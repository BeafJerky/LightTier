//! Install pipeline: download → verify → extract → atomic rename.
//!
//! A task writes only inside `<data>/tmp/<task-id>/` until the staged binaries
//! match the manifest, then publishes them with one `rename` into
//! `<data>/core/<version>`. Every exit path removes the staging tree, so a crash
//! or cancellation can never leave a half-installed version that the supervisor
//! would happily spawn.

use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::{Component, Path};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
use zip::ZipArchive;

use super::manifest::LinuxPackage;
use super::tasks;
use super::{is_safe_version, Packages};
use crate::error::ApiError;

/// Refuse to start when the data volume has less than this much free; an
/// official archive is ~30 MiB but unpacking needs several times that.
const MIN_FREE_BYTES: u64 = 600 * 1024 * 1024;
/// Hard cap on the downloaded archive, so a lying `Content-Length` or a hostile
/// mirror cannot fill the volume.
const MAX_PACKAGE_BYTES: u64 = 200 * 1024 * 1024;
/// Hard cap on uncompressed bytes, the usual zip-bomb guard. It applies to the
/// staging tree as a whole (one cumulative counter across every entry we take
/// out of the archive), so splitting an oversized payload over many entries
/// buys nothing.
const MAX_UNPACKED_BYTES: u64 = 500 * 1024 * 1024;
/// Cap on archive entries.
const MAX_ARCHIVE_ENTRIES: usize = 500;
/// Progress is published at most this often while streaming.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
/// The only two entries an install takes out of an archive.
const BINARIES: [&str; 2] = ["easytier-core", "easytier-cli"];

/// How a step stopped before publishing a version.
enum Stop {
    Canceled,
    Failed(ApiError),
}

type Step = Result<(), Stop>;

impl From<ApiError> for Stop {
    fn from(err: ApiError) -> Self {
        Self::Failed(err)
    }
}

impl From<std::io::Error> for Stop {
    fn from(err: std::io::Error) -> Self {
        Self::Failed(ApiError::from(err))
    }
}

fn bad_package(detail: impl Into<String>) -> Stop {
    Stop::Failed(ApiError::BadPackage {
        detail: detail.into(),
    })
}

impl Packages {
    /// Starts an install and returns the task id immediately; the download and
    /// verification continue in the background.
    ///
    /// Every cheap precondition (this deployment installs at all, manifest entry,
    /// already installed, task already running, free space) is checked here so the
    /// HTTP caller gets a real error instead of a task that fails a moment later.
    pub async fn install(&self, version: &str) -> Result<String, ApiError> {
        let inner = &*self.inner;
        // First, before anything is created on disk: under an `LT_CORE_DIR`
        // override the publish target `<data>/core` is never scanned, so the
        // version would install "successfully" and stay invisible forever.
        if !inner.install_allowed {
            return Err(ApiError::CoreOverrideReadOnly);
        }
        let pkg = inner
            .lookup(version)
            .ok_or(ApiError::CoreVersionUnsupported)?;
        tokio::fs::create_dir_all(&inner.data_dir).await?;
        // Any root counts, including the image-provided (baked) one: a builtin
        // copy shadows whatever we would download, so the version is "installed".
        if inner.holds_version(version) {
            return Err(ApiError::PackageExists);
        }
        if (inner.free_bytes)(&inner.data_dir) < MIN_FREE_BYTES {
            return Err(ApiError::DiskFull);
        }
        // Check-and-insert under one lock: two concurrent requests for the same
        // version cannot both start a download.
        let Some((id, cancel)) = inner.tasks.create_if_idle(version) else {
            return Err(ApiError::TaskInProgress);
        };
        let packages = self.clone();
        let task_id = id.clone();
        tokio::spawn(async move { packages.run_install(task_id, pkg, cancel).await });
        Ok(id)
    }

    /// Deletes one version the agent installed under `<data>/core`.
    ///
    /// Filesystem only on purpose: whether the version may be removed while
    /// instances run is a runtime question, and the HTTP layer owns the
    /// supervisor. It must answer `409 instance_running` when this version is the
    /// active one and any instance is running; coupling `packages` to the
    /// supervisor here would invert the dependency direction.
    pub async fn remove(&self, version: &str) -> Result<(), ApiError> {
        if !is_safe_version(version) {
            return Err(ApiError::InvalidId);
        }
        let inner = &*self.inner;
        // A running task owns the tree it is about to publish; refuse instead of
        // deleting underneath its `rename`.
        if inner.tasks.in_progress(version) {
            return Err(ApiError::TaskInProgress);
        }
        let target = inner.target_dir(version);
        if !target.exists() {
            // Only the image ships this version: read-only, even for a caller
            // that never asked about the builtin root.
            return if inner.builtin_dir.join(version).exists() {
                Err(ApiError::BuiltinPackage)
            } else {
                Err(ApiError::NotFound)
            };
        }
        // The agent's own copy wins: a version present under both roots is
        // uninstalled from `<data>/core`, after which resolution falls back to
        // the builtin copy (the image stays untouched).
        remove_tree(&target).await
    }

    /// Runs the pipeline and publishes the terminal state. The staging tree is
    /// removed before the state flips, so a `canceled`/`failed` task the UI sees
    /// is already cleaned up.
    async fn run_install(self, id: String, pkg: &'static LinuxPackage, cancel: CancellationToken) {
        let tmp = self.inner.tmp_dir(&id);
        let result = self.install_steps(&id, pkg, &cancel).await;
        let _ = tokio::fs::remove_dir_all(&tmp).await;
        let tasks = &self.inner.tasks;
        let (state, error) = match result {
            Ok(()) => (tasks::DONE, None),
            Err(Stop::Canceled) => (tasks::CANCELED, None),
            Err(Stop::Failed(err)) => (tasks::FAILED, Some(err.payload())),
        };
        tasks.finish(&id, state, error);
        // The HTTP layer audits a failure here: the request that started the task
        // was answered with a 202 long ago, so the pipeline is the only place that
        // still knows how it ended. The hook is cloned out before it runs so a
        // slow observer cannot hold the registry or this handle.
        if let Some(hook) = self.inner.on_finish.clone() {
            if let Some(view) = self.task(&id) {
                hook(&view);
            }
        }
    }

    async fn install_steps(
        &self,
        id: &str,
        pkg: &'static LinuxPackage,
        cancel: &CancellationToken,
    ) -> Step {
        let inner = &*self.inner;
        let tmp = inner.tmp_dir(id);
        tokio::fs::create_dir_all(&tmp).await?;
        let archive = tmp.join("package.zip");
        let stage = tmp.join("stage");

        self.download(id, pkg, &archive, cancel).await?;
        check_canceled(cancel)?;

        inner.tasks.update(id, |view| view.state = tasks::VERIFYING);
        check_zip_header(&archive).await?;
        check_canceled(cancel)?;

        inner
            .tasks
            .update(id, |view| view.state = tasks::EXTRACTING);
        let extracted = {
            let archive = archive.clone();
            let stage = stage.clone();
            let pkg = *pkg;
            tokio::task::spawn_blocking(move || extract_verified(&archive, &stage, &pkg))
                .await
                .map_err(|err| {
                    Stop::Failed(ApiError::Internal(format!("unpack task failed: {err}")))
                })?
        };
        extracted.map_err(Stop::Failed)?;
        check_canceled(cancel)?;

        inner
            .tasks
            .update(id, |view| view.state = tasks::INSTALLING);
        for name in BINARIES {
            make_executable(&stage.join(name)).await?;
        }
        tokio::fs::create_dir_all(inner.target_root()).await?;
        let target = inner.target_dir(pkg.version);
        // Re-checked right before publishing: a concurrent install or a manual
        // `mkdir` must not be overwritten.
        if target.exists() {
            return Err(Stop::Failed(ApiError::PackageExists));
        }
        // Same filesystem: the version appears complete or not at all. A target
        // that appears between the check and the rename (another agent process,
        // a manual `mkdir`) surfaces as `ENOTEMPTY`/`EEXIST`, i.e. a conflict.
        match tokio::fs::rename(&stage, &target).await {
            Ok(()) => Ok(()),
            Err(err) if is_dir_conflict(&err) => Err(Stop::Failed(ApiError::PackageExists)),
            Err(err) => Err(Stop::from(err)),
        }
    }

    /// Streams the release archive to `archive`, hashing and reporting progress
    /// while it goes. The digest is compared to the manifest after the final
    /// byte, so a truncated or tampered download never reaches the unpacker.
    async fn download(
        &self,
        id: &str,
        pkg: &'static LinuxPackage,
        archive: &Path,
        cancel: &CancellationToken,
    ) -> Step {
        let tasks = &self.inner.tasks;
        let url = self.inner.download_url(pkg.version);
        tasks.update(id, |view| view.state = tasks::DOWNLOADING);

        let response = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(Stop::Canceled),
            response = self.inner.http.get(&url).send() => {
                response.map_err(|err| Stop::Failed(transport_error("download", &err)))?
            },
        };
        let status = response.status();
        if !status.is_success() {
            return Err(bad_package(format!(
                "download returned HTTP {}",
                status.as_u16()
            )));
        }
        let total = response.content_length();
        tasks.update(id, |view| view.total = total);

        let mut body = response;
        let mut file = tokio::fs::File::create(archive).await?;
        let mut hasher = Sha256::new();
        let mut downloaded: u64 = 0;
        let mut reported = Instant::now();
        loop {
            let chunk = tokio::select! {
                biased;
                _ = cancel.cancelled() => return Err(Stop::Canceled),
                chunk = body.chunk() => chunk
                    .map_err(|err| Stop::Failed(transport_error("download body", &err)))?,
            };
            let Some(chunk) = chunk else { break };
            downloaded += chunk.len() as u64;
            if downloaded > MAX_PACKAGE_BYTES {
                return Err(bad_package(format!(
                    "archive exceeds {MAX_PACKAGE_BYTES} bytes"
                )));
            }
            hasher.update(&chunk);
            file.write_all(&chunk).await?;
            if reported.elapsed() >= PROGRESS_INTERVAL {
                tasks.update(id, |view| view.downloaded = downloaded);
                reported = Instant::now();
            }
        }
        file.flush().await?;
        file.sync_all().await?;
        // A finished task always reports a total, even without `Content-Length`.
        tasks.update(id, |view| {
            view.downloaded = downloaded;
            view.total = Some(total.unwrap_or(downloaded));
        });
        if !hex::encode(hasher.finalize()).eq_ignore_ascii_case(pkg.package) {
            return Err(Stop::Failed(ApiError::ChecksumMismatch));
        }
        Ok(())
    }
}

fn check_canceled(cancel: &CancellationToken) -> Step {
    if cancel.is_cancelled() {
        Err(Stop::Canceled)
    } else {
        Ok(())
    }
}

/// Deletes a version directory, reporting a tree that vanished under us as
/// `not_found` rather than a 500.
async fn remove_tree(path: &Path) -> Result<(), ApiError> {
    match tokio::fs::remove_dir_all(path).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Err(ApiError::NotFound),
        Err(err) => Err(ApiError::from(err)),
    }
}

/// `rename` onto a non-empty directory fails with `ENOTEMPTY` and onto an
/// existing non-directory with `EEXIST`; both mean "the target is taken".
fn is_dir_conflict(err: &std::io::Error) -> bool {
    matches!(
        err.raw_os_error(),
        Some(code) if code == libc::ENOTEMPTY || code == libc::EEXIST
    )
}

/// Maps a transport failure to the generic 500 while naming the phase that
/// failed, so an operator can tell a DNS/connect problem from a stalled or
/// truncated transfer. Network errors are transient and retryable, which is why
/// they are not `bad_package` (that would tell the UI the archive is at fault).
fn transport_error(phase: &str, err: &reqwest::Error) -> ApiError {
    let kind = match (err.is_connect(), err.is_timeout()) {
        (true, true) => "connect timeout",
        (true, false) => "connect",
        (false, true) => "timeout",
        _ if err.is_body() => "body",
        _ if err.is_decode() => "decode",
        _ => "transport",
    };
    ApiError::Internal(format!("{phase} failed ({kind}): {err}"))
}

/// The archive must start with a zip local file header. A GitHub error page
/// saved as a file would otherwise reach `ZipArchive` with a confusing error.
async fn check_zip_header(archive: &Path) -> Step {
    let mut file = tokio::fs::File::open(archive).await?;
    let mut magic = [0u8; 4];
    let read = file.read(&mut magic).await?;
    if read < magic.len() || magic != *b"PK\x03\x04" {
        return Err(bad_package("archive does not start with a zip header"));
    }
    Ok(())
}

async fn make_executable(path: &Path) -> std::io::Result<()> {
    let mut permissions = tokio::fs::metadata(path).await?.permissions();
    permissions.set_mode(0o755);
    tokio::fs::set_permissions(path, permissions).await
}

/// Unpacks the two binaries into `stage` and verifies them against the manifest.
/// Blocking on purpose: it runs inside `spawn_blocking`, and doing it off the
/// async worker keeps progress polling responsive.
fn extract_verified(archive: &Path, stage: &Path, pkg: &LinuxPackage) -> Result<(), ApiError> {
    let file = std::fs::File::open(archive)?;
    let mut zip = ZipArchive::new(file).map_err(|err| ApiError::BadPackage {
        detail: format!("unreadable zip: {err}"),
    })?;
    if zip.len() > MAX_ARCHIVE_ENTRIES {
        return Err(ApiError::BadPackage {
            detail: format!(
                "archive holds {} entries, at most {MAX_ARCHIVE_ENTRIES} allowed",
                zip.len()
            ),
        });
    }
    std::fs::create_dir_all(stage)?;
    // ONE counter for the whole staging tree, shared by every entry we extract:
    // the cap is a property of what we write to disk, not of a single entry, so
    // an archive cannot multiply its budget by splitting the payload up.
    let mut staged: u64 = 0;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|err| ApiError::BadPackage {
            detail: format!("unreadable zip entry {index}: {err}"),
        })?;
        let name = entry.name().to_owned();
        // Traversal and absolute paths are rejected for every entry, not only
        // for the two we keep: a hostile archive must fail loudly.
        if !is_safe_entry_name(&name) {
            return Err(ApiError::BadPackage {
                detail: format!("unsafe archive entry {name:?}"),
            });
        }
        if entry.is_dir() {
            continue;
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(ApiError::BadPackage {
                detail: format!("archive entry {name:?} is a symlink"),
            });
        }
        let Some(base) = name.rsplit('/').next() else {
            return Err(ApiError::BadPackage {
                detail: format!("archive entry {name:?} has no file name"),
            });
        };
        if !BINARIES.contains(&base) {
            continue;
        }
        let destination = stage.join(base);
        let mut out = std::fs::File::create(&destination)?;
        copy_capped(&mut entry, &mut out, &mut staged).map_err(|err| ApiError::BadPackage {
            detail: format!("corrupt entry {name:?}: {err}"),
        })?;
    }

    for name in BINARIES {
        if !stage.join(name).is_file() {
            return Err(ApiError::BadPackage {
                detail: format!("archive is missing {name}"),
            });
        }
    }
    verify_digest(&stage.join("easytier-core"), pkg.core)?;
    verify_digest(&stage.join("easytier-cli"), pkg.cli)?;
    Ok(())
}

/// Rejects empty names, absolute paths and any `..` component.
fn is_safe_entry_name(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    let path = Path::new(name);
    if path.is_absolute() {
        return false;
    }
    path.components()
        .all(|part| matches!(part, Component::Normal(_) | Component::CurDir))
}

/// Copies an archive entry, charging the *actual* bytes written against the
/// caller's cumulative counter. Declared entry sizes are never trusted, and the
/// counter is shared across entries so the cap covers the whole staging tree.
fn copy_capped(
    reader: &mut impl Read,
    writer: &mut impl std::io::Write,
    staged: &mut u64,
) -> std::io::Result<u64> {
    let mut buffer = vec![0u8; 64 * 1024];
    let mut written: u64 = 0;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok(written);
        }
        written = written.saturating_add(read as u64);
        *staged = staged.saturating_add(read as u64);
        if *staged > MAX_UNPACKED_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("staged more than {MAX_UNPACKED_BYTES} bytes"),
            ));
        }
        writer.write_all(&buffer[..read])?;
    }
}

fn verify_digest(path: &Path, expected: &str) -> Result<(), ApiError> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    if hex::encode(hasher.finalize()).eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(ApiError::ChecksumMismatch)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::packages::manifest::Channel;
    use crate::packages::TaskView;

    const VERSION: &str = "v9.9.9";
    const CORE_BODY: &[u8] = b"#!/bin/sh\nexit 0\n";
    const CLI_BODY: &[u8] = b"#!/bin/sh\necho cli\n";

    fn sha256(bytes: &[u8]) -> String {
        hex::encode(Sha256::digest(bytes))
    }

    /// Builds a deflated zip in memory, so tests never touch the network.
    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let cursor = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o644);
        for (name, body) in entries {
            writer.start_file(*name, options).unwrap();
            std::io::Write::write_all(&mut writer, body).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn zip_fixture() -> Vec<u8> {
        build_zip(&[("easytier-core", CORE_BODY), ("easytier-cli", CLI_BODY)])
    }

    /// `'static` manifest is what `Packages` requires; tests leak their tables.
    fn static_manifest(package: String, core: String, cli: String) -> &'static [LinuxPackage] {
        Box::leak(Box::new(vec![LinuxPackage {
            version: VERSION,
            channel: Channel::Stable,
            package: Box::leak(package.into_boxed_str()),
            core: Box::leak(core.into_boxed_str()),
            cli: Box::leak(cli.into_boxed_str()),
        }]))
    }

    fn manifest_for(archive: &[u8]) -> &'static [LinuxPackage] {
        static_manifest(sha256(archive), sha256(CORE_BODY), sha256(CLI_BODY))
    }

    struct Server {
        base: String,
        paths: Arc<Mutex<Vec<String>>>,
        connections: Arc<AtomicUsize>,
    }

    /// Minimal HTTP/1.1 server: one response per connection, `Content-Length`
    /// set, optional slow drip so a test can cancel mid-download.
    async fn serve(status: u16, body: Vec<u8>, delay: Option<Duration>) -> Server {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let paths = Arc::new(Mutex::new(Vec::new()));
        let connections = Arc::new(AtomicUsize::new(0));
        let seen_paths = paths.clone();
        let seen_connections = connections.clone();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                seen_connections.fetch_add(1, Ordering::Relaxed);
                let body = body.clone();
                let paths = seen_paths.clone();
                tokio::spawn(async move {
                    let mut head = Vec::new();
                    let mut buffer = [0u8; 512];
                    loop {
                        match stream.read(&mut buffer).await {
                            Ok(0) | Err(_) => return,
                            Ok(read) => head.extend_from_slice(&buffer[..read]),
                        }
                        if head.windows(4).any(|window| window == b"\r\n\r\n") {
                            break;
                        }
                        if head.len() > 8192 {
                            return;
                        }
                    }
                    let request = String::from_utf8_lossy(&head).into_owned();
                    if let Some(path) = request.split_whitespace().nth(1) {
                        paths.lock().unwrap().push(path.to_owned());
                    }
                    let reply = format!(
                        "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nContent-Type: application/zip\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    if stream.write_all(reply.as_bytes()).await.is_err() {
                        return;
                    }
                    match delay {
                        Some(delay) => {
                            for chunk in body.chunks(16) {
                                if stream.write_all(chunk).await.is_err() {
                                    return;
                                }
                                if stream.flush().await.is_err() {
                                    return;
                                }
                                tokio::time::sleep(delay).await;
                            }
                        }
                        None => {
                            let _ = stream.write_all(&body).await;
                        }
                    }
                    let _ = stream.shutdown().await;
                });
            }
        });
        Server {
            base,
            paths,
            connections,
        }
    }

    fn packages(dir: &Path, manifest: &'static [LinuxPackage], mirror: Option<String>) -> Packages {
        Packages::with_manifest(&dir.join("data"), dir.join("builtin"), manifest)
            .with_mirror(mirror)
    }

    fn requests(server: &Server) -> Vec<String> {
        server.paths.lock().unwrap().clone()
    }

    fn entries(dir: &Path) -> usize {
        std::fs::read_dir(dir)
            .map(|items| items.count())
            .unwrap_or(0)
    }

    /// A failed or cancelled task must leave neither its staging tree nor the
    /// downloaded archive behind: `<data>/tmp` is empty again.
    fn assert_no_leftovers(dir: &Path, id: &str) {
        assert!(
            !dir.join("data/tmp").join(id).exists(),
            "staging tree of task {id} must be gone"
        );
        assert_eq!(entries(&dir.join("data/tmp")), 0, "tmp must be empty");
    }

    async fn wait_finished(packages: &Packages, id: &str) -> TaskView {
        for _ in 0..500 {
            let view = packages.task(id).expect("task snapshot must exist");
            if view.is_finished() {
                return view;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("install task {id} did not finish in time");
    }

    fn mode_of(path: &Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    fn write_fake_install(root: &Path, version: &str) {
        let dir = root.join(version);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("easytier-core"), CORE_BODY).unwrap();
    }

    #[tokio::test]
    async fn install_downloads_verifies_and_publishes_the_binaries() {
        let archive = zip_fixture();
        let server = serve(200, archive.clone(), None).await;
        let dir = tempfile::tempdir().unwrap();
        let packages = packages(
            dir.path(),
            manifest_for(&archive),
            Some(server.base.clone()),
        );

        let id = packages.install(VERSION).await.unwrap();
        assert_eq!(id, "9.9.9-1", "ids drop the v prefix and carry a sequence");
        let view = wait_finished(&packages, &id).await;
        assert_eq!(view.state, tasks::DONE);
        assert!(view.error.is_none());
        assert_eq!(view.downloaded, view.total.unwrap());
        assert_eq!(view.total, Some(archive.len() as u64));

        let installed = dir.path().join("data/core").join(VERSION);
        assert_eq!(
            std::fs::read(installed.join("easytier-core")).unwrap(),
            CORE_BODY
        );
        assert_eq!(
            std::fs::read(installed.join("easytier-cli")).unwrap(),
            CLI_BODY
        );
        assert_eq!(mode_of(&installed.join("easytier-core")), 0o755);
        assert_eq!(mode_of(&installed.join("easytier-cli")), 0o755);
        assert_eq!(
            entries(&dir.path().join("data/tmp")),
            0,
            "staging must be gone"
        );

        // Resolution and listing pick the new version up immediately.
        assert_eq!(packages.active_version().as_deref(), Some(VERSION));
        assert_eq!(packages.list_installed().len(), 1);

        // The mirror is a plain prefix in front of the official URL.
        let paths = requests(&server);
        assert_eq!(paths.len(), 1);
        assert!(
            paths[0].starts_with("/https://github.com/EasyTier/EasyTier/releases/download/v9.9.9/")
        );
    }

    #[tokio::test]
    async fn wrong_archive_digest_fails_and_leaves_nothing_behind() {
        let archive = zip_fixture();
        let manifest = static_manifest("0".repeat(64), sha256(CORE_BODY), sha256(CLI_BODY));
        let server = serve(200, archive, None).await;
        let dir = tempfile::tempdir().unwrap();
        let packages = packages(dir.path(), manifest, Some(server.base.clone()));

        let id = packages.install(VERSION).await.unwrap();
        let view = wait_finished(&packages, &id).await;
        assert_eq!(view.state, tasks::FAILED);
        assert_eq!(view.error.unwrap()["code"], "checksum_mismatch");
        assert!(!dir.path().join("data/core").join(VERSION).exists());
        assert_no_leftovers(dir.path(), &id);
    }

    #[tokio::test]
    async fn wrong_binary_digest_fails_even_when_the_archive_matches() {
        let archive = zip_fixture();
        let manifest = static_manifest(sha256(&archive), "0".repeat(64), sha256(CLI_BODY));
        let server = serve(200, archive, None).await;
        let dir = tempfile::tempdir().unwrap();
        let packages = packages(dir.path(), manifest, Some(server.base.clone()));

        let id = packages.install(VERSION).await.unwrap();
        let view = wait_finished(&packages, &id).await;
        assert_eq!(view.state, tasks::FAILED);
        assert_eq!(view.error.unwrap()["code"], "checksum_mismatch");
        assert!(!dir.path().join("data/core").join(VERSION).exists());
        assert_no_leftovers(dir.path(), &id);
    }

    #[tokio::test]
    async fn traversal_entries_are_rejected() {
        let archive = build_zip(&[
            ("easytier-core", CORE_BODY),
            ("easytier-cli", CLI_BODY),
            ("../evil", b"pwn"),
        ]);
        let server = serve(200, archive.clone(), None).await;
        let dir = tempfile::tempdir().unwrap();
        let packages = packages(
            dir.path(),
            manifest_for(&archive),
            Some(server.base.clone()),
        );

        let id = packages.install(VERSION).await.unwrap();
        let view = wait_finished(&packages, &id).await;
        assert_eq!(view.state, tasks::FAILED);
        assert_eq!(view.error.unwrap()["code"], "bad_package");
        assert!(!dir.path().join("data/core").join(VERSION).exists());
        assert!(!dir.path().join("data/evil").exists());
        assert!(!dir.path().join("evil").exists());
        assert_no_leftovers(dir.path(), &id);
    }

    #[tokio::test]
    async fn archive_without_a_zip_header_is_rejected() {
        let body = b"<html>not a release</html>".to_vec();
        let manifest = static_manifest(sha256(&body), sha256(CORE_BODY), sha256(CLI_BODY));
        let server = serve(200, body, None).await;
        let dir = tempfile::tempdir().unwrap();
        let packages = packages(dir.path(), manifest, Some(server.base.clone()));

        let id = packages.install(VERSION).await.unwrap();
        let view = wait_finished(&packages, &id).await;
        assert_eq!(view.state, tasks::FAILED);
        assert_eq!(view.error.unwrap()["code"], "bad_package");
        assert_no_leftovers(dir.path(), &id);
    }

    #[tokio::test]
    async fn archive_missing_a_binary_is_rejected() {
        let archive = build_zip(&[("easytier-core", CORE_BODY)]);
        let server = serve(200, archive.clone(), None).await;
        let dir = tempfile::tempdir().unwrap();
        let packages = packages(
            dir.path(),
            manifest_for(&archive),
            Some(server.base.clone()),
        );

        let id = packages.install(VERSION).await.unwrap();
        let view = wait_finished(&packages, &id).await;
        assert_eq!(view.state, tasks::FAILED);
        assert_eq!(view.error.unwrap()["code"], "bad_package");
        assert_no_leftovers(dir.path(), &id);
    }

    #[tokio::test]
    async fn download_error_status_is_reported_as_bad_package() {
        let server = serve(503, b"nope".to_vec(), None).await;
        let dir = tempfile::tempdir().unwrap();
        let packages = packages(
            dir.path(),
            static_manifest("0".repeat(64), sha256(CORE_BODY), sha256(CLI_BODY)),
            Some(server.base.clone()),
        );

        let id = packages.install(VERSION).await.unwrap();
        let view = wait_finished(&packages, &id).await;
        assert_eq!(view.state, tasks::FAILED);
        let error = view.error.unwrap();
        assert_eq!(error["code"], "bad_package");
        assert!(
            error["message"].as_str().unwrap().contains("503"),
            "message must carry the status: {error}"
        );
        assert_no_leftovers(dir.path(), &id);
    }

    #[tokio::test]
    async fn cancel_stops_a_running_download_and_cleans_up() {
        let archive = zip_fixture();
        // Slow enough that the transfer is still running once real progress was
        // observed; a fixed sleep would race a loaded CI box.
        let server = serve(200, archive.clone(), Some(Duration::from_millis(60))).await;
        let dir = tempfile::tempdir().unwrap();
        let packages = packages(
            dir.path(),
            manifest_for(&archive),
            Some(server.base.clone()),
        );

        let started = Instant::now();
        let id = packages.install(VERSION).await.unwrap();
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "install must return before the download finishes"
        );
        assert!(!packages.task(&id).unwrap().is_finished());

        // Wait for the first reported byte instead of guessing a delay: a
        // cancel before the body starts would only test the pre-download check.
        let mut view = packages.task(&id).unwrap();
        for _ in 0..500 {
            view = packages.task(&id).unwrap();
            if view.downloaded > 0 || view.is_finished() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(view.downloaded > 0, "download must have made progress");
        assert!(
            !view.is_finished(),
            "cancel must hit a running task: {view:?}"
        );

        let view = packages.cancel(&id).unwrap();
        assert!(!view.is_finished(), "the worker reports the cancellation");

        let view = wait_finished(&packages, &id).await;
        assert_eq!(view.state, tasks::CANCELED);
        assert!(view.error.is_none());
        assert!(!dir.path().join("data/core").join(VERSION).exists());
        assert_no_leftovers(dir.path(), &id);
        // Cancelling an unknown task is a 404, not a silent no-op.
        assert_eq!(packages.cancel("nope").unwrap_err().code(), "not_found");
    }

    #[tokio::test]
    async fn archive_with_too_many_entries_is_rejected() {
        // 501 entries of a few bytes each: far below every size cap, so the entry
        // count is the only guard that can stop it (and it must not unpack).
        let mut items: Vec<(String, &'static [u8])> = vec![
            ("easytier-core".to_owned(), CORE_BODY),
            ("easytier-cli".to_owned(), CLI_BODY),
        ];
        for index in 0..MAX_ARCHIVE_ENTRIES - 1 {
            items.push((format!("padding-{index:03}"), &b"x"[..]));
        }
        assert_eq!(items.len(), MAX_ARCHIVE_ENTRIES + 1);
        let borrowed: Vec<(&str, &[u8])> = items
            .iter()
            .map(|(name, body)| (name.as_str(), *body))
            .collect();
        let archive = build_zip(&borrowed);
        assert!(archive.len() as u64 <= MAX_PACKAGE_BYTES);

        let server = serve(200, archive.clone(), None).await;
        let dir = tempfile::tempdir().unwrap();
        let packages = packages(
            dir.path(),
            manifest_for(&archive),
            Some(server.base.clone()),
        );

        let id = packages.install(VERSION).await.unwrap();
        let view = wait_finished(&packages, &id).await;
        assert_eq!(view.state, tasks::FAILED);
        let error = view.error.unwrap();
        assert_eq!(error["code"], "bad_package");
        assert!(
            error["params"]["detail"]
                .as_str()
                .unwrap()
                .contains("501 entries"),
            "message must name the entry count: {error}"
        );
        assert!(!dir.path().join("data/core").join(VERSION).exists());
        assert_no_leftovers(dir.path(), &id);
    }

    #[tokio::test]
    async fn refused_connection_is_reported_as_an_internal_transport_error() {
        let archive = zip_fixture();
        let dir = tempfile::tempdir().unwrap();
        // Bind and drop, so the port is (almost certainly) closed: the connect
        // itself fails, which is a transport problem, not a bad archive.
        let port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let packages = packages(
            dir.path(),
            manifest_for(&archive),
            Some(format!("http://127.0.0.1:{port}")),
        );

        let id = packages.install(VERSION).await.unwrap();
        let view = wait_finished(&packages, &id).await;
        assert_eq!(view.state, tasks::FAILED);
        let error = view.error.unwrap();
        assert_eq!(error["code"], "internal");
        let message = error["message"].as_str().unwrap();
        assert!(
            message.contains("connect"),
            "message must name the failing phase: {message}"
        );
        assert!(!dir.path().join("data/core").join(VERSION).exists());
        assert_no_leftovers(dir.path(), &id);
    }

    #[tokio::test]
    async fn install_rejects_unknown_and_already_installed_versions() {
        let archive = zip_fixture();
        let server = serve(200, archive.clone(), None).await;
        let dir = tempfile::tempdir().unwrap();
        let packages = packages(
            dir.path(),
            manifest_for(&archive),
            Some(server.base.clone()),
        );

        assert_eq!(
            packages.install("v8.8.8").await.unwrap_err().code(),
            "core_version_unsupported"
        );
        // A baked (image-provided) version also counts as installed: a local copy
        // would only shadow it.
        write_fake_install(&dir.path().join("builtin"), VERSION);
        assert_eq!(
            packages.install(VERSION).await.unwrap_err().code(),
            "package_exists"
        );
        std::fs::remove_dir_all(dir.path().join("builtin")).unwrap();
        // Same for a version this agent installed earlier.
        std::fs::create_dir_all(dir.path().join("data/core").join(VERSION)).unwrap();
        assert_eq!(
            packages.install(VERSION).await.unwrap_err().code(),
            "package_exists"
        );
        assert!(
            requests(&server).is_empty(),
            "rejected installs never download"
        );
    }

    #[tokio::test]
    async fn second_install_of_a_running_version_is_rejected() {
        let archive = zip_fixture();
        let server = serve(200, archive.clone(), Some(Duration::from_millis(25))).await;
        let dir = tempfile::tempdir().unwrap();
        let packages = packages(
            dir.path(),
            manifest_for(&archive),
            Some(server.base.clone()),
        );

        let id = packages.install(VERSION).await.unwrap();
        assert_eq!(
            packages.install(VERSION).await.unwrap_err().code(),
            "task_in_progress"
        );
        assert_eq!(
            packages.remove(VERSION).await.unwrap_err().code(),
            "task_in_progress"
        );
        packages.cancel(&id).unwrap();
        assert_eq!(wait_finished(&packages, &id).await.state, tasks::CANCELED);
    }

    #[tokio::test]
    async fn disk_full_is_reported_before_any_download() {
        let archive = zip_fixture();
        let server = serve(200, archive.clone(), None).await;
        let dir = tempfile::tempdir().unwrap();
        let packages = packages(
            dir.path(),
            manifest_for(&archive),
            Some(server.base.clone()),
        )
        .with_free_bytes(|_| MIN_FREE_BYTES - 1);

        assert_eq!(
            packages.install(VERSION).await.unwrap_err().code(),
            "disk_full"
        );
        assert!(requests(&server).is_empty());
        assert_eq!(server.connections.load(Ordering::Relaxed), 0);

        // The real probe on a real directory reports enough space to install.
        assert!(crate::packages::free_bytes(dir.path()) >= MIN_FREE_BYTES);
    }

    #[tokio::test]
    async fn finish_hook_sees_the_failed_terminal_state_once() {
        let archive = zip_fixture();
        // Wrong archive digest: the task fails after the download, which is
        // exactly the outcome the HTTP layer has to audit afterwards.
        let manifest = static_manifest("0".repeat(64), sha256(CORE_BODY), sha256(CLI_BODY));
        let server = serve(200, archive, None).await;
        let dir = tempfile::tempdir().unwrap();
        let seen: Arc<Mutex<Vec<(String, String)>>> = Arc::new(Mutex::new(Vec::new()));
        let recorded = seen.clone();
        let packages =
            packages(dir.path(), manifest, Some(server.base.clone())).on_finish(move |view| {
                let code = view
                    .error
                    .as_ref()
                    .and_then(|error| error["code"].as_str())
                    .unwrap_or(view.state)
                    .to_owned();
                recorded.lock().unwrap().push((view.version.clone(), code));
            });

        let id = packages.install(VERSION).await.unwrap();
        assert_eq!(wait_finished(&packages, &id).await.state, tasks::FAILED);
        assert_eq!(
            *seen.lock().unwrap(),
            vec![(VERSION.to_string(), "checksum_mismatch".to_string())],
            "one terminal notification, carrying the version and the code"
        );
        assert_no_leftovers(dir.path(), &id);
    }

    #[tokio::test]
    async fn refusal_paths_never_reach_the_finish_hook() {
        // A rejected install never becomes a task, so the observer stays silent:
        // the HTTP layer audits the 4xx itself and must not get a second event.
        let archive = zip_fixture();
        let dir = tempfile::tempdir().unwrap();
        let seen = Arc::new(Mutex::new(0usize));
        let counter = seen.clone();
        let packages = Packages::with_manifest(
            &dir.path().join("data"),
            dir.path().join("builtin"),
            manifest_for(&archive),
        )
        .on_finish(move |_| *counter.lock().unwrap() += 1);

        assert_eq!(
            packages.install("v8.8.8").await.unwrap_err().code(),
            "core_version_unsupported"
        );
        assert_eq!(*seen.lock().unwrap(), 0);
    }

    #[tokio::test]
    async fn refused_paths_never_touch_the_override_layout() {
        let dir = tempfile::tempdir().unwrap();
        let packages = Packages::with_manifest(
            &dir.path().join("data"),
            dir.path().join("builtin"),
            manifest_for(&zip_fixture()),
        )
        .with_core_override(Some(dir.path().join("operator-core")));

        // Nothing to publish into a root that is never scanned: refuse before a
        // task (or even the data directory) exists.
        assert_eq!(
            packages.install(VERSION).await.unwrap_err().code(),
            "core_override_read_only"
        );
        assert!(!dir.path().join("data/core").exists());
    }

    #[tokio::test]
    async fn remove_deletes_installs_and_protects_builtin_versions() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let builtin = dir.path().join("builtin");
        let packages =
            Packages::with_manifest(&data, builtin.clone(), manifest_for(&zip_fixture()));

        // Only the image ships this version: it is read-only.
        write_fake_install(&builtin, VERSION);
        assert_eq!(
            packages.remove(VERSION).await.unwrap_err().code(),
            "builtin_package"
        );
        assert!(builtin.join(VERSION).exists());

        // The agent's own copy wins: it can be uninstalled even though the image
        // ships the same version, and the builtin copy becomes active again.
        write_fake_install(&data.join("core"), VERSION);
        packages.remove(VERSION).await.unwrap();
        assert!(!data.join("core").join(VERSION).exists());
        assert!(
            builtin.join(VERSION).exists(),
            "the builtin tree is untouched"
        );
        assert_eq!(packages.active_version().as_deref(), Some(VERSION));

        write_fake_install(&data.join("core"), "v2.6.4");
        packages.remove("v2.6.4").await.unwrap();
        assert!(!data.join("core/v2.6.4").exists());
        assert!(
            !data.join("core").join(VERSION).exists(),
            "removed versions stay removed"
        );

        assert_eq!(
            packages.remove("v2.4.5").await.unwrap_err().code(),
            "not_found"
        );
        assert_eq!(
            packages.remove("../evil").await.unwrap_err().code(),
            "invalid_id"
        );
        assert_eq!(packages.remove("").await.unwrap_err().code(), "invalid_id");
    }

    #[test]
    fn entry_names_are_validated_conservatively() {
        for name in ["easytier-core", "sub/easytier-cli", "./easytier-core"] {
            assert!(is_safe_entry_name(name), "{name} must be accepted");
        }
        for name in [
            "",
            "..",
            "../evil",
            "a/../../evil",
            "/etc/passwd",
            "sub/../easytier-core",
        ] {
            assert!(!is_safe_entry_name(name), "{name} must be rejected");
        }
    }
}

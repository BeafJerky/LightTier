//! Kernel package discovery, the single version-resolution rule, and the
//! install/remove entry points.
//!
//! Both the supervisor (which binary to spawn) and the CLI helper (which
//! `easytier-cli` to query with) go through [`Packages`], so every consumer
//! agrees on which installed version is active. The installed tree is
//! `<root>/<version>/easytier-core` (+ optional `easytier-cli`), with two roots:
//! the image-provided [`BUILTIN_CORE_DIR`] and `<data>/core` for agent installs.
//!
//! Install tasks are created here and executed by `install.rs` in the
//! background; [`Packages`] itself is a cheap `Arc` handle so the HTTP state and
//! the spawned task share one registry, one manifest and one mirror setting.

mod install;
mod manifest;
mod tasks;

pub use manifest::{
    asset_name, lookup, official_url, Channel, LinuxPackage, DEFAULT_VERSION, LINUX_PACKAGES,
};
pub use tasks::{TaskView, Tasks};

use std::cmp::Reverse;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use crate::error::ApiError;

/// Root the Docker image (or an operator) places verified kernels in. Read-only
/// at runtime and never touched by install/remove.
pub const BUILTIN_CORE_DIR: &str = "/opt/lighttier/core";

/// Environment variable holding an optional download mirror. When set, the
/// download URL becomes `<mirror>/<official_url>` (same trick as `ghfast.top`).
pub const MIRROR_ENV: &str = "LT_CORE_MIRROR";

/// Time budget for opening the TCP/TLS connection to the release mirror.
const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Time budget for one whole archive transfer, connect included, so a mirror
/// that stops sending cannot pin an install task (and its staging tree) forever.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);

/// Resolved EasyTier kernel binaries. `cli` is `None` when the release does not
/// ship `easytier-cli` next to `easytier-core`.
#[derive(Debug, Clone)]
pub struct CorePaths {
    pub core: PathBuf,
    pub cli: Option<PathBuf>,
    pub version: String,
}

/// One kernel version present on disk.
#[derive(Debug, Clone)]
pub struct InstalledPackage {
    pub version: String,
    /// Directory holding the binaries (`<root>/<version>`, or the root itself
    /// for a flat layout).
    pub path: PathBuf,
    pub builtin: bool,
    pub has_core: bool,
    pub has_cli: bool,
}

/// Kernel package locations plus the release manifest.
///
/// Cloning is cheap (one `Arc`), so the install pipeline can own a handle while
/// the HTTP state keeps its own.
#[derive(Clone)]
pub struct Packages {
    inner: Arc<Inner>,
}

/// Called once with the terminal snapshot of an install task; the HTTP layer
/// uses it to audit a failure that happened after its request was answered.
type FinishHook = Arc<dyn Fn(&TaskView) + Send + Sync>;

/// Shared state behind [`Packages`]; every field is immutable after construction
/// so clones stay in sync.
#[derive(Clone)]
struct Inner {
    data_dir: PathBuf,
    /// Read-only root: versions under it are reported `builtin` and `remove`
    /// refuses them.
    builtin_dir: PathBuf,
    /// Roots scanned for kernels, in search order. Identity matters more than it
    /// looks: the supervisor scans exactly this list, so `/packages.active` is
    /// always the binary a spawn would run.
    roots: Vec<PathBuf>,
    /// Release table the installer and the `/packages` listing read.
    manifest: &'static [LinuxPackage],
    /// `<mirror>/<official_url>` prefix, from [`MIRROR_ENV`] or a test fixture.
    mirror: Option<String>,
    /// Free-bytes probe for the data volume. Injectable so the disk-full path is
    /// testable without filling a real filesystem.
    free_bytes: Arc<dyn Fn(&Path) -> u64 + Send + Sync>,
    /// False when `LT_CORE_DIR` replaced the scan list. Installs would land in
    /// `<data>/core`, which such a deployment never scans, so a version would be
    /// published but never resolvable; the pipeline refuses instead of writing
    /// an invisible tree (see [`Packages::install_allowed`]).
    install_allowed: bool,
    /// The one HTTP client every download shares, so connection limits and the
    /// connect/transfer timeouts are properties of the process, not of a call
    /// site. Cloning a [`Packages`] clones this handle, which keeps one pool.
    http: reqwest::Client,
    tasks: Arc<tasks::Tasks>,
    /// Terminal-state observer; `None` until a caller installs one.
    on_finish: Option<FinishHook>,
}

impl Packages {
    /// Default layout: the image-provided root plus `<data>/core`.
    pub fn new(data_dir: &Path) -> Self {
        Self::with_manifest(data_dir, PathBuf::from(BUILTIN_CORE_DIR), LINUX_PACKAGES)
    }

    /// Same as [`Packages::new`] with an explicit builtin root and manifest, for
    /// tests and for callers that ship a different release table.
    pub fn with_manifest(
        data_dir: &Path,
        builtin_dir: PathBuf,
        manifest: &'static [LinuxPackage],
    ) -> Self {
        let roots = default_roots(&builtin_dir, data_dir);
        Self::build(data_dir, builtin_dir, roots, manifest)
    }

    /// Explicit scan list: the supervisor is given the same roots, so `active`
    /// describes the kernel a spawn would really start. `builtin_dir` stays the
    /// read-only root for the `builtin` flag and for `remove`'s refusal.
    pub fn with_roots(
        data_dir: &Path,
        builtin_dir: PathBuf,
        roots: Vec<PathBuf>,
        manifest: &'static [LinuxPackage],
    ) -> Self {
        Self::build(data_dir, builtin_dir, dedup(roots), manifest)
    }

    fn build(
        data_dir: &Path,
        builtin_dir: PathBuf,
        roots: Vec<PathBuf>,
        manifest: &'static [LinuxPackage],
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                data_dir: data_dir.to_path_buf(),
                builtin_dir,
                roots,
                manifest,
                mirror: mirror_from_env(),
                free_bytes: Arc::new(free_bytes),
                install_allowed: true,
                http: http_client(),
                tasks: Arc::new(tasks::Tasks::new()),
                on_finish: None,
            }),
        }
    }

    /// Follows `LT_CORE_DIR`: an override *replaces* the scanned list (the
    /// supervisor does the same) and is the read-only root, so `/packages`
    /// agrees with the spawner about which kernel runs. Installs keep landing in
    /// `<data>/core`, which such a deployment does not scan, so they are refused
    /// altogether: see [`Packages::install_allowed`].
    pub fn with_core_override(self, dir: Option<PathBuf>) -> Self {
        match dir {
            Some(dir) => self.map_inner(|inner| {
                inner.roots = vec![dir.clone()];
                inner.builtin_dir = dir;
                inner.install_allowed = false;
            }),
            None => self,
        }
    }

    /// Observes the terminal state of every install task. Install this before the
    /// handle is cloned: the pipeline reads the hook from the shared state, so a
    /// later call would only reach future clones.
    pub fn on_finish(self, hook: impl Fn(&TaskView) + Send + Sync + 'static) -> Self {
        self.map_inner(|inner| inner.on_finish = Some(Arc::new(hook)))
    }

    /// Overrides the download mirror (`None` = download from GitHub directly).
    pub fn with_mirror(self, mirror: Option<String>) -> Self {
        self.map_inner(|inner| {
            inner.mirror = mirror
                .map(|value| value.trim().trim_end_matches('/').to_owned())
                .filter(|value| !value.is_empty());
        })
    }

    /// Overrides the free-space probe; `f` receives the data directory and
    /// returns the bytes available for new data.
    pub fn with_free_bytes(self, f: impl Fn(&Path) -> u64 + Send + Sync + 'static) -> Self {
        self.map_inner(|inner| inner.free_bytes = Arc::new(f))
    }

    /// Applies a builder step to the shared state. Builders are meant to run
    /// before the handle is cloned; afterwards this degrades to a cheap copy that
    /// still shares one task registry.
    fn map_inner(mut self, f: impl FnOnce(&mut Inner)) -> Self {
        f(Arc::make_mut(&mut self.inner));
        self
    }

    /// Root the agent installs into (`<data>/core`).
    pub fn data_dir(&self) -> &Path {
        &self.inner.data_dir
    }

    /// Roots searched for a usable kernel, in search order (see
    /// [`Packages::with_roots`] for why the order and the exact set matter).
    pub fn core_roots(&self) -> Vec<PathBuf> {
        self.inner.roots.clone()
    }

    /// Release table this instance installs from and lists.
    pub fn manifest(&self) -> &'static [LinuxPackage] {
        self.inner.manifest
    }

    /// Whether this deployment can install at all.
    ///
    /// False only under an `LT_CORE_DIR` override: the install pipeline writes
    /// `<data>/core`, and an override never scans that root, so a "successful"
    /// install would be invisible to both the supervisor and `/packages`. The
    /// endpoint reports this flag so the UI can hide the action instead of
    /// offering it and collecting a `core_override_read_only` refusal.
    pub fn install_allowed(&self) -> bool {
        self.inner.install_allowed
    }

    /// True when `version` exists *only* under the read-only root: there is no
    /// agent copy to delete, so a removal is `builtin_package` (`403`) rather
    /// than `not_found` (`404`). A version present in both roots is not builtin
    /// only: the agent copy is removed and resolution falls back to the image.
    pub fn is_builtin_only(&self, version: &str) -> bool {
        is_safe_version(version)
            && self.inner.builtin_dir.join(version).exists()
            && !self.inner.target_dir(version).exists()
    }

    /// Every kernel version on disk, newest first and deduplicated by version.
    /// For a version present in several roots the copy the resolver would run is
    /// reported (highest version wins, a tie prefers the later root), so `path`
    /// and `builtin` describe the live binary instead of the first hit on disk.
    pub fn list_installed(&self) -> Vec<InstalledPackage> {
        let mut winners: Vec<(usize, CorePaths)> = Vec::new();
        for (index, root) in self.inner.roots.iter().enumerate() {
            for candidate in core_candidates(root) {
                match winners
                    .iter_mut()
                    .find(|(_, item)| item.version == candidate.version)
                {
                    // Same version in a later root: the resolver prefers it, so
                    // the listing must report that copy as well.
                    Some(slot) => *slot = (index, candidate),
                    None => winners.push((index, candidate)),
                }
            }
        }
        let builtin_dir = &self.inner.builtin_dir;
        let mut out: Vec<InstalledPackage> = winners
            .into_iter()
            .map(|(index, paths)| {
                let root = &self.inner.roots[index];
                let path = paths
                    .core
                    .parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| root.clone());
                InstalledPackage {
                    version: paths.version,
                    path,
                    builtin: root == builtin_dir,
                    has_core: true,
                    has_cli: paths.cli.is_some(),
                }
            })
            .collect();
        out.sort_by_key(|item| Reverse(version_key(&item.version)));
        out
    }

    /// Version the supervisor would start right now, if any.
    pub fn active_version(&self) -> Option<String> {
        self.resolve().ok().map(|paths| paths.version)
    }

    /// Resolves the kernel to run; `core_missing` when no root holds one.
    pub fn resolve(&self) -> Result<CorePaths, ApiError> {
        resolve_in(&self.core_roots())
    }

    /// Snapshot of one install task, running or finished.
    pub fn task(&self, id: &str) -> Option<TaskView> {
        self.inner.tasks.get(id)
    }

    /// Asks the running install task to stop and clean up. A finished task is
    /// returned unchanged; an unknown id is `not_found`.
    pub fn cancel(&self, id: &str) -> Result<TaskView, ApiError> {
        self.inner.tasks.cancel(id)
    }
}

impl Inner {
    /// Manifest entry for a version; only listed releases are installable.
    fn lookup(&self, version: &str) -> Option<&'static LinuxPackage> {
        self.manifest.iter().find(|item| item.version == version)
    }

    fn target_root(&self) -> PathBuf {
        self.data_dir.join("core")
    }

    fn target_dir(&self, version: &str) -> PathBuf {
        self.target_root().join(version)
    }

    fn tmp_dir(&self, task_id: &str) -> PathBuf {
        self.data_dir.join("tmp").join(task_id)
    }

    /// True when a root already holds `version` as a directory: the agent's own
    /// `<data>/core/<version>` or the image-provided `<builtin>/<version>`. A
    /// builtin copy already provides the version, so downloading it again would
    /// only shadow the image copy: a conflict, not a new version.
    fn holds_version(&self, version: &str) -> bool {
        self.builtin_dir.join(version).exists() || self.target_dir(version).exists()
    }

    /// Download URL for a version, prefixed with [`MIRROR_ENV`] when configured.
    fn download_url(&self, version: &str) -> String {
        let official = official_url(version);
        match &self.mirror {
            Some(mirror) => format!("{mirror}/{official}"),
            None => official,
        }
    }
}

/// Reads [`MIRROR_ENV`]; blank values mean "no mirror".
fn mirror_from_env() -> Option<String> {
    std::env::var(MIRROR_ENV)
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_owned())
        .filter(|value| !value.is_empty())
}

/// Default search list: the image-provided root first, then `<data>/core`. A
/// data dir that *is* the builtin dir (tests, or a bind-mounted layout) is
/// listed once.
fn default_roots(builtin_dir: &Path, data_dir: &Path) -> Vec<PathBuf> {
    dedup(vec![builtin_dir.to_path_buf(), data_dir.join("core")])
}

/// Drops repeated roots while keeping the order a caller chose.
fn dedup(roots: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::with_capacity(roots.len());
    for root in roots {
        if !out.contains(&root) {
            out.push(root);
        }
    }
    out
}

/// Builds the shared download client. Without these timeouts a mirror that
/// accepts the connection and then stops sending would hold the install task
/// (and its staging directory) open indefinitely.
fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(DOWNLOAD_CONNECT_TIMEOUT)
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        // Only a broken TLS backend can fail here, and that is unrecoverable:
        // every install would fail anyway, just less clearly.
        .expect("the download HTTP client must be buildable")
}

/// Bytes available to unprivileged writers on the filesystem holding `path`.
/// An unreadable volume reports `u64::MAX` so a probe failure never blocks an
/// install that would otherwise work.
fn free_bytes(path: &Path) -> u64 {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let Ok(raw) = CString::new(path.as_os_str().as_bytes()) else {
        return u64::MAX;
    };
    // SAFETY: `raw` is a valid NUL-terminated path and `stats` is a zeroed
    // statvfs the kernel fills in on success.
    unsafe {
        let mut stats: libc::statvfs = std::mem::zeroed();
        if libc::statvfs(raw.as_ptr(), &mut stats) != 0 {
            return u64::MAX;
        }
        (stats.f_bavail as u64).saturating_mul(stats.f_frsize as u64)
    }
}

/// True when `version` is safe to join under `<data>/core`. Versions come from
/// the manifest for installs, but `remove` takes user input.
fn is_safe_version(version: &str) -> bool {
    !version.is_empty()
        && version != "."
        && version != ".."
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// Root-list seam shared by [`Packages::resolve`], `supervisor::resolve_core`
/// and the supervisor itself. All roots are scanned and the highest version
/// wins regardless of root order, so installing a newer kernel into
/// `<data>/core` takes effect over the image-provided one immediately. A tie
/// prefers the later root, which is the user-installed copy.
pub(crate) fn resolve_in(roots: &[PathBuf]) -> Result<CorePaths, ApiError> {
    let mut best: Option<(Vec<u64>, CorePaths)> = None;
    for root in roots {
        for candidate in core_candidates(root) {
            let key = version_key(&candidate.version);
            if best.as_ref().map_or(true, |(best_key, _)| key >= *best_key) {
                best = Some((key, candidate));
            }
        }
    }
    best.map(|(_, paths)| paths).ok_or(ApiError::CoreMissing)
}

/// Candidate kernels under one root: the root itself when it directly holds
/// `easytier-core` (version = directory name), plus every `<version>/` subdir
/// that does. A missing `easytier-cli` only drops the CLI, never the candidate.
fn core_candidates(root: &Path) -> Vec<CorePaths> {
    let mut out = Vec::new();
    let direct = root.join("easytier-core");
    if direct.is_file() {
        let version = root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "local".into());
        out.push(CorePaths {
            core: direct,
            cli: cli_beside(root),
            version,
        });
    }
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let core = path.join("easytier-core");
            if !core.is_file() {
                continue;
            }
            let version = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            out.push(CorePaths {
                core,
                cli: cli_beside(&path),
                version,
            });
        }
    }
    out
}

fn cli_beside(dir: &Path) -> Option<PathBuf> {
    let path = dir.join("easytier-cli");
    path.is_file().then_some(path)
}

/// Numeric sort key: every digit run in the version, compared as numbers, so
/// `v2.10.0` sorts above `v2.9.9` (a plain string compare would not).
fn version_key(version: &str) -> Vec<u64> {
    version
        .split(|c: char| !c.is_ascii_digit())
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn write_exec(path: &Path, body: &str) {
        std::fs::write(path, body).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// Creates `<root>/<version>/easytier-core` (+ `easytier-cli` when asked) and
    /// returns the version directory.
    fn install(root: &Path, version: &str, with_cli: bool) -> PathBuf {
        let dir = root.join(version);
        std::fs::create_dir_all(&dir).unwrap();
        write_exec(&dir.join("easytier-core"), "#!/bin/sh\n");
        if with_cli {
            write_exec(&dir.join("easytier-cli"), "#!/bin/sh\n");
        }
        dir
    }

    #[test]
    fn resolve_picks_the_highest_version_across_roots() {
        let dir = tempfile::tempdir().unwrap();
        let root_a = dir.path().join("a");
        let root_b = dir.path().join("b");
        install(&root_a, "v2.5.0", false);
        install(&root_b, "v2.6.4", false);
        // Root A is listed first on purpose: the version decides, not the order.
        for roots in [
            vec![root_a.clone(), root_b.clone()],
            vec![root_b.clone(), root_a.clone()],
        ] {
            let resolved = resolve_in(&roots).unwrap();
            assert_eq!(resolved.version, "v2.6.4");
            assert_eq!(resolved.core, root_b.join("v2.6.4/easytier-core"));
            assert!(resolved.cli.is_none());
        }
    }

    #[test]
    fn resolve_compares_version_segments_numerically() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("core");
        install(&root, "v2.9.9", false);
        install(&root, "v2.10.0", false);
        assert_eq!(resolve_in(&[root]).unwrap().version, "v2.10.0");
    }

    #[test]
    fn resolve_prefers_the_later_root_on_equal_versions() {
        let dir = tempfile::tempdir().unwrap();
        let builtin = dir.path().join("builtin");
        let data_root = dir.path().join("data");
        install(&builtin, "v2.6.4", false);
        install(&data_root, "v2.6.4", true);
        let resolved = resolve_in(&[builtin, data_root.clone()]).unwrap();
        assert_eq!(resolved.core, data_root.join("v2.6.4/easytier-core"));
        assert_eq!(resolved.cli, Some(data_root.join("v2.6.4/easytier-cli")));
    }

    #[test]
    fn resolve_reports_core_missing_without_candidates() {
        let dir = tempfile::tempdir().unwrap();
        let empty = dir.path().join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        let err = resolve_in(&[empty]).unwrap_err();
        assert_eq!(err.code(), "core_missing");
        assert_eq!(resolve_in(&[]).unwrap_err().code(), "core_missing");
        assert_eq!(
            resolve_in(&[dir.path().join("absent")]).unwrap_err().code(),
            "core_missing"
        );
    }

    #[test]
    fn resolve_accepts_a_flat_root_and_the_dir_name_as_version() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("v9.9.9");
        std::fs::create_dir_all(&root).unwrap();
        write_exec(&root.join("easytier-core"), "#!/bin/sh\n");
        write_exec(&root.join("easytier-cli"), "#!/bin/sh\n");
        let resolved = resolve_in(&[root.clone()]).unwrap();
        assert_eq!(resolved.version, "v9.9.9");
        assert_eq!(resolved.core, root.join("easytier-core"));
        assert_eq!(resolved.cli, Some(root.join("easytier-cli")));
    }

    #[test]
    fn core_roots_are_builtin_then_data_and_deduplicated() {
        let dir = tempfile::tempdir().unwrap();
        let packages = Packages::new(dir.path());
        assert_eq!(
            packages.core_roots(),
            vec![PathBuf::from(BUILTIN_CORE_DIR), dir.path().join("core")]
        );
        // When the data dir *is* the builtin dir, the root appears once.
        let data = dir.path().join("data");
        let builtin = data.join("core");
        let packages = Packages::with_manifest(&data, builtin.clone(), LINUX_PACKAGES);
        assert_eq!(packages.core_roots(), vec![builtin]);
    }

    #[test]
    fn list_installed_reports_the_copy_the_resolver_would_run() {
        let dir = tempfile::tempdir().unwrap();
        let builtin = dir.path().join("builtin");
        let data = dir.path().join("data");
        install(&builtin, "v2.6.4", true);
        // The same version under the data root wins the resolver's tie, so the
        // listing must report it (and not the builtin copy) as the live one.
        install(&data.join("core"), "v2.6.4", false);
        install(&data.join("core"), "v2.5.0", false);
        let packages = Packages::with_manifest(&data, builtin, LINUX_PACKAGES);
        let installed = packages.list_installed();
        let versions: Vec<&str> = installed.iter().map(|item| item.version.as_str()).collect();
        assert_eq!(versions, ["v2.6.4", "v2.5.0"]);
        assert_eq!(packages.resolve().unwrap().version, "v2.6.4");
        assert_eq!(installed[0].path, data.join("core/v2.6.4"));
        assert!(
            !installed[0].builtin,
            "the data copy is what runs, so it is not builtin"
        );
        assert!(installed[0].has_core);
        assert!(!installed[0].has_cli);
        assert!(!installed[1].builtin);
        assert!(!installed[1].has_cli);
        assert_eq!(installed[1].path, data.join("core/v2.5.0"));

        // Without a data copy the image-provided one is the live binary.
        std::fs::remove_dir_all(data.join("core/v2.6.4")).unwrap();
        let installed = packages.list_installed();
        assert_eq!(installed[0].path, dir.path().join("builtin/v2.6.4"));
        assert!(installed[0].builtin);
        assert!(installed[0].has_cli);
    }

    #[test]
    fn active_version_follows_resolve() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let empty_builtin = dir.path().join("builtin");
        std::fs::create_dir_all(&empty_builtin).unwrap();
        let packages = Packages::with_manifest(&data, empty_builtin, LINUX_PACKAGES);
        assert_eq!(packages.active_version(), None);
        assert_eq!(packages.resolve().unwrap_err().code(), "core_missing");
        install(&data.join("core"), "v2.5.0", false);
        install(&data.join("core"), "v2.7.1", false);
        assert_eq!(packages.active_version().as_deref(), Some("v2.7.1"));
    }

    #[test]
    fn core_override_replaces_the_scan_list_and_owns_builtin() {
        let dir = tempfile::tempdir().unwrap();
        let override_dir = dir.path().join("operator-core");
        install(&override_dir, "v2.6.4", true);
        let packages = Packages::new(dir.path()).with_core_override(Some(override_dir.clone()));

        // Same rule as the supervisor: the override *is* the whole list.
        assert_eq!(packages.core_roots(), vec![override_dir.clone()]);
        assert_eq!(packages.active_version().as_deref(), Some("v2.6.4"));
        let installed = packages.list_installed();
        assert_eq!(installed.len(), 1);
        assert!(installed[0].builtin, "an operator tree is read-only");

        // Without an override the default layout stays untouched.
        let packages = Packages::new(dir.path()).with_core_override(None);
        assert_eq!(
            packages.core_roots(),
            vec![PathBuf::from(BUILTIN_CORE_DIR), dir.path().join("core")]
        );
    }

    #[test]
    fn with_roots_scans_exactly_the_given_list() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first");
        let second = dir.path().join("second");
        install(&first, "v2.5.0", false);
        install(&second, "v2.6.4", false);
        let packages = Packages::with_roots(
            &dir.path().join("data"),
            first.clone(),
            // Duplicates are dropped, order is kept.
            vec![first.clone(), first.clone(), second.clone()],
            LINUX_PACKAGES,
        );
        assert_eq!(packages.core_roots(), vec![first.clone(), second.clone()]);
        assert_eq!(packages.manifest().len(), LINUX_PACKAGES.len());
        assert_eq!(packages.active_version().as_deref(), Some("v2.6.4"));
        let installed = packages.list_installed();
        let flags: Vec<bool> = installed.iter().map(|item| item.builtin).collect();
        assert_eq!(flags, [false, true], "builtin follows the configured root");
    }

    #[test]
    fn download_url_is_the_official_release_unless_a_mirror_is_set() {
        let dir = tempfile::tempdir().unwrap();
        let packages = Packages::new(dir.path()).with_mirror(None);
        assert_eq!(
            packages.inner.download_url("v2.6.4"),
            official_url("v2.6.4")
        );

        // The mirror is a plain prefix, trailing slashes trimmed (ghfast.top style).
        let packages = Packages::new(dir.path()).with_mirror(Some(" https://ghfast.top/ ".into()));
        assert_eq!(
            packages.inner.download_url("v2.6.4"),
            format!("https://ghfast.top/{}", official_url("v2.6.4"))
        );

        // A blank value means "no mirror", not an empty prefix.
        let packages = Packages::new(dir.path()).with_mirror(Some("   ".into()));
        assert_eq!(
            packages.inner.download_url("v2.6.4"),
            official_url("v2.6.4")
        );
    }

    #[test]
    fn cloned_handles_share_one_task_registry() {
        let dir = tempfile::tempdir().unwrap();
        let packages = Packages::new(dir.path());
        let clone = packages.clone();
        let (id, token) = packages.inner.tasks.create("v2.6.4");
        assert!(clone.task(&id).is_some(), "clones see the same registry");
        clone.cancel(&id).unwrap();
        assert!(token.is_cancelled());
        assert!(packages.inner.tasks.in_progress("v2.6.4"));
    }

    #[test]
    fn install_allowed_follows_the_core_override() {
        let dir = tempfile::tempdir().unwrap();
        let packages = Packages::new(dir.path());
        assert!(
            packages.install_allowed(),
            "the default layout publishes where it scans"
        );
        let override_dir = dir.path().join("operator-core");
        assert!(
            !packages
                .clone()
                .with_core_override(Some(override_dir))
                .install_allowed(),
            "an override never scans <data>/core, so installing is a lie"
        );
        assert!(packages.with_core_override(None).install_allowed());
    }

    #[test]
    fn is_builtin_only_ignores_a_version_the_agent_can_remove() {
        let dir = tempfile::tempdir().unwrap();
        let builtin = dir.path().join("builtin");
        let data = dir.path().join("data");
        install(&builtin, "v2.6.4", false);
        let packages = Packages::with_manifest(&data, builtin, LINUX_PACKAGES);
        assert!(packages.is_builtin_only("v2.6.4"));

        // The agent's own copy is removable, so the request is not builtin-only
        // (removing it falls back to the image copy).
        install(&data.join("core"), "v2.6.4", false);
        assert!(!packages.is_builtin_only("v2.6.4"));
        assert!(!packages.is_builtin_only("v2.5.0"));
        // An unsafe version stays `invalid_id`; it must never look like a 403.
        assert!(!packages.is_builtin_only("../builtin"));
        assert!(!packages.is_builtin_only(".."));
    }

    #[test]
    fn version_whitelist_blocks_traversal() {
        for version in ["v2.6.4", "2.6.4", "v2.10.0-rc1", "v2.6.4_1"] {
            assert!(is_safe_version(version), "{version} must be accepted");
        }
        for version in ["", ".", "..", "../evil", "a/b", "v2.6.4 ", "..\\evil"] {
            assert!(!is_safe_version(version), "{version} must be rejected");
        }
    }
}

//! Where the agent and the kernels keep their logs, and how much of one file a
//! client may read.
//!
//! Layout, owned by the writers and not to be reinvented here:
//!
//! ```text
//! <data>/logs/agent/agent.log[.<date>]   tracing appender, daily rotation (crate::logging)
//! <data>/logs/agent/audit.log            append-only audit trail (crate::audit)
//! <data>/logs/core/<config-id>/<file>    written by the kernel itself (crate::supervisor)
//! ```
//!
//! Only names on the whitelist in [`parse_name`] are reachable. A read is
//! resolved by joining a *validated* name under the logs root; nothing is ever
//! canonicalized from client input, so `core/../state/auth.json` and
//! `core/%2e%2e/x` die at the parser instead of being turned into a file path.
//!
//! Only regular files are served: a directory or a symlink planted under
//! `logs/` is `404 not_found`. The ancestors are checked to be real
//! directories and the open itself carries `O_NOFOLLOW`, so neither the last
//! path component nor the ones in front of it can lead out of the tree.

use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::error::ApiError;
use crate::ids::validate_config_id;

/// Trailing lines a read returns when the caller does not say.
pub const DEFAULT_TAIL_LINES: usize = 400;
/// Hard cap on `tail`: one request must not be able to pull a whole kernel log.
pub const MAX_TAIL_LINES: usize = 2000;
/// Read window: an active kernel log can reach hundreds of MiB, only its end is
/// interesting, so a tail seeks this far from EOF instead of reading the file.
pub const TAIL_WINDOW_BYTES: u64 = 512 * 1024;

const AGENT_DIR: &str = "agent";
const CORE_DIR: &str = "core";
const AGENT_LOG: &str = "agent.log";
const AUDIT_LOG: &str = "audit.log";

/// One file as the UI lists it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFile {
    pub name: String,
    pub size: u64,
    /// Unix seconds, matching every other timestamp in the crate
    /// (`ConfigEntry.modifiedAt`); `0` when the platform cannot tell.
    pub modified_at: i64,
}

/// All log files of one config id.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreLogGroup {
    pub id: String,
    pub files: Vec<LogFile>,
}

/// `GET /api/v1/logs` payload.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogList {
    pub agent: Vec<LogFile>,
    pub core: Vec<CoreLogGroup>,
}

pub struct Logs {
    /// `<data>/logs`; every resolved path must stay below it.
    root: PathBuf,
    agent_dir: PathBuf,
    core_dir: PathBuf,
}

impl Logs {
    pub fn new(data_dir: &Path) -> Self {
        let root = data_dir.join("logs");
        Self {
            agent_dir: root.join(AGENT_DIR),
            core_dir: root.join(CORE_DIR),
            root,
        }
    }

    /// Every file on disk, grouped by writer.
    ///
    /// A missing directory is an empty list (fresh install); a permission or
    /// IO error is a `500`, because a log tree that cannot be read is not the
    /// same thing as an empty one.
    pub async fn list(&self) -> Result<LogList, ApiError> {
        Ok(LogList {
            agent: self.list_agent().await?,
            core: self.list_core().await?,
        })
    }

    /// Resolves a whitelisted name to a path inside the logs root.
    pub fn path(&self, name: &str) -> Result<PathBuf, ApiError> {
        let path = match parse_name(name)? {
            LogTarget::Agent(name) => self.agent_dir.join(name),
            LogTarget::Core { id, file } => self.core_dir.join(id).join(file),
        };
        // Belt and braces: every component was validated, so a path that still
        // leaves the root means the validation above has a hole. Refuse to read
        // it instead of trusting the join.
        if !path.starts_with(&self.root) {
            return Err(ApiError::InvalidId);
        }
        Ok(path)
    }

    /// Last `tail` lines of one log, as UTF-8.
    ///
    /// `tail` is clamped into `1..=MAX_TAIL_LINES`: a request for zero lines is
    /// answered with the last line (the caller gets a log line or nothing, never
    /// a silently empty 200), and anything above the cap is cut to the cap.
    ///
    /// The file is opened once, without following symlinks, on the blocking
    /// pool: `std`'s `O_NOFOLLOW` is not something `tokio::fs` exposes, and a
    /// request must not hold a runtime thread while the file is inspected.
    pub async fn tail(&self, name: &str, tail: usize) -> Result<String, ApiError> {
        let path = self.path(name)?;
        let lines_wanted = tail.clamp(1, MAX_TAIL_LINES);
        let root = self.root.clone();
        let (file, len) = tokio::task::spawn_blocking(move || open_log(&root, &path))
            .await
            .map_err(spawn_error)??;
        let mut file = tokio::fs::File::from_std(file);
        let start = len.saturating_sub(TAIL_WINDOW_BYTES);
        file.seek(std::io::SeekFrom::Start(start)).await?;
        // `take` bounds the read even if the writer appends while we read.
        let mut buf = Vec::new();
        (&mut file)
            .take(TAIL_WINDOW_BYTES)
            .read_to_end(&mut buf)
            .await?;
        if start > 0 {
            // The window opens mid-line (possibly mid-character): drop that
            // fragment. Cutting at `\n` keeps the rest valid UTF-8.
            match buf.iter().position(|byte| *byte == b'\n') {
                Some(end) => {
                    buf.drain(..=end);
                }
                None => buf.clear(),
            }
        }
        Ok(take_last_lines(&buf, lines_wanted))
    }

    /// Empties `agent/*` (except the audit trail) and every file under
    /// `core/*/*`, leaving every directory and every file name in place.
    ///
    /// Truncation, not unlinking: the tracing appender and a running kernel keep
    /// their log file open, so removing the name would only detach those
    /// handles from the tree — the file would vanish from the listing until the
    /// next daily rollover, the space would not come back until the handle
    /// closes, and the writer would keep appending to an invisible inode.
    /// Opening with `write + truncate` reaches the same inode the writers hold,
    /// so the file stays listed, reads as empty, and keeps receiving their
    /// output. Directories stay for the same reason.
    ///
    /// `audit.log` is never touched: it is the record of what was done,
    /// including this clear. Only `NotFound` names are skipped (already rotated
    /// away); any other IO error aborts the clear.
    pub async fn clear(&self) -> Result<(), ApiError> {
        if let Some(mut entries) = read_dir_opt(&self.agent_dir).await? {
            while let Some(entry) = entries.next_entry().await? {
                let name = entry.file_name().to_string_lossy().into_owned();
                // `audit.log` is the record of what was done, including this
                // clear; emptying it would let an operator erase the evidence.
                if name == AUDIT_LOG || !is_agent_log(&name) {
                    continue;
                }
                truncate_log(&self.root, &entry.path()).await?;
            }
        }
        if let Some(mut groups) = read_dir_opt(&self.core_dir).await? {
            while let Some(group) = groups.next_entry().await? {
                match group.file_type().await {
                    Ok(file_type) if file_type.is_dir() => {}
                    // A symlink is not a kernel log directory: skipped, never
                    // followed.
                    Ok(_) => continue,
                    Err(err) if err.kind() == io::ErrorKind::NotFound => continue,
                    Err(err) => return Err(err.into()),
                }
                let Some(mut entries) = read_dir_opt(&group.path()).await? else {
                    continue;
                };
                while let Some(entry) = entries.next_entry().await? {
                    truncate_log(&self.root, &entry.path()).await?;
                }
            }
        }
        Ok(())
    }

    async fn list_agent(&self) -> Result<Vec<LogFile>, ApiError> {
        let mut out = Vec::new();
        let Some(mut entries) = read_dir_opt(&self.agent_dir).await? else {
            // No log directory yet (a fresh install): an empty list, not an error.
            return Ok(out);
        };
        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !is_agent_log(&name) {
                continue;
            }
            if let Some(file) = describe(&name, &entry).await? {
                out.push(file);
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    async fn list_core(&self) -> Result<Vec<CoreLogGroup>, ApiError> {
        let mut groups = Vec::new();
        let Some(mut dirs) = read_dir_opt(&self.core_dir).await? else {
            return Ok(groups);
        };
        while let Some(dir) = dirs.next_entry().await? {
            let id = dir.file_name().to_string_lossy().into_owned();
            if validate_config_id(&id).is_err() {
                continue;
            }
            match dir.file_type().await {
                Ok(file_type) if file_type.is_dir() => {}
                Ok(_) => continue,
                Err(err) if err.kind() == io::ErrorKind::NotFound => continue,
                Err(err) => return Err(err.into()),
            }
            let mut files = Vec::new();
            let Some(mut entries) = read_dir_opt(&dir.path()).await? else {
                continue;
            };
            while let Some(entry) = entries.next_entry().await? {
                let name = entry.file_name().to_string_lossy().into_owned();
                if !is_file_token(&name) {
                    continue;
                }
                if let Some(file) = describe(&name, &entry).await? {
                    files.push(file);
                }
            }
            if files.is_empty() {
                // A directory with nothing readable in it is not worth a row.
                continue;
            }
            files.sort_by(|a, b| a.name.cmp(&b.name));
            groups.push(CoreLogGroup { id, files });
        }
        groups.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(groups)
    }
}

/// A whitelisted log name, already split into the parts the path needs.
#[derive(Debug, PartialEq, Eq)]
enum LogTarget {
    Agent(String),
    Core { id: String, file: String },
}

/// Applies the name whitelist:
///
/// * `agent.log`, `agent.log.<suffix>`, `audit.log`
/// * `core/<id>/<file>` with `id` valid per [`validate_config_id`] and `file` a
///   plain file token
///
/// Anything else is `404 not_found`; an empty name, a `..` segment or a
/// structurally broken `core/...` name is `400 invalid_id`, because that is a
/// client trying to leave the tree rather than a name that merely is not there.
fn parse_name(name: &str) -> Result<LogTarget, ApiError> {
    if name.is_empty() || name.contains("..") {
        return Err(ApiError::InvalidId);
    }
    if name == AGENT_LOG || name == AUDIT_LOG {
        return Ok(LogTarget::Agent(name.to_string()));
    }
    if let Some(suffix) = name.strip_prefix("agent.log.") {
        if !is_file_token(suffix) {
            return Err(ApiError::InvalidId);
        }
        return Ok(LogTarget::Agent(name.to_string()));
    }
    if let Some(rest) = name.strip_prefix("core/") {
        let mut parts = rest.split('/');
        let (Some(id), Some(file), None) = (parts.next(), parts.next(), parts.next()) else {
            // `core/<id>`, `core/<id>/<file>/more` and `core/` are not log names.
            return Err(ApiError::InvalidId);
        };
        if id.is_empty() || file.is_empty() {
            return Err(ApiError::InvalidId);
        }
        validate_config_id(id)?;
        if !is_file_token(file) {
            return Err(ApiError::InvalidId);
        }
        return Ok(LogTarget::Core {
            id: id.to_string(),
            file: file.to_string(),
        });
    }
    Err(ApiError::NotFound)
}

/// `[A-Za-z0-9._-]+` and not empty; `..` is rejected by [`parse_name`] already,
/// but a lone `.`/`..` inside `core/<id>/<file>` never reaches a valid id either.
fn is_file_token(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Names the agent itself writes into `logs/agent`.
fn is_agent_log(name: &str) -> bool {
    if name == AGENT_LOG || name == AUDIT_LOG {
        return true;
    }
    name.strip_prefix("agent.log.")
        .map(is_file_token)
        .unwrap_or(false)
}

async fn describe(name: &str, entry: &tokio::fs::DirEntry) -> Result<Option<LogFile>, ApiError> {
    // `DirEntry::metadata` is an lstat: a symlink is described as a symlink and
    // therefore skipped, exactly like a read of it would be refused.
    let metadata = match entry.metadata().await {
        Ok(metadata) => metadata,
        // Rotated away between the listing and the stat.
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.into()),
    };
    if !metadata.is_file() {
        return Ok(None);
    }
    Ok(Some(LogFile {
        name: name.to_string(),
        size: metadata.len(),
        modified_at: modified_at(&metadata),
    }))
}

fn modified_at(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|dur| dur.as_secs() as i64)
        .unwrap_or(0)
}

/// `read_dir`, with a missing directory answered as "nothing there".
///
/// Only `NotFound` may look like an absent directory: a permission or IO error
/// is a real failure and must not be flattened into an empty log tree.
async fn read_dir_opt(dir: &Path) -> Result<Option<tokio::fs::ReadDir>, ApiError> {
    match tokio::fs::read_dir(dir).await {
        Ok(entries) => Ok(Some(entries)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

/// Opens one log for reading, returning the file and its size.
///
/// Only a regular file directly below the log tree is opened. A directory or a
/// fifo answers `404` instead of a `500`/a hung read, and `O_NOFOLLOW` (plus the
/// ancestor check in [`check_below_root`]) means a symlink planted under
/// `logs/` cannot redirect the read outside the tree. The size comes from the
/// same `lstat`, so a single open answers the whole request.
fn open_log(root: &Path, path: &Path) -> Result<(std::fs::File, u64), ApiError> {
    check_below_root(root, path)?;
    let metadata = std::fs::symlink_metadata(path).map_err(read_error)?;
    if !metadata.is_file() {
        return Err(ApiError::NotFound);
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path).map_err(read_error)?;
    Ok((file, metadata.len()))
}

/// Truncates one log to zero bytes in place, on the blocking pool.
async fn truncate_log(root: &Path, path: &Path) -> Result<(), ApiError> {
    let root = root.to_path_buf();
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || truncate_blocking(&root, &path))
        .await
        .map_err(spawn_error)?
}

/// Empties the file the writers already hold: `truncate` acts on the inode, so
/// the name stays listed and the next append lands in the same, emptied file.
///
/// Never follows a symlink (neither the file itself nor a directory in front of
/// it) and never unlinks. A file that is not regular, or that has already been
/// rotated away, is simply not ours to truncate.
fn truncate_blocking(root: &Path, path: &Path) -> Result<(), ApiError> {
    match check_below_root(root, path) {
        Ok(()) => {}
        // A missing or symlinked directory means the file is gone or not ours.
        Err(ApiError::NotFound) => return Ok(()),
        Err(err) => return Err(err),
    }
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err.into()),
    };
    if !metadata.is_file() {
        return Ok(());
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    match options.open(path) {
        // Dropping the handle closes it; the length is already zero.
        Ok(_file) => Ok(()),
        // Rotated away, or swapped for a symlink after the checks above.
        Err(err) if err.kind() == io::ErrorKind::NotFound || is_symlink_error(&err) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

/// Refuses a path whose ancestors under `root` are not all real directories.
///
/// `O_NOFOLLOW` protects the last component only, so `core/<id>` replaced by a
/// symlink would still let a read reach outside `logs/`. Nothing is
/// canonicalized: each ancestor is `lstat`ed and must be a directory, which a
/// symlink is not. A path that does not sit below `root` is refused as well.
///
/// The root itself is accepted whatever it is: it is created by the agent, and
/// an operator pointing `<data>/logs` at another volume (a symlink) must not
/// lose log viewing. Only components a log name can address are checked.
fn check_below_root(root: &Path, path: &Path) -> Result<(), ApiError> {
    let mut current = path.parent();
    while let Some(dir) = current {
        if dir == root {
            return Ok(());
        }
        match std::fs::symlink_metadata(dir) {
            Ok(metadata) if metadata.is_dir() => {}
            Ok(_) => return Err(ApiError::NotFound),
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Err(ApiError::NotFound),
            Err(err) => return Err(err.into()),
        }
        current = dir.parent();
    }
    // Unreachable through `Logs::path`, which refuses paths outside `root`.
    Err(ApiError::NotFound)
}

/// `NotFound` (and a symlink met by an `O_NOFOLLOW` open) is "no such log";
/// everything else is a real failure.
fn read_error(err: io::Error) -> ApiError {
    if err.kind() == io::ErrorKind::NotFound || is_symlink_error(&err) {
        ApiError::NotFound
    } else {
        err.into()
    }
}

#[cfg(unix)]
fn is_symlink_error(err: &io::Error) -> bool {
    err.raw_os_error() == Some(libc::ELOOP)
}

#[cfg(not(unix))]
fn is_symlink_error(_err: &io::Error) -> bool {
    false
}

fn spawn_error(err: tokio::task::JoinError) -> ApiError {
    ApiError::Internal(format!("blocking task failed: {err}"))
}

/// Last `wanted` lines of a (possibly mid-line cut) byte window, as UTF-8.
///
/// Invalid UTF-8 is replaced, never rejected: a kernel writing a non-UTF-8 byte
/// must not turn the log viewer into a 500, and a cut at a line boundary means
/// only genuinely corrupt bytes are affected.
fn take_last_lines(bytes: &[u8], wanted: usize) -> String {
    let text = String::from_utf8_lossy(bytes);
    let lines: Vec<&str> = text.lines().collect();
    // Clamped here as well as in `tail`, so the helper can never answer with an
    // unintentionally empty body.
    let keep = lines.len().saturating_sub(wanted.max(1));
    let mut body = lines[keep..].join("\n");
    if !body.is_empty() {
        body.push('\n');
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    fn logs() -> (tempfile::TempDir, Logs) {
        let dir = tempfile::tempdir().unwrap();
        let logs = Logs::new(dir.path());
        (dir, logs)
    }

    #[test]
    fn accepts_whitelisted_names_only() {
        assert_eq!(
            parse_name("agent.log").unwrap(),
            LogTarget::Agent("agent.log".into())
        );
        assert_eq!(
            parse_name("audit.log").unwrap(),
            LogTarget::Agent("audit.log".into())
        );
        assert_eq!(
            parse_name("agent.log.2026-11-26").unwrap(),
            LogTarget::Agent("agent.log.2026-11-26".into())
        );
        assert_eq!(
            parse_name("core/home/easytier-core.log").unwrap(),
            LogTarget::Core {
                id: "home".into(),
                file: "easytier-core.log".into()
            }
        );
        for name in ["", "..", "core/../state/auth.json", "core/home/../secret"] {
            assert_eq!(
                parse_name(name).unwrap_err().code(),
                "invalid_id",
                "{name:?} must be rejected as malformed"
            );
        }
        for name in [
            "agent.log..",
            "agent.log.",
            "core/home",
            "core//x",
            "other.log",
        ] {
            let code = parse_name(name).unwrap_err().code();
            assert!(
                code == "invalid_id" || code == "not_found",
                "{name:?}: {code}"
            );
        }
        assert_eq!(parse_name("notes.txt").unwrap_err().code(), "not_found");
        // An id the store itself would refuse can never name a core log dir.
        // (A space is legal in ids, so a backslash is used to stay invalid.)
        assert_eq!(
            parse_name("core/bad\\id/x.log").unwrap_err().code(),
            "invalid_id"
        );
    }

    #[test]
    fn keeps_only_the_last_lines() {
        assert_eq!(take_last_lines(b"a\nb\nc\n", 1), "c\n");
        assert_eq!(take_last_lines(b"a\nb\nc\n", 400), "a\nb\nc\n");
        assert_eq!(take_last_lines(b"a\nb\nc", 2), "b\nc\n");
        assert_eq!(take_last_lines(b"", 4), "");
        assert_eq!(take_last_lines(b"only", 0), "only\n");
    }

    #[tokio::test]
    async fn tail_reads_the_end_of_a_large_file() {
        let (dir, logs) = logs();
        let agent = dir.path().join("logs/agent");
        std::fs::create_dir_all(&agent).unwrap();
        let mut content = Vec::new();
        for index in 0..100_000 {
            content.extend_from_slice(format!("line {index}\n").as_bytes());
        }
        std::fs::write(agent.join("agent.log"), &content).unwrap();
        assert!(content.len() as u64 > TAIL_WINDOW_BYTES);
        let tail = logs.tail("agent.log", 2).await.unwrap();
        assert_eq!(tail, "line 99998\nline 99999\n");
        // The window opens mid-line; that fragment must not leak out.
        assert!(!tail.contains('\u{FFFD}'));
    }

    #[tokio::test]
    async fn tail_survives_invalid_utf8_and_missing_files() {
        let (dir, logs) = logs();
        let agent = dir.path().join("logs/agent");
        std::fs::create_dir_all(&agent).unwrap();
        std::fs::write(agent.join("agent.log"), b"ok\n\xff\xfe bad\n").unwrap();
        let tail = logs.tail("agent.log", 5).await.unwrap();
        assert!(tail.ends_with('\n'));
        assert!(tail.contains('\u{FFFD}'));
        assert_eq!(
            logs.tail("audit.log", 10).await.unwrap_err().code(),
            "not_found"
        );
    }

    #[tokio::test]
    async fn clear_truncates_logs_and_keeps_audit_and_directories() {
        let (dir, logs) = logs();
        let agent = dir.path().join("logs/agent");
        let core = dir.path().join("logs/core/home");
        std::fs::create_dir_all(&agent).unwrap();
        std::fs::create_dir_all(&core).unwrap();
        std::fs::write(agent.join("agent.log"), b"x\n").unwrap();
        std::fs::write(agent.join("agent.log.2026-11-25"), b"x\n").unwrap();
        std::fs::write(agent.join("audit.log"), b"{}\n").unwrap();
        std::fs::write(core.join("easytier-core.log"), b"x\n").unwrap();

        logs.clear().await.unwrap();

        // Truncated in place, not unlinked: the names stay on disk (the
        // appender and a running kernel still hold them open) and cost nothing.
        for path in [
            agent.join("agent.log"),
            agent.join("agent.log.2026-11-25"),
            core.join("easytier-core.log"),
        ] {
            let metadata = std::fs::metadata(&path).unwrap();
            assert!(
                metadata.is_file(),
                "{} must survive as a file",
                path.display()
            );
            assert_eq!(metadata.len(), 0, "{} must be empty", path.display());
        }
        assert_eq!(std::fs::read(agent.join("audit.log")).unwrap(), b"{}\n");
        assert!(agent.is_dir(), "directories must survive a clear");
        assert!(core.is_dir(), "directories must survive a clear");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn tail_refuses_directories_and_symlinks() {
        let (dir, logs) = logs();
        let agent = dir.path().join("logs/agent");
        std::fs::create_dir_all(agent.join("agent.log")).unwrap();
        let secret = dir.path().join("secret.txt");
        std::fs::write(&secret, b"planted\n").unwrap();
        std::os::unix::fs::symlink(&secret, agent.join("agent.log.2026-11-26")).unwrap();

        // A directory in place of a log is absent, not a 500 and not a read.
        assert_eq!(
            logs.tail("agent.log", 10).await.unwrap_err().code(),
            "not_found"
        );
        // A planted symlink is refused and its target is untouched.
        assert_eq!(
            logs.tail("agent.log.2026-11-26", 10)
                .await
                .unwrap_err()
                .code(),
            "not_found"
        );
        assert_eq!(std::fs::read(&secret).unwrap(), b"planted\n");

        // A symlinked directory one level up cannot redirect a core log read.
        let outside = dir.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("core.log"), b"secret\n").unwrap();
        std::os::unix::fs::symlink(&outside, dir.path().join("logs/core")).unwrap();
        assert_eq!(
            logs.tail("core/home/core.log", 10)
                .await
                .unwrap_err()
                .code(),
            "not_found"
        );
        assert_eq!(
            std::fs::read(outside.join("core.log")).unwrap(),
            b"secret\n"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn tail_accepts_a_symlinked_logs_root() {
        // An operator may keep the log volume elsewhere; the root itself is not
        // a component a log name can address, so it is not refused.
        let (dir, logs) = logs();
        let volume = dir.path().join("volume");
        std::fs::create_dir_all(volume.join("agent")).unwrap();
        std::fs::write(volume.join("agent/agent.log"), b"kept\n").unwrap();
        std::os::unix::fs::symlink(&volume, dir.path().join("logs")).unwrap();

        assert_eq!(logs.tail("agent.log", 5).await.unwrap(), "kept\n");
    }

    #[tokio::test]
    async fn list_groups_core_logs_and_skips_unknown_files() {
        let (dir, logs) = logs();
        let agent = dir.path().join("logs/agent");
        let core = dir.path().join("logs/core/office");
        std::fs::create_dir_all(&agent).unwrap();
        std::fs::create_dir_all(&core).unwrap();
        std::fs::write(agent.join("agent.log"), b"x\n").unwrap();
        std::fs::write(agent.join("audit.log"), b"{}\n").unwrap();
        std::fs::write(agent.join("unrelated.txt"), b"x\n").unwrap();
        std::fs::write(core.join("easytier-core.log"), b"abc\n").unwrap();

        let list = logs.list().await.unwrap();
        let names: Vec<&str> = list.agent.iter().map(|file| file.name.as_str()).collect();
        assert_eq!(names, ["agent.log", "audit.log"]);
        assert_eq!(list.agent[0].size, 2);
        assert_eq!(list.core.len(), 1);
        assert_eq!(list.core[0].id, "office");
        assert_eq!(list.core[0].files[0].name, "easytier-core.log");
        assert_eq!(list.core[0].files[0].size, 4);
    }

    #[tokio::test]
    async fn list_without_a_log_tree_is_empty() {
        let (_dir, logs) = logs();
        let list = logs.list().await.unwrap();
        assert!(list.agent.is_empty());
        assert!(list.core.is_empty());
    }
}

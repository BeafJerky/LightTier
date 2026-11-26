//! Server-side "Web 配置": easytier-core processes started with
//! `--config-server <url>` against a remote configuration server.
//!
//! The record model mirrors `FormWebData` in the desktop frontend
//! (`frontend/src/entities/config/formTypes.ts`); only the user-authored fields
//! are persisted, while `status`/`pid` are derived from the process table on
//! every read and never written to disk.
//!
//! Layout owned here (not to be reinvented elsewhere):
//!
//! ```text
//! <data>/state/web-configs.json          the whole table, atomically replaced
//! <data>/logs/core/web-config/<file>     written by the kernels themselves
//! ```
//!
//! `web-config` is the log group id: `crate::logs::parse_name` validates the
//! `core/<id>/` segment with `validate_config_id`, which refuses the leading
//! underscore of a `__web__` style name.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::error::ApiError;
use crate::ids::validate_config_id;
use crate::settings::SettingsStore;
use crate::storage;
use crate::supervisor::{normalize_log_level, spawn_kernel, terminate};

/// Table cap, mirroring the desktop `MAX_WEB_CONFIGS`.
pub const MAX_WEB_CONFIGS: usize = 500;
/// Log group every web-config kernel writes into (`core/<id>/` under `logs`).
pub const LOG_ID: &str = "web-config";
/// `webStartMethod` default and accepted range. The field is a legacy desktop
/// field with no consumer; it is persisted verbatim so a desktop backup can be
/// restored, and the agent always starts the process directly.
const DEFAULT_START_METHOD: i64 = 2;
const START_METHOD_RANGE: std::ops::RangeInclusive<i64> = 0..=9;

/// One persisted web config, already validated and normalized.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebItem {
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub user_name: String,
    pub web_start_method: i64,
    pub config_file_name: String,
    pub web_url: String,
}

/// One request item. Deliberately lenient (`Option`/`i64`) so every bad value
/// reaches [`WebItem::validate`] and answers the API error contract instead of
/// an extractor rejection; unknown fields (`status`, `pid`) are ignored.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebConfigInput {
    pub protocol: String,
    pub host: String,
    pub port: i64,
    pub user_name: String,
    #[serde(default)]
    pub web_start_method: Option<i64>,
    pub config_file_name: String,
    #[serde(default)]
    pub web_url: Option<String>,
}

/// A persisted record plus its live process state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebConfigView {
    #[serde(flatten)]
    pub item: WebItem,
    /// `running` or `notRunning`; the desktop-only `runningService` (Windows
    /// service) and the frontend-side `checking` are never returned here.
    pub status: &'static str,
    pub pid: Option<u32>,
}

/// What a table replacement changed, for the audit trail.
#[derive(Debug, Default)]
pub struct ReplaceSummary {
    pub created: Vec<WebItem>,
    pub updated: Vec<WebItem>,
    pub deleted: Vec<WebItem>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct WebConfigsFile {
    items: Vec<WebItem>,
}

#[derive(Debug, Default, Clone)]
struct Process {
    pid: Option<u32>,
    generation: u64,
}

#[derive(Debug, Default)]
struct State {
    loaded: bool,
    items: Vec<WebItem>,
    processes: HashMap<String, Process>,
}

pub struct WebConfigs {
    data_dir: PathBuf,
    core_roots: Vec<PathBuf>,
    settings: Arc<SettingsStore>,
    // `Arc` (not owned) so the exit waiter can hold the table while `self`
    // is only borrowed.
    state: Arc<Mutex<State>>,
    /// Serializes table replacement and every start/stop, exactly like
    /// `supervisor.start_lock`: a start that passed its running check must not
    /// race a stop or a replacement that removes its record.
    start_lock: Mutex<()>,
    generation: Mutex<u64>,
}

impl WebConfigs {
    pub fn new(data_dir: &Path, core_roots: Vec<PathBuf>, settings: Arc<SettingsStore>) -> Self {
        Self {
            data_dir: data_dir.to_path_buf(),
            core_roots,
            settings,
            state: Arc::new(Mutex::new(State::default())),
            start_lock: Mutex::new(()),
            generation: Mutex::new(0),
        }
    }

    fn state_path(&self) -> PathBuf {
        self.data_dir.join("state/web-configs.json")
    }

    fn log_dir(&self) -> PathBuf {
        self.data_dir.join("logs/core").join(LOG_ID)
    }

    /// Loads the table once, on first use, so a corrupt file can never block the
    /// agent: it degrades to an empty table (like `settings::load`) and only a
    /// later replacement rewrites it. A real IO error is reported instead, or the
    /// next replacement would silently overwrite data it never read.
    async fn load_once(&self, state: &mut State) -> Result<(), ApiError> {
        if state.loaded {
            return Ok(());
        }
        let path = self.state_path();
        match storage::read_json_or_default::<WebConfigsFile>(&path).await {
            Ok(file) => state.items = file.items,
            Err(err) if err.kind() == std::io::ErrorKind::InvalidData => tracing::warn!(
                path = %path.display(),
                error = %err,
                "web configs file is not valid JSON, starting with an empty table"
            ),
            Err(err) => return Err(err.into()),
        }
        state.loaded = true;
        Ok(())
    }

    pub async fn list(&self) -> Result<Vec<WebConfigView>, ApiError> {
        let mut state = self.state.lock().await;
        self.load_once(&mut state).await?;
        Ok(views(&state))
    }

    /// Replaces the whole table. Records that are running and either removed or
    /// pointed at a different server are stopped first: a removed record must
    /// not leave a kernel behind, and a renamed target must not keep dialing the
    /// old one.
    pub async fn replace(
        &self,
        inputs: Vec<WebConfigInput>,
    ) -> Result<(Vec<WebConfigView>, ReplaceSummary), ApiError> {
        let items = validate_items(inputs)?;
        let _start = self.start_lock.lock().await;
        let (previous, to_stop) = {
            let mut state = self.state.lock().await;
            self.load_once(&mut state).await?;
            let previous = state.items.clone();
            let to_stop: Vec<String> = previous
                .iter()
                .filter(|old| match find(&items, &old.config_file_name) {
                    Some(new) => !same_endpoint(old, new),
                    None => true,
                })
                .map(|old| old.config_file_name.clone())
                .collect();
            (previous, to_stop)
        };
        for name in to_stop {
            self.stop_locked(&name).await?;
        }
        let file = WebConfigsFile {
            items: items.clone(),
        };
        storage::write_json_atomic(&self.state_path(), &file).await?;
        let mut summary = ReplaceSummary::default();
        for old in &previous {
            match find(&items, &old.config_file_name) {
                Some(new) if new == old => {}
                Some(new) => summary.updated.push(new.clone()),
                None => summary.deleted.push(old.clone()),
            }
        }
        for new in &items {
            if find(&previous, &new.config_file_name).is_none() {
                summary.created.push(new.clone());
            }
        }
        let mut state = self.state.lock().await;
        state
            .processes
            .retain(|name, _| find(&items, name).is_some());
        state.items = items;
        Ok((views(&state), summary))
    }

    /// Idempotent: an already running record is a success, matching the desktop
    /// intent of "a double click must not start a second kernel".
    pub async fn start(&self, name: &str) -> Result<(), ApiError> {
        let _start = self.start_lock.lock().await;
        self.start_locked(name).await
    }

    async fn start_locked(&self, name: &str) -> Result<(), ApiError> {
        validate_config_id(name)?;
        let item = {
            let mut state = self.state.lock().await;
            self.load_once(&mut state).await?;
            let Some(item) = find(&state.items, name).cloned() else {
                return Err(ApiError::NotFound);
            };
            if state
                .processes
                .get(name)
                .map(|process| process.pid.is_some())
                .unwrap_or(false)
            {
                return Ok(());
            }
            item
        };
        let core = crate::packages::resolve_in(&self.core_roots)?;
        let settings = self.settings.get().await;
        let log_dir = self.log_dir();
        storage::ensure_dir(&log_dir).await?;
        let args: Vec<OsString> = vec![
            "--config-server".into(),
            server_url(&item).into(),
            "--file-log-dir".into(),
            log_dir.into_os_string(),
            "--file-log-level".into(),
            normalize_log_level(None, &settings.log_level).into(),
            "--file-log-size".into(),
            "10".into(),
            "--file-log-count".into(),
            "10".into(),
        ];
        let (mut child, pid) = spawn_kernel(&core.core, args)?;
        let generation = {
            let mut counter = self.generation.lock().await;
            *counter += 1;
            *counter
        };
        let stderr = child.stderr.take();
        // Register the pid before the waiter can observe the exit, otherwise a
        // kernel that dies immediately would leave a stale pid behind.
        self.state.lock().await.processes.insert(
            name.to_string(),
            Process {
                pid: Some(pid),
                generation,
            },
        );
        if let Some(stderr) = stderr {
            let label = name.to_string();
            tokio::spawn(async move {
                use tokio::io::AsyncBufReadExt;
                let mut lines = tokio::io::BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::warn!(web_config = %label, line = %line, "core stderr");
                }
            });
        }
        let handle = self.state.clone();
        let waiter_name = name.to_string();
        tokio::spawn(async move {
            let status = child.wait().await;
            {
                let mut state = handle.lock().await;
                // Only clear the pid while `generation` still matches, so a
                // restarted record is never marked stopped by an older exit.
                if let Some(process) = state.processes.get_mut(&waiter_name) {
                    if process.generation == generation {
                        process.pid = None;
                    }
                }
            }
            match status {
                Ok(status) => tracing::info!(
                    web_config = %waiter_name,
                    code = ?status.code(),
                    "web-config kernel exited"
                ),
                Err(err) => {
                    tracing::warn!(web_config = %waiter_name, error = %err, "web-config kernel wait failed")
                }
            }
        });
        Ok(())
    }

    /// Idempotent: a record that is not running is a success.
    pub async fn stop(&self, name: &str) -> Result<(), ApiError> {
        let _start = self.start_lock.lock().await;
        self.stop_locked(name).await
    }

    async fn stop_locked(&self, name: &str) -> Result<(), ApiError> {
        validate_config_id(name)?;
        let pid = {
            let mut state = self.state.lock().await;
            self.load_once(&mut state).await?;
            if find(&state.items, name).is_none() {
                return Err(ApiError::NotFound);
            }
            state.processes.get(name).and_then(|process| process.pid)
        };
        let Some(pid) = pid.filter(|pid| *pid != 0) else {
            return Ok(());
        };
        terminate(pid, libc::SIGTERM);
        if !self.wait_stopped(name, Duration::from_secs(5)).await {
            terminate(pid, libc::SIGKILL);
            if !self.wait_stopped(name, Duration::from_secs(2)).await {
                // Still alive: reporting success would hide a kernel that no
                // later request could stop.
                return Err(ApiError::Internal(format!(
                    "web-config process {pid} survived SIGKILL"
                )));
            }
        }
        Ok(())
    }

    async fn wait_stopped(&self, name: &str, timeout: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let running = self
                .state
                .lock()
                .await
                .processes
                .get(name)
                .map(|process| process.pid.is_some())
                .unwrap_or(false);
            if !running {
                return true;
            }
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

/// Validates the whole request before anything is stopped, written or spawned.
pub fn validate_items(inputs: Vec<WebConfigInput>) -> Result<Vec<WebItem>, ApiError> {
    if inputs.len() > MAX_WEB_CONFIGS {
        return Err(invalid(format!(
            "at most {MAX_WEB_CONFIGS} web configs are allowed"
        )));
    }
    let mut items: Vec<WebItem> = Vec::with_capacity(inputs.len());
    for input in inputs {
        let item = WebItem::validate(input)?;
        if find(&items, &item.config_file_name).is_some() {
            // A duplicate key would make start/stop ambiguous.
            return Err(ApiError::ConfigExists);
        }
        items.push(item);
    }
    Ok(items)
}

impl WebItem {
    fn validate(input: WebConfigInput) -> Result<Self, ApiError> {
        validate_config_id(&input.config_file_name)?;
        if !matches!(input.protocol.as_str(), "udp" | "tcp") {
            return Err(invalid("protocol must be \"udp\" or \"tcp\""));
        }
        let port = u16::try_from(input.port)
            .ok()
            .filter(|port| *port != 0)
            .ok_or_else(|| invalid("port must be an integer in 1..=65535"))?;
        let host = input.host.trim().to_string();
        if !is_valid_host(&host) {
            return Err(invalid("host is not a valid host name or IPv6 literal"));
        }
        if !is_valid_user_name(&input.user_name) {
            return Err(invalid("userName must match ^[a-zA-Z0-9@._-]{1,36}$"));
        }
        let web_start_method = input.web_start_method.unwrap_or(DEFAULT_START_METHOD);
        if !START_METHOD_RANGE.contains(&web_start_method) {
            return Err(invalid("webStartMethod must be an integer in 0..=9"));
        }
        let web_url = input.web_url.unwrap_or_default();
        if !web_url.is_empty() && !is_http_url(&web_url) {
            return Err(invalid("webUrl must be an http(s) URL"));
        }
        Ok(Self {
            protocol: input.protocol,
            host,
            port,
            user_name: input.user_name,
            web_start_method,
            config_file_name: input.config_file_name,
            web_url,
        })
    }
}

fn invalid(detail: impl Into<String>) -> ApiError {
    ApiError::InvalidSettings {
        detail: detail.into(),
    }
}

fn find<'a>(items: &'a [WebItem], name: &str) -> Option<&'a WebItem> {
    items.iter().find(|item| item.config_file_name == name)
}

/// Only the fields baked into the kernel argv decide whether a running process
/// is stale; a console URL or start-method edit leaves it alone.
fn same_endpoint(left: &WebItem, right: &WebItem) -> bool {
    left.protocol == right.protocol
        && left.host == right.host
        && left.port == right.port
        && left.user_name == right.user_name
}

fn views(state: &State) -> Vec<WebConfigView> {
    state
        .items
        .iter()
        .map(|item| {
            let pid = state
                .processes
                .get(&item.config_file_name)
                .and_then(|process| process.pid);
            WebConfigView {
                item: item.clone(),
                status: if pid.is_some() {
                    "running"
                } else {
                    "notRunning"
                },
                pid,
            }
        })
        .collect()
}

/// `<protocol>://<authority>:<port>/<userName>`; an IPv6 literal is bracketed,
/// mirroring `formatWebConfigServerUrl` in
/// `frontend/src/features/web-configs/lib/webConfigHost.ts`.
pub fn server_url(item: &WebItem) -> String {
    let authority = if item.host.contains(':') && !item.host.starts_with('[') {
        format!("[{}]", item.host)
    } else {
        item.host.clone()
    };
    format!(
        "{}://{}:{}/{}",
        item.protocol, authority, item.port, item.user_name
    )
}

/// Equivalent of `isValidWebHost`: no whitespace/control characters, domain
/// labels of at most 63 chars, at most 253 chars overall, or a standard IPv6
/// literal. URL/path delimiters are refused outright: the value is pasted into
/// the kernel argv as part of a URL, so a `/` or `@` must never survive.
pub fn is_valid_host(host: &str) -> bool {
    let value = host.trim();
    if value.is_empty() || value.chars().count() > 253 {
        return false;
    }
    if value
        .chars()
        .any(|c| c.is_whitespace() || (c as u32) < 0x20 || c as u32 == 0x7f)
    {
        return false;
    }
    if value
        .chars()
        .any(|c| matches!(c, '"' | '\'' | '/' | '\\' | '?' | '#' | '@' | '%'))
    {
        return false;
    }
    if value.contains(':') {
        let literal = match value.strip_prefix('[') {
            Some(rest) => match rest.strip_suffix(']') {
                Some(inner) => inner,
                None => return false,
            },
            None => value,
        };
        return reqwest::Url::parse(&format!("http://[{literal}]/")).is_ok();
    }
    value.split('.').all(is_valid_host_label)
}

/// `^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$`, length counted in chars.
fn is_valid_host_label(label: &str) -> bool {
    let count = label.chars().count();
    (1..=63).contains(&count)
        && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && !label.starts_with('-')
        && !label.ends_with('-')
}

/// `WEB_USER_PATTERN` from `backupUtil.ts`.
pub fn is_valid_user_name(value: &str) -> bool {
    (1..=36).contains(&value.chars().count())
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '@' | '.' | '_' | '-'))
}

fn is_http_url(value: &str) -> bool {
    matches!(
        reqwest::Url::parse(value),
        Ok(url) if matches!(url.scheme(), "http" | "https")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn input(name: &str) -> WebConfigInput {
        WebConfigInput {
            protocol: "udp".into(),
            host: "web.example.com".into(),
            port: 11010,
            user_name: "octet".into(),
            web_start_method: None,
            config_file_name: name.into(),
            web_url: Some("http://web.example.com:11223".into()),
        }
    }

    fn write_exec(path: &Path, body: &str) {
        std::fs::write(path, body).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    const ARG_RECORDING_CORE: &str = r#"#!/bin/sh
trap 'exit 0' TERM
for arg in "$@"; do
  printf '%s\n' "$arg"
done > "$(dirname "$0")/args.txt"
while true; do sleep 0.1; done
"#;

    fn install_core(root: &Path, body: &str) -> PathBuf {
        let dir = root.join("v9.9.9");
        std::fs::create_dir_all(&dir).unwrap();
        write_exec(&dir.join("easytier-core"), body);
        root.to_path_buf()
    }

    fn args_file(root: &Path) -> PathBuf {
        root.join("v9.9.9/args.txt")
    }

    async fn read_args(path: &Path) -> Vec<String> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            if let Ok(text) = tokio::fs::read_to_string(path).await {
                if !text.is_empty() {
                    return text.lines().map(str::to_string).collect();
                }
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "args file {} was never written",
                path.display()
            );
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    fn value_after<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        let index = args.iter().position(|arg| arg == flag)?;
        args.get(index + 1).map(String::as_str)
    }

    async fn app(data: &Path, core_root: Option<PathBuf>) -> (WebConfigs, Arc<SettingsStore>) {
        let settings = Arc::new(SettingsStore::load(data).await.unwrap());
        let roots = core_root.into_iter().collect();
        (WebConfigs::new(data, roots, settings.clone()), settings)
    }

    #[test]
    fn accepts_desktop_hosts_and_rejects_url_smuggling() {
        for host in [
            "web.example.com",
            "localhost",
            "192.168.1.10",
            "::1",
            "[fe80::1]",
            "fe80::1",
            "a",
            "node-1.internal",
        ] {
            assert!(is_valid_host(host), "{host} must be accepted");
        }
        for host in [
            "",
            " ",
            "exa mple.com",
            "example.com/path",
            "user@example.com",
            "example..com",
            ".example.com",
            "example.com.",
            "-bad.com",
            "bad-.com",
            "::1]/evil",
            "[::1",
            "1.2.3.4:80",
            "exa\"mple.com",
            "example.com?x",
            &"a".repeat(300),
            &format!("{}.com", "a".repeat(64)),
        ] {
            assert!(!is_valid_host(host), "{host:?} must be rejected");
        }
    }

    #[test]
    fn start_method_accepts_the_whole_legacy_range() {
        for method in 0..=9 {
            let mut item = input("web");
            item.web_start_method = Some(method);
            let validated = validate_items(vec![item]).unwrap();
            assert_eq!(validated[0].web_start_method, method);
        }
        // Missing means the desktop default.
        assert_eq!(
            validate_items(vec![input("web")]).unwrap()[0].web_start_method,
            2
        );
        for method in [-1, 10, 100] {
            let mut item = input("web");
            item.web_start_method = Some(method);
            assert_eq!(
                validate_items(vec![item]).unwrap_err().code(),
                "invalid_settings",
                "{method} must be rejected"
            );
        }
    }

    #[test]
    fn rejects_bad_fields_with_the_api_error_codes() {
        let cases: Vec<(WebConfigInput, &str)> = vec![
            (
                WebConfigInput {
                    protocol: "quic".into(),
                    ..input("web")
                },
                "invalid_settings",
            ),
            (
                WebConfigInput {
                    port: 0,
                    ..input("web")
                },
                "invalid_settings",
            ),
            (
                WebConfigInput {
                    port: 70_000,
                    ..input("web")
                },
                "invalid_settings",
            ),
            (
                WebConfigInput {
                    host: "exa mple".into(),
                    ..input("web")
                },
                "invalid_settings",
            ),
            (
                WebConfigInput {
                    user_name: "bad user".into(),
                    ..input("web")
                },
                "invalid_settings",
            ),
            (
                WebConfigInput {
                    user_name: "a".repeat(37),
                    ..input("web")
                },
                "invalid_settings",
            ),
            (
                WebConfigInput {
                    web_url: Some("file:///etc/passwd".into()),
                    ..input("web")
                },
                "invalid_settings",
            ),
            (
                WebConfigInput {
                    config_file_name: "bad\\id".into(),
                    ..input("web")
                },
                "invalid_id",
            ),
        ];
        for (item, code) in cases {
            let err = validate_items(vec![item]).unwrap_err();
            assert_eq!(err.code(), code, "{err:?}");
        }
        // A blank webUrl is a legal "no console link".
        let mut item = input("web");
        item.web_url = None;
        assert_eq!(validate_items(vec![item]).unwrap()[0].web_url, "");
    }

    #[test]
    fn duplicate_names_are_a_conflict() {
        let err = validate_items(vec![input("web"), input("web")]).unwrap_err();
        assert_eq!(err.code(), "config_exists");
    }

    #[test]
    fn table_cap_is_enforced() {
        let items: Vec<WebConfigInput> = (0..=MAX_WEB_CONFIGS)
            .map(|index| input(&format!("web{index}")))
            .collect();
        assert_eq!(
            validate_items(items).unwrap_err().code(),
            "invalid_settings"
        );
    }

    #[test]
    fn server_url_brackets_ipv6_and_keeps_the_user() {
        let mut item = WebItem::validate(input("web")).unwrap();
        assert_eq!(server_url(&item), "udp://web.example.com:11010/octet");
        item.host = "::1".into();
        assert_eq!(server_url(&item), "udp://[::1]:11010/octet");
        item.host = "[fe80::1]".into();
        assert_eq!(server_url(&item), "udp://[fe80::1]:11010/octet");
    }

    #[tokio::test]
    async fn replace_persists_only_user_fields() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let (store, _settings) = app(&data, None).await;
        let (views, summary) = store.replace(vec![input("web")]).await.unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].status, "notRunning");
        assert_eq!(views[0].pid, None);
        assert_eq!(summary.created.len(), 1);

        let raw = tokio::fs::read_to_string(data.join("state/web-configs.json"))
            .await
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let item = &parsed["items"][0];
        assert_eq!(item["configFileName"], "web");
        assert_eq!(item["webStartMethod"], 2);
        assert!(item.get("status").is_none(), "{item}");
        assert!(item.get("pid").is_none(), "{item}");

        // The table survives a restart, in stored order.
        let (reloaded, _) = app(&data, None).await;
        let listed = reloaded.list().await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].item.config_file_name, "web");
    }

    #[tokio::test]
    async fn corrupt_file_starts_empty_without_failing() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        std::fs::create_dir_all(data.join("state")).unwrap();
        std::fs::write(data.join("state/web-configs.json"), b"{\"items\":[{\"conf").unwrap();
        let (store, _settings) = app(&data, None).await;
        assert!(store.list().await.unwrap().is_empty());
        // A rewrite replaces the corrupt document with a valid table.
        store.replace(vec![input("web")]).await.unwrap();
        assert_eq!(store.list().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn start_is_idempotent_and_stop_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let core = install_core(&dir.path().join("core"), ARG_RECORDING_CORE);
        let data = dir.path().join("data");
        let (store, _settings) = app(&data, Some(core)).await;
        store.replace(vec![input("web")]).await.unwrap();

        store.start("web").await.unwrap();
        let pid = store.list().await.unwrap()[0]
            .pid
            .expect("start registers a pid");
        // A second start must not spawn a second kernel.
        store.start("web").await.unwrap();
        assert_eq!(store.list().await.unwrap()[0].pid, Some(pid));

        store.stop("web").await.unwrap();
        assert_eq!(store.list().await.unwrap()[0].status, "notRunning");
        assert_eq!(store.list().await.unwrap()[0].pid, None);
        // Stopping a stopped record is a success.
        store.stop("web").await.unwrap();
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);

        assert_eq!(
            store.start("missing").await.unwrap_err().code(),
            "not_found"
        );
        assert_eq!(store.stop("missing").await.unwrap_err().code(), "not_found");
    }

    #[tokio::test]
    async fn spawn_args_follow_the_desktop_shape() {
        let dir = tempfile::tempdir().unwrap();
        let core_root = dir.path().join("core");
        let core = install_core(&core_root, ARG_RECORDING_CORE);
        let data = dir.path().join("data");
        let (store, settings) = app(&data, Some(core)).await;
        settings
            .update(crate::settings::SettingsPatch {
                log_level: Some("debug".into()),
                ..crate::settings::SettingsPatch::default()
            })
            .await
            .unwrap();
        store
            .replace(vec![WebConfigInput {
                host: "::1".into(),
                ..input("web")
            }])
            .await
            .unwrap();
        store.start("web").await.unwrap();
        let args = read_args(&args_file(&core_root)).await;
        store.stop("web").await.unwrap();

        assert_eq!(
            value_after(&args, "--config-server"),
            Some("udp://[::1]:11010/octet")
        );
        let log_dir = data.join("logs/core/web-config");
        assert_eq!(
            value_after(&args, "--file-log-dir"),
            Some(log_dir.to_str().unwrap())
        );
        assert!(log_dir.is_dir());
        assert_eq!(value_after(&args, "--file-log-level"), Some("debug"));
        assert_eq!(value_after(&args, "--file-log-size"), Some("10"));
        assert_eq!(value_after(&args, "--file-log-count"), Some("10"));
        assert!(value_after(&args, "--config-file").is_none());
    }

    #[tokio::test]
    async fn missing_core_reports_core_missing() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let (store, _settings) = app(&data, Some(dir.path().join("absent"))).await;
        store.replace(vec![input("web")]).await.unwrap();
        assert_eq!(store.start("web").await.unwrap_err().code(), "core_missing");
    }

    #[tokio::test]
    async fn removed_or_retargeted_running_record_is_stopped_first() {
        let dir = tempfile::tempdir().unwrap();
        let core = install_core(&dir.path().join("core"), ARG_RECORDING_CORE);
        let data = dir.path().join("data");
        let (store, _settings) = app(&data, Some(core)).await;
        store
            .replace(vec![input("web"), input("keep")])
            .await
            .unwrap();
        store.start("web").await.unwrap();
        store.start("keep").await.unwrap();
        let removed_pid = store.list().await.unwrap()[0].pid.unwrap();
        let kept_pid = store.list().await.unwrap()[1].pid.unwrap();

        // An unrelated edit of a running record must not restart it.
        let (views, summary) = store
            .replace(vec![
                WebConfigInput {
                    web_url: Some("http://other.example.com:11223".into()),
                    ..input("keep")
                },
                WebConfigInput {
                    host: "other.example.com".into(),
                    ..input("moved")
                },
            ])
            .await
            .unwrap();
        assert_eq!(summary.deleted.len(), 1);
        assert_eq!(summary.deleted[0].config_file_name, "web");
        assert_eq!(summary.created.len(), 1);
        assert_eq!(summary.updated.len(), 1);
        assert_eq!(views.len(), 2);
        // `keep` is still the same process, `web` is gone.
        let kept = views
            .iter()
            .find(|view| view.item.config_file_name == "keep")
            .unwrap();
        assert_eq!(kept.pid, Some(kept_pid));
        assert_eq!(unsafe { libc::kill(removed_pid as i32, 0) }, -1);
        store.stop("keep").await.unwrap();
    }

    #[tokio::test]
    async fn crashed_process_returns_to_not_running() {
        let dir = tempfile::tempdir().unwrap();
        let core = install_core(&dir.path().join("core"), "#!/bin/sh\nexit 0\n");
        let data = dir.path().join("data");
        let (store, _settings) = app(&data, Some(core)).await;
        store.replace(vec![input("web")]).await.unwrap();
        store.start("web").await.unwrap();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while store.list().await.unwrap()[0].pid.is_some() {
            assert!(
                tokio::time::Instant::now() < deadline,
                "crashed kernel pid never cleared"
            );
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert_eq!(store.list().await.unwrap()[0].status, "notRunning");
    }
}

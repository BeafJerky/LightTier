use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::error::ApiError;
use crate::ids::validate_config_id;
use crate::settings::SettingsStore;
use crate::storage;

/// Resolved EasyTier kernel binaries. `cli` is `None` when the release does not
/// ship `easytier-cli` next to `easytier-core`.
#[derive(Debug, Clone)]
pub struct CorePaths {
    pub core: PathBuf,
    pub cli: Option<PathBuf>,
    pub version: String,
}

/// The subset of an EasyTier TOML config the supervisor needs: where the RPC
/// portal listens, which listeners are opened, and the kernel log level.
#[derive(Debug, Default, Clone)]
pub struct CoreConfig {
    pub rpc_portal: String,
    /// `listeners` in file order, already parsed into bindable endpoints.
    /// Malformed entries are dropped here so a single typo cannot fail the parse.
    pub listeners: Vec<Endpoint>,
    pub log_level: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortMode {
    Tcp,
    Udp,
}

/// A bindable endpoint parsed from a listener URI or from `rpc_portal`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
    pub mode: PortMode,
}

impl Endpoint {
    /// Two endpoints collide only when they share port *and* transport mode and
    /// their bind addresses can overlap (same address, or a wildcard on either
    /// side). TCP and UDP port spaces are independent on Linux, and so are
    /// distinct addresses.
    fn conflicts_with(&self, other: &Endpoint) -> bool {
        self.port == other.port
            && self.mode == other.mode
            && (self.host == other.host
                || is_wildcard_host(&self.host)
                || is_wildcard_host(&other.host))
    }
}

fn is_wildcard_host(host: &str) -> bool {
    matches!(host, "0.0.0.0" | "::" | "[::]")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastExit {
    pub code: Option<i32>,
    pub at: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceSnapshot {
    pub id: String,
    pub running: bool,
    pub pid: Option<u32>,
    pub started_at: Option<i64>,
    pub rpc_portal: Option<String>,
    pub last_exit: Option<LastExit>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InstancesFile {
    pub last_running: Vec<String>,
}

#[derive(Debug, Default, Clone)]
struct Instance {
    pid: Option<u32>,
    started_at: Option<i64>,
    rpc_portal: Option<String>,
    /// Every endpoint the kernel was started with (rpc portal + listeners), so a
    /// port clash on a listener can be attributed to its instance as well.
    endpoints: Vec<Endpoint>,
    last_exit: Option<LastExit>,
    generation: u64,
}

pub struct Supervisor {
    data_dir: PathBuf,
    core_roots: Vec<PathBuf>,
    configs: Arc<crate::configs::Configs>,
    settings: Arc<SettingsStore>,
    instances: Arc<Mutex<HashMap<String, Instance>>>,
    last_running: Mutex<Vec<String>>,
    start_lock: Mutex<()>,
    generation: Mutex<u64>,
    persist: Mutex<()>,
}

impl Supervisor {
    pub async fn load(
        data_dir: &Path,
        core_override: Option<PathBuf>,
        configs: Arc<crate::configs::Configs>,
        settings: Arc<SettingsStore>,
    ) -> std::io::Result<Self> {
        let roots = core_search_roots(data_dir, core_override.as_deref());
        Self::load_with_roots(data_dir, roots, configs, settings).await
    }

    /// Constructor body shared with `load`; tests pass their own `core_roots`
    /// so a core packaged at `/opt/lighttier/core` cannot change their result.
    async fn load_with_roots(
        data_dir: &Path,
        core_roots: Vec<PathBuf>,
        configs: Arc<crate::configs::Configs>,
        settings: Arc<SettingsStore>,
    ) -> std::io::Result<Self> {
        let state_path = data_dir.join("state/instances.json");
        let file: InstancesFile = match storage::read_json_or_default(&state_path).await {
            Ok(file) => file,
            // A truncated or zero-byte file (possible after a power loss) must not
            // abort boot: the agent would crash-loop under `restart: unless-stopped`
            // and `/readyz` would never turn ready. `lastRunning` is only a hint, so
            // start empty, move the bad file aside as evidence, and let the next
            // persist rewrite a clean one.
            Err(err) if err.kind() == std::io::ErrorKind::InvalidData => {
                tracing::warn!(
                    path = %state_path.display(),
                    error = %err,
                    "instances file is not valid JSON, starting with an empty lastRunning"
                );
                quarantine_corrupt(&state_path).await;
                InstancesFile::default()
            }
            Err(err) => return Err(err),
        };
        Ok(Self {
            data_dir: data_dir.to_path_buf(),
            core_roots,
            configs,
            settings,
            instances: Arc::new(Mutex::new(HashMap::new())),
            last_running: Mutex::new(file.last_running),
            start_lock: Mutex::new(()),
            generation: Mutex::new(0),
            persist: Mutex::new(()),
        })
    }

    fn state_path(&self) -> PathBuf {
        self.data_dir.join("state/instances.json")
    }

    pub async fn last_running(&self) -> Vec<String> {
        self.last_running.lock().await.clone()
    }

    async fn persist_last_running(&self) {
        // `persist` is taken before the snapshot so two concurrent writers can
        // never publish an older list last. No caller holds `last_running` while
        // acquiring `persist` (`mark_*` release it first), so this cannot deadlock.
        let _guard = self.persist.lock().await;
        let ids = self.last_running.lock().await.clone();
        let file = InstancesFile { last_running: ids };
        if let Err(err) = storage::write_json_atomic(&self.state_path(), &file).await {
            tracing::warn!(%err, "persist instances failed");
        }
    }

    async fn mark_running(&self, id: &str) {
        {
            let mut ids = self.last_running.lock().await;
            if !ids.iter().any(|item| item == id) {
                ids.push(id.to_string());
            }
        }
        self.persist_last_running().await;
    }

    async fn mark_stopped(&self, id: &str) {
        self.last_running.lock().await.retain(|item| item != id);
        self.persist_last_running().await;
    }

    pub async fn snapshot(&self, id: &str) -> InstanceSnapshot {
        let state = self
            .instances
            .lock()
            .await
            .get(id)
            .cloned()
            .unwrap_or_default();
        into_snapshot(id.to_string(), state)
    }

    pub async fn snapshots(&self) -> Result<Vec<InstanceSnapshot>, ApiError> {
        // Clone under the lock and release it before the config listing does I/O.
        let instances = self.instances.lock().await.clone();
        let mut out = Vec::new();
        let mut seen = Vec::new();
        for entry in self.configs.list().await? {
            let state = instances.get(&entry.id).cloned().unwrap_or_default();
            seen.push(entry.id.clone());
            out.push(into_snapshot(entry.id, state));
        }
        for (id, state) in instances.iter() {
            if !seen.contains(id) && state.pid.is_some() {
                out.push(into_snapshot(id.clone(), state.clone()));
            }
        }
        out.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(out)
    }

    /// Serialized entry point: `start_lock` is held for the whole body so a
    /// concurrent `stop`/`restart` can never interleave with a start.
    pub async fn start(&self, id: &str) -> Result<InstanceSnapshot, ApiError> {
        let _start = self.start_lock.lock().await;
        self.start_locked(id).await
    }

    async fn start_locked(&self, id: &str) -> Result<InstanceSnapshot, ApiError> {
        validate_config_id(id)?;
        // The running check comes first so an already running id reports
        // `instance_running` even when its core or config vanished from disk.
        let running = self
            .instances
            .lock()
            .await
            .get(id)
            .map(|state| state.pid.is_some())
            .unwrap_or(false);
        if running {
            return Err(ApiError::InstanceRunning);
        }
        let document = self.configs.get(id).await?;
        let core = resolve_core_in(&self.core_roots)?;
        let parsed = parse_core_config(&document.toml)?;
        let settings = self.settings.get().await;

        let mut endpoints: Vec<Endpoint> = Vec::new();
        if let Some(endpoint) = parse_endpoint(&parsed.rpc_portal) {
            endpoints.push(endpoint);
        }
        endpoints.extend(parsed.listeners.iter().cloned());

        // Ports claimed by the other running instances are read under the lock
        // and the guard is dropped before the async bind probes. Re-acquiring it
        // to register the pid is race-free: `start_lock` serializes every start
        // and stop, so no other instance can claim a port in between.
        let claimed: Vec<(String, Endpoint)> = {
            let instances = self.instances.lock().await;
            instances
                .iter()
                .filter(|(other, state)| state.pid.is_some() && other.as_str() != id)
                .flat_map(|(other, state)| {
                    let owner = format!("instance:{other}");
                    state
                        .endpoints
                        .iter()
                        .cloned()
                        .map(move |endpoint| (owner.clone(), endpoint))
                })
                .collect()
        };
        for endpoint in &endpoints {
            // A claim only blocks when protocol, port and address overlap; a UDP
            // listener over an existing TCP one, or another address on the same
            // port, is legal and falls through to the real bind probe.
            if let Some((owner, _)) = claimed
                .iter()
                .find(|(_, claimed)| claimed.conflicts_with(endpoint))
            {
                return Err(ApiError::PortInUse {
                    port: endpoint.port,
                    owner: Some(owner.clone()),
                });
            }
            if !port_free(&endpoint.host, endpoint.port, endpoint.mode).await {
                return Err(ApiError::PortInUse {
                    port: endpoint.port,
                    owner: None,
                });
            }
        }

        let generation = {
            let mut counter = self.generation.lock().await;
            *counter += 1;
            *counter
        };
        let log_dir = self.data_dir.join("logs/core").join(id);
        storage::ensure_dir(&log_dir).await?;
        let level = normalize_log_level(parsed.log_level.as_deref(), &settings.log_level);
        let mut command = tokio::process::Command::new(&core.core);
        command
            .arg("--file-log-dir")
            .arg(&log_dir)
            .arg("--file-log-level")
            .arg(&level)
            .arg("--file-log-size")
            .arg("10")
            .arg("--file-log-count")
            .arg("10")
            .arg("--config-file")
            .arg(self.configs.path(id))
            .arg("--rpc-portal")
            .arg(&parsed.rpc_portal)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(false);
        if settings.no_tun {
            command.arg("--no-tun");
        }
        // Own session + parent-death signal: `stop` can signal the whole group
        // and the kernel never outlives the agent.
        unsafe {
            command.pre_exec(|| {
                libc::setsid();
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM, 0, 0, 0);
                Ok(())
            });
        }
        let mut child = command
            .spawn()
            .map_err(|err| ApiError::Internal(format!("spawn easytier-core: {err}")))?;
        // A pid-less child could never be stopped (pid 0 is rejected by `stop`
        // forever), so kill it best-effort and fail instead of registering a ghost.
        let pid = match child.id() {
            Some(pid) if pid != 0 => pid,
            _ => {
                let _ = child.start_kill();
                return Err(ApiError::Internal("spawn returned no pid".into()));
            }
        };
        let stderr = child.stderr.take();
        // Register the pid before the waiter can observe the exit, otherwise a
        // kernel that dies immediately would leave a stale pid behind.
        self.instances.lock().await.insert(
            id.to_string(),
            Instance {
                pid: Some(pid),
                started_at: Some(chrono::Utc::now().timestamp()),
                rpc_portal: Some(parsed.rpc_portal.clone()),
                endpoints: endpoints.clone(),
                last_exit: None,
                generation,
            },
        );

        if let Some(stderr) = stderr {
            let label = id.to_string();
            tokio::spawn(async move {
                use tokio::io::AsyncBufReadExt;
                let mut lines = tokio::io::BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::warn!(config = %label, line = %line, "core stderr");
                }
            });
        }
        // The waiter owns the `Child`; it only clears the pid while `generation`
        // still matches so a restarted instance is never overwritten. A crashed
        // exit keeps `lastRunning`: only an explicit stop removes the entry.
        let instances_handle = self.instances.clone();
        let waiter_id = id.to_string();
        tokio::spawn(async move {
            let status = child.wait().await;
            let (code, error) = match status {
                Ok(status) => (status.code(), None),
                Err(err) => (None, Some(err.to_string())),
            };
            let mut instances = instances_handle.lock().await;
            if let Some(state) = instances.get_mut(&waiter_id) {
                if state.generation == generation {
                    state.pid = None;
                    state.last_exit = Some(LastExit {
                        code,
                        at: chrono::Utc::now().timestamp(),
                        error,
                    });
                }
            }
        });
        self.mark_running(id).await;
        Ok(self.snapshot(id).await)
    }

    /// Serialized with `start`: without `start_lock` a stop could `mark_stopped`
    /// after a concurrent start re-registered the id, dropping a live instance
    /// from `lastRunning` on disk.
    pub async fn stop(&self, id: &str) -> Result<InstanceSnapshot, ApiError> {
        let _start = self.start_lock.lock().await;
        self.stop_locked(id).await
    }

    async fn stop_locked(&self, id: &str) -> Result<InstanceSnapshot, ApiError> {
        validate_config_id(id)?;
        let pid = {
            let instances = self.instances.lock().await;
            match instances.get(id).and_then(|state| state.pid) {
                Some(pid) if pid != 0 => pid,
                _ => return Err(ApiError::InstanceNotRunning),
            }
        };
        terminate(pid, libc::SIGTERM);
        if !self.wait_stopped(id, Duration::from_secs(5)).await {
            terminate(pid, libc::SIGKILL);
            if !self.wait_stopped(id, Duration::from_secs(2)).await {
                // The kernel is still alive, so it must stay in `lastRunning`:
                // reporting success here would persist a lie.
                return Err(ApiError::Internal(format!(
                    "core process {pid} survived SIGKILL"
                )));
            }
        }
        self.mark_stopped(id).await;
        Ok(self.snapshot(id).await)
    }

    /// Serialized with `start`/`stop` through a single `start_lock` acquisition
    /// (the tokio mutex is not reentrant, hence the `*_locked` bodies).
    pub async fn restart(&self, id: &str) -> Result<InstanceSnapshot, ApiError> {
        validate_config_id(id)?;
        let _start = self.start_lock.lock().await;
        let running = self
            .instances
            .lock()
            .await
            .get(id)
            .map(|state| state.pid.is_some())
            .unwrap_or(false);
        if !running {
            return Err(ApiError::InstanceNotRunning);
        }
        self.stop_locked(id).await?;
        self.start_locked(id).await
    }

    async fn wait_stopped(&self, id: &str, timeout: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let running = self
                .instances
                .lock()
                .await
                .get(id)
                .map(|state| state.pid.is_some())
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

/// Moves a corrupt state file to `<name>.corrupt-<unix-ts>` (best effort) so the
/// evidence survives while the next write starts from a clean path. A failed
/// rename only costs the evidence, never the boot.
async fn quarantine_corrupt(path: &Path) {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state");
    let target = path.with_file_name(format!("{name}.corrupt-{}", chrono::Utc::now().timestamp()));
    if let Err(err) = tokio::fs::rename(path, &target).await {
        tracing::warn!(
            path = %path.display(),
            error = %err,
            "could not move corrupt state file aside"
        );
    }
}

/// Brings back the instances that were running when the agent last exited.
///
/// Idempotent: an already running instance answers `instance_running` and is
/// only logged. Failures (missing core, port clash, deleted config) are logged
/// and skipped so one broken instance cannot keep the others down.
pub async fn autostart(supervisor: &Supervisor) {
    if !supervisor.settings.get().await.auto_start_last_running {
        return;
    }
    for (index, id) in supervisor.last_running().await.iter().enumerate() {
        if index > 0 {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        match supervisor.start(id).await {
            Ok(snapshot) => tracing::info!(config = %snapshot.id, "autostart started"),
            Err(err) => tracing::warn!(config = %id, code = err.code(), "autostart failed"),
        }
    }
}

/// Search order for the kernel: explicit override, then the packaged
/// `/opt/lighttier/core`, then `<data>/core`.
fn core_search_roots(data_dir: &Path, override_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(dir) = override_dir {
        roots.push(dir.to_path_buf());
    }
    roots.push(PathBuf::from("/opt/lighttier/core"));
    roots.push(data_dir.join("core"));
    roots
}

/// Finds the newest usable kernel. Roots are tried in order — explicit override,
/// then the packaged `/opt/lighttier/core`, then `<data>/core` — and the first
/// root that holds a candidate wins. A root that itself contains
/// `easytier-core` counts as a release whose version is the directory name.
pub fn resolve_core(data_dir: &Path, override_dir: Option<&Path>) -> Result<CorePaths, ApiError> {
    resolve_core_in(&core_search_roots(data_dir, override_dir))
}

/// Root-list seam: `resolve_core` and `Supervisor` both delegate here, and tests
/// pass their own roots so a packaged core cannot influence the result.
fn resolve_core_in(roots: &[PathBuf]) -> Result<CorePaths, ApiError> {
    for root in roots {
        if let Some(best) = core_candidates(root)
            .into_iter()
            .max_by_key(|candidate| version_key(&candidate.version))
        {
            return Ok(best);
        }
    }
    Err(ApiError::CoreMissing)
}

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

fn version_key(version: &str) -> Vec<u64> {
    version
        .split(|c: char| !c.is_ascii_digit())
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

/// Levels easytier-core accepts for `--file-log-level`. The kernel parses the
/// flag with `.unwrap()`, so any other value panics it at startup; the desktop
/// applies the same whitelist (`normalizeLogLevel` in
/// `frontend/src/shared/lib/coreLogUtil.ts`).
const FILE_LOG_LEVELS: [&str; 6] = ["error", "warn", "info", "debug", "trace", "off"];

/// Normalizes a TOML `[file_logger] level` into a value the kernel can parse:
/// trim + lowercase, whitelist incl. `off`, then fall back to `settings.logLevel`
/// and finally to `info`.
pub fn normalize_log_level(value: Option<&str>, fallback: &str) -> String {
    match value.map(|raw| raw.trim().to_ascii_lowercase()) {
        Some(level) if FILE_LOG_LEVELS.contains(&level.as_str()) => level,
        _ => {
            let fallback = fallback.trim().to_ascii_lowercase();
            if FILE_LOG_LEVELS.contains(&fallback.as_str()) {
                fallback
            } else {
                "info".to_string()
            }
        }
    }
}

pub fn parse_core_config(text: &str) -> Result<CoreConfig, ApiError> {
    let table: toml::Table =
        text.parse()
            .map_err(|err: toml::de::Error| ApiError::InvalidToml {
                detail: err.to_string(),
            })?;
    let rpc_portal = table
        .get("rpc_portal")
        .and_then(|value| value.as_str())
        .unwrap_or("127.0.0.1:15888")
        .to_string();
    // Real configs written by LightTier/EasyTier use a string array
    // (`listeners = ["tcp://0.0.0.0:11010", ...]`); `[[listeners]] uri = "..."`
    // tables are still accepted for compatibility with hand-written configs.
    let listeners = table
        .get("listeners")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let uri = item
                        .as_str()
                        .or_else(|| item.get("uri").and_then(|value| value.as_str()))?;
                    parse_endpoint(uri)
                })
                .collect()
        })
        .unwrap_or_default();
    let log_level = table
        .get("file_logger")
        .and_then(|value| value.as_table())
        .and_then(|table| table.get("level"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    Ok(CoreConfig {
        rpc_portal,
        listeners,
        log_level,
    })
}

/// Parses an EasyTier listener URI (`scheme://host:port[/...]`) into a bindable
/// endpoint. Unknown schemes, port 0 and hostless URIs are skipped; a missing
/// scheme is treated as `tcp` so a bare `host:port` also works.
pub fn parse_endpoint(raw: &str) -> Option<Endpoint> {
    let (scheme, rest) = match raw.split_once("://") {
        Some((scheme, rest)) => (scheme.to_ascii_lowercase(), rest),
        None => ("tcp".to_string(), raw),
    };
    let mode = match scheme.as_str() {
        "tcp" | "ws" | "wss" => PortMode::Tcp,
        "udp" | "wg" | "quic" => PortMode::Udp,
        _ => return None,
    };
    let authority = rest.split('/').next().unwrap_or(rest);
    let (host, port) = if let Some(stripped) = authority.strip_prefix('[') {
        let (host, tail) = stripped.split_once(']')?;
        (host.to_string(), tail.strip_prefix(':')?)
    } else {
        let (host, port) = authority.rsplit_once(':')?;
        (host.to_string(), port)
    };
    let port: u16 = port.parse().ok()?;
    if port == 0 {
        return None;
    }
    let host = if host.is_empty() || host == "*" {
        "0.0.0.0".to_string()
    } else {
        host
    };
    Some(Endpoint { host, port, mode })
}

fn socket_addr(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

async fn port_free(host: &str, port: u16, mode: PortMode) -> bool {
    let addr = socket_addr(host, port);
    let probe = async {
        match mode {
            PortMode::Tcp => tokio::net::TcpListener::bind(&addr).await.is_ok(),
            PortMode::Udp => std::net::UdpSocket::bind(&addr).is_ok(),
        }
    };
    tokio::time::timeout(Duration::from_secs(2), probe)
        .await
        .unwrap_or(false)
}

fn terminate(pid: u32, signal: i32) {
    unsafe {
        if libc::kill(-(pid as i32), signal) != 0 {
            libc::kill(pid as i32, signal);
        }
    }
}

fn into_snapshot(id: String, state: Instance) -> InstanceSnapshot {
    InstanceSnapshot {
        id,
        running: state.pid.is_some(),
        pid: state.pid,
        started_at: state.started_at,
        rpc_portal: state.rpc_portal,
        last_exit: state.last_exit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::configs::Configs;
    use crate::settings::SettingsPatch;
    use std::os::unix::fs::PermissionsExt;

    fn write_exec(path: &Path, body: &str) {
        std::fs::write(path, body).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// Installs `body` as `<root>/v9.9.9/easytier-core` and returns the root.
    fn fake_core_script(root: &Path, body: &str) -> PathBuf {
        let version = root.join("v9.9.9");
        std::fs::create_dir_all(&version).unwrap();
        write_exec(&version.join("easytier-core"), body);
        root.to_path_buf()
    }

    fn fake_core(root: &Path) -> PathBuf {
        fake_core_script(
            root,
            "#!/bin/sh\ntrap 'exit 0' TERM\nwhile true; do sleep 0.1; done\n",
        )
    }

    /// Fake kernel that records its argv (one entry per line) next to itself and
    /// then idles, so a test can assert the exact spawn arguments.
    const ARG_RECORDING_CORE: &str = r#"#!/bin/sh
trap 'exit 0' TERM
for arg in "$@"; do
  printf '%s\n' "$arg"
done > "$(dirname "$0")/args.txt"
while true; do sleep 0.1; done
"#;

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

    fn contains(args: &[String], flag: &str) -> bool {
        args.iter().any(|arg| arg == flag)
    }

    async fn persisted_last_running(data: &Path) -> serde_json::Value {
        serde_json::from_str(
            &tokio::fs::read_to_string(data.join("state/instances.json"))
                .await
                .unwrap(),
        )
        .unwrap()
    }

    async fn store(data: &Path) -> (Arc<Configs>, Arc<SettingsStore>) {
        (
            Arc::new(Configs::new(data)),
            Arc::new(SettingsStore::load(data).await.unwrap()),
        )
    }

    #[tokio::test]
    async fn start_stop_fake_core() {
        let dir = tempfile::tempdir().unwrap();
        let core = fake_core(&dir.path().join("core"));
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        // A dedicated portal port keeps this test isolated from
        // `second_instance_same_port_conflicts`, which probes the default 15888
        // from a parallel test thread.
        configs
            .put("home", "rpc_portal = \"127.0.0.1:15901\"\n", None)
            .await
            .unwrap();
        let supervisor = Supervisor::load(&data, Some(core), configs.clone(), settings)
            .await
            .unwrap();

        let snapshot = supervisor.start("home").await.unwrap();
        assert!(snapshot.running);
        let pid = snapshot.pid.unwrap();
        assert!(pid > 0);
        let log_dir = data.join("logs/core/home");
        assert!(log_dir.is_dir());

        let stopped = supervisor.stop("home").await.unwrap();
        assert!(!stopped.running);
        assert!(stopped.last_exit.is_some());
        // The kernel is really gone, not just forgotten: the pid no longer exists.
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
        assert!(log_dir.is_dir());

        let persisted = persisted_last_running(&data).await;
        assert_eq!(persisted["lastRunning"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn second_instance_same_port_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let core = fake_core(&dir.path().join("core"));
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        configs
            .put("a", "rpc_portal = \"127.0.0.1:15888\"\n", None)
            .await
            .unwrap();
        configs
            .put("b", "rpc_portal = \"127.0.0.1:15888\"\n", None)
            .await
            .unwrap();
        let supervisor = Supervisor::load(&data, Some(core), configs, settings)
            .await
            .unwrap();
        supervisor.start("a").await.unwrap();
        let err = supervisor.start("b").await.unwrap_err();
        assert_eq!(err.code(), "port_in_use");
        match err {
            ApiError::PortInUse { port, owner } => {
                assert_eq!(port, 15888);
                assert_eq!(owner.as_deref(), Some("instance:a"));
            }
            other => panic!("expected port_in_use, got {other:?}"),
        }
        supervisor.stop("a").await.unwrap();
    }

    /// A listener clash on the same port must be attributed to the instance that
    /// holds it, not only rpc portal clashes. Uses the product's real TOML shape
    /// (`listeners = [...]`), which is what the frontend writes.
    #[tokio::test]
    async fn listener_port_conflict_reports_owner() {
        let dir = tempfile::tempdir().unwrap();
        let core = fake_core(&dir.path().join("core"));
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        configs
            .put(
                "a",
                "rpc_portal = \"127.0.0.1:15907\"\nlisteners = [\"tcp://0.0.0.0:15908\"]\n",
                None,
            )
            .await
            .unwrap();
        configs
            .put(
                "b",
                "rpc_portal = \"127.0.0.1:15909\"\nlisteners = [\"tcp://0.0.0.0:15908\"]\n",
                None,
            )
            .await
            .unwrap();
        let supervisor = Supervisor::load(&data, Some(core), configs, settings)
            .await
            .unwrap();
        supervisor.start("a").await.unwrap();
        let err = supervisor.start("b").await.unwrap_err();
        match err {
            ApiError::PortInUse { port, owner } => {
                assert_eq!(port, 15908);
                assert_eq!(owner.as_deref(), Some("instance:a"));
            }
            other => panic!("expected port_in_use, got {other:?}"),
        }
        supervisor.stop("a").await.unwrap();
    }

    /// UDP and TCP port spaces are independent: the same port number on both
    /// protocols is a legal pair and must reach the real bind probe.
    #[tokio::test]
    async fn udp_and_tcp_listeners_on_same_port_both_start() {
        let dir = tempfile::tempdir().unwrap();
        let core = fake_core(&dir.path().join("core"));
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        configs
            .put(
                "udp",
                "rpc_portal = \"127.0.0.1:15920\"\nlisteners = [\"udp://0.0.0.0:15921\"]\n",
                None,
            )
            .await
            .unwrap();
        configs
            .put(
                "tcp",
                "rpc_portal = \"127.0.0.1:15922\"\nlisteners = [\"tcp://0.0.0.0:15921\"]\n",
                None,
            )
            .await
            .unwrap();
        let supervisor = Supervisor::load(&data, Some(core), configs, settings)
            .await
            .unwrap();
        supervisor.start("udp").await.unwrap();
        let snapshot = supervisor.start("tcp").await.unwrap();
        assert!(snapshot.running);
        supervisor.stop("tcp").await.unwrap();
        supervisor.stop("udp").await.unwrap();
    }

    /// Two instances may bind the same port on disjoint addresses.
    #[tokio::test]
    async fn disjoint_tcp_hosts_on_same_port_both_start() {
        let dir = tempfile::tempdir().unwrap();
        let core = fake_core(&dir.path().join("core"));
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        configs
            .put(
                "first",
                "rpc_portal = \"127.0.0.1:15923\"\nlisteners = [\"tcp://127.0.0.1:15924\"]\n",
                None,
            )
            .await
            .unwrap();
        configs
            .put(
                "second",
                "rpc_portal = \"127.0.0.1:15925\"\nlisteners = [\"tcp://127.0.0.2:15924\"]\n",
                None,
            )
            .await
            .unwrap();
        let supervisor = Supervisor::load(&data, Some(core), configs, settings)
            .await
            .unwrap();
        supervisor.start("first").await.unwrap();
        let snapshot = supervisor.start("second").await.unwrap();
        assert!(snapshot.running);
        supervisor.stop("second").await.unwrap();
        supervisor.stop("first").await.unwrap();
    }

    /// A wildcard bind overlaps any address on the same port and protocol, so
    /// `0.0.0.0` must still reject a specific host of the same protocol.
    #[tokio::test]
    async fn wildcard_listener_conflicts_with_specific_host() {
        let dir = tempfile::tempdir().unwrap();
        let core = fake_core(&dir.path().join("core"));
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        configs
            .put(
                "wild",
                "rpc_portal = \"127.0.0.1:15926\"\nlisteners = [\"tcp://0.0.0.0:15927\"]\n",
                None,
            )
            .await
            .unwrap();
        configs
            .put(
                "specific",
                "rpc_portal = \"127.0.0.1:15928\"\nlisteners = [\"tcp://127.0.0.1:15927\"]\n",
                None,
            )
            .await
            .unwrap();
        let supervisor = Supervisor::load(&data, Some(core), configs, settings)
            .await
            .unwrap();
        supervisor.start("wild").await.unwrap();
        let err = supervisor.start("specific").await.unwrap_err();
        match err {
            ApiError::PortInUse { port, owner } => {
                assert_eq!(port, 15927);
                assert_eq!(owner.as_deref(), Some("instance:wild"));
            }
            other => panic!("expected port_in_use, got {other:?}"),
        }
        supervisor.stop("wild").await.unwrap();
    }

    #[tokio::test]
    async fn missing_core_reports_core_missing() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        configs
            .put("home", "hostname = \"nas\"\n", None)
            .await
            .unwrap();
        // Explicit roots: a core packaged at `/opt/lighttier/core` on the host
        // must not be able to change this test's result.
        let supervisor =
            Supervisor::load_with_roots(&data, vec![dir.path().join("absent")], configs, settings)
                .await
                .unwrap();
        let err = supervisor.start("home").await.unwrap_err();
        assert_eq!(err.code(), "core_missing");
    }

    #[tokio::test]
    async fn restart_spawns_new_process() {
        let dir = tempfile::tempdir().unwrap();
        let core = fake_core(&dir.path().join("core"));
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        configs
            .put("home", "rpc_portal = \"127.0.0.1:15902\"\n", None)
            .await
            .unwrap();
        let supervisor = Supervisor::load(&data, Some(core), configs, settings)
            .await
            .unwrap();

        let first = supervisor.start("home").await.unwrap();
        assert!(first.running);

        let restarted = supervisor.restart("home").await.unwrap();
        assert!(restarted.running);
        assert_ne!(
            restarted.pid, first.pid,
            "restart must run a brand new process"
        );
        assert!(
            restarted.started_at.unwrap() >= first.started_at.unwrap(),
            "startedAt must be refreshed by the restart"
        );
        assert!(restarted.last_exit.is_none());

        let stopped = supervisor.stop("home").await.unwrap();
        assert!(!stopped.running);
    }

    #[tokio::test]
    async fn stop_when_not_running() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        // No core and no config needed: the running check comes first.
        let supervisor = Supervisor::load_with_roots(&data, Vec::new(), configs, settings)
            .await
            .unwrap();
        assert_eq!(
            supervisor.stop("home").await.unwrap_err().code(),
            "instance_not_running"
        );
        assert_eq!(
            supervisor.restart("home").await.unwrap_err().code(),
            "instance_not_running"
        );
        assert_eq!(
            supervisor.restart("bad id").await.unwrap_err().code(),
            "invalid_id"
        );
    }

    #[tokio::test]
    async fn start_twice_reports_instance_running() {
        let dir = tempfile::tempdir().unwrap();
        let core_root = dir.path().join("core");
        let core = fake_core(&core_root);
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        configs
            .put("home", "rpc_portal = \"127.0.0.1:15903\"\n", None)
            .await
            .unwrap();
        let supervisor = Supervisor::load(&data, Some(core), configs, settings)
            .await
            .unwrap();

        supervisor.start("home").await.unwrap();
        // A running instance wins over a missing core: the kernel was removed
        // from disk after the spawn.
        std::fs::remove_dir_all(&core_root).unwrap();
        assert_eq!(
            supervisor.start("home").await.unwrap_err().code(),
            "instance_running"
        );
        supervisor.stop("home").await.unwrap();
    }

    #[tokio::test]
    async fn crash_keeps_last_running() {
        let dir = tempfile::tempdir().unwrap();
        let core = fake_core_script(&dir.path().join("core"), "#!/bin/sh\nexit 0\n");
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        configs
            .put("home", "rpc_portal = \"127.0.0.1:15904\"\n", None)
            .await
            .unwrap();
        let supervisor = Supervisor::load(&data, Some(core), configs, settings)
            .await
            .unwrap();

        supervisor.start("home").await.unwrap();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        while supervisor.snapshot("home").await.pid.is_some() {
            assert!(
                tokio::time::Instant::now() < deadline,
                "crashed kernel pid never cleared"
            );
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        let crashed = supervisor.snapshot("home").await;
        assert!(!crashed.running);
        assert!(crashed.last_exit.is_some());

        // Only an explicit stop removes an id from `lastRunning`; a crash keeps it.
        let persisted = persisted_last_running(&data).await;
        assert!(
            persisted["lastRunning"]
                .as_array()
                .unwrap()
                .iter()
                .any(|id| id.as_str() == Some("home")),
            "crashed instance must stay in lastRunning: {persisted}"
        );
    }

    #[tokio::test]
    async fn spawn_args_follow_settings() {
        let dir = tempfile::tempdir().unwrap();
        let core_root = dir.path().join("core");
        let core = fake_core_script(&core_root, ARG_RECORDING_CORE);
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        configs
            .put("home", "rpc_portal = \"127.0.0.1:15905\"\n", None)
            .await
            .unwrap();
        let supervisor = Supervisor::load(&data, Some(core), configs.clone(), settings)
            .await
            .unwrap();
        let args_path = args_file(&core_root);

        supervisor.start("home").await.unwrap();
        let args = read_args(&args_path).await;
        supervisor.stop("home").await.unwrap();

        let log_dir = data.join("logs/core/home");
        assert_eq!(
            value_after(&args, "--file-log-dir"),
            Some(log_dir.to_str().unwrap())
        );
        assert_eq!(value_after(&args, "--file-log-level"), Some("info"));
        assert_eq!(value_after(&args, "--file-log-size"), Some("10"));
        assert_eq!(value_after(&args, "--file-log-count"), Some("10"));
        assert_eq!(
            value_after(&args, "--config-file"),
            Some(configs.path("home").to_str().unwrap())
        );
        assert_eq!(value_after(&args, "--rpc-portal"), Some("127.0.0.1:15905"));
        assert!(!contains(&args, "--no-tun"), "noTun is off by default");
    }

    #[tokio::test]
    async fn spawn_args_add_no_tun_when_enabled() {
        let dir = tempfile::tempdir().unwrap();
        let core_root = dir.path().join("core");
        let core = fake_core_script(&core_root, ARG_RECORDING_CORE);
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        configs
            .put("home", "rpc_portal = \"127.0.0.1:15906\"\n", None)
            .await
            .unwrap();
        let supervisor = Supervisor::load(&data, Some(core), configs, settings.clone())
            .await
            .unwrap();
        settings
            .update(SettingsPatch {
                no_tun: Some(true),
                ..SettingsPatch::default()
            })
            .await
            .unwrap();
        let args_path = args_file(&core_root);

        supervisor.start("home").await.unwrap();
        let args = read_args(&args_path).await;
        supervisor.stop("home").await.unwrap();

        assert!(contains(&args, "--no-tun"));
        assert_eq!(value_after(&args, "--rpc-portal"), Some("127.0.0.1:15906"));
    }

    /// An invalid TOML `[file_logger] level` would make easytier-core panic on
    /// `--file-log-level`, so only a normalized value may reach the kernel.
    #[tokio::test]
    async fn invalid_toml_log_level_falls_back_to_info() {
        let dir = tempfile::tempdir().unwrap();
        let core_root = dir.path().join("core");
        let core = fake_core_script(&core_root, ARG_RECORDING_CORE);
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        configs
            .put(
                "home",
                "rpc_portal = \"127.0.0.1:15917\"\n\n[file_logger]\nlevel = \"verbose\"\n",
                None,
            )
            .await
            .unwrap();
        let supervisor = Supervisor::load(&data, Some(core), configs, settings)
            .await
            .unwrap();
        let args_path = args_file(&core_root);

        supervisor.start("home").await.unwrap();
        let args = read_args(&args_path).await;
        supervisor.stop("home").await.unwrap();

        assert_eq!(value_after(&args, "--file-log-level"), Some("info"));
    }

    /// A valid TOML level wins over `settings.logLevel` and is passed verbatim
    /// (case-normalized) to the kernel.
    #[tokio::test]
    async fn toml_log_level_overrides_settings() {
        let dir = tempfile::tempdir().unwrap();
        let core_root = dir.path().join("core");
        let core = fake_core_script(&core_root, ARG_RECORDING_CORE);
        let data = dir.path().join("data");
        let (configs, settings) = store(&data).await;
        configs
            .put(
                "home",
                "rpc_portal = \"127.0.0.1:15919\"\n\n[file_logger]\nlevel = \" OFF \"\n",
                None,
            )
            .await
            .unwrap();
        let supervisor = Supervisor::load(&data, Some(core), configs, settings.clone())
            .await
            .unwrap();
        settings
            .update(SettingsPatch {
                log_level: Some("error".into()),
                ..SettingsPatch::default()
            })
            .await
            .unwrap();
        let args_path = args_file(&core_root);

        supervisor.start("home").await.unwrap();
        let args = read_args(&args_path).await;
        supervisor.stop("home").await.unwrap();

        assert_eq!(value_after(&args, "--file-log-level"), Some("off"));
    }

    /// A truncated `instances.json` (power loss) must not abort boot: the agent
    /// starts with an empty `lastRunning` and keeps the bad file as evidence.
    #[tokio::test]
    async fn corrupt_instances_file_starts_empty_and_keeps_evidence() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        std::fs::create_dir_all(data.join("state")).unwrap();
        std::fs::write(
            data.join("state/instances.json"),
            b"{\"lastRunning\":[\"home\"",
        )
        .unwrap();
        let (configs, settings) = store(&data).await;

        let supervisor = Supervisor::load(&data, None, configs, settings)
            .await
            .unwrap();

        assert!(supervisor.last_running().await.is_empty());
        let mut names: Vec<String> = std::fs::read_dir(data.join("state"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert!(
            names
                .iter()
                .any(|name| name.starts_with("instances.json.corrupt-")),
            "corrupt file must be preserved: {names:?}"
        );
        assert!(
            !names.iter().any(|name| name == "instances.json"),
            "corrupt file must be moved out of the way: {names:?}"
        );
    }

    #[test]
    fn parse_config_defaults_and_endpoints() {
        assert_eq!(
            parse_core_config("hostname = \"x\"\n").unwrap().rpc_portal,
            "127.0.0.1:15888"
        );
        let parsed = parse_core_config(
            "[file_logger]\nlevel = \"debug\"\n[[listeners]]\nuri = \"udp://0.0.0.0:11010\"\n",
        )
        .unwrap();
        assert_eq!(parsed.log_level.as_deref(), Some("debug"));
        assert_eq!(
            parsed.listeners,
            vec![Endpoint {
                host: "0.0.0.0".into(),
                port: 11010,
                mode: PortMode::Udp,
            }]
        );
        assert_eq!(
            parse_endpoint("tcp://0.0.0.0:11010"),
            Some(Endpoint {
                host: "0.0.0.0".into(),
                port: 11010,
                mode: PortMode::Tcp,
            })
        );
        assert_eq!(
            parse_endpoint("wg://[::]:11011"),
            Some(Endpoint {
                host: "::".into(),
                port: 11011,
                mode: PortMode::Udp,
            })
        );
        assert_eq!(parse_endpoint("foo://1.2.3.4:1"), None);
        assert_eq!(parse_endpoint("tcp://1.2.3.4:0"), None);
        assert_eq!(parse_endpoint("tcp://1.2.3.4"), None);
    }

    /// LightTier/EasyTier write `listeners` as a string array; a malformed entry
    /// is skipped without failing the whole parse.
    #[test]
    fn parse_config_accepts_string_listener_array() {
        let parsed = parse_core_config(
            "listeners = [\"tcp://0.0.0.0:11010\", \"nope://1.2.3.4:11011\", \"udp://0.0.0.0:11012\"]\n",
        )
        .unwrap();
        assert_eq!(
            parsed.listeners,
            vec![
                Endpoint {
                    host: "0.0.0.0".into(),
                    port: 11010,
                    mode: PortMode::Tcp,
                },
                Endpoint {
                    host: "0.0.0.0".into(),
                    port: 11012,
                    mode: PortMode::Udp,
                },
            ]
        );
    }

    /// Full product-shaped TOML (as serialized by the frontend): listeners
    /// array, `[[peer]]` tables, `[file_logger]` and `rpc_portal`.
    const REALISTIC_PRODUCT_TOML: &str = r#"instance_name = "nas-server"
hostname = "nas"
dhcp = true
listeners = ["tcp://0.0.0.0:11010", "udp://0.0.0.0:11010"]
rpc_portal = "0.0.0.0:15888"
routes = ["10.144.0.0/24"]

[network_identity]
network_name = "office"
network_secret = "s3cret"

[[peer]]
uri = "tcp://relay.example.com:11010"

[[peer]]
uri = "udp://relay2.example.com:11010"

[file_logger]
level = "warn"
file = "easytier"
"#;

    #[test]
    fn realistic_product_toml_parses_listeners_level_and_portal() {
        let parsed = parse_core_config(REALISTIC_PRODUCT_TOML).unwrap();

        assert_eq!(parsed.listeners.len(), 2);
        assert_eq!(
            parsed.listeners[0],
            Endpoint {
                host: "0.0.0.0".into(),
                port: 11010,
                mode: PortMode::Tcp,
            }
        );
        assert_eq!(
            parsed.listeners[1],
            Endpoint {
                host: "0.0.0.0".into(),
                port: 11010,
                mode: PortMode::Udp,
            }
        );
        assert_eq!(parsed.log_level.as_deref(), Some("warn"));
        assert_eq!(parsed.rpc_portal, "0.0.0.0:15888");
        assert_eq!(
            parse_endpoint(&parsed.rpc_portal),
            Some(Endpoint {
                host: "0.0.0.0".into(),
                port: 15888,
                mode: PortMode::Tcp,
            })
        );
    }

    #[test]
    fn endpoint_conflicts_require_same_port_mode_and_overlapping_host() {
        let wildcard = Endpoint {
            host: "0.0.0.0".into(),
            port: 11010,
            mode: PortMode::Tcp,
        };
        let loopback = Endpoint {
            host: "127.0.0.1".into(),
            port: 11010,
            mode: PortMode::Tcp,
        };
        assert!(loopback.conflicts_with(&loopback));
        // A wildcard overlaps every address on the same port/protocol.
        assert!(wildcard.conflicts_with(&loopback));
        assert!(loopback.conflicts_with(&wildcard));
        // Disjoint concrete addresses do not overlap.
        let lan = Endpoint {
            host: "192.168.1.5".into(),
            ..loopback.clone()
        };
        assert!(!loopback.conflicts_with(&lan));
        // Different protocol or port never conflicts.
        let udp = Endpoint {
            mode: PortMode::Udp,
            ..wildcard.clone()
        };
        assert!(!udp.conflicts_with(&wildcard));
        let other_port = Endpoint {
            port: 11011,
            ..wildcard.clone()
        };
        assert!(!wildcard.conflicts_with(&other_port));
        // The IPv6 wildcard is a wildcard too.
        let v6 = Endpoint {
            host: "::".into(),
            ..loopback.clone()
        };
        assert!(v6.conflicts_with(&lan));
    }

    #[test]
    fn normalize_log_level_applies_desktop_whitelist() {
        assert_eq!(normalize_log_level(Some("debug"), "info"), "debug");
        assert_eq!(normalize_log_level(Some(" OFF "), "info"), "off");
        assert_eq!(normalize_log_level(Some("Warn"), "info"), "warn");
        // Invalid or empty TOML value falls back to settings, then to info.
        assert_eq!(normalize_log_level(Some("verbose"), "trace"), "trace");
        assert_eq!(normalize_log_level(Some(""), "trace"), "trace");
        assert_eq!(normalize_log_level(None, "error"), "error");
        // An unusable fallback never leaks to the kernel.
        assert_eq!(normalize_log_level(Some("verbose"), "loud"), "info");
        assert_eq!(normalize_log_level(None, ""), "info");
    }

    #[test]
    fn resolve_prefers_first_root_then_highest_version() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("core");
        for version in ["v2.4.5", "v2.7.1", "v2.6.4"] {
            let path = root.join(version);
            std::fs::create_dir_all(&path).unwrap();
            write_exec(&path.join("easytier-core"), "#!/bin/sh\n");
        }
        let resolved = resolve_core(dir.path(), Some(&root)).unwrap();
        assert_eq!(resolved.version, "v2.7.1");
        assert!(resolved.cli.is_none());
    }
}

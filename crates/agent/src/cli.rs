use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::RwLock;

use crate::error::ApiError;
use crate::supervisor::{resolve_core, Supervisor};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);
const CACHE_TTL_MS: i64 = 1000;

#[derive(Clone)]
struct CacheEntry {
    at: i64,
    data: Value,
}

enum CliError {
    Timeout,
    Failed(String),
}

pub struct CliQuery {
    data_dir: PathBuf,
    core_override: Option<PathBuf>,
    timeout: Duration,
    cache: RwLock<HashMap<(String, String), CacheEntry>>,
}

impl CliQuery {
    pub fn new(data_dir: &Path, core_override: Option<PathBuf>) -> Self {
        Self::with_timeout(data_dir, core_override, DEFAULT_TIMEOUT)
    }

    pub fn with_timeout(
        data_dir: &Path,
        core_override: Option<PathBuf>,
        timeout: Duration,
    ) -> Self {
        Self {
            data_dir: data_dir.to_path_buf(),
            core_override,
            timeout,
            cache: RwLock::new(HashMap::new()),
        }
    }

    pub async fn query(
        &self,
        supervisor: &Supervisor,
        id: &str,
        subcommand: &str,
    ) -> Result<Value, ApiError> {
        let snapshot = supervisor.snapshot(id).await;
        if !snapshot.running {
            return Err(ApiError::InstanceNotRunning);
        }
        let portal = snapshot
            .rpc_portal
            .clone()
            .unwrap_or_else(|| "127.0.0.1:15888".to_string());
        let key = (id.to_string(), subcommand.to_string());
        let now = chrono::Utc::now().timestamp_millis();
        let cached = self.cache.read().await.get(&key).cloned();
        if let Some(entry) = &cached {
            if now - entry.at < CACHE_TTL_MS {
                return Ok(json!({ "stale": false, "data": entry.data }));
            }
        }
        let core = resolve_core(&self.data_dir, self.core_override.as_deref())?;
        let cli = core.cli.ok_or(ApiError::CoreMissing)?;
        match run_cli(&cli, &portal, subcommand, self.timeout).await {
            Ok(data) => {
                self.cache.write().await.insert(
                    key,
                    CacheEntry {
                        // Timestamp at success, not at spawn: a 5 s run must not
                        // land already expired.
                        at: chrono::Utc::now().timestamp_millis(),
                        data: data.clone(),
                    },
                );
                Ok(json!({ "stale": false, "data": data }))
            }
            Err(CliError::Timeout) => Ok(stale_response(cached, "cli_timeout")),
            Err(CliError::Failed(detail)) => {
                tracing::debug!(cli = %cli.display(), subcommand, %detail, "cli query failed");
                Ok(stale_response(cached, "cli_failed"))
            }
        }
    }
}

fn stale_response(cached: Option<CacheEntry>, error: &str) -> Value {
    let data = cached.map(|entry| entry.data).unwrap_or(Value::Null);
    json!({ "stale": true, "data": data, "error": error })
}

async fn run_cli(
    cli: &Path,
    portal: &str,
    subcommand: &str,
    timeout: Duration,
) -> Result<Value, CliError> {
    let mut command = tokio::process::Command::new(cli);
    command
        .arg("-p")
        .arg(portal)
        .arg("--output")
        .arg("json")
        .arg(subcommand)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| CliError::Timeout)?
        .map_err(|err| CliError::Failed(err.to_string()))?;
    if !output.status.success() {
        return Err(CliError::Failed(format!(
            "exit code {:?}",
            output.status.code()
        )));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|err| CliError::Failed(format!("invalid json: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::configs::Configs;
    use crate::settings::SettingsStore;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Arc;

    fn write_exec(path: &Path, body: &str) {
        std::fs::write(path, body).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    async fn fake_install(dir: &Path, cli_body: &str, toml: &str) -> Supervisor {
        let version = dir.join("core/v9.9.9");
        std::fs::create_dir_all(&version).unwrap();
        write_exec(
            &version.join("easytier-core"),
            "#!/bin/sh\ntrap 'exit 0' TERM\nwhile true; do sleep 0.1; done\n",
        );
        write_exec(&version.join("easytier-cli"), cli_body);
        let data = dir.join("data");
        let configs = Arc::new(Configs::new(&data));
        configs.put("home", toml, None).await.unwrap();
        let settings = Arc::new(SettingsStore::load(&data).await.unwrap());
        Supervisor::load(&data, Some(dir.join("core")), configs, settings)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn caches_and_marks_stale_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("fail");
        let body = format!(
            "#!/bin/sh\nif [ -f '{}' ]; then exit 3; fi\necho '{{\"ok\":true}}'\n",
            marker.display()
        );
        let supervisor = fake_install(
            dir.path(),
            &body,
            "rpc_portal = \"127.0.0.1:15913\"\nhostname = \"nas\"\n",
        )
        .await;
        let data = dir.path().join("data");
        let cli = CliQuery::with_timeout(
            &data,
            Some(dir.path().join("core")),
            Duration::from_millis(500),
        );
        supervisor.start("home").await.unwrap();

        let value = cli.query(&supervisor, "home", "node").await.unwrap();
        assert_eq!(value["stale"], false);
        assert_eq!(value["data"]["ok"], true);

        std::fs::write(&marker, b"").unwrap();
        tokio::time::sleep(Duration::from_millis(1100)).await;
        let value = cli.query(&supervisor, "home", "node").await.unwrap();
        assert_eq!(value["stale"], true);
        assert_eq!(value["error"], "cli_failed");
        assert_eq!(value["data"]["ok"], true);

        supervisor.stop("home").await.unwrap();
        let err = cli.query(&supervisor, "home", "node").await.unwrap_err();
        assert_eq!(err.code(), "instance_not_running");
    }

    #[tokio::test]
    async fn timeout_is_reported_as_stale() {
        let dir = tempfile::tempdir().unwrap();
        let supervisor = fake_install(
            dir.path(),
            "#!/bin/sh\nsleep 1\n",
            "rpc_portal = \"127.0.0.1:15914\"\nhostname = \"nas\"\n",
        )
        .await;
        let data = dir.path().join("data");
        let cli = CliQuery::with_timeout(
            &data,
            Some(dir.path().join("core")),
            Duration::from_millis(100),
        );
        supervisor.start("home").await.unwrap();
        let value = cli.query(&supervisor, "home", "peer").await.unwrap();
        assert_eq!(value["stale"], true);
        assert_eq!(value["error"], "cli_timeout");
        assert_eq!(value["data"], serde_json::Value::Null);
        supervisor.stop("home").await.unwrap();
    }

    #[tokio::test]
    async fn missing_cli_is_core_missing() {
        let dir = tempfile::tempdir().unwrap();
        let version = dir.path().join("core/v9.9.9");
        std::fs::create_dir_all(&version).unwrap();
        write_exec(
            &version.join("easytier-core"),
            "#!/bin/sh\ntrap 'exit 0' TERM\nwhile true; do sleep 0.1; done\n",
        );
        let data = dir.path().join("data");
        let configs = Arc::new(Configs::new(&data));
        configs
            .put(
                "home",
                "rpc_portal = \"127.0.0.1:15915\"\nhostname = \"nas\"\n",
                None,
            )
            .await
            .unwrap();
        let settings = Arc::new(SettingsStore::load(&data).await.unwrap());
        let supervisor = Supervisor::load(&data, Some(dir.path().join("core")), configs, settings)
            .await
            .unwrap();
        supervisor.start("home").await.unwrap();
        let cli = CliQuery::new(&data, Some(dir.path().join("core")));
        let err = cli.query(&supervisor, "home", "node").await.unwrap_err();
        assert_eq!(err.code(), "core_missing");
        supervisor.stop("home").await.unwrap();
    }
}

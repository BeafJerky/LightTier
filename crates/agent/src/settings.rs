use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{Mutex, RwLock};

use crate::audit::Audit;
use crate::error::ApiError;
use crate::storage;

const LOG_LEVELS: [&str; 5] = ["error", "warn", "info", "debug", "trace"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub auto_start_last_running: bool,
    pub no_tun: bool,
    pub log_level: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_start_last_running: false,
            no_tun: false,
            log_level: "info".into(),
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsPatch {
    pub auto_start_last_running: Option<bool>,
    pub no_tun: Option<bool>,
    pub log_level: Option<String>,
}

pub struct SettingsStore {
    path: PathBuf,
    value: RwLock<Settings>,
    write: Mutex<()>,
}

impl SettingsStore {
    pub async fn load(data_dir: &Path) -> std::io::Result<Self> {
        let path = data_dir.join("state/settings.json");
        let mut value: Settings = match storage::read_json_or_default(&path).await {
            Ok(value) => value,
            // `read_json_or_default` maps parse failures to `InvalidData`; a
            // corrupt file must not block boot, so fall back to defaults and let
            // the next update rewrite it.
            Err(err) if err.kind() == std::io::ErrorKind::InvalidData => {
                tracing::warn!(
                    path = %path.display(),
                    error = %err,
                    "settings file is not valid JSON, using defaults"
                );
                Settings::default()
            }
            Err(err) => return Err(err),
        };
        if !LOG_LEVELS.contains(&value.log_level.as_str()) {
            tracing::warn!(
                log_level = %value.log_level,
                "settings logLevel is not recognised, using \"info\""
            );
            value.log_level = "info".into();
        }
        Ok(Self {
            path,
            value: RwLock::new(value),
            write: Mutex::new(()),
        })
    }

    pub async fn get(&self) -> Settings {
        self.value.read().await.clone()
    }

    pub async fn update(&self, patch: SettingsPatch) -> Result<Settings, ApiError> {
        let _guard = self.write.lock().await;
        let mut next = self.value.read().await.clone();
        if let Some(value) = patch.auto_start_last_running {
            next.auto_start_last_running = value;
        }
        if let Some(value) = patch.no_tun {
            next.no_tun = value;
        }
        if let Some(level) = patch.log_level {
            if !LOG_LEVELS.contains(&level.as_str()) {
                return Err(ApiError::InvalidSettings {
                    detail: format!("logLevel must be one of {LOG_LEVELS:?}"),
                });
            }
            next.log_level = level;
        }
        storage::write_json_atomic(&self.path, &next).await?;
        *self.value.write().await = next.clone();
        Ok(next)
    }
}

pub async fn record_update(audit: &Audit, request_id: Option<&str>, settings: &Settings) {
    audit
        .record(
            "settings.update",
            request_id,
            json!({
                "autoStartLastRunning": settings.auto_start_last_running,
                "noTun": settings.no_tun,
                "logLevel": settings.log_level,
            }),
        )
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn defaults_and_patch_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(dir.path()).await.unwrap();
        assert_eq!(store.get().await, Settings::default());

        let updated = store
            .update(SettingsPatch {
                auto_start_last_running: Some(true),
                no_tun: Some(true),
                log_level: Some("debug".into()),
            })
            .await
            .unwrap();
        assert!(updated.auto_start_last_running);
        assert!(updated.no_tun);
        assert_eq!(updated.log_level, "debug");

        let reloaded = SettingsStore::load(dir.path()).await.unwrap();
        assert_eq!(reloaded.get().await, updated);
    }

    #[tokio::test]
    async fn corrupt_file_falls_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("state")).unwrap();
        std::fs::write(dir.path().join("state/settings.json"), b"{not json").unwrap();

        let store = SettingsStore::load(dir.path()).await.unwrap();
        assert_eq!(store.get().await, Settings::default());
    }

    #[tokio::test]
    async fn unknown_log_level_is_coerced_to_info() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("state")).unwrap();
        std::fs::write(
            dir.path().join("state/settings.json"),
            br#"{"autoStartLastRunning":true,"noTun":true,"logLevel":"verbose"}"#,
        )
        .unwrap();

        let loaded = SettingsStore::load(dir.path()).await.unwrap().get().await;
        assert!(loaded.auto_start_last_running);
        assert!(loaded.no_tun);
        assert_eq!(loaded.log_level, "info");
    }

    #[tokio::test]
    async fn invalid_log_level_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(dir.path()).await.unwrap();
        let err = store
            .update(SettingsPatch {
                log_level: Some("verbose".into()),
                ..SettingsPatch::default()
            })
            .await
            .unwrap_err();
        assert_eq!(err.code(), "invalid_settings");
    }
}

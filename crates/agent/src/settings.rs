use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Mutex;

use crate::audit::Audit;
use crate::error::ApiError;
use crate::packages::normalize_mirror_prefix;
use crate::storage;

const LOG_LEVELS: [&str; 5] = ["error", "warn", "info", "debug", "trace"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub auto_start_last_running: bool,
    pub no_tun: bool,
    pub log_level: String,
    /// Normalized mirror prefix for kernel downloads; empty = GitHub direct.
    pub core_mirror: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_start_last_running: false,
            no_tun: false,
            log_level: "info".into(),
            core_mirror: String::new(),
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsPatch {
    pub auto_start_last_running: Option<bool>,
    pub no_tun: Option<bool>,
    pub log_level: Option<String>,
    pub core_mirror: Option<String>,
}

pub struct SettingsStore {
    path: PathBuf,
    // std lock: the packages module reads the mirror synchronously at download
    // time; guards are never held across an await.
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
        self.value.read().unwrap_or_else(|err| err.into_inner()).clone()
    }

    /// Synchronous read for the download pipeline's mirror provider closure.
    pub fn core_mirror(&self) -> Option<String> {
        let value = self
            .value
            .read()
            .unwrap_or_else(|err| err.into_inner())
            .core_mirror
            .clone();
        (!value.is_empty()).then_some(value)
    }

    pub async fn update(&self, patch: SettingsPatch) -> Result<Settings, ApiError> {
        let _guard = self.write.lock().await;
        let mut next = self.value.read().unwrap_or_else(|err| err.into_inner()).clone();
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
        if let Some(raw) = patch.core_mirror {
            if raw.trim().is_empty() {
                next.core_mirror = String::new();
            } else {
                next.core_mirror = normalize_mirror_prefix(&raw).ok_or_else(|| {
                    ApiError::InvalidSettings {
                        detail: "coreMirror must be an http(s) prefix without query, fragment or credentials".into(),
                    }
                })?;
            }
        }
        storage::write_json_atomic(&self.path, &next).await?;
        *self.value.write().unwrap_or_else(|err| err.into_inner()) = next.clone();
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
                "coreMirror": settings.core_mirror,
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
                ..SettingsPatch::default()
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
    async fn core_mirror_normalizes_persists_and_clears() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(dir.path()).await.unwrap();
        assert_eq!(store.get().await.core_mirror, "");
        assert_eq!(store.core_mirror(), None);

        let updated = store
            .update(SettingsPatch {
                core_mirror: Some(" ghfast.top ".into()),
                ..SettingsPatch::default()
            })
            .await
            .unwrap();
        assert_eq!(updated.core_mirror, "https://ghfast.top/");
        assert_eq!(store.core_mirror().as_deref(), Some("https://ghfast.top/"));

        let reloaded = SettingsStore::load(dir.path()).await.unwrap();
        assert_eq!(reloaded.get().await.core_mirror, "https://ghfast.top/");

        // Empty string is legal and means official direct.
        let cleared = store
            .update(SettingsPatch {
                core_mirror: Some("  ".into()),
                ..SettingsPatch::default()
            })
            .await
            .unwrap();
        assert_eq!(cleared.core_mirror, "");
        assert_eq!(store.core_mirror(), None);
    }

    #[tokio::test]
    async fn invalid_core_mirror_is_rejected_and_keeps_the_old_value() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(dir.path()).await.unwrap();
        store
            .update(SettingsPatch {
                core_mirror: Some("https://ghfast.top/".into()),
                ..SettingsPatch::default()
            })
            .await
            .unwrap();
        for raw in [
            "ftp://example.com/",
            "https://example.com/?a=1",
            "https://user:pass@example.com/",
            "not a url",
        ] {
            let err = store
                .update(SettingsPatch {
                    core_mirror: Some(raw.into()),
                    ..SettingsPatch::default()
                })
                .await
                .unwrap_err();
            assert_eq!(err.code(), "invalid_settings", "{raw} must be rejected");
        }
        assert_eq!(store.core_mirror().as_deref(), Some("https://ghfast.top/"));
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

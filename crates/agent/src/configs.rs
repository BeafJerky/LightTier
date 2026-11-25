use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

use crate::error::ApiError;
use crate::ids::validate_config_id;
use crate::storage;

pub const MAX_CONFIG_BYTES: usize = 1024 * 1024;

/// Ids that cannot be used for a stored config: `/api/v1/configs/import` is a
/// static route, so `import.toml` would be unreachable through `/{id}`.
const RESERVED_IDS: &[&str] = &["import"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEntry {
    pub id: String,
    pub hash: String,
    pub size: u64,
    pub modified_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDocument {
    pub id: String,
    pub hash: String,
    pub toml: String,
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub struct Configs {
    dir: PathBuf,
    write: Mutex<()>,
}

impl Configs {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            dir: data_dir.join("config"),
            write: Mutex::new(()),
        }
    }

    pub fn path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.toml"))
    }

    fn backup_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.toml.bak"))
    }

    fn validate_writable_id(id: &str) -> Result<(), ApiError> {
        validate_config_id(id)?;
        if RESERVED_IDS.contains(&id) {
            return Err(ApiError::InvalidId);
        }
        Ok(())
    }

    fn validate_text(text: &str) -> Result<(), ApiError> {
        if text.len() > MAX_CONFIG_BYTES {
            return Err(ApiError::InvalidToml {
                detail: "config exceeds 1 MiB".into(),
            });
        }
        text.parse::<toml::Table>()
            .map_err(|err| ApiError::InvalidToml {
                detail: err.to_string(),
            })?;
        Ok(())
    }

    async fn read_document(&self, id: &str) -> Result<ConfigDocument, ApiError> {
        let bytes = match tokio::fs::read(self.path(id)).await {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Err(ApiError::NotFound)
            }
            Err(err) => return Err(err.into()),
        };
        let text = String::from_utf8(bytes).map_err(|_| ApiError::InvalidToml {
            detail: "config is not valid UTF-8".into(),
        })?;
        let hash = hash_bytes(text.as_bytes());
        Ok(ConfigDocument {
            id: id.to_string(),
            hash,
            toml: text,
        })
    }

    pub async fn list(&self) -> Result<Vec<ConfigEntry>, ApiError> {
        storage::ensure_dir(&self.dir).await?;
        let mut out = Vec::new();
        let mut entries = tokio::fs::read_dir(&self.dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(id) = name.strip_suffix(".toml") else {
                continue;
            };
            if validate_config_id(id).is_err() {
                continue;
            }
            let Ok(metadata) = entry.metadata().await else {
                continue;
            };
            let Ok(bytes) = tokio::fs::read(entry.path()).await else {
                continue;
            };
            let modified_at = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|dur| dur.as_secs() as i64)
                .unwrap_or(0);
            out.push(ConfigEntry {
                id: id.to_string(),
                hash: hash_bytes(&bytes),
                size: metadata.len(),
                modified_at,
            });
        }
        out.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(out)
    }

    pub async fn get(&self, id: &str) -> Result<ConfigDocument, ApiError> {
        validate_config_id(id)?;
        self.read_document(id).await
    }

    /// Writes `text` and returns `(hash, created)`, where `created` is true when
    /// no file existed before this call.
    pub async fn put(
        &self,
        id: &str,
        text: &str,
        expected_hash: Option<&str>,
    ) -> Result<(String, bool), ApiError> {
        Self::validate_writable_id(id)?;
        Self::validate_text(text)?;
        let _guard = self.write.lock().await;
        let path = self.path(id);
        let current = match tokio::fs::read(&path).await {
            Ok(bytes) => Some(hash_bytes(&bytes)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
            Err(err) => return Err(err.into()),
        };
        if let Some(expected) = expected_hash {
            let actual = current.clone().unwrap_or_default();
            if actual != expected {
                return Err(ApiError::ConflictHash {
                    expected: expected.to_string(),
                    actual,
                });
            }
        }
        let created = current.is_none();
        if !created {
            tokio::fs::copy(&path, self.backup_path(id)).await?;
        }
        storage::write_text_atomic(&path, text).await?;
        Ok((hash_bytes(text.as_bytes()), created))
    }

    pub async fn delete(&self, id: &str) -> Result<(), ApiError> {
        validate_config_id(id)?;
        let _guard = self.write.lock().await;
        match tokio::fs::remove_file(self.path(id)).await {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Err(ApiError::NotFound)
            }
            Err(err) => return Err(err.into()),
        }
        let _ = tokio::fs::remove_file(self.backup_path(id)).await;
        Ok(())
    }

    pub async fn rename(&self, from: &str, to: &str) -> Result<String, ApiError> {
        validate_config_id(from)?;
        // The target becomes a stored id, so it follows the same reserved-id
        // rule as `put`/`import`: `import` is a static route and unreachable.
        Self::validate_writable_id(to)?;
        let _guard = self.write.lock().await;
        let document = self.read_document(from).await?;
        // Renaming onto itself is a successful no-op: the "already existing"
        // target is the source document.
        if from == to {
            return Ok(document.hash);
        }
        if tokio::fs::try_exists(self.path(to)).await? {
            return Err(ApiError::ConfigExists);
        }
        tokio::fs::rename(self.path(from), self.path(to)).await?;
        let backup = self.backup_path(from);
        if tokio::fs::try_exists(&backup).await? {
            tokio::fs::rename(backup, self.backup_path(to)).await?;
        }
        Ok(document.hash)
    }

    pub async fn import(&self, filename: &str, text: &str) -> Result<ConfigEntry, ApiError> {
        let name = filename
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(filename)
            .to_string();
        let stem = name
            .strip_suffix(".toml")
            .or_else(|| name.strip_suffix(".TOML"))
            .unwrap_or(&name)
            .to_string();
        Self::validate_writable_id(&stem)?;
        Self::validate_text(text)?;
        let _guard = self.write.lock().await;
        let path = self.path(&stem);
        if tokio::fs::try_exists(&path).await? {
            return Err(ApiError::ConfigExists);
        }
        storage::write_text_atomic(&path, text).await?;
        Ok(ConfigEntry {
            id: stem,
            hash: hash_bytes(text.as_bytes()),
            size: text.len() as u64,
            modified_at: chrono::Utc::now().timestamp(),
        })
    }

    pub async fn export(&self, id: &str) -> Result<ConfigDocument, ApiError> {
        self.get(id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn store() -> (tempfile::TempDir, Configs) {
        let dir = tempfile::tempdir().unwrap();
        let store = Configs::new(dir.path());
        (dir, store)
    }

    #[tokio::test]
    async fn put_requires_matching_hash_and_keeps_backup() {
        let (_dir, store) = store().await;
        let (first, created) = store.put("home", "hostname = \"a\"\n", None).await.unwrap();
        assert!(created);
        let document = store.get("home").await.unwrap();
        assert_eq!(document.toml, "hostname = \"a\"\n");
        assert_eq!(document.hash, first);

        let err = store
            .put("home", "hostname = \"b\"\n", Some("deadbeef"))
            .await
            .unwrap_err();
        assert_eq!(err.code(), "conflict_hash");

        let (second, created) = store
            .put("home", "hostname = \"b\"\n", Some(&first))
            .await
            .unwrap();
        assert!(!created);
        assert_ne!(first, second);
        let backup = std::fs::read_to_string(store.backup_path("home")).unwrap();
        assert_eq!(backup, "hostname = \"a\"\n");
    }

    #[tokio::test]
    async fn reserved_import_id_is_rejected_on_write() {
        let (_dir, store) = store().await;
        let err = store
            .put("import", "hostname = \"a\"\n", None)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "invalid_id");
        let err = store
            .import("import.toml", "hostname = \"a\"\n")
            .await
            .unwrap_err();
        assert_eq!(err.code(), "invalid_id");
        // The rejection happens before anything is written.
        assert!(!store.path("import").exists());
    }

    #[tokio::test]
    async fn rename_to_same_id_is_a_noop_success() {
        let (_dir, store) = store().await;
        let (hash, _) = store.put("a", "x = 1\n", None).await.unwrap();
        assert_eq!(store.rename("a", "a").await.unwrap(), hash);
        assert_eq!(store.get("a").await.unwrap().toml, "x = 1\n");
        // A missing source still reports not_found.
        assert_eq!(
            store.rename("nope", "nope").await.unwrap_err().code(),
            "not_found"
        );
    }

    #[tokio::test]
    async fn invalid_toml_is_rejected() {
        let (_dir, store) = store().await;
        let err = store.put("bad", "hostname = [", None).await.unwrap_err();
        assert_eq!(err.code(), "invalid_toml");
    }

    #[tokio::test]
    async fn rename_rejects_reserved_target() {
        let (_dir, store) = store().await;
        store.put("a", "x = 1\n", None).await.unwrap();
        let err = store.rename("a", "import").await.unwrap_err();
        assert_eq!(err.code(), "invalid_id");
        // Nothing was renamed away and nothing was created.
        assert!(store.path("a").exists());
        assert!(!store.path("import").exists());
        assert_eq!(store.get("a").await.unwrap().toml, "x = 1\n");
        assert_eq!(store.get("import").await.unwrap_err().code(), "not_found");
    }

    #[tokio::test]
    async fn rename_refuses_existing_target() {
        let (_dir, store) = store().await;
        store.put("a", "x = 1\n", None).await.unwrap();
        store.put("b", "x = 2\n", None).await.unwrap();
        let err = store.rename("a", "b").await.unwrap_err();
        assert_eq!(err.code(), "config_exists");
        store.rename("a", "c").await.unwrap();
        assert_eq!(store.get("c").await.unwrap().toml, "x = 1\n");
    }

    #[tokio::test]
    async fn import_uses_basename_and_rejects_bad_names() {
        let (_dir, store) = store().await;
        store
            .import("home.toml", "hostname = \"a\"\n")
            .await
            .unwrap();
        assert_eq!(
            store
                .import("home.toml", "x = 1\n")
                .await
                .unwrap_err()
                .code(),
            "config_exists"
        );
        // 路径分隔符被剥掉，只取最后一段文件名。
        let entry = store
            .import("../nested/office.toml", "x = 1\n")
            .await
            .unwrap();
        assert_eq!(entry.id, "office");
        assert_eq!(
            store
                .import("a b.toml", "x = 1\n")
                .await
                .unwrap_err()
                .code(),
            "invalid_id"
        );
    }

    #[tokio::test]
    async fn delete_missing_is_not_found() {
        let (_dir, store) = store().await;
        assert_eq!(store.delete("nope").await.unwrap_err().code(), "not_found");
    }
}

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::de::DeserializeOwned;
use serde::Serialize;

static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

pub async fn ensure_dir(path: &Path) -> std::io::Result<()> {
    tokio::fs::create_dir_all(path).await
}

pub async fn read_json_or_default<T>(path: &Path) -> std::io::Result<T>
where
    T: DeserializeOwned + Default,
{
    match tokio::fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(err) => Err(err),
    }
}

pub async fn write_json_atomic<T>(path: &Path, value: &T) -> std::io::Result<()>
where
    T: Serialize,
{
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("state");
    let tmp = path.with_file_name(format!(".{file_name}.{}.{seq}.tmp", std::process::id()));
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?;
    tokio::fs::write(&tmp, bytes).await?;
    tokio::fs::rename(&tmp, path).await
}

pub async fn dir_writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".ready-{}", std::process::id()));
    match tokio::fs::write(&probe, b"ok").await {
        Ok(()) => {
            let _ = tokio::fs::remove_file(&probe).await;
            true
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Default, serde::Serialize, Deserialize, PartialEq, Debug)]
    struct Doc {
        value: u32,
    }

    #[tokio::test]
    async fn missing_file_returns_default() {
        let dir = tempfile::tempdir().unwrap();
        let doc: Doc = read_json_or_default(&dir.path().join("missing.json"))
            .await
            .unwrap();
        assert_eq!(doc, Doc::default());
    }

    #[tokio::test]
    async fn atomic_write_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/doc.json");
        write_json_atomic(&path, &Doc { value: 7 }).await.unwrap();
        let doc: Doc = read_json_or_default(&path).await.unwrap();
        assert_eq!(doc.value, 7);
    }

    #[tokio::test]
    async fn writable_detection() {
        let dir = tempfile::tempdir().unwrap();
        assert!(dir_writable(dir.path()).await);
        assert!(!dir_writable(&dir.path().join("absent")).await);
    }

    #[tokio::test]
    async fn concurrent_writes_to_same_path_leave_one_valid_document() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");
        let (first, second) = tokio::join!(
            write_json_atomic(&path, &Doc { value: 1 }),
            write_json_atomic(&path, &Doc { value: 2 }),
        );
        first.unwrap();
        second.unwrap();

        let doc: Doc = read_json_or_default(&path).await.unwrap();
        assert!(
            doc == Doc { value: 1 } || doc == Doc { value: 2 },
            "unexpected document content: {doc:?}"
        );

        let mut entries: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        entries.sort();
        assert_eq!(entries, vec!["sessions.json".to_string()]);
    }
}

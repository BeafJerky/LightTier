use std::path::{Path, PathBuf};

use chrono::Utc;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

pub struct Audit {
    path: PathBuf,
    write: Mutex<()>,
}

impl Audit {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join("logs/agent/audit.log"),
            write: Mutex::new(()),
        }
    }

    pub async fn record(&self, event: &str, request_id: Option<&str>, details: Value) {
        let line = json!({
            "ts": Utc::now().to_rfc3339(),
            "event": event,
            "actor": "admin",
            "requestId": request_id,
            "details": details,
        });
        let _guard = self.write.lock().await;
        if let Some(parent) = self.path.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        match tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .await
        {
            Ok(mut file) => {
                let mut text = line.to_string();
                text.push('\n');
                if let Err(err) = file.write_all(text.as_bytes()).await {
                    tracing::warn!(%err, "audit write failed");
                }
                if let Err(err) = file.flush().await {
                    tracing::warn!(%err, "audit flush failed");
                }
            }
            Err(err) => tracing::warn!(%err, "audit open failed"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn appends_one_json_line_per_event() {
        let dir = tempfile::tempdir().unwrap();
        let audit = Audit::new(dir.path());
        audit
            .record("config.create", Some("req-1"), json!({"id": "home"}))
            .await;
        audit
            .record("config.delete", None, json!({"id": "home"}))
            .await;
        let text = tokio::fs::read_to_string(dir.path().join("logs/agent/audit.log"))
            .await
            .unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        let first: Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["event"], "config.create");
        assert_eq!(first["requestId"], "req-1");
    }
}

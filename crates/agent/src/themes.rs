//! Server-side theme storage (`<data>/themes/<name>.css`).
//!
//! The web UI stores imported themes here instead of the browser, so every
//! browser pointed at the same agent sees the same theme list. Built-in themes
//! live in the frontend bundle and never touch this directory.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::error::ApiError;
use crate::storage;

pub const MAX_THEME_BYTES: usize = 256 * 1024;

/// Theme ids are file stems and are never CJK: the frontend already enforces
/// this, and the name is concatenated into a path.
const THEME_NAME_MAX: usize = 64;

/// Built-in themes rendered by the UI; an imported file with the same stem
/// would shadow nothing and only duplicate the list entry.
const RESERVED_NAMES: &[&str] = &["cream", "dark"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEntry {
    pub name: String,
    pub size: u64,
    pub modified_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeDocument {
    pub name: String,
    pub css_text: String,
    pub size: u64,
    pub modified_at: i64,
}

pub fn validate_theme_name(name: &str) -> Result<(), ApiError> {
    if name.is_empty() || name.len() > THEME_NAME_MAX {
        return Err(ApiError::InvalidId);
    }
    if !name
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(ApiError::InvalidId);
    }
    if RESERVED_NAMES.contains(&name) {
        return Err(ApiError::InvalidTheme {
            detail: "theme name is reserved".into(),
        });
    }
    Ok(())
}

fn validate_css(css: &str) -> Result<(), ApiError> {
    if css.len() > MAX_THEME_BYTES {
        return Err(ApiError::InvalidTheme {
            detail: "theme exceeds 256 KiB".into(),
        });
    }
    // Same rule as the frontend: a theme must define at least three variables,
    // so a plain stylesheet cannot be imported as one.
    if css.matches("--theme-").count() < 3 {
        return Err(ApiError::InvalidTheme {
            detail: "theme must define at least 3 --theme- variables".into(),
        });
    }
    Ok(())
}

fn modified_at(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|delta| delta.as_secs() as i64)
        .unwrap_or(0)
}

pub struct Themes {
    dir: PathBuf,
}

impl Themes {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            dir: data_dir.join("themes"),
        }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.join(format!("{name}.css"))
    }

    pub async fn list(&self) -> Result<Vec<ThemeEntry>, ApiError> {
        let mut entries = Vec::new();
        let mut dir = match tokio::fs::read_dir(&self.dir).await {
            Ok(dir) => dir,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(entries),
            Err(err) => return Err(err.into()),
        };
        while let Some(entry) = dir.next_entry().await? {
            let file_name = entry.file_name();
            let Some(file_name) = file_name.to_str() else {
                continue;
            };
            let Some(name) = file_name.strip_suffix(".css") else {
                continue;
            };
            if validate_theme_name(name).is_err() {
                continue;
            }
            let meta = entry.metadata().await?;
            entries.push(ThemeEntry {
                name: name.to_string(),
                size: meta.len(),
                modified_at: modified_at(&meta),
            });
        }
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(entries)
    }

    pub async fn read(&self, name: &str) -> Result<ThemeDocument, ApiError> {
        validate_theme_name(name)?;
        let path = self.path(name);
        let css = match tokio::fs::read_to_string(&path).await {
            Ok(css) => css,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Err(ApiError::NotFound)
            }
            Err(err) => return Err(err.into()),
        };
        let meta = tokio::fs::metadata(&path).await?;
        Ok(ThemeDocument {
            name: name.to_string(),
            css_text: css,
            size: meta.len(),
            modified_at: modified_at(&meta),
        })
    }

    pub async fn save(&self, name: &str, css: &str) -> Result<ThemeEntry, ApiError> {
        validate_theme_name(name)?;
        validate_css(css)?;
        storage::ensure_dir(&self.dir)
            .await
            .map_err(ApiError::from)?;
        let path = self.path(name);
        storage::write_text_atomic(&path, css)
            .await
            .map_err(ApiError::from)?;
        let meta = tokio::fs::metadata(&path).await?;
        Ok(ThemeEntry {
            name: name.to_string(),
            size: meta.len(),
            modified_at: modified_at(&meta),
        })
    }

    pub async fn delete(&self, name: &str) -> Result<(), ApiError> {
        validate_theme_name(name)?;
        match tokio::fs::remove_file(self.path(name)).await {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Err(ApiError::NotFound),
            Err(err) => Err(err.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_CSS: &str = ":root { --theme-bg: #fff; --theme-text: #000; --theme-accent: #333; }";

    #[tokio::test]
    async fn save_list_read_delete_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let themes = Themes::new(dir.path());
        themes.save("ocean", VALID_CSS).await.unwrap();

        let list = themes.list().await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "ocean");

        let doc = themes.read("ocean").await.unwrap();
        assert_eq!(doc.css_text, VALID_CSS);

        themes.delete("ocean").await.unwrap();
        assert!(themes.list().await.unwrap().is_empty());
        assert!(matches!(
            themes.read("ocean").await,
            Err(ApiError::NotFound)
        ));
    }

    #[tokio::test]
    async fn rejects_invalid_and_reserved_names() {
        let dir = tempfile::tempdir().unwrap();
        let themes = Themes::new(dir.path());
        let long = "a".repeat(65);
        for name in ["", "a/b", "a.b", "../x", "主题", long.as_str()] {
            assert!(
                matches!(themes.save(name, VALID_CSS).await, Err(ApiError::InvalidId)),
                "{name}"
            );
        }
        assert!(matches!(
            themes.save("cream", VALID_CSS).await,
            Err(ApiError::InvalidTheme { .. })
        ));
    }

    #[tokio::test]
    async fn rejects_oversized_and_non_theme_css() {
        let dir = tempfile::tempdir().unwrap();
        let themes = Themes::new(dir.path());
        assert!(matches!(
            themes.save("plain", "body { color: red }").await,
            Err(ApiError::InvalidTheme { .. })
        ));
        let huge = format!("{VALID_CSS}\n{}", "a".repeat(MAX_THEME_BYTES));
        assert!(matches!(
            themes.save("huge", &huge).await,
            Err(ApiError::InvalidTheme { .. })
        ));
    }
}

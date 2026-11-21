//! 受控外部程序执行：固定程序路径、参数白名单、原生编码输出。

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

pub(crate) fn resource_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resource_dir()
        .map_err(|e| format!("failed to resolve resource dir: {e}"))
}

pub(crate) fn core_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(resource_root(app)?.join("resource").join("core"))
}

pub(crate) fn is_under(path: &Path, base: &Path) -> bool {
    let normalize = |value: &Path| {
        value
            .to_string_lossy()
            .replace('\\', "/")
            .to_ascii_lowercase()
            .trim_end_matches('/')
            .to_string()
    };
    let normalized = normalize(path);
    let base = normalize(base);
    normalized == base || normalized.starts_with(&format!("{base}/"))
}

pub(crate) fn is_core_path(path: &Path, core: &Path) -> bool {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    stem == "easytier-core" && is_under(path, core)
}

pub(crate) fn run_program(program: &Path, args: &[String]) -> Result<CommandResult, String> {
    if !program.exists() {
        return Err(format!("程序不存在: {}", program.display()));
    }
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = command
        .output()
        .map_err(|e| format!("执行 {} 失败: {e}", program.display()))?;
    Ok(CommandResult {
        code: output.status.code(),
        stdout: super::decode_native(&output.stdout)
            .trim_end()
            .to_string(),
        stderr: super::decode_native(&output.stderr)
            .trim_end()
            .to_string(),
    })
}

/// Unix 桌面为内核补可执行位；Windows 为 no-op。
pub fn ensure_executable(app: &tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    let root = resource_root(app)?;
    for path in &paths {
        if !is_under(Path::new(path), &root) {
            return Err(format!("路径不在应用资源目录: {path}"));
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in &paths {
            let metadata = std::fs::metadata(path).map_err(|e| format!("读取 {path} 失败: {e}"))?;
            let mut permissions = metadata.permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(path, permissions)
                .map_err(|e| format!("设置执行位失败 {path}: {e}"))?;
        }
    }
    Ok(())
}
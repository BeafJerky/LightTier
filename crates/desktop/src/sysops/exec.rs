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
    let normalized = normalize_path(path);
    let base = normalize_path(base);
    normalized == base || normalized.starts_with(&format!("{base}/"))
}

/// Windows 的 `resource_dir()` 可能返回 `\\?\D:\...` 长路径前缀，
/// 而前端 path API 返回普通 `D:\...`；比较前必须统一去掉 verbatim 前缀。
pub(crate) fn normalize_path(value: &Path) -> String {
    let mut text = value.to_string_lossy().replace('\\', "/");
    let lower = text.to_ascii_lowercase();
    if lower.starts_with("//?/unc/") {
        text = format!("//{}", &text[8..]);
    } else if lower.starts_with("//?/") {
        text = text[4..].to_string();
    }
    text.to_ascii_lowercase().trim_end_matches('/').to_string()
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
    hide_console(&mut command);
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

/// 隐藏控制台窗口（Windows 下所有子进程统一使用）。
pub(crate) fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
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

/// 安装前校验内核 zip：路径必须在 resource/core，哈希必须匹配内置清单。
pub fn verify_core_package(
    app: &tauri::AppHandle,
    version: &str,
    path: &str,
) -> Result<(), String> {
    let core = core_dir(app)?;
    let path = Path::new(path);
    if !is_under(path, &core) {
        return Err("内核包不在 resource/core 目录".into());
    }
    crate::kernel_manifest::verify_package(version, path)
}
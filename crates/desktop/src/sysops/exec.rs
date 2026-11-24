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
    if normalized.split('/').any(|segment| segment == "..") {
        return false;
    }
    let Some(resolved_path) = resolve_existing_ancestor(path) else {
        return false;
    };
    let Some(resolved_base) = resolve_existing_ancestor(base) else {
        return false;
    };
    let resolved_path = normalize_path(&resolved_path);
    let resolved_base = normalize_path(&resolved_base);
    resolved_path == resolved_base || resolved_path.starts_with(&format!("{resolved_base}/"))
}

fn resolve_existing_ancestor(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return Some(path.to_path_buf());
    }
    let mut current = path.to_path_buf();
    let mut missing = Vec::new();
    loop {
        match current.canonicalize() {
            Ok(mut resolved) => {
                for component in missing.into_iter().rev() {
                    resolved.push(component);
                }
                return Some(resolved);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let name = current.file_name()?.to_os_string();
                missing.push(name);
                if !current.pop() {
                    return None;
                }
            }
            Err(_) => return None,
        }
    }
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
    if stem != "easytier-core" || !is_under(path, core) {
        return false;
    }
    let Some(parent) = path.parent() else {
        return false;
    };
    if normalize_path(parent) != normalize_path(core) {
        return false;
    }
    match (path.canonicalize(), core.canonicalize()) {
        (Ok(path), Ok(core)) => path.parent() == Some(core.as_path()),
        (Err(error), _) if error.kind() == std::io::ErrorKind::NotFound => true,
        _ => false,
    }
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
        stdout: super::decode_native(&output.stdout).trim_end().to_string(),
        stderr: super::decode_native(&output.stderr).trim_end().to_string(),
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
) -> Result<String, String> {
    let core = core_dir(app)?;
    let path = Path::new(path);
    if !is_under(path, &core) {
        return Err("内核包不在 resource/core 目录".into());
    }
    crate::kernel_manifest::verify_package(version, path)?;
    crate::kernel_manifest::expected_package(version)
        .map(str::to_owned)
        .ok_or_else(|| format!("内核 {version} 未提供校验清单"))
}

/// 解压后重新校验真实文件；句柄保留到两个文件都验完，防止校验期间被替换。
pub fn verify_core_files(app: &tauri::AppHandle) -> Result<(), String> {
    verify_core_files_in_dir(&core_dir(app)?)
}

fn verify_core_files_in_dir(core: &Path) -> Result<(), String> {
    let _core = crate::kernel_manifest::open_verified_exe(
        &core.join("easytier-core"),
        crate::kernel_manifest::CoreFile::Core,
        core,
    )?;
    let _cli = crate::kernel_manifest::open_verified_exe(
        &core.join("easytier-cli"),
        crate::kernel_manifest::CoreFile::Cli,
        core,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_direct_child() {
        let base = Path::new("C:/res/resource/core");
        assert!(is_under(
            Path::new("C:/res/resource/core/easytier-core.exe"),
            base
        ));
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        let base = Path::new("C:/res/resource/core");
        assert!(!is_under(
            Path::new("C:/res/resource/core/../../../Windows/System32/easytier-core.exe"),
            base
        ));
        assert!(!is_under(
            Path::new("C:/res/resource/core/sub/../../other/file.zip"),
            base
        ));
    }

    #[test]
    fn core_executable_must_be_a_direct_child() {
        let base = Path::new("C:/res/resource/core");
        assert!(is_core_path(
            Path::new("C:/res/resource/core/easytier-core.exe"),
            base
        ));
        assert!(!is_core_path(
            Path::new("C:/res/resource/core/sub/easytier-core.exe"),
            base
        ));
    }

    #[test]
    fn installed_core_files_must_exist_in_core_directory() {
        let core =
            std::env::temp_dir().join(format!("lt-sysops-core-files-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&core);
        std::fs::create_dir_all(&core).unwrap();

        let error = verify_core_files_in_dir(&core).unwrap_err();
        assert!(error.contains("easytier-core"), "{error}");

        std::fs::write(core.join("easytier-core.exe"), b"MZ tampered").unwrap();
        let error = verify_core_files_in_dir(&core).unwrap_err();
        assert!(error.contains("校验失败"), "{error}");
        let _ = std::fs::remove_dir_all(&core);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_directory_escape() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!("lt-sysops-boundary-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let core = root.join("resource/core");
        let outside = root.join("outside");
        std::fs::create_dir_all(&core).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, core.join("link")).unwrap();

        assert!(!is_under(&core.join("link/new.zip"), &core));
        assert!(!is_core_path(&core.join("link/easytier-core"), &core));
        let _ = std::fs::remove_dir_all(&root);
    }
}

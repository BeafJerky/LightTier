//! 内核进程启动。
//!
//! 安全边界：`run_command` 只允许执行资源目录 `resource/core` 下的内核程序，
//! 防止前端（含被注入脚本）借自定义命令启动任意可执行文件。

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use tauri::Manager;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 后台启动内核进程，返回 PID。
pub fn run_command(
    app: &tauri::AppHandle,
    program: String,
    args: Vec<String>,
) -> Result<String, String> {
    let core_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("failed to resolve resource dir: {e}"))?
        .join("resource")
        .join("core");
    let stem = Path::new(&program)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    let kind = match stem.as_str() {
        "easytier-core" => crate::kernel_manifest::CoreFile::Core,
        "easytier-cli" => crate::kernel_manifest::CoreFile::Cli,
        _ => return Err(format!("program not allowed: {program}")),
    };
    let executable =
        crate::kernel_manifest::open_verified_exe(Path::new(&program), kind, &core_dir)?;
    let mut cmd = Command::new(executable.path());
    cmd.args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    // spawn 失败必须作为错误返回，避免前端把 "Error: ..." 当成 PID
    let child = cmd.spawn().map_err(|e| {
        log::error!("Failed to execute process: {}", e);
        format!("启动进程失败: {e}")
    })?;
    drop(executable);
    Ok(child.id().to_string())
}

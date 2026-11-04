//! 内核进程启动。
//!
//! 安全边界：`run_command` 只允许执行资源目录 `resource/core` 下的内核程序，
//! 防止前端（含被注入脚本）借自定义命令启动任意可执行文件。

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;
use tauri::Manager;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn ensure_core_program_allowed(app: &tauri::AppHandle, program: &str) -> Result<(), String> {
    let program_path = std::path::Path::new(program);
    let stem = program_path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if stem != "easytier-core" && stem != "easytier-cli" {
        return Err(format!("program not allowed: {program}"));
    }

    let core_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("failed to resolve resource dir: {e}"))?
        .join("resource")
        .join("core");

    let parent = match program_path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => return Err(format!("program has no parent directory: {program}")),
    };

    // 目录存在时用 canonicalize 严格比较；目录尚不存在（首次安装未下载内核）等
    // 失败场景退回字符串归一化比较（斜杠统一 + 小写 + 去尾斜杠）
    let allowed = match (parent.canonicalize(), core_dir.canonicalize()) {
        (Ok(p), Ok(c)) => p == c,
        _ => normalize_path(&parent) == normalize_path(&core_dir),
    };
    if !allowed {
        return Err(format!("program is outside core dir: {program}"));
    }
    Ok(())
}

fn normalize_path(p: &std::path::Path) -> String {
    p.to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase()
        .trim_end_matches('/')
        .to_string()
}

/// 后台启动内核进程，返回 PID。
pub fn run_command(
    app: &tauri::AppHandle,
    program: String,
    args: Vec<String>,
) -> Result<String, String> {
    ensure_core_program_allowed(app, &program)?;
    let mut cmd = Command::new(&program);
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
    Ok(child.id().to_string())
}

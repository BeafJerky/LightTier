//! 进程启动命令（薄包装，实现见 `lighttier-desktop`）。
//!
//! 安全边界：只允许执行资源目录 `resource/core` 下的内核程序，
//! 防止前端（含被注入脚本）借自定义命令启动任意可执行文件。

/// 后台启动内核进程，返回 PID。
#[tauri::command(rename_all = "snake_case")]
pub fn run_command(
    app: tauri::AppHandle,
    program: String,
    args: Vec<String>,
) -> Result<String, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        lighttier_desktop::process::run_command(&app, program, args)
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, program, args);
        Err("run_command is not supported on mobile platform".to_string())
    }
}

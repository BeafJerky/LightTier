//! 系统能力：端口检测与外部链接打开。

/// 检测本机端口是否可绑定。
pub fn check_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// 用系统默认浏览器打开外部链接。
/// 不能直接用 plugin-shell 的 JS open：其 Android 侧仍走桌面实现，会失败；
/// 走 Rust API 才会在移动端调用 Kotlin Intent。
#[allow(deprecated)]
pub fn open_external_url(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell().open(url, None).map_err(|e| e.to_string())
}

/// 打开本地路径（资源管理器/文件管理器）；http(s) 交给默认浏览器。
pub fn open_path(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let lower = path.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return open_external_url(app, path);
    }
    if path.is_empty() || path.contains('\0') {
        return Err("非法的路径".into());
    }
    #[cfg(windows)]
    let mut command = {
        let mut command = std::process::Command::new("explorer.exe");
        command.arg(path);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(path);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(path);
        command
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开路径失败: {e}"))
}

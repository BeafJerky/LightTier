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

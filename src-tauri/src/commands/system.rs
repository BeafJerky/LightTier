//! 系统能力命令（薄包装，实现见 `lighttier-core`）。

#[tauri::command]
pub fn check_port_available(port: u16) -> bool {
    lighttier_core::system::check_port_available(port)
}

/// 用系统默认浏览器打开外部链接。
/// 不能直接用 plugin-shell 的 JS open：其 Android 侧仍走桌面实现，会失败；
/// 走 Rust API 才会在移动端调用 Kotlin Intent。
#[tauri::command]
#[allow(deprecated)]
pub fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    lighttier_core::system::open_external_url(&app, &url)
}

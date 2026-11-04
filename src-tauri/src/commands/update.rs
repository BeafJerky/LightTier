//! 应用内更新命令（薄包装，实现见 `lighttier-desktop`）。

#[tauri::command]
pub fn launch_update_installer(app: tauri::AppHandle, installer: String) -> Result<(), String> {
    lighttier_desktop::update::launch_update_installer(&app, &installer)
}

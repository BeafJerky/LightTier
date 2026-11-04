//! 实例生命周期命令（薄包装，实现见 `lighttier-android`）。

/// 启动一个配置（单实例模型：启动前自动停掉旧实例）。
#[tauri::command(rename_all = "snake_case")]
pub async fn start_instance(app: tauri::AppHandle, config_file: String) -> Result<String, String> {
    lighttier_android::instance::start_instance(app, config_file).await
}

/// 停止实例；不传实例 id 时停止全部。
#[tauri::command(rename_all = "snake_case")]
pub async fn stop_instance(instance_id: Option<String>) -> Result<(), String> {
    lighttier_android::instance::stop_instance(instance_id).await
}

/// 列出当前运行中的实例（单实例模型下最多一条）。
#[tauri::command]
pub async fn list_instances() -> Result<Vec<lighttier_android::instance::InstanceInfo>, String> {
    lighttier_android::instance::list_instances().await
}

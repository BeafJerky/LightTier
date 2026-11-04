//! 进程内 RPC 查询命令（薄包装，实现见 `lighttier-android`）。

/// 查询本节点信息（与 `easytier-cli --output json node` 结构一致）。
#[tauri::command(rename_all = "snake_case")]
pub async fn query_node(instance_id: Option<String>) -> Result<serde_json::Value, String> {
    lighttier_android::rpc::query_node(instance_id).await
}

/// 查询对等节点列表（与 `easytier-cli --output json peer` 结构一致，首项为本地节点）。
#[tauri::command(rename_all = "snake_case")]
pub async fn query_peer(instance_id: Option<String>) -> Result<serde_json::Value, String> {
    lighttier_android::rpc::query_peer(instance_id).await
}

/// 查询路由表（序列化后的 Route 数组，含对端 proxy_cidrs）。
#[tauri::command(rename_all = "snake_case")]
pub async fn query_routes(instance_id: Option<String>) -> Result<serde_json::Value, String> {
    lighttier_android::rpc::query_routes(instance_id).await
}

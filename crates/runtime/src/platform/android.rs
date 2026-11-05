//! Android 平台：进程内实例管理器与进程内 RPC（无子进程）。

use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::types::RunningInstance;

/// 配置目录：应用数据目录下的 `config`（与前端 CONFIG_PATH 一致）。
pub fn config_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|p| p.join("config"))
}

/// Android 单 VPN 限制下单实例模型，轮询更快以便启动/停止后及时反映。
pub const SCAN_INTERVAL_MS: u64 = 5_000;

/// 列出进程内运行中的实例。
pub async fn scan_instances(
    _catalog: &[String],
    _app: &AppHandle,
) -> Result<Vec<RunningInstance>, String> {
    let infos = lighttier_android::instance::list_instances().await?;
    Ok(infos
        .into_iter()
        .filter(|info| info.running)
        .filter_map(|info| {
            let file_name = info.config_file?;
            let config_file_name = file_name
                .strip_suffix(".toml")
                .unwrap_or(&file_name)
                .to_string();
            Some(RunningInstance {
                config_file_name,
                file_name,
                pid: 0,
                rpc_portal: None,
                instance_id: Some(info.instance_id),
                virtual_ip: info
                    .virtual_ipv4
                    .as_deref()
                    .map(|ip| ip.split('/').next().unwrap_or(ip).to_string()),
            })
        })
        .collect())
}

/// 查询节点与对等节点（进程内 RPC，与 CLI 的 JSON 结构一致）。
pub async fn query_node_peer(
    instance: &RunningInstance,
    _app: &AppHandle,
) -> Result<(Value, Value), String> {
    let instance_id = instance.instance_id.clone();
    let (node, peers) = tokio::join!(
        lighttier_android::rpc::query_node(instance_id.clone()),
        lighttier_android::rpc::query_peer(instance_id)
    );
    let node = node?;
    let peers = peers?;
    if !peers.is_array() {
        return Err("对等节点数据格式异常".to_string());
    }
    Ok((node, peers))
}

/// 从配置目录解析配置文件绝对路径（供 TOML 展示字段读取）。
pub fn config_file_path(app: &AppHandle, file_name: &str) -> Option<PathBuf> {
    let name = std::path::Path::new(file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(file_name);
    config_dir(app).map(|dir| dir.join(name))
}

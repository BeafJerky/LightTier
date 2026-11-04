//! 实例生命周期：启动、停止与列出运行中实例。
//!
//! 受系统单 VPN 限制采用单实例模型：启动新配置前自动停掉旧实例。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use easytier::common::config::{ConfigFileControl, ConfigLoader, TomlConfigLoader};
use easytier::common::global_ctx::GlobalCtxEvent;
use easytier::instance_manager::NetworkInstanceManager;

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

use crate::rpc::instance_manager;

/// 运行中实例 uuid -> 配置文件名。内核实例随进程存活，无需持久化。
static INSTANCE_CONFIG_FILES: Lazy<RwLock<HashMap<Uuid, String>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// 配置目录：appDataDir()/config（与桌面端 resource/config 对应）。
fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("config"))
        .map_err(|e| format!("failed to resolve app data dir: {e}"))
}

/// 订阅实例事件（DHCP 虚拟 IP / 代理网段变化），推送给前端更新 VPN 配置。
fn subscribe_instance_events(
    app: AppHandle,
    instance_manager: &Arc<NetworkInstanceManager>,
    instance_id: Uuid,
) {
    let Some(instance) = instance_manager
        .iter()
        .find(|item| *item.key() == instance_id)
    else {
        return;
    };
    let Some(mut event_receiver) = instance.value().subscribe_event() else {
        return;
    };

    tauri::async_runtime::spawn(async move {
        let instance_id_str = instance_id.to_string();
        loop {
            match event_receiver.recv().await {
                Ok(GlobalCtxEvent::DhcpIpv4Changed(_, _)) => {
                    let _ = app.emit("dhcp_ip_changed", &instance_id_str);
                }
                Ok(GlobalCtxEvent::ProxyCidrsUpdated(_, _)) => {
                    let _ = app.emit("proxy_cidrs_updated", &instance_id_str);
                }
                Ok(_) => {}
                Err(broadcast::error::RecvError::Closed) => break,
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    event_receiver = event_receiver.resubscribe();
                }
            }
        }
    });
}

/// 启动一个配置（单实例模型：启动前自动停掉旧实例）。
pub async fn start_instance(app: AppHandle, config_file: String) -> Result<String, String> {
    // 仅接受纯文件名，避免路径穿越
    let file_name = std::path::Path::new(&config_file)
        .file_name()
        .and_then(|s| s.to_str())
        .map(str::to_owned)
        .ok_or_else(|| format!("invalid config file name: {config_file}"))?;

    let config_path = config_dir(&app)?.join(&file_name);
    if !config_path.is_file() {
        return Err(format!("config file not found: {}", config_path.display()));
    }

    let config = TomlConfigLoader::new(&config_path).map_err(|e| e.to_string())?;
    let instance_id = config.get_id();

    let instance_manager = instance_manager().await?;

    let stale = instance_manager.list_network_instance_ids();
    if !stale.is_empty() {
        log::info!(
            "stopping {} stale instance(s) before starting new one",
            stale.len()
        );
        instance_manager
            .delete_network_instance(stale)
            .map_err(|e| e.to_string())?;
        INSTANCE_CONFIG_FILES.write().await.clear();
    }

    let control = ConfigFileControl::from_path(config_path).await;
    instance_manager
        .run_network_instance(config, true, control)
        .map_err(|e| e.to_string())?;

    INSTANCE_CONFIG_FILES
        .write()
        .await
        .insert(instance_id, file_name.clone());

    subscribe_instance_events(app, &instance_manager, instance_id);

    log::info!("instance {instance_id} started from config {file_name}");
    Ok(instance_id.to_string())
}

/// 停止实例；不传实例 id 时停止全部。
pub async fn stop_instance(instance_id: Option<String>) -> Result<(), String> {
    let instance_manager = instance_manager().await?;
    let ids = match instance_id {
        Some(raw) => vec![Uuid::parse_str(&raw).map_err(|e| format!("invalid instance id: {e}"))?],
        None => instance_manager.list_network_instance_ids(),
    };

    if ids.is_empty() {
        return Ok(());
    }

    instance_manager
        .delete_network_instance(ids.clone())
        .map_err(|e| e.to_string())?;

    let mut files = INSTANCE_CONFIG_FILES.write().await;
    for id in ids {
        files.remove(&id);
    }
    Ok(())
}

/// 运行中实例信息。
#[derive(Serialize)]
pub struct InstanceInfo {
    instance_id: String,
    config_file: Option<String>,
    instance_name: String,
    network_name: String,
    running: bool,
    /// "10.126.126.1/24"，实例未就绪时为 None。
    virtual_ipv4: Option<String>,
    error_msg: Option<String>,
}

/// 列出当前运行中的实例（单实例模型下最多一条）。
pub async fn list_instances() -> Result<Vec<InstanceInfo>, String> {
    let instance_manager = instance_manager().await?;
    let infos = instance_manager
        .collect_network_infos()
        .await
        .map_err(|e| e.to_string())?;
    let files = INSTANCE_CONFIG_FILES.read().await;

    Ok(infos
        .into_iter()
        .map(|(id, info)| InstanceInfo {
            instance_id: id.to_string(),
            config_file: files.get(&id).cloned(),
            instance_name: instance_manager.get_instance_name(&id).unwrap_or_default(),
            network_name: instance_manager.get_network_name(&id).unwrap_or_default(),
            running: info.running,
            virtual_ipv4: info
                .my_node_info
                .as_ref()
                .and_then(|node| node.virtual_ipv4.as_ref())
                .and_then(|inet| {
                    inet.address
                        .as_ref()
                        .map(|addr| format!("{}/{}", addr, inet.network_length))
                }),
            error_msg: info.error_msg,
        })
        .collect())
}

//! Android 平台内核集成。
//!
//! Android 10+ 禁止应用执行私有目录下的原生二进制，桌面端「easytier-core 子进程」模型
//! 不可用。本模块将 easytier 内核以库的形式运行在应用进程内：
//!
//! - `NetworkInstanceManager` 管理网络实例；受系统单 VPN 限制，采用单实例运行模型
//!   （启动新配置前自动停掉旧实例）；
//! - 进程内 Ring Tunnel 承载 RPC（`ApiRpcServer` + `StandAloneClient`），对前端暴露与
//!   `easytier-cli --output json node/peer` 一致的数据结构；
//! - `set_tun_fd` 将 VpnService 建立的 TUN fd 注入内核（由前端 mobileVpn 编排触发）。

use std::cmp::Ordering;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::ops::Deref;
use std::path::PathBuf;
use std::sync::Arc;

use easytier::common::config::{ConfigFileControl, ConfigLoader, TomlConfigLoader};
use easytier::common::global_ctx::GlobalCtxEvent;
use easytier::instance_manager::NetworkInstanceManager;
use easytier::proto::api::instance::{
    instance_identifier::Selector, list_peer_route_pair, InstanceIdentifier, ListPeerRequest,
    ListRouteRequest, NodeInfo, PeerManageRpc, PeerManageRpcClientFactory, ShowNodeInfoRequest,
};
use easytier::proto::rpc_impl::standalone::StandAloneClient;
use easytier::proto::rpc_types::controller::BaseController;
use easytier::rpc_service::ApiRpcServer;
use easytier::tunnel::ring::{RingTunnelConnector, RingTunnelListener};
use easytier::tunnel::TunnelListener;
use easytier::utils::{string::cost_to_str, PeerRoutePair};

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{broadcast, Mutex, OnceCell, RwLock};
use uuid::Uuid;

type BoxedTunnelListener = Box<dyn TunnelListener>;

/// 进程内内核实例管理器（首次使用时确定性初始化，避免与启动预热竞态）。
static INSTANCE_MANAGER: Lazy<OnceCell<Arc<NetworkInstanceManager>>> = Lazy::new(OnceCell::new);

/// 进程内 RPC 的 Ring Tunnel 地址标识（每次进程启动随机生成）。
static RPC_RING_UUID: Lazy<Uuid> = Lazy::new(Uuid::new_v4);

/// 进程内 RPC 服务端（持有引用以防被 drop 后服务停止）。
static RPC_SERVER: Lazy<Mutex<Option<ApiRpcServer<BoxedTunnelListener>>>> =
    Lazy::new(|| Mutex::new(None));

/// 进程内 RPC 客户端（惰性建立，连接出错时自动重连）。
static RPC_CLIENT: Lazy<Mutex<Option<StandAloneClient<RingTunnelConnector>>>> =
    Lazy::new(|| Mutex::new(None));

/// 运行中实例 uuid -> 配置文件名。内核实例随进程存活，无需持久化。
static INSTANCE_CONFIG_FILES: Lazy<RwLock<HashMap<Uuid, String>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// 预热内核与进程内 RPC（应用启动时调用；实际初始化由首次命令触发并等待完成）。
pub fn setup() {
    tauri::async_runtime::spawn(async {
        if let Err(err) = instance_manager().await {
            log::error!("failed to initialize easytier kernel: {err}");
        }
    });
}

async fn init_kernel() -> Result<Arc<NetworkInstanceManager>, String> {
    let instance_manager = Arc::new(NetworkInstanceManager::new());

    // ring://<uuid> 固定格式，解析不会失败
    let tunnel: BoxedTunnelListener = Box::new(RingTunnelListener::new(
        format!("ring://{}", RPC_RING_UUID.deref())
            .parse()
            .expect("invalid ring tunnel url"),
    ));

    let rpc_server = ApiRpcServer::from_tunnel(tunnel, instance_manager.clone())
        .with_rx_timeout(None)
        .serve()
        .await
        .map_err(|e| format!("failed to start in-process rpc server: {e}"))?;

    *RPC_SERVER.lock().await = Some(rpc_server);

    log::info!(
        "easytier kernel initialized, version v{}",
        easytier::VERSION
    );
    Ok(instance_manager)
}

/// 获取内核实例管理器；首次调用时同步完成初始化（初始化失败可在下次调用时重试）。
async fn instance_manager() -> Result<Arc<NetworkInstanceManager>, String> {
    INSTANCE_MANAGER.get_or_try_init(init_kernel).await.cloned()
}

async fn resolve_instance_id(instance_id: Option<String>) -> Result<Uuid, String> {
    match instance_id {
        Some(raw) => Uuid::parse_str(&raw).map_err(|e| format!("invalid instance id: {e}")),
        None => instance_manager()
            .await?
            .list_network_instance_ids()
            .into_iter()
            .next()
            .ok_or_else(|| "no running instance".to_string()),
    }
}

/// 配置目录：appDataDir()/config（与桌面端 resource/config 对应）。
fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("config"))
        .map_err(|e| format!("failed to resolve app data dir: {e}"))
}

/// 通过进程内 RPC 一次性获取节点信息、对等连接与路由。
async fn fetch_node_and_peer_routes(
    instance_id: &Uuid,
) -> Result<(NodeInfo, Vec<PeerRoutePair>), String> {
    let mut guard = RPC_CLIENT.lock().await;
    let client = guard.get_or_insert_with(|| {
        StandAloneClient::new(RingTunnelConnector::new(
            format!("ring://{}", RPC_RING_UUID.deref())
                .parse()
                .expect("invalid ring tunnel url"),
        ))
    });

    let peer_client = client
        .scoped_client::<PeerManageRpcClientFactory<BaseController>>(String::new())
        .await
        .map_err(|e| format!("failed to connect in-process rpc: {e}"))?;

    let identifier = || InstanceIdentifier {
        selector: Some(Selector::Id((*instance_id).into())),
    };

    let node_info = peer_client
        .show_node_info(
            BaseController::default(),
            ShowNodeInfoRequest {
                instance: Some(identifier()),
            },
        )
        .await
        .map_err(|e| e.to_string())?
        .node_info
        .ok_or_else(|| "node info is unavailable".to_string())?;

    let peers = peer_client
        .list_peer(
            BaseController::default(),
            ListPeerRequest {
                instance: Some(identifier()),
            },
        )
        .await
        .map_err(|e| e.to_string())?
        .peer_infos;

    let routes = peer_client
        .list_route(
            BaseController::default(),
            ListRouteRequest {
                instance: Some(identifier()),
            },
        )
        .await
        .map_err(|e| e.to_string())?
        .routes;

    Ok((node_info, list_peer_route_pair(peers, routes)))
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
#[tauri::command(rename_all = "snake_case")]
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
#[tauri::command(rename_all = "snake_case")]
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
#[tauri::command]
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

/// 查询本节点信息（与 `easytier-cli --output json node` 结构一致）。
#[tauri::command(rename_all = "snake_case")]
pub async fn query_node(instance_id: Option<String>) -> Result<serde_json::Value, String> {
    let id = resolve_instance_id(instance_id).await?;
    let (node_info, _) = fetch_node_and_peer_routes(&id).await?;
    serde_json::to_value(&node_info).map_err(|e| e.to_string())
}

/// 查询对等节点列表（与 `easytier-cli --output json peer` 结构一致，首项为本地节点）。
#[tauri::command(rename_all = "snake_case")]
pub async fn query_peer(instance_id: Option<String>) -> Result<serde_json::Value, String> {
    let id = resolve_instance_id(instance_id).await?;
    let (node_info, pairs) = fetch_node_and_peer_routes(&id).await?;

    let mut items: Vec<PeerTableItem> = Vec::with_capacity(pairs.len() + 1);
    items.push(PeerTableItem::from(node_info));
    items.extend(pairs.into_iter().map(PeerTableItem::from));
    items.sort_by(compare_peer_items);

    serde_json::to_value(items).map_err(|e| e.to_string())
}

/// 查询路由表（序列化后的 Route 数组，含对端 proxy_cidrs）。
#[tauri::command(rename_all = "snake_case")]
pub async fn query_routes(instance_id: Option<String>) -> Result<serde_json::Value, String> {
    let id = resolve_instance_id(instance_id).await?;
    let (_, pairs) = fetch_node_and_peer_routes(&id).await?;
    let routes: Vec<_> = pairs.into_iter().filter_map(|pair| pair.route).collect();
    serde_json::to_value(routes).map_err(|e| e.to_string())
}

/// 将 VpnService 建立的 TUN fd 注入内核（单实例模型取唯一运行中实例）。
#[tauri::command]
pub async fn set_tun_fd(fd: i32) -> Result<(), String> {
    let instance_manager = instance_manager().await?;
    let instance_id = instance_manager
        .list_network_instance_ids()
        .into_iter()
        .next()
        .ok_or_else(|| "no running instance".to_string())?;
    instance_manager
        .set_tun_fd(&instance_id, fd)
        .map_err(|e| e.to_string())
}

/// 内置内核版本。
#[tauri::command]
pub fn get_core_version() -> String {
    easytier::VERSION.to_string()
}

/// 与 CLI `peer --output json` 对齐的表格项。
#[derive(Serialize)]
struct PeerTableItem {
    cidr: String,
    ipv4: String,
    hostname: String,
    cost: String,
    lat_ms: String,
    loss_rate: String,
    rx_bytes: String,
    tx_bytes: String,
    tunnel_proto: String,
    nat_type: String,
    id: String,
    version: String,
}

impl From<PeerRoutePair> for PeerTableItem {
    fn from(pair: PeerRoutePair) -> Self {
        let route = pair.route.clone().unwrap_or_default();
        let lat_ms = if route.cost == 1 {
            pair.get_latency_ms().unwrap_or(0.0)
        } else {
            route.path_latency_latency_first.unwrap_or_default() as f64
        };

        PeerTableItem {
            cidr: route
                .ipv4_addr
                .clone()
                .map(|ip| ip.to_string())
                .unwrap_or_default(),
            ipv4: route
                .ipv4_addr
                .and_then(|ip| ip.address)
                .map(|addr| addr.to_string())
                .unwrap_or_default(),
            hostname: route.hostname.clone(),
            cost: cost_to_str(route.cost),
            lat_ms: format!("{:.2}", lat_ms),
            loss_rate: format!("{:.1}%", pair.get_loss_rate().unwrap_or(0.0) * 100.0),
            rx_bytes: humansize::format_size(pair.get_rx_bytes().unwrap_or(0), humansize::DECIMAL),
            tx_bytes: humansize::format_size(pair.get_tx_bytes().unwrap_or(0), humansize::DECIMAL),
            tunnel_proto: pair.get_conn_protos().unwrap_or_default().join(","),
            nat_type: pair.get_udp_nat_type(),
            id: route.peer_id.to_string(),
            version: if route.version.is_empty() {
                "unknown".to_string()
            } else {
                route.version
            },
        }
    }
}

impl From<NodeInfo> for PeerTableItem {
    fn from(node: NodeInfo) -> Self {
        PeerTableItem {
            cidr: node.ipv4_addr.clone(),
            ipv4: node
                .ipv4_addr
                .split('/')
                .next()
                .unwrap_or_default()
                .to_string(),
            hostname: node.hostname.clone(),
            cost: "Local".to_string(),
            lat_ms: "-".to_string(),
            loss_rate: "-".to_string(),
            rx_bytes: "-".to_string(),
            tx_bytes: "-".to_string(),
            tunnel_proto: "-".to_string(),
            nat_type: node
                .stun_info
                .map(|info| info.udp_nat_type().as_str_name().to_string())
                .unwrap_or_else(|| "Unknown".to_string()),
            id: node.peer_id.to_string(),
            version: node.version,
        }
    }
}

/// 排序与 CLI 保持一致：本地节点、公共服务器优先，其余按 IP、主机名。
fn compare_peer_items(a: &PeerTableItem, b: &PeerTableItem) -> Ordering {
    let a_is_local = a.cost == "Local";
    let b_is_local = b.cost == "Local";
    if a_is_local != b_is_local {
        return if a_is_local {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }

    let a_is_public = a
        .hostname
        .starts_with(easytier::peers::PUBLIC_SERVER_HOSTNAME_PREFIX);
    let b_is_public = b
        .hostname
        .starts_with(easytier::peers::PUBLIC_SERVER_HOSTNAME_PREFIX);
    if a_is_public != b_is_public {
        return if a_is_public {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }

    let a_ip = a
        .ipv4
        .parse::<IpAddr>()
        .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    let b_ip = b
        .ipv4
        .parse::<IpAddr>()
        .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    match a_ip.cmp(&b_ip) {
        Ordering::Equal => a.hostname.cmp(&b.hostname),
        other => other,
    }
}

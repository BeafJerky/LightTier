//! VPN 能力：将 VpnService 建立的 TUN fd 注入内核。

use crate::rpc::instance_manager;

/// 将 VpnService 建立的 TUN fd 注入内核（单实例模型取唯一运行中实例）。
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

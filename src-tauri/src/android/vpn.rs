//! VPN 相关命令（薄包装，实现见 `lighttier-android`）。

/// 将 VpnService 建立的 TUN fd 注入内核（单实例模型取唯一运行中实例）。
#[tauri::command]
pub async fn set_tun_fd(fd: i32) -> Result<(), String> {
    lighttier_android::vpn::set_tun_fd(fd).await
}

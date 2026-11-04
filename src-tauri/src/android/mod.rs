//! Android 平台内核集成（薄包装，实现见 `lighttier-android`）。
//!
//! Android 10+ 禁止应用执行私有目录下的原生二进制，桌面端「easytier-core 子进程」模型
//! 不可用。本模块将 easytier 内核以库的形式运行在应用进程内：
//!
//! - `instance` 管理网络实例；受系统单 VPN 限制，采用单实例运行模型
//!   （启动新配置前自动停掉旧实例）；
//! - `rpc` 用进程内 Ring Tunnel 承载 RPC（`ApiRpcServer` + `StandAloneClient`），对前端
//!   暴露与 `easytier-cli --output json node/peer` 一致的数据结构；
//! - `vpn` 的 `set_tun_fd` 将 VpnService 建立的 TUN fd 注入内核（由前端 mobileVpn 编排触发）。

pub mod instance;
pub mod rpc;
pub mod vpn;

/// 预热内核与进程内 RPC（应用启动时调用；实际初始化由首次命令触发并等待完成）。
pub fn setup() {
    lighttier_android::setup();
}

/// 内置内核版本。
#[tauri::command]
pub fn get_core_version() -> String {
    lighttier_android::get_core_version()
}

//! LightTier Android 平台能力（进程内内核、RPC、VPN）。
//!
//! 子模块仅在 Android 目标下编译；其他平台保持空库，便于 workspace 整体检查。

#[cfg(target_os = "android")]
pub mod instance;
#[cfg(target_os = "android")]
pub mod rpc;
#[cfg(target_os = "android")]
pub mod vpn;

/// 预热内核与进程内 RPC（应用启动时调用；实际初始化由首次命令触发并等待完成）。
#[cfg(target_os = "android")]
pub fn setup() {
    tauri::async_runtime::spawn(async {
        if let Err(err) = rpc::instance_manager().await {
            log::error!("failed to initialize easytier kernel: {err}");
        }
    });
}

/// 内置内核版本。
#[cfg(target_os = "android")]
pub fn get_core_version() -> String {
    easytier::VERSION.to_string()
}

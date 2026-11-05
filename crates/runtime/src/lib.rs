//! LightTier 运行态服务：实例快照、配置投影与监控采样。
//!
//! 由 `src-tauri` 在 setup 阶段创建为托管状态，并通过薄命令暴露给前端。

pub mod types;

mod platform;
mod service;

pub use service::RuntimeService;
pub use types::{MonitorSnapshot, MonitorSubscription, RunningInstance, RuntimeSnapshot};

/// 创建并启动运行态服务（后台扫描线程随应用生命周期存活）。
pub fn setup(app: &tauri::AppHandle) -> std::sync::Arc<RuntimeService> {
    let service = std::sync::Arc::new(RuntimeService::new(app.clone()));
    service.start();
    service
}

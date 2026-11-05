//! 运行态与监控命令（薄包装，实现见 `lighttier-runtime`）。
//!
//! 前端不再直接扫描进程或调用 CLI：启动时拉取快照并订阅事件，
//! 监控采样由后端按订阅节奏执行并通过 `monitor:snapshot` 推送。

use std::sync::Arc;

use lighttier_runtime::{
    MonitorSnapshot, MonitorSubscription, RuntimeService, RuntimeSnapshot,
};
use tauri::State;

#[tauri::command]
pub async fn runtime_get_snapshot(
    state: State<'_, Arc<RuntimeService>>,
) -> Result<RuntimeSnapshot, String> {
    Ok(state.snapshot().await)
}

/// 同步配置目录清单（配置列表加载/变更后调用），清单变化会触发立即重扫。
#[tauri::command]
pub async fn runtime_set_catalog(
    state: State<'_, Arc<RuntimeService>>,
    catalog: Vec<String>,
) -> Result<(), String> {
    state.set_catalog(catalog).await;
    Ok(())
}

/// 手动刷新运行态（启动/停止实例后调用，避免等待扫描周期）。
#[tauri::command]
pub async fn runtime_refresh(state: State<'_, Arc<RuntimeService>>) -> Result<(), String> {
    state.refresh().await;
    Ok(())
}

/// 订阅监控采样，返回上一份快照供首屏立即渲染。
#[tauri::command]
pub async fn monitor_subscribe(
    state: State<'_, Arc<RuntimeService>>,
    subscription: MonitorSubscription,
) -> Result<Option<MonitorSnapshot>, String> {
    Ok(state.monitor_subscribe(subscription).await)
}

#[tauri::command]
pub async fn monitor_unsubscribe(
    state: State<'_, Arc<RuntimeService>>,
) -> Result<(), String> {
    state.monitor_unsubscribe().await;
    Ok(())
}

#[tauri::command]
pub async fn monitor_get_snapshot(
    state: State<'_, Arc<RuntimeService>>,
    config_file_name: String,
) -> Result<Option<MonitorSnapshot>, String> {
    Ok(state.monitor_snapshot(&config_file_name).await)
}

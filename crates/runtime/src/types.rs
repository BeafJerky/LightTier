//! 运行态与监控快照的数据契约（与前端 `shared/platform/runtimeApi.ts` 对齐）。

use serde::{Deserialize, Serialize};

/// 运行中的内核实例（桌面来自进程扫描，Android 来自进程内实例管理器）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningInstance {
    pub config_file_name: String,
    pub file_name: String,
    pub pid: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rpc_portal: Option<String>,
    /// Android 进程内实例 id；桌面为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    /// Android 虚拟 IPv4（不含掩码）；桌面为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub virtual_ip: Option<String>,
}

/// 运行态快照：实例集合变化时才递增 revision。
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub revision: u64,
    pub updated_at: u64,
    pub instances: Vec<RunningInstance>,
    pub catalog: Vec<String>,
}

/// 监控采样快照：失败时保留上一份数据并标记 stale。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSnapshot {
    pub config_file_name: String,
    pub revision: u64,
    pub sampled_at: u64,
    /// 与 `easytier-cli --output json node` 一致，并注入 TOML 展示字段。
    pub node_info: serde_json::Value,
    /// 与 `easytier-cli --output json peer` 一致。
    pub peer_list: serde_json::Value,
    pub failures: u32,
    pub stale: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 订阅参数：采样间隔由前端按页面场景下发（详情 3s / 后台 10s）。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSubscription {
    pub instance: RunningInstance,
    #[serde(default)]
    pub interval_ms: Option<u64>,
}

/// 后台健康采样订阅：监控页关闭时仍跟踪运行中实例的连接质量。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSubscription {
    pub instances: Vec<RunningInstance>,
    #[serde(default)]
    pub interval_ms: Option<u64>,
}

/// 单个实例的健康采样结果；失败时 `ok = false`，指标为空。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSample {
    pub config_file_name: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_latency_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loss_rate: Option<f64>,
    pub peer_count: usize,
}

impl HealthSample {
    /// 采样失败：不携带指标，由前端跳过质量上报。
    pub fn failed(config_file_name: String) -> Self {
        Self {
            config_file_name,
            ok: false,
            avg_latency_ms: None,
            loss_rate: None,
            peer_count: 0,
        }
    }
}

/// 健康采样快照：每次采样轮次递增 revision。
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSnapshot {
    pub revision: u64,
    pub sampled_at: u64,
    pub instances: Vec<HealthSample>,
}

//! 运行态与监控采样服务。
//!
//! 单例持有运行中实例快照与监控采样结果，后台工作线程按固定节奏扫描进程，
//! 变化时通过 Tauri 事件推送（`runtime:snapshot` / `monitor:snapshot`）。
//! 前端只做投影，不再各自轮询 PowerShell 或 CLI。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::time::Instant;

use crate::platform;
use crate::types::{MonitorSnapshot, MonitorSubscription, RunningInstance, RuntimeSnapshot};

/// 工作线程节拍：只做轻量判断，重活（扫描/采样）在线程内异步完成。
const WORKER_TICK_MS: u64 = 250;
const QUERY_RETRY_DELAY_MS: u64 = 150;
/// 采样失败后的重试间隔档位（同时不低于订阅间隔）。
const FAILURE_BACKOFF_MS: [u64; 4] = [3_000, 6_000, 12_000, 30_000];
const DEFAULT_INTERVAL_MS: u64 = 3_000;
const MIN_INTERVAL_MS: u64 = 1_000;

struct CachedProjection {
    mtime: Option<SystemTime>,
    fields: Map<String, Value>,
}

#[derive(Default)]
struct MonitorState {
    subscription: Option<MonitorSubscription>,
    last_sample: Option<Instant>,
    sampling: bool,
    failures: u32,
    next_delay: Duration,
    snapshots: HashMap<String, MonitorSnapshot>,
}

pub struct RuntimeService {
    app: AppHandle,
    catalog: Mutex<Vec<String>>,
    snapshot: Mutex<RuntimeSnapshot>,
    /// 串行化扫描，避免工作线程与手动刷新并发执行 PowerShell/ps。
    scan_lock: Mutex<()>,
    force_scan: AtomicBool,
    monitor: Mutex<MonitorState>,
    projections: Mutex<HashMap<String, CachedProjection>>,
}

impl RuntimeService {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            catalog: Mutex::new(Vec::new()),
            snapshot: Mutex::new(RuntimeSnapshot::default()),
            scan_lock: Mutex::new(()),
            force_scan: AtomicBool::new(false),
            monitor: Mutex::new(MonitorState {
                next_delay: Duration::from_millis(DEFAULT_INTERVAL_MS),
                ..MonitorState::default()
            }),
            projections: Mutex::new(HashMap::new()),
        }
    }

    /// 启动后台工作线程（扫描 + 采样）。
    pub fn start(self: &Arc<Self>) {
        let service = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut last_scan: Option<Instant> = None;
            loop {
                tokio::time::sleep(Duration::from_millis(WORKER_TICK_MS)).await;
                let interval = Duration::from_millis(platform::SCAN_INTERVAL_MS);
                let due = match last_scan {
                    None => true,
                    Some(at) => at.elapsed() >= interval,
                };
                if due || service.force_scan.swap(false, Ordering::AcqRel) {
                    last_scan = Some(Instant::now());
                    service.scan_once().await;
                }
                service.monitor_tick().await;
            }
        });
    }

    pub async fn snapshot(&self) -> RuntimeSnapshot {
        self.snapshot.lock().await.clone()
    }

    /// 更新配置目录清单；清单变化时立即重扫（新增配置后无需等下一个周期）。
    pub async fn set_catalog(&self, catalog: Vec<String>) {
        let mut current = self.catalog.lock().await;
        if *current == catalog {
            return;
        }
        *current = catalog;
        self.force_scan.store(true, Ordering::Release);
    }

    /// 手动刷新运行态（启动/停止实例后调用）。
    pub async fn refresh(&self) {
        self.scan_once().await;
    }

    async fn scan_once(&self) {
        let _guard = self.scan_lock.lock().await;
        let catalog = self.catalog.lock().await.clone();
        let mut instances = match platform::scan_instances(&catalog, &self.app).await {
            Ok(instances) => instances,
            Err(err) => {
                log::warn!("runtime scan failed: {err}");
                return;
            }
        };
        instances.sort_by(|a, b| a.config_file_name.cmp(&b.config_file_name));
        instances.dedup_by(|a, b| a.config_file_name == b.config_file_name);

        let mut snapshot = self.snapshot.lock().await;
        let catalog_changed = snapshot.catalog != catalog;
        let instances_changed = snapshot.instances != instances;
        if !catalog_changed && !instances_changed {
            return;
        }
        snapshot.catalog = catalog;
        if instances_changed {
            snapshot.revision += 1;
            snapshot.instances = instances;
        }
        snapshot.updated_at = now_ms();
        let payload = snapshot.clone();
        drop(snapshot);
        self.emit("runtime:snapshot", &payload);
    }

    /// 订阅监控采样；返回该实例的上一份快照用于首屏立即渲染。
    pub async fn monitor_subscribe(
        &self,
        subscription: MonitorSubscription,
    ) -> Option<MonitorSnapshot> {
        let mut state = self.monitor.lock().await;
        let name = subscription.instance.config_file_name.clone();
        let interval = subscription
            .interval_ms
            .unwrap_or(DEFAULT_INTERVAL_MS)
            .max(MIN_INTERVAL_MS);
        let unchanged = state
            .subscription
            .as_ref()
            .map(|current| {
                current.instance.config_file_name == name
                    && normalize_interval(current.interval_ms) == interval
            })
            .unwrap_or(false);
        if !unchanged {
            state.subscription = Some(subscription);
            state.failures = 0;
            state.last_sample = None;
            state.next_delay = Duration::from_millis(interval);
        }
        state.snapshots.get(&name).cloned()
    }

    pub async fn monitor_unsubscribe(&self) {
        self.monitor.lock().await.subscription = None;
    }

    pub async fn monitor_snapshot(&self, config_file_name: &str) -> Option<MonitorSnapshot> {
        self.monitor
            .lock()
            .await
            .snapshots
            .get(config_file_name)
            .cloned()
    }

    async fn monitor_tick(self: &Arc<Self>) {
        let mut state = self.monitor.lock().await;
        let Some(subscription) = state.subscription.clone() else {
            return;
        };
        if state.sampling {
            return;
        }
        let name = subscription.instance.config_file_name.clone();
        let running = self
            .snapshot
            .lock()
            .await
            .instances
            .iter()
            .find(|item| item.config_file_name == name)
            .cloned();
        let Some(instance) = running else {
            // 实例已停止：结束订阅，前端由 runtime 快照驱动收起监控
            state.subscription = None;
            return;
        };
        let due = match state.last_sample {
            None => true,
            Some(at) => at.elapsed() >= state.next_delay,
        };
        if !due {
            return;
        }
        state.sampling = true;
        state.last_sample = Some(Instant::now());
        drop(state);

        let service = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            service.sample_monitor(instance).await;
        });
    }

    async fn sample_monitor(self: &Arc<Self>, instance: RunningInstance) {
        let name = instance.config_file_name.clone();
        let result = self.query_with_retry(&instance).await;
        // 投影读取是异步 IO，放在持锁前完成，避免阻塞订阅切换
        let projection = match &result {
            Ok((node, _)) if node.is_object() => Some(self.projection(&instance.file_name).await),
            _ => None,
        };
        let mut state = self.monitor.lock().await;
        state.sampling = false;
        let still_active = state
            .subscription
            .as_ref()
            .map(|current| current.instance.config_file_name == name)
            .unwrap_or(false);
        if !still_active {
            return;
        }

        match result {
            Ok((mut node_info, peer_list)) => {
                if let (Value::Object(map), Some(fields)) = (&mut node_info, projection) {
                    for (key, value) in fields {
                        map.insert(key, value);
                    }
                }
                let revision = state
                    .snapshots
                    .get(&name)
                    .map(|prev| prev.revision + 1)
                    .unwrap_or(1);
                let snapshot = MonitorSnapshot {
                    config_file_name: name.clone(),
                    revision,
                    sampled_at: now_ms(),
                    node_info,
                    peer_list,
                    failures: 0,
                    stale: false,
                    error: None,
                };
                state.failures = 0;
                state.next_delay = subscribed_interval(&state);
                state.snapshots.insert(name, snapshot.clone());
                drop(state);
                self.emit("monitor:snapshot", &snapshot);
            }
            Err(err) => {
                state.failures += 1;
                let backoff = FAILURE_BACKOFF_MS
                    [(state.failures.saturating_sub(1) as usize).min(FAILURE_BACKOFF_MS.len() - 1)];
                state.next_delay = Duration::from_millis(backoff).max(subscribed_interval(&state));

                let previous = state.snapshots.get(&name).cloned();
                let mut snapshot = previous.unwrap_or_else(|| MonitorSnapshot {
                    config_file_name: name.clone(),
                    revision: 0,
                    sampled_at: 0,
                    node_info: Value::Object(Map::new()),
                    peer_list: Value::Array(Vec::new()),
                    failures: 0,
                    stale: true,
                    error: None,
                });
                snapshot.revision += 1;
                snapshot.failures = state.failures;
                snapshot.stale = true;
                snapshot.error = Some(err.clone());
                state.snapshots.insert(name, snapshot.clone());
                drop(state);
                log::warn!("monitor sample failed for {}: {err}", instance.config_file_name);
                self.emit("monitor:snapshot", &snapshot);
            }
        }
    }

    async fn query_with_retry(
        &self,
        instance: &RunningInstance,
    ) -> Result<(Value, Value), String> {
        let mut last_err = String::new();
        for attempt in 0..2 {
            match platform::query_node_peer(instance, &self.app).await {
                Ok((node, peers)) if !node.is_null() && peers.is_array() => {
                    return Ok((node, peers))
                }
                Ok(_) => last_err = "内核返回数据格式异常".to_string(),
                Err(err) => last_err = err,
            }
            if attempt == 0 {
                tokio::time::sleep(Duration::from_millis(QUERY_RETRY_DELAY_MS)).await;
            }
        }
        Err(last_err)
    }

    /// TOML 展示字段投影（按 mtime 缓存，避免每轮采样都解析配置）。
    async fn projection(&self, file_name: &str) -> Map<String, Value> {
        let Some(path) = platform::config_file_path(&self.app, file_name) else {
            return Map::new();
        };
        let mtime = tokio::fs::metadata(&path)
            .await
            .ok()
            .and_then(|meta| meta.modified().ok());
        {
            let cache = self.projections.lock().await;
            if let Some(cached) = cache.get(file_name) {
                if cached.mtime == mtime {
                    return cached.fields.clone();
                }
            }
        }
        let fields = match tokio::fs::read_to_string(&path).await {
            Ok(content) => parse_projection(&content),
            Err(err) => {
                log::warn!("read config {} failed: {err}", path.display());
                Map::new()
            }
        };
        self.projections.lock().await.insert(
            file_name.to_string(),
            CachedProjection {
                mtime,
                fields: fields.clone(),
            },
        );
        fields
    }

    fn emit<T: Clone + serde::Serialize>(&self, event: &str, payload: &T) {
        if let Err(err) = self.app.emit(event, payload.clone()) {
            log::warn!("emit {event} failed: {err}");
        }
    }
}

fn normalize_interval(interval: Option<u64>) -> u64 {
    interval.unwrap_or(DEFAULT_INTERVAL_MS).max(MIN_INTERVAL_MS)
}

fn subscribed_interval(state: &MonitorState) -> Duration {
    Duration::from_millis(
        state
            .subscription
            .as_ref()
            .map(|current| normalize_interval(current.interval_ms))
            .unwrap_or(DEFAULT_INTERVAL_MS),
    )
}

fn parse_projection(content: &str) -> Map<String, Value> {
    let Ok(parsed) = toml::from_str::<toml::Value>(content) else {
        return Map::new();
    };
    let mut fields = Map::new();
    fields.insert(
        "_instance_name".to_string(),
        Value::String(
            parsed
                .get("instance_name")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
        ),
    );
    fields.insert(
        "_network_name".to_string(),
        Value::String(
            parsed
                .get("network_identity")
                .and_then(|value| value.get("network_name"))
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
        ),
    );
    fields.insert(
        "_dhcp".to_string(),
        Value::Bool(
            parsed
                .get("dhcp")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
        ),
    );
    fields.insert(
        "_exit_nodes".to_string(),
        array_or_empty(parsed.get("exit_nodes")),
    );
    fields.insert(
        "_port_forward".to_string(),
        array_or_empty(parsed.get("port_forward")),
    );
    fields
}

fn array_or_empty(value: Option<&toml::Value>) -> Value {
    match value.map(|item| serde_json::to_value(item).unwrap_or(Value::Null)) {
        Some(Value::Array(items)) => Value::Array(items),
        _ => Value::Array(Vec::new()),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_parses_display_fields() {
        let fields = parse_projection(
            r#"
instance_name = "东京中继"
dhcp = true
exit_nodes = ["0.0.0.0/0"]
port_forward = [{ bind_addr = "0.0.0.0:8080", dst_addr = "10.0.0.2:80" }]

[network_identity]
network_name = "global-mesh"
"#,
        );
        assert_eq!(
            fields.get("_instance_name").and_then(Value::as_str),
            Some("东京中继")
        );
        assert_eq!(
            fields.get("_network_name").and_then(Value::as_str),
            Some("global-mesh")
        );
        assert_eq!(fields.get("_dhcp").and_then(Value::as_bool), Some(true));
        assert_eq!(
            fields
                .get("_exit_nodes")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(
            fields
                .get("_port_forward")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
    }

    #[test]
    fn projection_defaults_on_missing_or_invalid_fields() {
        let fields = parse_projection("instance_name = 1");
        assert_eq!(fields.get("_instance_name").and_then(Value::as_str), Some(""));
        assert_eq!(fields.get("_network_name").and_then(Value::as_str), Some(""));
        assert_eq!(fields.get("_dhcp").and_then(Value::as_bool), Some(false));
        assert_eq!(
            fields
                .get("_exit_nodes")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(0)
        );

        let invalid = parse_projection("instance_name = ");
        assert!(invalid.is_empty());
    }

    #[test]
    fn interval_is_clamped_to_minimum() {
        assert_eq!(normalize_interval(None), DEFAULT_INTERVAL_MS);
        assert_eq!(normalize_interval(Some(10)), MIN_INTERVAL_MS);
        assert_eq!(normalize_interval(Some(10_000)), 10_000);
    }
}

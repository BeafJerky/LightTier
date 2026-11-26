use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Extension, Path, State};
use axum::Json;
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::error::ApiError;
use crate::http::{AppState, RequestId};

/// 与桌面 runtime 的 HEALTH_MAX_INSTANCES 一致：单轮采样实例上限。
const HEALTH_MAX_INSTANCES: usize = 8;
/// CLI 自身已有 5s 超时，这里再留 1s 调度余量，保证单实例查询有硬上界。
const HEALTH_QUERY_BUDGET: Duration = Duration::from_secs(6);
static HEALTH_REVISION: AtomicU64 = AtomicU64::new(0);

pub async fn list(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let instances = state.supervisor.snapshots().await?;
    // 目录包含全部合法配置 id（运行中与已停止），前端据此对齐运行态清单，
    // 不必再单独读配置目录；`instances` 仍只描述当前进程状态。
    let catalog: Vec<String> = state
        .configs
        .list()
        .await?
        .into_iter()
        .map(|entry| entry.id)
        .collect();
    Ok(Json(json!({ "instances": instances, "catalog": catalog })))
}

async fn act(
    state: &AppState,
    request_id: &RequestId,
    id: &str,
    verb: &str,
) -> Result<Json<Value>, ApiError> {
    // Deliberately exhaustive: no catch-all arm, so a verb this router does not
    // know can never be silently executed as `restart`.
    let snapshot = match verb {
        "start" => state.supervisor.start(id).await?,
        "stop" => state.supervisor.stop(id).await?,
        "restart" => state.supervisor.restart(id).await?,
        _ => return Err(ApiError::NotFound),
    };
    state
        .audit
        .record(
            &format!("instance.{verb}"),
            Some(&request_id.0),
            json!({ "id": id }),
        )
        .await;
    Ok(Json(json!(snapshot)))
}

pub async fn start(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<Value>, ApiError> {
    act(&state, &request_id, &id, "start").await
}

pub async fn stop(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<Value>, ApiError> {
    act(&state, &request_id, &id, "stop").await
}

pub async fn restart(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<Value>, ApiError> {
    act(&state, &request_id, &id, "restart").await
}

pub async fn node(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.cli.query(&state.supervisor, &id, "node").await?))
}

pub async fn peers(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.cli.query(&state.supervisor, &id, "peer").await?))
}

pub async fn monitor(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let node = state.cli.query(&state.supervisor, &id, "node");
    let peers = state.cli.query(&state.supervisor, &id, "peer");
    let (node, peers) = tokio::join!(node, peers);
    let mut node = node?;
    let peers = peers?;
    merge_config_projection(&state, &id, &mut node).await;
    Ok(Json(json!({ "node": node, "peers": peers })))
}

/// 按需健康采样（灵动岛质量提示）：只遍历当前运行中的实例，并发查询 peer，
/// 单实例失败只影响自己的样本，不让整个请求失败。无常驻采样任务。
pub async fn health(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let running: Vec<String> = state
        .supervisor
        .snapshots()
        .await?
        .into_iter()
        .filter(|snapshot| snapshot.running)
        .map(|snapshot| snapshot.id)
        .take(HEALTH_MAX_INSTANCES)
        .collect();
    let mut samples = futures_util::future::join_all(running.into_iter().map(|id| {
        let state = Arc::clone(&state);
        async move { sample_instance(&state, &id).await }
    }))
    .await;
    samples.sort_by(|a, b| a.config_file_name.cmp(&b.config_file_name));
    Ok(Json(json!({
        "revision": HEALTH_REVISION.fetch_add(1, Ordering::Relaxed) + 1,
        "sampledAt": chrono::Utc::now().timestamp(),
        "instances": samples,
    })))
}

async fn sample_instance(state: &AppState, id: &str) -> HealthSample {
    match tokio::time::timeout(
        HEALTH_QUERY_BUDGET,
        state.cli.query(&state.supervisor, id, "peer"),
    )
    .await
    {
        Ok(Ok(payload)) => sample_from_payload(id, &payload),
        _ => HealthSample::failed(id.to_string()),
    }
}

/// 与桌面 `RuntimeHealthSnapshot.instances` 同形（camelCase，缺指标时省略字段）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthSample {
    config_file_name: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    avg_latency_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    loss_rate: Option<f64>,
    peer_count: usize,
}

impl HealthSample {
    fn failed(config_file_name: String) -> Self {
        Self {
            config_file_name,
            ok: false,
            avg_latency_ms: None,
            loss_rate: None,
            peer_count: 0,
        }
    }
}

fn sample_from_payload(id: &str, payload: &Value) -> HealthSample {
    // stale=true 表示本轮 CLI 查询失败（超时/非零退出），缓存数据不冒充新样本
    if payload.get("stale").and_then(Value::as_bool) == Some(true) {
        return HealthSample::failed(id.to_string());
    }
    let quality = quality_from_peers(payload.get("data").unwrap_or(&Value::Null));
    HealthSample {
        config_file_name: id.to_string(),
        ok: true,
        avg_latency_ms: quality.avg_latency_ms,
        loss_rate: quality.loss_rate,
        peer_count: quality.peer_count,
    }
}

struct PeerQuality {
    avg_latency_ms: Option<f64>,
    loss_rate: Option<f64>,
    peer_count: usize,
}

/// 逐字镜像 `lighttier-runtime` 的 `quality_from_peers`：crate 分层禁止 agent
/// 依赖桌面 runtime，而两端的质量口径必须一致。
fn quality_from_peers(peers: &Value) -> PeerQuality {
    let Some(items) = peers.as_array() else {
        return PeerQuality {
            avg_latency_ms: None,
            loss_rate: None,
            peer_count: 0,
        };
    };
    let remote: Vec<&Value> = items
        .iter()
        .filter(|peer| peer.get("cost").and_then(Value::as_str) != Some("Local"))
        .collect();
    let latencies: Vec<f64> = remote
        .iter()
        .filter_map(|peer| numeric_metric(peer, "lat_ms"))
        .collect();
    let losses: Vec<f64> = remote
        .iter()
        .filter_map(|peer| numeric_metric(peer, "loss_rate"))
        .collect();
    PeerQuality {
        avg_latency_ms: (!latencies.is_empty())
            .then(|| latencies.iter().sum::<f64>() / latencies.len() as f64),
        loss_rate: Some(if losses.is_empty() {
            0.0
        } else {
            losses.iter().sum::<f64>() / losses.len() as f64
        }),
        peer_count: remote.len(),
    }
}

fn numeric_metric(peer: &Value, key: &str) -> Option<f64> {
    let raw = peer.get(key)?.as_str()?.trim();
    if raw.is_empty() {
        return None;
    }
    raw.parse::<f64>().ok().filter(|value| value.is_finite())
}

/// Adds the config-derived display fields the desktop runtime merges into
/// `node.data` (`_instance_name`, `_network_name`, `_dhcp`, `_exit_nodes`,
/// `_port_forward`), so the monitor page shows the same values in agent mode.
///
/// Keys already present in the CLI payload win: this only fills the gaps and
/// never touches `stale` / `error` or the surrounding envelope. A config that
/// cannot be read (missing, IO, invalid TOML) leaves the payload untouched —
/// the monitor response is still valid without display hints.
async fn merge_config_projection(state: &AppState, id: &str, node: &mut Value) {
    let Ok(document) = state.configs.get(id).await else {
        return;
    };
    let projection = config_projection(&document.toml);
    let Some(data) = node.get_mut("data").and_then(Value::as_object_mut) else {
        // `stale` without a cached sample: data is null, nothing to decorate
        return;
    };
    for (key, value) in projection {
        data.entry(key).or_insert(value);
    }
}

/// Mirrors `parse_projection` in `lighttier-runtime` field for field. It is
/// duplicated on purpose: the crate layering forbids `lighttier-agent` from
/// depending on the desktop runtime crate, and the monitor contract between
/// both backends must stay identical.
fn config_projection(toml_text: &str) -> Map<String, Value> {
    // `Value`'s own `FromStr` parses a single inline value, so the document
    // deserializer is required here (same call the desktop runtime makes).
    let Ok(parsed) = toml::from_str::<toml::Value>(toml_text) else {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_reads_display_fields() {
        let fields = config_projection(
            r#"
instance_name = "家"
dhcp = true
exit_nodes = ["0.0.0.0/0"]
port_forward = [{ bind_addr = "0.0.0.0:8080", dst_addr = "10.0.0.2:80" }]

[network_identity]
network_name = "mesh-a"
"#,
        );
        assert_eq!(
            fields.get("_instance_name").and_then(Value::as_str),
            Some("家")
        );
        assert_eq!(
            fields.get("_network_name").and_then(Value::as_str),
            Some("mesh-a")
        );
        assert_eq!(fields.get("_dhcp").and_then(Value::as_bool), Some(true));
        assert_eq!(
            fields.get("_exit_nodes").and_then(Value::as_array),
            Some(&vec![Value::String("0.0.0.0/0".into())])
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
    fn projection_defaults_when_keys_are_missing() {
        let fields = config_projection("hostname = \"nas\"\n");
        assert_eq!(
            fields.get("_instance_name").and_then(Value::as_str),
            Some("")
        );
        assert_eq!(
            fields.get("_network_name").and_then(Value::as_str),
            Some("")
        );
        assert_eq!(fields.get("_dhcp").and_then(Value::as_bool), Some(false));
        assert_eq!(
            fields.get("_exit_nodes").and_then(Value::as_array),
            Some(&Vec::new())
        );
        assert_eq!(
            fields.get("_port_forward").and_then(Value::as_array),
            Some(&Vec::new())
        );
    }

    #[test]
    fn projection_is_empty_for_invalid_toml() {
        assert!(config_projection("hostname = [").is_empty());
    }

    #[test]
    fn non_array_exit_nodes_fall_back_to_empty() {
        let fields = config_projection("exit_nodes = \"10.0.0.1\"\n");
        assert_eq!(
            fields.get("_exit_nodes").and_then(Value::as_array),
            Some(&Vec::new())
        );
    }

    #[test]
    fn quality_ignores_local_peer_and_parses_string_metrics() {
        let peers = serde_json::json!([
            { "cost": "Local", "lat_ms": "1", "loss_rate": "0" },
            { "cost": "p2p", "lat_ms": "20", "loss_rate": "1.5" },
            { "cost": "relay", "lat_ms": "", "loss_rate": "0.5" },
            { "cost": "relay", "lat_ms": "40", "loss_rate": "" }
        ]);
        let quality = quality_from_peers(&peers);
        assert_eq!(quality.peer_count, 3);
        assert_eq!(quality.avg_latency_ms, Some(30.0));
        assert_eq!(quality.loss_rate, Some(1.0));
    }

    #[test]
    fn quality_without_latency_reports_none() {
        let peers = serde_json::json!([
            { "cost": "p2p", "lat_ms": "", "loss_rate": "0" }
        ]);
        let quality = quality_from_peers(&peers);
        assert_eq!(quality.peer_count, 1);
        assert_eq!(quality.avg_latency_ms, None);
        assert_eq!(quality.loss_rate, Some(0.0));
    }

    #[test]
    fn quality_skips_non_numeric_and_non_finite_metrics() {
        let peers = serde_json::json!([
            { "cost": "p2p", "lat_ms": "abc", "loss_rate": "NaN" },
            { "cost": "p2p", "lat_ms": "inf", "loss_rate": "  " },
            { "cost": "p2p", "lat_ms": " 30 ", "loss_rate": "2" }
        ]);
        let quality = quality_from_peers(&peers);
        assert_eq!(quality.peer_count, 3);
        assert_eq!(quality.avg_latency_ms, Some(30.0));
        assert_eq!(quality.loss_rate, Some(2.0));
    }

    #[test]
    fn quality_non_array_peers_reports_zero_without_metrics() {
        let quality = quality_from_peers(&serde_json::json!({ "error": "cli_failed" }));
        assert_eq!(quality.peer_count, 0);
        assert_eq!(quality.avg_latency_ms, None);
        assert_eq!(quality.loss_rate, None);
    }

    #[test]
    fn sample_marks_stale_payload_as_failed_without_metrics() {
        let payload = serde_json::json!({
            "stale": true,
            "data": [{ "cost": "p2p", "lat_ms": "20", "loss_rate": "1" }],
            "error": "cli_timeout"
        });
        let sample = sample_from_payload("home", &payload);
        assert!(!sample.ok);
        assert_eq!(sample.peer_count, 0);
        let wire = serde_json::to_value(&sample).unwrap();
        assert_eq!(wire["configFileName"], "home");
        assert!(wire.get("avgLatencyMs").is_none());
        assert!(wire.get("lossRate").is_none());
    }

    #[test]
    fn sample_serializes_camel_case_metrics() {
        let payload = serde_json::json!({
            "stale": false,
            "data": [
                { "cost": "Local", "lat_ms": "1", "loss_rate": "0" },
                { "cost": "p2p", "lat_ms": "20", "loss_rate": "1.5" },
                { "cost": "relay", "lat_ms": "40", "loss_rate": "0.5" }
            ]
        });
        let wire = serde_json::to_value(sample_from_payload("home", &payload)).unwrap();
        assert_eq!(wire["ok"], true);
        assert_eq!(wire["avgLatencyMs"], 30.0);
        assert_eq!(wire["lossRate"], 1.0);
        assert_eq!(wire["peerCount"], 2);
    }

    #[test]
    fn failed_sample_omits_metric_fields() {
        let wire = serde_json::to_value(HealthSample::failed("home".into())).unwrap();
        assert_eq!(wire["ok"], false);
        assert_eq!(wire["peerCount"], 0);
        assert!(wire.get("avgLatencyMs").is_none());
        assert!(wire.get("lossRate").is_none());
    }
}

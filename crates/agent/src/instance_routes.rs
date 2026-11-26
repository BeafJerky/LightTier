use std::sync::Arc;

use axum::extract::{Extension, Path, State};
use axum::Json;
use serde_json::{json, Map, Value};

use crate::error::ApiError;
use crate::http::{AppState, RequestId};

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
}

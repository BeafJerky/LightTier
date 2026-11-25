use std::sync::Arc;

use axum::extract::{Extension, Path, State};
use axum::Json;
use serde_json::{json, Value};

use crate::error::ApiError;
use crate::http::{AppState, RequestId};

pub async fn list(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let instances = state.supervisor.snapshots().await?;
    Ok(Json(json!({ "instances": instances })))
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
    Ok(Json(json!({ "node": node?, "peers": peers? })))
}

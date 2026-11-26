use std::sync::Arc;

use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::ApiError;
use crate::http::{AppState, RequestId};
use crate::web_configs::WebConfigInput;

#[derive(Deserialize)]
pub struct PutWebConfigs {
    pub items: Vec<WebConfigInput>,
}

pub async fn list(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let items = state.web_configs.list().await?;
    Ok(Json(json!({ "items": items })))
}

pub async fn put(
    State(state): State<Arc<AppState>>,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<PutWebConfigs>,
) -> Result<Json<Value>, ApiError> {
    let (items, summary) = state.web_configs.replace(body.items).await?;
    for item in &summary.created {
        state
            .audit
            .record("web.create", Some(&request_id.0), item_details(item))
            .await;
    }
    for item in &summary.updated {
        state
            .audit
            .record("web.update", Some(&request_id.0), item_details(item))
            .await;
    }
    for item in &summary.deleted {
        state
            .audit
            .record("web.delete", Some(&request_id.0), item_details(item))
            .await;
    }
    Ok(Json(json!({ "items": items })))
}

pub async fn start(
    State(state): State<Arc<AppState>>,
    Path(config_file_name): Path<String>,
    Extension(request_id): Extension<RequestId>,
) -> Result<StatusCode, ApiError> {
    state.web_configs.start(&config_file_name).await?;
    state
        .audit
        .record(
            "web.start",
            Some(&request_id.0),
            json!({ "name": config_file_name }),
        )
        .await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn stop(
    State(state): State<Arc<AppState>>,
    Path(config_file_name): Path<String>,
    Extension(request_id): Extension<RequestId>,
) -> Result<StatusCode, ApiError> {
    state.web_configs.stop(&config_file_name).await?;
    state
        .audit
        .record(
            "web.stop",
            Some(&request_id.0),
            json!({ "name": config_file_name }),
        )
        .await;
    Ok(StatusCode::NO_CONTENT)
}

/// Audit detail: the connection target is not a credential (the user name is an
/// identifier, not a secret) and the console URL is left out.
fn item_details(item: &crate::web_configs::WebItem) -> Value {
    json!({
        "name": item.config_file_name,
        "protocol": item.protocol,
        "host": item.host,
        "port": item.port,
    })
}

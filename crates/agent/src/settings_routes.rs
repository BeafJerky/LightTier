use std::sync::Arc;

use axum::extract::{Extension, State};
use axum::Json;
use serde_json::{json, Value};

use crate::error::ApiError;
use crate::http::{AppState, RequestId};
use crate::settings::{record_update, SettingsPatch};

pub async fn get(State(state): State<Arc<AppState>>) -> Json<Value> {
    let settings = state.settings.get().await;
    Json(json!(settings))
}

pub async fn put(
    State(state): State<Arc<AppState>>,
    Extension(request_id): Extension<RequestId>,
    Json(patch): Json<SettingsPatch>,
) -> Result<Json<Value>, ApiError> {
    let settings = state.settings.update(patch).await?;
    record_update(&state.audit, Some(&request_id.0), &settings).await;
    Ok(Json(json!(settings)))
}

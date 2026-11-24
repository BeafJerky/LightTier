use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::error::ApiError;
use crate::http::AppState;

const COOKIE_NAME: &str = "lt_session";
const COOKIE_MAX_AGE: i64 = 30 * 86_400;

#[derive(Deserialize)]
pub struct SetupReq {
    pub token: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct PasswordReq {
    pub password: String,
}

pub fn session_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .find_map(|pair| {
            let pair = pair.trim();
            pair.strip_prefix(&format!("{COOKIE_NAME}="))
                .map(ToString::to_string)
        })
}

fn session_cookie(state: &AppState, raw: &str) -> HeaderValue {
    let mut value =
        format!("{COOKIE_NAME}={raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age={COOKIE_MAX_AGE}");
    if state.auth.cookie_secure() {
        value.push_str("; Secure");
    }
    HeaderValue::from_str(&value).expect("cookie value")
}

fn cleared_cookie() -> HeaderValue {
    HeaderValue::from_str(&format!(
        "{COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
    ))
    .expect("cookie value")
}

fn peer_ip(ConnectInfo(addr): ConnectInfo<SocketAddr>) -> String {
    addr.ip().to_string()
}

pub async fn setup(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SetupReq>,
) -> Result<Response, ApiError> {
    let now = chrono::Utc::now().timestamp();
    let token = state.auth.setup(&req.token, &req.password, now).await?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, session_cookie(&state, &token));
    Ok(response)
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    peer: ConnectInfo<SocketAddr>,
    Json(req): Json<PasswordReq>,
) -> Result<Response, ApiError> {
    let now = chrono::Utc::now().timestamp();
    let token = state
        .auth
        .login_at(&peer_ip(peer), &req.password, now)
        .await?;
    let mut response = Json(json!({ "ok": true })).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, session_cookie(&state, &token));
    Ok(response)
}

pub async fn logout(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Some(raw) = session_from_headers(&headers) {
        state.auth.logout(&raw).await;
    }
    let mut response = StatusCode::NO_CONTENT.into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, cleared_cookie());
    response
}

pub async fn session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let raw = session_from_headers(&headers).ok_or(ApiError::AuthRequired)?;
    let now = chrono::Utc::now().timestamp();
    let info = state
        .auth
        .validate_at(&raw, now)
        .await
        .ok_or(ApiError::AuthRequired)?;
    Ok(Json(json!({
        "authenticated": true,
        "createdAt": info.created_at,
    })))
}

pub async fn change_password(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PasswordReq>,
) -> Result<StatusCode, ApiError> {
    state.auth.change_password(&req.password).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn require_auth(
    State(state): State<Arc<AppState>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    if state.auth.setup_required().await {
        return ApiError::SetupRequired.into_response();
    }
    let raw = session_from_headers(request.headers());
    match raw {
        Some(raw) => {
            let now = chrono::Utc::now().timestamp();
            if state.auth.validate_at(&raw, now).await.is_some() {
                next.run(request).await
            } else {
                ApiError::AuthRequired.into_response()
            }
        }
        None => ApiError::AuthRequired.into_response(),
    }
}

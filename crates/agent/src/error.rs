use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug)]
pub enum ApiError {
    SetupRequired,
    AuthRequired,
    AuthInvalid,
    AuthRateLimited,
    ForbiddenOrigin,
    AlreadyInitialized,
    InvalidId,
    NotFound,
    Internal(String),
}

impl ApiError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::SetupRequired => "setup_required",
            Self::AuthRequired => "auth_required",
            Self::AuthInvalid => "auth_invalid",
            Self::AuthRateLimited => "auth_rate_limited",
            Self::ForbiddenOrigin => "permission_denied",
            Self::AlreadyInitialized => "already_initialized",
            Self::InvalidId => "invalid_id",
            Self::NotFound => "not_found",
            Self::Internal(_) => "internal",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::SetupRequired => "administrator setup is required".into(),
            Self::AuthRequired => "authentication required".into(),
            Self::AuthInvalid => "invalid credentials".into(),
            Self::AuthRateLimited => "too many attempts, retry later".into(),
            Self::ForbiddenOrigin => "cross-origin request rejected".into(),
            Self::AlreadyInitialized => "administrator already initialized".into(),
            Self::InvalidId => "invalid identifier".into(),
            Self::NotFound => "not found".into(),
            Self::Internal(detail) => format!("internal error: {detail}"),
        }
    }

    fn status(&self) -> StatusCode {
        match self {
            Self::SetupRequired => StatusCode::PRECONDITION_REQUIRED,
            Self::AuthRequired | Self::AuthInvalid => StatusCode::UNAUTHORIZED,
            Self::AuthRateLimited => StatusCode::TOO_MANY_REQUESTS,
            Self::ForbiddenOrigin => StatusCode::FORBIDDEN,
            Self::AlreadyInitialized => StatusCode::CONFLICT,
            Self::InvalidId => StatusCode::BAD_REQUEST,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status();
        let body = json!({ "error": { "code": self.code(), "message": self.message() } });
        (status, Json(body)).into_response()
    }
}

impl From<std::io::Error> for ApiError {
    fn from(err: std::io::Error) -> Self {
        Self::Internal(err.to_string())
    }
}

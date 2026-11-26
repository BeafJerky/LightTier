use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

#[derive(Debug)]
pub enum ApiError {
    SetupRequired,
    AuthRequired,
    AuthInvalid,
    AuthRateLimited,
    ForbiddenOrigin,
    AlreadyInitialized,
    InvalidId,
    InvalidToml { detail: String },
    InvalidTheme { detail: String },
    ConflictHash { expected: String, actual: String },
    ConfigExists,
    InvalidSettings { detail: String },
    InstanceRunning,
    InstanceNotRunning,
    PortInUse { port: u16, owner: Option<String> },
    CoreMissing,
    DiskFull,
    NotFound,
    PackageExists,
    BadPackage { detail: String },
    ChecksumMismatch,
    CoreVersionUnsupported,
    TaskInProgress,
    BuiltinPackage,
    CoreOverrideReadOnly,
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
            Self::InvalidToml { .. } => "invalid_toml",
            Self::InvalidTheme { .. } => "invalid_theme",
            Self::ConflictHash { .. } => "conflict_hash",
            Self::ConfigExists => "config_exists",
            Self::InvalidSettings { .. } => "invalid_settings",
            Self::InstanceRunning => "instance_running",
            Self::InstanceNotRunning => "instance_not_running",
            Self::PortInUse { .. } => "port_in_use",
            Self::CoreMissing => "core_missing",
            Self::DiskFull => "disk_full",
            Self::NotFound => "not_found",
            Self::PackageExists => "package_exists",
            Self::BadPackage { .. } => "bad_package",
            Self::ChecksumMismatch => "checksum_mismatch",
            Self::CoreVersionUnsupported => "core_version_unsupported",
            Self::TaskInProgress => "task_in_progress",
            Self::BuiltinPackage => "builtin_package",
            Self::CoreOverrideReadOnly => "core_override_read_only",
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
            Self::InvalidToml { detail } => format!("invalid TOML: {detail}"),
            Self::InvalidTheme { detail } => format!("invalid theme: {detail}"),
            Self::ConflictHash { expected, actual } => {
                format!("config changed: expected {expected}, actual {actual}")
            }
            Self::ConfigExists => "config already exists".into(),
            Self::InvalidSettings { detail } => format!("invalid settings: {detail}"),
            Self::InstanceRunning => "instance is already running".into(),
            Self::InstanceNotRunning => "instance is not running".into(),
            Self::PortInUse { port, owner } => match owner {
                Some(owner) => format!("port {port} is already used by {owner}"),
                None => format!("port {port} is already in use"),
            },
            Self::CoreMissing => "easytier core is not installed".into(),
            Self::DiskFull => "disk is full".into(),
            Self::NotFound => "not found".into(),
            Self::PackageExists => "kernel version is already installed".into(),
            Self::BadPackage { detail } => format!("unusable kernel package: {detail}"),
            Self::ChecksumMismatch => "kernel package checksum mismatch".into(),
            Self::CoreVersionUnsupported => "kernel version is not in the release manifest".into(),
            Self::TaskInProgress => "an install task for this version is running".into(),
            Self::BuiltinPackage => "built-in kernel version cannot be removed".into(),
            Self::CoreOverrideReadOnly => {
                "installs are disabled while a core directory override is configured".into()
            }
            Self::Internal(detail) => format!("internal error: {detail}"),
        }
    }

    pub fn params(&self) -> Option<Value> {
        match self {
            Self::InvalidToml { detail }
            | Self::InvalidTheme { detail }
            | Self::InvalidSettings { detail } => Some(json!({ "detail": detail })),
            Self::BadPackage { detail } => Some(json!({ "detail": detail })),
            Self::ConflictHash { expected, actual } => {
                Some(json!({ "expected": expected, "actual": actual }))
            }
            Self::PortInUse { port, owner } => Some(json!({ "port": port, "owner": owner })),
            _ => None,
        }
    }

    /// The `{code, message[, params]}` object clients see, also stored on failed
    /// install tasks so a task snapshot carries the same shape as an HTTP error.
    pub fn payload(&self) -> Value {
        let mut error = json!({ "code": self.code(), "message": self.message() });
        if let Some(params) = self.params() {
            error["params"] = params;
        }
        error
    }

    fn status(&self) -> StatusCode {
        match self {
            Self::SetupRequired => StatusCode::PRECONDITION_REQUIRED,
            Self::AuthRequired | Self::AuthInvalid => StatusCode::UNAUTHORIZED,
            Self::AuthRateLimited => StatusCode::TOO_MANY_REQUESTS,
            Self::ForbiddenOrigin => StatusCode::FORBIDDEN,
            Self::AlreadyInitialized => StatusCode::CONFLICT,
            Self::InvalidId => StatusCode::BAD_REQUEST,
            Self::InvalidToml { .. } | Self::InvalidTheme { .. } | Self::InvalidSettings { .. } => {
                StatusCode::UNPROCESSABLE_ENTITY
            }
            Self::ConflictHash { .. }
            | Self::ConfigExists
            | Self::InstanceRunning
            | Self::InstanceNotRunning
            | Self::PortInUse { .. }
            | Self::CoreMissing
            | Self::PackageExists
            | Self::TaskInProgress
            | Self::CoreOverrideReadOnly => StatusCode::CONFLICT,
            Self::BadPackage { .. } | Self::ChecksumMismatch | Self::CoreVersionUnsupported => {
                StatusCode::UNPROCESSABLE_ENTITY
            }
            Self::BuiltinPackage => StatusCode::FORBIDDEN,
            Self::DiskFull => StatusCode::INSUFFICIENT_STORAGE,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status();
        let error = self.payload();
        (status, Json(json!({ "error": error }))).into_response()
    }
}

impl From<std::io::Error> for ApiError {
    fn from(err: std::io::Error) -> Self {
        if err.kind() == std::io::ErrorKind::StorageFull {
            Self::DiskFull
        } else {
            Self::Internal(err.to_string())
        }
    }
}

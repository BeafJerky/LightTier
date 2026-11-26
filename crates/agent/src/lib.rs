pub mod audit;
pub mod auth;
pub mod auth_routes;
pub mod cli;
pub mod config;
pub mod config_routes;
pub mod configs;
pub mod error;
pub mod http;
pub mod ids;
pub mod instance_routes;
pub mod log_routes;
pub mod logging;
pub mod logs;
pub mod package_routes;
pub mod packages;
pub mod settings;
pub mod settings_routes;
pub mod storage;
pub mod supervisor;
pub mod theme_routes;
pub mod themes;
pub mod tun;
pub mod web_config_routes;
pub mod web_configs;

use std::sync::Arc;

pub async fn run_server() -> Result<(), Box<dyn std::error::Error>> {
    let cfg = config::AgentConfig::from_env()?;
    std::fs::create_dir_all(&cfg.data_dir)?;
    let _guard = logging::init(&cfg.data_dir.join("logs/agent"))?;
    let auth = crate::auth::AuthStore::load(&cfg).await?;
    let configs = Arc::new(configs::Configs::new(&cfg.data_dir));
    let audit = Arc::new(audit::Audit::new(&cfg.data_dir));
    let settings = Arc::new(settings::SettingsStore::load(&cfg.data_dir).await?);
    // `LT_CORE_DIR` lets an operator point the agent at a core tree outside the
    // packaged/default locations without rebuilding it.
    let core_override = std::env::var_os("LT_CORE_DIR").map(std::path::PathBuf::from);
    let supervisor = Arc::new(
        supervisor::Supervisor::load(
            &cfg.data_dir,
            core_override.clone(),
            configs.clone(),
            settings.clone(),
        )
        .await?,
    );
    let cli = Arc::new(cli::CliQuery::new(&cfg.data_dir, core_override.clone()));
    // `Packages` gets the same override as the supervisor, so `/packages.active`
    // is the binary a spawn would run. An override also disables installs
    // (`installAllowed: false`): they would publish into `<data>/core`, which
    // such a deployment never scans. The install pipeline reports terminal
    // failures to the audit log (its request was answered with a 202 long ago).
    // Same `<data>/logs` tree the tracing appender, the audit trail and the
    // kernels write into; the API only ever reads it (and clears it on request).
    let logs = Arc::new(logs::Logs::new(&cfg.data_dir));
    // Downloads must see the *current* mirror setting, not the value at boot:
    // the closure reads the store at download time (env lock still wins inside
    // `download_url`).
    let mirror_settings = settings.clone();
    let packages = Arc::new(
        packages::Packages::new(&cfg.data_dir)
            .with_core_override(core_override)
            .with_settings_mirror(move || mirror_settings.core_mirror())
            .on_finish(package_routes::install_audit_hook(audit.clone())),
    );
    let state = Arc::new(http::AppState::new(
        cfg, auth, configs, audit, settings, supervisor, cli, packages, logs,
    ));
    // Autostart runs detached: a slow (or failing) kernel start must never delay
    // the listener coming up.
    let startup = state.clone();
    tokio::spawn(async move { supervisor::autostart(&startup.supervisor).await });
    http::serve(state).await
}

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
pub mod logging;
pub mod settings;
pub mod settings_routes;
pub mod storage;
pub mod supervisor;
pub mod tun;

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
    let cli = Arc::new(cli::CliQuery::new(&cfg.data_dir, core_override));
    let state = Arc::new(http::AppState::new(
        cfg, auth, configs, audit, settings, supervisor, cli,
    ));
    // Autostart runs detached: a slow (or failing) kernel start must never delay
    // the listener coming up.
    let startup = state.clone();
    tokio::spawn(async move { supervisor::autostart(&startup.supervisor).await });
    http::serve(state).await
}

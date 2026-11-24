use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::time::Duration;

use lighttier_agent::config::AgentConfig;

fn main() {
    let cmd = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "serve".to_string());
    let result = match cmd.as_str() {
        "serve" => run_serve(),
        "version" => {
            println!("lighttier-agent {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        "healthcheck" => healthcheck(),
        "print-setup-token" => print_setup_token(),
        "reset-password" => reset_password(),
        other => {
            eprintln!("unknown command: {other}");
            eprintln!("usage: lighttier-agent [serve|version|healthcheck|print-setup-token|reset-password]");
            std::process::exit(2);
        }
    };
    if let Err(err) = result {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}

fn run_serve() -> Result<(), Box<dyn std::error::Error>> {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    rt.block_on(lighttier_agent::run_server())
}

fn healthcheck() -> Result<(), Box<dyn std::error::Error>> {
    let cfg = AgentConfig::from_env()?;
    let addr = if cfg.bind.ip().is_unspecified() {
        SocketAddr::new(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), cfg.bind.port())
    } else {
        cfg.bind
    };
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3))?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    write!(
        stream,
        "GET /api/v1/healthz HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n"
    )?;
    let mut buf = String::new();
    stream.read_to_string(&mut buf)?;
    if buf.starts_with("HTTP/1.1 200") || buf.starts_with("HTTP/1.0 200") {
        Ok(())
    } else {
        Err(format!(
            "unexpected response: {}",
            buf.lines().next().unwrap_or("")
        ))
        .map_err(Into::into)
    }
}

fn print_setup_token() -> Result<(), Box<dyn std::error::Error>> {
    let cfg = AgentConfig::from_env()?;
    let path = cfg.data_dir.join("state/setup-token");
    let token = std::fs::read_to_string(&path)?;
    println!("{}", token.trim());
    Ok(())
}

fn reset_password() -> Result<(), Box<dyn std::error::Error>> {
    let cfg = AgentConfig::from_env()?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let store = rt.block_on(lighttier_agent::auth::AuthStore::load(&cfg))?;
    let password = rpassword::prompt_password("New admin password: ")?;
    rt.block_on(store.reset_password(&password))
        .map_err(|err| format!("{}: {}", err.code(), err.message()))?;
    println!("password updated");
    Ok(())
}

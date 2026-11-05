//! 桌面平台：进程扫描（Windows CIM / Unix ps）与 easytier-cli 查询。

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::process::Command;

use crate::types::RunningInstance;

/// 配置目录：桌面资源目录下的 `config`（与前端 CONFIG_PATH 一致）。
pub fn config_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok().map(|p| p.join("config"))
}

fn core_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok().map(|p| p.join("resource").join("core"))
}

fn executable_name() -> &'static str {
    if cfg!(windows) {
        "easytier-cli.exe"
    } else {
        "easytier-cli"
    }
}

fn cli_program(app: &AppHandle) -> String {
    if let Some(path) = core_dir(app).map(|dir| dir.join(executable_name())) {
        if path.exists() {
            return path.to_string_lossy().to_string();
        }
    }
    "easytier-cli".to_string()
}

fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd;
}

/// 桌面扫描间隔：进程列表查询成本较高，15s 足以发现外部启动/退出。
pub const SCAN_INTERVAL_MS: u64 = 15_000;

async fn run_program(program: &str, args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    hide_console(&mut cmd);

    let output = tokio::time::timeout(timeout, cmd.output())
        .await
        .map_err(|_| format!("{program} 执行超时"))?
        .map_err(|e| format!("{program} 启动失败: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "{program} 执行失败: {}",
            stderr.trim().to_string() + stdout.trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(windows)]
async fn scan_process_output(timeout: Duration) -> Result<String, String> {
    // 强制 PowerShell 输出 UTF-8，避免中文路径按 GBK 解码出错
    let script = "$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8; \
        Get-CimInstance -ClassName Win32_Process -Filter \"CommandLine LIKE '%easytier-core%'\" | \
        Select-Object @{N='commandLine';E={$_.CommandLine}}, @{N='pid';E={$_.ProcessId}} | \
        ConvertTo-Json -Compress";
    run_program(
        "powershell",
        &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        timeout,
    )
    .await
}

#[cfg(not(windows))]
async fn scan_process_output(timeout: Duration) -> Result<String, String> {
    run_program("ps", &["-eo", "pid=,args="], timeout).await
}

/// 扫描运行中的内核进程，只保留当前配置目录内的实例。
pub async fn scan_instances(
    catalog: &[String],
    _app: &AppHandle,
) -> Result<Vec<RunningInstance>, String> {
    if catalog.is_empty() {
        return Ok(Vec::new());
    }
    let output = scan_process_output(Duration::from_secs(8)).await?;
    Ok(parse_scan_output(&output, catalog))
}

#[cfg(windows)]
fn parse_scan_output(raw: &str, catalog: &[String]) -> Vec<RunningInstance> {
    if raw.is_empty() {
        return Vec::new();
    }
    let parsed: Value = match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let rows = match parsed {
        Value::Array(items) => items,
        Value::Object(_) => vec![parsed],
        _ => Vec::new(),
    };

    rows.iter()
        .filter_map(|row| {
            let command_line = row.get("commandLine")?.as_str()?.to_string();
            let pid = row.get("pid")?.as_u64()? as u32;
            build_instance(&command_line, pid, catalog)
        })
        .collect()
}

#[cfg(not(windows))]
fn parse_scan_output(raw: &str, catalog: &[String]) -> Vec<RunningInstance> {
    raw.lines()
        .filter_map(|line| {
            let line = line.trim();
            let (pid, command_line) = line.split_once(char::is_whitespace)?;
            let pid = pid.trim().parse::<u32>().ok()?;
            build_instance(command_line.trim(), pid, catalog)
        })
        .collect()
}

fn build_instance(
    command_line: &str,
    pid: u32,
    catalog: &[String],
) -> Option<RunningInstance> {
    let config_file_name = catalog
        .iter()
        .find(|name| command_line.contains(&format!("{name}.toml")))
        .cloned()?;
    Some(RunningInstance {
        file_name: format!("{config_file_name}.toml"),
        config_file_name,
        pid,
        rpc_portal: extract_flag(command_line, "--rpc-portal"),
        instance_id: None,
        virtual_ip: None,
    })
}

/// 从命令行提取带值的参数（`--rpc-portal 127.0.0.1:15888`）。
fn extract_flag(command_line: &str, flag: &str) -> Option<String> {
    let mut tokens = command_line.split_whitespace();
    while let Some(token) = tokens.next() {
        if token == flag {
            return tokens
                .next()
                .map(|value| value.trim_matches('"').trim_matches('\'').to_string());
        }
    }
    None
}

/// 查询节点与对等节点（桌面走 easytier-cli；CLI 与当前内核版本同包配套）。
pub async fn query_node_peer(
    instance: &RunningInstance,
    app: &AppHandle,
) -> Result<(Value, Value), String> {
    let portal = instance
        .rpc_portal
        .clone()
        .unwrap_or_else(|| "127.0.0.1:15888".to_string())
        .replace("0.0.0.0", "127.0.0.1");
    let cli = cli_program(app);

    let node_raw = run_program(
        &cli,
        &["-p", &portal, "--output", "json", "node"],
        Duration::from_secs(10),
    )
    .await?;
    let peer_raw = run_program(
        &cli,
        &["-p", &portal, "--output", "json", "peer"],
        Duration::from_secs(10),
    )
    .await?;

    let node: Value =
        serde_json::from_str(&node_raw).map_err(|e| format!("节点数据解析失败: {e}"))?;
    let peers: Value =
        serde_json::from_str(&peer_raw).map_err(|e| format!("对等节点解析失败: {e}"))?;
    if !peers.is_array() {
        return Err("对等节点数据格式异常".to_string());
    }
    Ok((node, peers))
}

/// 从资源目录解析配置文件的绝对路径（供 TOML 展示字段读取）。
pub fn config_file_path(app: &AppHandle, file_name: &str) -> Option<PathBuf> {
    let name = Path::new(file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(file_name);
    config_dir(app).map(|dir| dir.join(name))
}

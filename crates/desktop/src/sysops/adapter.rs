//! 网卡枚举、默认网关与自动跃点。
//!
//! PowerShell 只执行静态脚本，网卡名通过环境变量传入，避免命令拼接注入。

use super::{decode_native, validate_adapter_name};

const ACTIVE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$item = Get-NetIPConfiguration |
  Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' -and $_.NetAdapter.Name -notlike 'et_*' -and $_.NetAdapter.Name -notlike 'easytier*' } |
  Sort-Object -Property InterfaceMetric |
  Select-Object -First 1
if ($null -ne $item) {
  [pscustomobject]@{ alias = $item.InterfaceAlias; gateway = $item.IPv4DefaultGateway.NextHop } | ConvertTo-Json -Compress
}
"#;

const LIST_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$items = @(Get-NetIPConfiguration |
  Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' -and $_.NetAdapter.Name -notlike 'et_*' -and $_.NetAdapter.Name -notlike 'easytier*' } |
  Sort-Object -Property InterfaceMetric |
  ForEach-Object { $_.InterfaceAlias })
if ($items.Count -gt 0) { $items | ConvertTo-Json -Compress }
"#;

const DISABLE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Set-NetIPInterface -InterfaceAlias $env:LT_ADAPTER -AutomaticMetric Disabled -InterfaceMetric 1
"#;

const ENABLE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Set-NetIPInterface -InterfaceAlias $env:LT_ADAPTER -AutomaticMetric Enabled
"#;

const STATE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$item = Get-NetIPInterface -InterfaceAlias $env:LT_ADAPTER -AddressFamily IPv4
[pscustomobject]@{ automatic = [string]$item.AutomaticMetric; metric = [int]$item.InterfaceMetric } | ConvertTo-Json -Compress
"#;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterState {
    pub automatic: String,
    pub metric: u32,
}

fn parse_adapter_state(raw: &str) -> Result<AdapterState, String> {
    let parsed: serde_json::Value = serde_json::from_str(raw.trim()).map_err(|e| e.to_string())?;
    Ok(AdapterState {
        automatic: parsed
            .get("automatic")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        metric: parsed
            .get("metric")
            .and_then(|value| value.as_u64())
            .unwrap_or_default() as u32,
    })
}

pub fn adapter_metric_script() -> &'static str {
    DISABLE_SCRIPT
}

fn ensure_known_adapter(adapter: &str, known: &[String]) -> Result<(), String> {
    if known.iter().any(|item| item == adapter) {
        Ok(())
    } else {
        Err(format!("unknown adapter: {adapter}"))
    }
}

fn parse_adapter_entry(raw: &str) -> Result<Option<(String, Option<String>)>, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let parsed: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let alias = parsed
        .get("alias")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let gateway = parsed
        .get("gateway")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    Ok(alias.map(|alias| (alias, gateway)))
}

fn parse_aliases(raw: &str) -> Result<Vec<String>, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    let parsed: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    match parsed {
        serde_json::Value::String(alias) => Ok(vec![alias]),
        serde_json::Value::Array(items) => Ok(items
            .into_iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect()),
        _ => Err("unexpected adapter list payload".into()),
    }
}

#[cfg(windows)]
fn run_powershell(script: &str, adapter: Option<&str>, mode: Option<&str>) -> Result<String, String> {
    use std::process::{Command, Stdio};

    let mut command = Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(adapter) = adapter {
        validate_adapter_name(adapter)?;
        command.env("LT_ADAPTER", adapter);
    }
    if let Some(mode) = mode {
        command.env("LT_METRIC_MODE", mode);
    }
    let output = command
        .output()
        .map_err(|e| format!("powershell 执行失败: {e}"))?;
    if !output.status.success() {
        return Err(decode_native(&output.stderr).trim().to_string());
    }
    Ok(decode_native(&output.stdout).trim().to_string())
}

#[cfg(not(windows))]
fn run_powershell(
    _script: &str,
    _adapter: Option<&str>,
    _mode: Option<&str>,
) -> Result<String, String> {
    Err("adapter operations are only supported on Windows".into())
}

pub fn active_adapter() -> Result<Option<String>, String> {
    let raw = run_powershell(ACTIVE_SCRIPT, None, None)?;
    Ok(parse_adapter_entry(&raw)?.map(|(alias, _)| alias))
}

pub fn default_gateway() -> Result<Option<String>, String> {
    let raw = run_powershell(ACTIVE_SCRIPT, None, None)?;
    Ok(parse_adapter_entry(&raw)?.and_then(|(_, gateway)| gateway))
}

pub fn list_adapters() -> Result<Vec<String>, String> {
    parse_aliases(&run_powershell(LIST_SCRIPT, None, None)?)
}

pub fn set_adapter_metric(adapter: &str, enabled: bool) -> Result<(), String> {
    let known = list_adapters()?;
    ensure_known_adapter(adapter, &known)?;
    let script = if enabled { ENABLE_SCRIPT } else { DISABLE_SCRIPT };
    run_powershell(script, Some(adapter), None).map(|_| ())
}

pub fn adapter_state(adapter: &str) -> Result<AdapterState, String> {
    validate_adapter_name(adapter)?;
    parse_adapter_state(&run_powershell(STATE_SCRIPT, Some(adapter), None)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metric_script_is_static_and_reads_env() {
        let script = adapter_metric_script();
        assert!(script.contains("$env:LT_ADAPTER"));
        assert!(script.contains("-InterfaceMetric 1"));
        assert!(!script.contains("-InterfaceAlias \""));
    }

    #[test]
    fn rejects_unknown_adapter() {
        let known = vec!["以太网".to_string()];
        assert!(ensure_known_adapter("以太网", &known).is_ok());
        assert!(ensure_known_adapter("其他网卡", &known).is_err());
    }

    #[test]
    fn parses_single_alias_json() {
        assert_eq!(parse_aliases("\"以太网\"").unwrap(), vec!["以太网"]);
        assert_eq!(parse_aliases("[\"以太网\",\"WLAN\"]").unwrap().len(), 2);
    }

    #[test]
    fn parses_adapter_entry() {
        let raw = r#"{"alias":"以太网","gateway":"192.168.1.1"}"#;
        let parsed = parse_adapter_entry(raw).unwrap();
        assert_eq!(
            parsed.as_ref().map(|(alias, _)| alias.as_str()),
            Some("以太网")
        );
    }

    #[test]
    fn parses_adapter_state() {
        let state = parse_adapter_state(r#"{"automatic":"Disabled","metric":1}"#).unwrap();
        assert_eq!(
            state,
            AdapterState {
                automatic: "Disabled".to_string(),
                metric: 1
            }
        );
    }
}
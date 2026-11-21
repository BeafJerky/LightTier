//! 进程扫描与终止：固定 PowerShell 脚本 + 环境变量过滤词。

use serde_json::Value;

use super::decode_native;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub name: String,
    pub command_line: String,
    pub path: String,
    pub pid: u32,
    pub memory: u64,
}

const PROCESS_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like ('*' + $env:LT_FILTER + '*') } |
  Select-Object @{N='name';E={$_.Name}}, @{N='commandLine';E={$_.CommandLine}},
                @{N='path';E={$_.ExecutablePath}}, @{N='pid';E={$_.ProcessId}},
                @{N='memory';E={$_.WorkingSetSize}} |
  ConvertTo-Json -Compress
"#;

pub fn validate_process_filter(value: &str) -> Result<(), String> {
    if value.trim().is_empty()
        || value.len() > 128
        || value
            .chars()
            .any(|c| c == '"' || c == '\'' || c == ';' || c == '\n' || c == '\r' || c == '\0')
    {
        return Err("invalid process filter".into());
    }
    Ok(())
}

fn parse_u64(value: Option<&Value>) -> Option<u64> {
    let value = value?;
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|raw| raw.trim().parse().ok()))
}

fn process_from_value(value: &Value) -> Option<ProcessInfo> {
    let object = value.as_object()?;
    let pid = parse_u64(object.get("pid"))?;
    if pid == 0 || pid > u32::MAX as u64 {
        return None;
    }
    let string_field = |key: &str| {
        object
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    Some(ProcessInfo {
        name: string_field("name"),
        command_line: string_field("commandLine"),
        path: string_field("path"),
        pid: pid as u32,
        memory: parse_u64(object.get("memory")).unwrap_or_default(),
    })
}

fn parse_process_json(raw: &str) -> Result<Vec<ProcessInfo>, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    let parsed: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    match parsed {
        Value::Null => Ok(Vec::new()),
        Value::Object(_) => Ok(process_from_value(&parsed).into_iter().collect()),
        Value::Array(items) => Ok(items.iter().filter_map(process_from_value).collect()),
        _ => Err("unexpected process payload".into()),
    }
}

#[cfg(windows)]
pub fn list_processes(filter: &str) -> Result<Vec<ProcessInfo>, String> {
    use std::process::{Command, Stdio};

    validate_process_filter(filter)?;
    let mut command = Command::new("powershell.exe");
    super::exec::hide_console(&mut command);
    let output = command
        .args(["-NoProfile", "-NonInteractive", "-Command", PROCESS_SCRIPT])
        .env("LT_FILTER", filter)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("powershell 执行失败: {e}"))?;
    if !output.status.success() {
        return Err(decode_native(&output.stderr).trim().to_string());
    }
    parse_process_json(&decode_native(&output.stdout))
}

#[cfg(not(windows))]
pub fn list_processes(filter: &str) -> Result<Vec<ProcessInfo>, String> {
    use std::process::{Command, Stdio};

    validate_process_filter(filter)?;
    let output = Command::new("ps")
        .args(["-eo", "comm,args,pid,rss"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("ps 执行失败: {e}"))?;
    if !output.status.success() {
        return Err(decode_native(&output.stderr).trim().to_string());
    }
    let text = decode_native(&output.stdout);
    let mut result = Vec::new();
    for line in text.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 4 {
            continue;
        }
        let rss = fields[fields.len() - 1];
        let pid = fields[fields.len() - 2];
        let name = fields[0];
        let command_line = fields[1..fields.len() - 2].join(" ");
        if !command_line.contains(filter) {
            continue;
        }
        let Ok(pid) = pid.parse::<u32>() else {
            continue;
        };
        if pid == 0 {
            continue;
        }
        result.push(ProcessInfo {
            name: name.to_string(),
            command_line,
            path: name.to_string(),
            pid,
            memory: rss.parse::<u64>().unwrap_or_default() * 1024,
        });
    }
    Ok(result)
}

#[cfg(not(windows))]
pub fn kill_process(pid: u32) -> Result<bool, String> {
    use std::process::{Command, Stdio};

    super::validate_pid(pid)?;
    let output = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("kill 执行失败: {e}"))?;
    Ok(output.status.success())
}

#[cfg(windows)]
pub fn kill_process(pid: u32) -> Result<bool, String> {
    use std::process::{Command, Stdio};

    super::validate_pid(pid)?;
    let output = Command::new("taskkill.exe")
        .args(["/F", "/PID", &pid.to_string()])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("taskkill 执行失败: {e}"))?;
    Ok(output.status.success())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_or_injected_filter() {
        assert!(validate_process_filter("easytier-core").is_ok());
        assert!(validate_process_filter("easytier-core\" ; calc").is_err());
        assert!(validate_process_filter("").is_err());
    }

    #[test]
    fn parses_single_and_array_json() {
        let one = r#"{"name":"easytier-core.exe","commandLine":"easytier-core --config-file a.toml","path":"C:\\x.exe","pid":12,"memory":1024}"#;
        assert_eq!(parse_process_json(one).unwrap().len(), 1);
        let many = format!("[{one},{one}]");
        assert_eq!(parse_process_json(&many).unwrap().len(), 2);
    }

    #[test]
    fn parses_string_pid_and_memory() {
        let raw = r#"{"name":"easytier-core.exe","commandLine":"x","path":"","pid":"42","memory":"2048"}"#;
        let parsed = parse_process_json(raw).unwrap();
        assert_eq!(parsed[0].pid, 42);
        assert_eq!(parsed[0].memory, 2048);
    }

    #[test]
    fn empty_output_is_empty_list() {
        assert!(parse_process_json("").unwrap().is_empty());
    }
}
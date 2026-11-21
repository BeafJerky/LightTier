//! 路由表操作：固定参数调用 `route.exe`，不接受任意参数数组。

use serde_json::Value;

use super::{decode_native, validate_ipv4, validate_mask};
use std::process::Command;

const NET_ROUTE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Get-NetRoute -AddressFamily IPv4 |
  ForEach-Object { [pscustomobject]@{ destination = $_.DestinationPrefix; gateway = $_.NextHop; metric = [int]$_.RouteMetric } } |
  ConvertTo-Json -Compress
"#;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteRow {
    pub target: String,
    pub mask: String,
    pub gateway: String,
    pub metric: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_route_add_arguments() {
        assert_eq!(
            build_add_args("10.0.0.0", "255.0.0.0", "192.168.1.1", 5),
            vec![
                "add",
                "10.0.0.0",
                "mask",
                "255.0.0.0",
                "192.168.1.1",
                "metric",
                "5"
            ]
        );
    }

    #[test]
    fn parses_net_route_json_and_filters_on_link() {
        let raw = r#"[
            {"destination":"0.0.0.0/0","gateway":"192.168.5.1","metric":0},
            {"destination":"192.168.5.0/24","gateway":"0.0.0.0","metric":256}
        ]"#;
        let rows = parse_net_route_json(raw).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].target, "0.0.0.0");
        assert_eq!(rows[0].mask, "0.0.0.0");
        assert_eq!(rows[0].metric, 0);
    }

    #[test]
    fn parses_single_net_route_object() {
        let raw = r#"{"destination":"10.199.0.0/24","gateway":"10.199.0.3","metric":1}"#;
        let rows = parse_net_route_json(raw).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].target, "10.199.0.0");
        assert_eq!(rows[0].mask, "255.255.255.0");
    }

    #[test]
    fn route_exists_matches_exact_token_only() {
        let table = "          10.1.2.3        255.255.255.255      192.168.1.1    192.168.1.100      5\n";
        assert!(table_contains_ip(table, "10.1.2.3"));
        assert!(!table_contains_ip(table, "10.1.2"));
    }

    #[test]
    fn builds_route_delete_arguments_with_mask_keyword() {
        assert_eq!(
            build_delete_args("10.0.0.0", "255.0.0.0", "192.168.1.1"),
            vec!["delete", "10.0.0.0", "mask", "255.0.0.0", "192.168.1.1"]
        );
    }

    #[test]
    fn rejects_host_bits_in_mask() {
        assert!(validate_mask("255.0.255.0").is_err());
    }
}

fn build_add_args(target: &str, mask: &str, gateway: &str, metric: u32) -> Vec<String> {
    vec![
        "add".into(),
        target.into(),
        "mask".into(),
        mask.into(),
        gateway.into(),
        "metric".into(),
        metric.to_string(),
    ]
}

fn run_route(args: &[String]) -> Result<String, String> {
    let output = Command::new("route.exe")
        .args(args)
        .output()
        .map_err(|e| format!("route 执行失败: {e}"))?;
    if !output.status.success() {
        let stderr = decode_native(&output.stderr);
        let stdout = decode_native(&output.stdout);
        let message = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!(
            "route {} 失败: {message}",
            args.first().map(String::as_str).unwrap_or_default()
        ));
    }
    Ok(decode_native(&output.stdout))
}

pub fn add_route(target: &str, mask: &str, gateway: &str, metric: u32) -> Result<(), String> {
    validate_ipv4(target)?;
    validate_mask(mask)?;
    validate_ipv4(gateway)?;
    run_route(&build_add_args(target, mask, gateway, metric)).map(|_| ())
}

pub fn delete_route(target: &str, mask: &str, gateway: &str) -> Result<(), String> {
    validate_ipv4(target)?;
    validate_mask(mask)?;
    validate_ipv4(gateway)?;
    run_route(&build_delete_args(target, mask, gateway)).map(|_| ())
}

fn build_delete_args(target: &str, mask: &str, gateway: &str) -> Vec<String> {
    vec![
        "delete".into(),
        target.into(),
        "mask".into(),
        mask.into(),
        gateway.into(),
    ]
}

pub fn change_default_route(gateway: &str, metric: u32) -> Result<(), String> {
    validate_ipv4(gateway)?;
    run_route(&[
        "change".into(),
        "0.0.0.0".into(),
        "mask".into(),
        "0.0.0.0".into(),
        gateway.into(),
        "metric".into(),
        metric.to_string(),
    ])
    .map(|_| ())
}

pub fn print_routes() -> Result<Vec<RouteRow>, String> {
    #[cfg(windows)]
    {
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", NET_ROUTE_SCRIPT])
            .output()
            .map_err(|e| format!("powershell 执行失败: {e}"))?;
        if !output.status.success() {
            return Err(decode_native(&output.stderr).trim().to_string());
        }
        parse_net_route_json(&decode_native(&output.stdout))
    }
    #[cfg(not(windows))]
    {
        Err("route listing is only supported on Windows".into())
    }
}

pub fn route_exists(ip: &str) -> Result<bool, String> {
    validate_ipv4(ip)?;
    let table = run_route(&["print".into(), "-4".into(), ip.into()])?;
    Ok(table_contains_ip(&table, ip))
}

fn parse_net_route_json(raw: &str) -> Result<Vec<RouteRow>, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    let parsed: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let items: Vec<&Value> = match &parsed {
        Value::Null => Vec::new(),
        Value::Array(items) => items.iter().collect(),
        Value::Object(_) => vec![&parsed],
        _ => return Err("unexpected route payload".into()),
    };
    let mut rows = Vec::new();
    for item in items {
        let Some(destination) = item.get("destination").and_then(Value::as_str) else {
            continue;
        };
        let Some(gateway) = item.get("gateway").and_then(Value::as_str) else {
            continue;
        };
        // 与 route print 旧口径一致：跳过 on-link（NextHop 0.0.0.0）
        if gateway.is_empty() || gateway == "0.0.0.0" {
            continue;
        }
        let Some((target, mask)) = prefix_to_target_mask(destination) else {
            continue;
        };
        rows.push(RouteRow {
            target,
            mask,
            gateway: gateway.to_string(),
            metric: item.get("metric").and_then(Value::as_u64).unwrap_or(0) as u32,
        });
    }
    Ok(rows)
}

fn prefix_to_target_mask(prefix: &str) -> Option<(String, String)> {
    let (ip, len) = prefix.split_once('/')?;
    validate_ipv4(ip).ok()?;
    let len: u32 = len.parse().ok()?;
    if len > 32 {
        return None;
    }
    let ip_value = ip.split('.').fold(0u32, |acc, part| {
        (acc << 8) | part.parse::<u32>().unwrap_or_default()
    });
    let mask_value = if len == 0 {
        0
    } else {
        u32::MAX << (32 - len)
    };
    Some((
        u32_to_ip(ip_value & mask_value),
        u32_to_ip(mask_value),
    ))
}

fn u32_to_ip(value: u32) -> String {
    format!(
        "{}.{}.{}.{}",
        value >> 24,
        (value >> 16) & 0xff,
        (value >> 8) & 0xff,
        value & 0xff
    )
}

fn table_contains_ip(table: &str, ip: &str) -> bool {
    table
        .lines()
        .any(|row| row.split_whitespace().any(|token| token == ip))
}
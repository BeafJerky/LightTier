//! 路由表操作：固定参数调用 `route.exe`，不接受任意参数数组。

use super::{decode_native, validate_ipv4, validate_mask};
use std::process::Command;

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
    fn parses_five_column_route_rows_and_uses_last_metric() {
        let text = "Network Destination        Netmask          Gateway       Interface  Metric\n\
                    \x20         10.0.0.0        255.0.0.0      192.168.1.1    192.168.1.100      5\n";
        let rows = parse_route_print(text).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].metric, 5);
        assert_eq!(rows[0].gateway, "192.168.1.1");
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
    fn parses_default_route_with_zero_mask() {
        let text = "          0.0.0.0          0.0.0.0      192.168.5.1     192.168.5.35     30\n";
        let rows = parse_route_print(text).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].target, "0.0.0.0");
        assert_eq!(rows[0].mask, "0.0.0.0");
        assert_eq!(rows[0].metric, 30);
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
    parse_route_print(&run_route(&["print".into(), "-4".into()])?)
}

pub fn route_exists(ip: &str) -> Result<bool, String> {
    validate_ipv4(ip)?;
    let table = run_route(&["print".into(), "-4".into(), ip.into()])?;
    Ok(table_contains_ip(&table, ip))
}

fn parse_route_print(text: &str) -> Result<Vec<RouteRow>, String> {
    let mut rows = Vec::new();
    for line in text.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        // route print -4 的活动路由为 5 列：目标 / 掩码 / 网关 / 接口 / metric
        if cols.len() != 5 {
            continue;
        }
        let (target, mask, gateway, metric) = (cols[0], cols[1], cols[2], cols[4]);
        if validate_ipv4(target).is_err()
            || validate_mask(mask).is_err()
            || validate_ipv4(gateway).is_err()
        {
            continue;
        }
        if let Ok(metric) = metric.parse::<u32>() {
            rows.push(RouteRow {
                target: target.into(),
                mask: mask.into(),
                gateway: gateway.into(),
                metric,
            });
        }
    }
    Ok(rows)
}

fn table_contains_ip(table: &str, ip: &str) -> bool {
    table
        .lines()
        .any(|row| row.split_whitespace().any(|token| token == ip))
}
//! Windows 系统操作的参数校验与固定模板执行。
//!
//! 安全边界：前端不再直接持有 powershell / route / taskkill 权限；
//! 所有系统参数在进入命令前必须经过本模块校验。

pub mod adapter;
pub mod process;
pub mod route;

pub fn validate_pid(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("invalid pid".into());
    }
    Ok(())
}

pub fn validate_ipv4(value: &str) -> Result<(), String> {
    let parts: Vec<&str> = value.split('.').collect();
    if parts.len() != 4 {
        return Err(format!("invalid ipv4: {value}"));
    }
    for part in parts {
        if part.is_empty() || part.len() > 3 || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(format!("invalid ipv4: {value}"));
        }
        if part.len() > 1 && part.starts_with('0') {
            return Err(format!("invalid ipv4: {value}"));
        }
        if part
            .parse::<u16>()
            .map_err(|_| format!("invalid ipv4: {value}"))?
            > 255
        {
            return Err(format!("invalid ipv4: {value}"));
        }
    }
    Ok(())
}

fn mask_bits(mask: &str) -> Result<u32, String> {
    validate_ipv4(mask)?;
    let value = mask.split('.').fold(0u32, |acc, part| {
        (acc << 8) | part.parse::<u32>().unwrap_or_default()
    });
    // 0.0.0.0 是默认路由的合法掩码；只需保证高位连续
    let inverted = !value;
    if inverted & inverted.wrapping_add(1) != 0 {
        return Err(format!("invalid mask: {mask}"));
    }
    Ok(value.count_ones())
}

pub fn validate_mask(value: &str) -> Result<(), String> {
    mask_bits(value).map(|_| ())
}

pub fn validate_adapter_name(value: &str) -> Result<(), String> {
    if value.trim().is_empty()
        || value.len() > 256
        || value
            .chars()
            .any(|c| c == '"' || c == '`' || c == '\n' || c == '\r' || c == '\0')
    {
        return Err("invalid adapter name".into());
    }
    Ok(())
}

pub fn validate_config_name(value: &str) -> Result<(), String> {
    const WINDOWS_INVALID: &[char] = &['<', '>', ':', '"', '|', '?', '*'];
    if value.is_empty()
        || value.len() > 200
        || value != value.trim()
        || value.contains('/')
        || value.contains('\\')
        || value.contains("..")
        || value.chars().any(|c| {
            c == '\0' || c == '\n' || c == '\r' || WINDOWS_INVALID.contains(&c)
        })
    {
        return Err("invalid config name".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_pid_and_accepts_positive() {
        assert!(validate_pid(0).is_err());
        assert!(validate_pid(4321).is_ok());
    }

    #[test]
    fn validates_ipv4_and_mask() {
        assert!(validate_ipv4("10.0.0.0").is_ok());
        assert!(validate_ipv4("256.0.0.1").is_err());
        assert!(validate_ipv4("10.0.0").is_err());
        assert!(validate_ipv4("01.0.0.1").is_err());
        assert!(validate_mask("255.255.255.0").is_ok());
        assert!(validate_mask("255.0.255.0").is_err());
        // 默认路由使用 0.0.0.0 掩码，必须放行
        assert!(validate_mask("0.0.0.0").is_ok());
    }

    #[test]
    fn rejects_dangerous_adapter_and_config_names() {
        assert!(validate_adapter_name("以太网").is_ok());
        assert!(validate_adapter_name("以太网\" -Command calc").is_err());
        assert!(validate_adapter_name("").is_err());
        assert!(validate_config_name("家庭").is_ok());
        assert!(validate_config_name("../evil").is_err());
        assert!(validate_config_name("a/b").is_err());
        assert!(validate_config_name("a\\b").is_err());
    }
}
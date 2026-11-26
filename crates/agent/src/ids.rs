use crate::error::ApiError;

/// Config id rules, mirroring `frontend/src/shared/lib/configNameUtil.ts`:
/// letters/digits of any script (so CJK names work), plus space, `.`, `_`, `-`;
/// no leading symbol, no `..`, at most 64 chars, and no Windows device name.
///
/// The id becomes `<id>.toml` in the config directory and `core/<id>/` under the
/// logs root, so the same rules must hold on both sides of the API.
pub fn validate_config_id(id: &str) -> Result<(), ApiError> {
    // Count characters, not bytes: a 64-char CJK name is 192 bytes in UTF-8.
    if id.is_empty() || id.chars().count() > 64 || id.contains("..") || id.starts_with('.') {
        return Err(ApiError::InvalidId);
    }
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return Err(ApiError::InvalidId);
    };
    if !first.is_alphanumeric() {
        return Err(ApiError::InvalidId);
    }
    // Rejects every separator, control char and shell/path special in one go.
    if !chars.all(|c| c.is_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-')) {
        return Err(ApiError::InvalidId);
    }
    // Windows reserved device names: case-insensitive, still reserved with an
    // extension (`con.toml`, `LPT9.backup`).
    let lowered = id.to_lowercase();
    let stem = lowered.split('.').next().unwrap_or_default();
    if matches!(stem, "con" | "prn" | "aux" | "nul") || is_numbered_device(stem) {
        return Err(ApiError::InvalidId);
    }
    Ok(())
}

/// `com1..com9` / `lpt1..lpt9`; `com10` and `console` are ordinary names.
fn is_numbered_device(stem: &str) -> bool {
    let bytes = stem.as_bytes();
    bytes.len() == 4
        && (stem.starts_with("com") || stem.starts_with("lpt"))
        && matches!(bytes[3], b'1'..=b'9')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_expected_ids() {
        for id in [
            "home",
            "office-1",
            "a_b.c",
            "A1",
            // 与前端 configNameUtil 对齐：Unicode、空格与点号都合法
            "家庭局域网",
            "办公室 组网_2",
            "测试节点.v1-beta",
            "a b",
            "console",
            "COM10",
        ] {
            assert!(validate_config_id(id).is_ok(), "{id}");
        }
    }

    #[test]
    fn rejects_traversal_and_specials() {
        let long = "a".repeat(65);
        for id in [
            "",
            "..",
            "a/b",
            "a\\b",
            ".hidden",
            "-leading",
            "_leading",
            "节点/子目录",
            "节点\u{0}名称",
            "CON",
            "con.toml",
            "COM1",
            "LPT9.backup",
            long.as_str(),
        ] {
            assert!(validate_config_id(id).is_err(), "{id}");
        }
    }

    #[test]
    fn counts_characters_not_bytes() {
        // 64 个汉字 = 192 字节：按字节判长会误拒，按字符判长必须通过
        let cjk = "家".repeat(64);
        assert!(validate_config_id(&cjk).is_ok());
        assert!(validate_config_id(&"家".repeat(65)).is_err());
    }
}

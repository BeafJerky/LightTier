use crate::error::ApiError;

pub fn validate_config_id(id: &str) -> Result<(), ApiError> {
    if id.is_empty() || id.len() > 64 || id.contains("..") || id.starts_with('.') {
        return Err(ApiError::InvalidId);
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(ApiError::InvalidId);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_expected_ids() {
        for id in ["home", "office-1", "a_b.c", "A1"] {
            assert!(validate_config_id(id).is_ok(), "{id}");
        }
    }

    #[test]
    fn rejects_traversal_and_specials() {
        let long = "a".repeat(65);
        for id in ["", "..", "a/b", "a b", "中文", ".hidden", long.as_str()] {
            assert!(validate_config_id(id).is_err(), "{id}");
        }
    }
}

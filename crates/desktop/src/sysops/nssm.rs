//! NSSM 服务管理：只允许固定动词与参数白名单，禁止 `set Application` 等可执行路径改写。

use std::path::Path;

use super::exec::{is_core_path, is_under, resource_root, run_program, CommandResult};

const ALLOWED_SET_KEYS: &[&str] = &[
    "AppParameters",
    "AppDirectory",
    "AppExit",
    "Description",
    "DisplayName",
    "ObjectName",
    "Start",
    "Type",
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn dirs() -> (PathBuf, PathBuf) {
        let root = PathBuf::from("C:/res");
        (root.join("resource/core"), root)
    }

    #[test]
    fn allows_read_lifecycle_and_set_whitelist() {
        let (core, root) = dirs();
        assert!(validate_args(&args(["status", "easytier-测试"]), &core, &root).is_ok());
        assert!(
            validate_args(
                &args(["set", "easytier-测试", "AppParameters", "--config-file,a.toml"]),
                &core,
                &root
            )
            .is_ok()
        );
        assert!(validate_args(
            &args(["remove", "easytier-测试", "confirm"]),
            &core,
            &root
        )
        .is_ok());
    }

    #[test]
    fn rejects_application_override_and_bad_values() {
        let (core, root) = dirs();
        assert!(
            validate_args(
                &args(["set", "easytier-测试", "Application", "C:/evil.exe"]),
                &core,
                &root
            )
            .is_err()
        );
        assert!(
            validate_args(
                &args(["set", "easytier-测试", "Start", "SERVICE_BAD"]),
                &core,
                &root
            )
            .is_err()
        );
        assert!(validate_args(&args(["remove", "easytier-测试"]), &core, &root).is_err());
    }

    #[test]
    fn rejects_paths_outside_core_and_resource() {
        let (core, root) = dirs();
        assert!(validate_args(
            &args(["install", "easytier-测试", "C:/evil/easytier-core.exe"]),
            &core,
            &root
        )
        .is_err());
        assert!(validate_args(
            &args(["set", "easytier-测试", "AppDirectory", "C:/Windows"]),
            &core,
            &root
        )
        .is_err());
    }

    fn args<'a>(items: impl IntoIterator<Item = &'a str>) -> Vec<String> {
        items.into_iter().map(|item| item.to_string()).collect()
    }
}

pub fn run(app: &tauri::AppHandle, args: Vec<String>) -> Result<CommandResult, String> {
    let core = super::exec::core_dir(app)?;
    let root = resource_root(app)?;
    validate_args(&args, &core, &root)?;
    let nssm = root.join("resource").join("nssm.exe");
    run_program(&nssm, &args)
}

fn validate_args(args: &[String], core: &Path, root: &Path) -> Result<(), String> {
    let action = args.first().map(String::as_str).unwrap_or_default();
    match action {
        "status" | "start" | "stop" => {
            if args.len() != 2 {
                return Err(format!("nssm {action} 参数数量不正确"));
            }
            validate_service_name(&args[1])
        }
        "remove" => {
            if args.len() != 3 || args[2] != "confirm" {
                return Err("nssm remove 需要 confirm".into());
            }
            validate_service_name(&args[1])
        }
        "install" => {
            if args.len() != 3 {
                return Err("nssm install 参数数量不正确".into());
            }
            validate_service_name(&args[1])?;
            if !is_core_path(Path::new(&args[2]), core) {
                return Err("nssm install 只允许 resource/core 下的内核程序".into());
            }
            Ok(())
        }
        "set" => {
            if args.len() < 4 {
                return Err("nssm set 参数数量不正确".into());
            }
            validate_service_name(&args[1])?;
            let key = args[2].as_str();
            if !ALLOWED_SET_KEYS.contains(&key) {
                return Err(format!("nssm set 不允许修改 {key}"));
            }
            let values = &args[3..];
            match key {
                "AppParameters" | "Description" | "DisplayName" => {
                    single_value(values, key)?;
                    Ok(())
                }
                "AppDirectory" => {
                    let value = single_value(values, key)?;
                    if !is_under(Path::new(value), root) {
                        return Err("AppDirectory 必须位于应用资源目录内".into());
                    }
                    Ok(())
                }
                "AppExit" => {
                    if values == ["Default", "Restart"] {
                        Ok(())
                    } else {
                        Err("AppExit 只允许 Default Restart".into())
                    }
                }
                "ObjectName" => {
                    if values.len() == 1 && values[0] == "LocalSystem" {
                        return Ok(());
                    }
                    if values.len() == 2 && values[0].starts_with(".\\") {
                        return Ok(());
                    }
                    Err("ObjectName 只允许 LocalSystem 或 .\\user password".into())
                }
                "Start" => {
                    if values.len() == 1
                        && (values[0] == "SERVICE_AUTO_START"
                            || values[0] == "SERVICE_DEMAND_START")
                    {
                        Ok(())
                    } else {
                        Err("Start 只允许 SERVICE_AUTO_START / SERVICE_DEMAND_START".into())
                    }
                }
                "Type" => {
                    if values.len() == 1 && values[0] == "SERVICE_WIN32_OWN_PROCESS" {
                        Ok(())
                    } else {
                        Err("Type 只允许 SERVICE_WIN32_OWN_PROCESS".into())
                    }
                }
                _ => Err(format!("nssm set 不允许修改 {key}")),
            }
        }
        _ => Err(format!("nssm 不允许的动词: {action}")),
    }
}

fn single_value<'a>(values: &'a [String], key: &str) -> Result<&'a str, String> {
    if values.len() != 1 || values[0].is_empty() || values[0].len() > 8192 {
        return Err(format!("{key} 需要单个非空值"));
    }
    if values[0].chars().any(|ch| ch == '\0' || ch == '\n' || ch == '\r') {
        return Err(format!("{key} 含有非法字符"));
    }
    Ok(&values[0])
}

fn validate_service_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 200
        || name.chars().any(|ch| {
            ch == '\0' || ch == '\n' || ch == '\r' || ch == '"' || ch == '/' || ch == '\\'
        })
    {
        return Err("非法的服务名".into());
    }
    Ok(())
}
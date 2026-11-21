//! easytier-cli 受控执行：只允许版本探测、node/peer 查询与 service 子命令白名单。

use std::path::Path;

use super::exec::{core_dir, is_core_path, is_under, resource_root, run_program, CommandResult};
use super::validate_ipv4;

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn dirs() -> (PathBuf, PathBuf) {
        let root = PathBuf::from("C:/res");
        (root.join("resource/core"), root)
    }

    fn args<'a>(items: impl IntoIterator<Item = &'a str>) -> Vec<String> {
        items.into_iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn allows_version_and_query() {
        let (core, root) = dirs();
        assert!(validate_args(&args(["-V"]), &core, &root).is_ok());
        assert!(validate_args(
            &args(["-p", "127.0.0.1:15888", "--output", "json", "peer"]),
            &core,
            &root
        )
        .is_ok());
        assert!(validate_args(
            &args(["-p", "127.0.0.1:15888", "--output", "json", "routes"]),
            &core,
            &root
        )
        .is_err());
    }

    #[test]
    fn rejects_bad_portal() {
        let (core, root) = dirs();
        assert!(validate_args(
            &args(["-p", "127.0.0.1;calc", "--output", "json", "node"]),
            &core,
            &root
        )
        .is_err());
        assert!(validate_args(
            &args(["-p", "127.0.0.1:99999", "--output", "json", "node"]),
            &core,
            &root
        )
        .is_err());
    }

    #[test]
    fn allows_service_lifecycle_without_extras() {
        let (core, root) = dirs();
        assert!(validate_args(
            &args(["service", "-n", "easytier-a", "status"]),
            &core,
            &root
        )
        .is_ok());
        assert!(validate_args(
            &args(["service", "status"]),
            &core,
            &root
        )
        .is_ok());
        assert!(validate_args(
            &args(["service", "-n", "easytier-a", "status", "extra"]),
            &core,
            &root
        )
        .is_err());
    }

    #[test]
    fn service_install_validates_core_path_and_options() {
        let (core, root) = dirs();
        let ok = args([
            "service",
            "-n",
            "easytier-a",
            "install",
            "--description",
            "desc",
            "--disable-autostart",
            "true",
            "--core-path",
            "C:/res/resource/core/easytier-core.exe",
            "--service-work-dir",
            "C:/res/resource",
            "--core-args",
            "--config-file",
            "C:/res/resource/config/a.toml",
        ]);
        assert!(validate_args(&ok, &core, &root).is_ok());

        let bad_core = args([
            "service",
            "-n",
            "easytier-a",
            "install",
            "--core-path",
            "C:/evil/easytier-core.exe",
            "--service-work-dir",
            "C:/res/resource",
            "--core-args",
            "--config-file",
            "C:/res/resource/config/a.toml",
        ]);
        assert!(validate_args(&bad_core, &core, &root).is_err());

        let bad_workdir = args([
            "service",
            "-n",
            "easytier-a",
            "install",
            "--core-path",
            "C:/res/resource/core/easytier-core.exe",
            "--service-work-dir",
            "C:/Windows",
            "--core-args",
            "--config-file",
            "a.toml",
        ]);
        assert!(validate_args(&bad_workdir, &core, &root).is_err());
    }
}

pub fn run(app: &tauri::AppHandle, args: Vec<String>) -> Result<CommandResult, String> {
    let core = core_dir(app)?;
    let root = resource_root(app)?;
    validate_args(&args, &core, &root)?;
    let cli = core.join(if cfg!(windows) {
        "easytier-cli.exe"
    } else {
        "easytier-cli"
    });
    crate::kernel_manifest::verify_exe(&cli, crate::kernel_manifest::CoreFile::Cli)?;
    run_program(&cli, &args)
}

fn validate_args(args: &[String], core: &Path, root: &Path) -> Result<(), String> {
    if args.len() == 1 && args[0] == "-V" {
        return Ok(());
    }
    if args.len() == 5
        && args[0] == "-p"
        && args[2] == "--output"
        && args[3] == "json"
        && matches!(args[4].as_str(), "node" | "peer")
    {
        return validate_portal(&args[1]);
    }
    if args.first().map(String::as_str) == Some("service") {
        return validate_service(&args[1..], core, root);
    }
    Err("easytier-cli 不允许的参数组合".into())
}

fn validate_service(args: &[String], core: &Path, root: &Path) -> Result<(), String> {
    let mut index = 0;
    if args.get(index).map(String::as_str) == Some("-n") {
        let name = args.get(index + 1).ok_or("缺少服务名")?;
        validate_service_name(name)?;
        index += 2;
    }
    let action = args.get(index).map(String::as_str).ok_or("缺少服务动作")?;
    index += 1;
    match action {
        "status" | "start" | "stop" | "uninstall" => {
            if index != args.len() {
                return Err(format!("service {action} 不接受额外参数"));
            }
            Ok(())
        }
        "install" => validate_install(&args[index..], core, root),
        _ => Err(format!("service 不允许的动作: {action}")),
    }
}

fn validate_install(args: &[String], core: &Path, root: &Path) -> Result<(), String> {
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--description" | "--display-name" => {
                let value = args.get(index + 1).ok_or("缺少选项值")?;
                validate_text(value)?;
                index += 2;
            }
            "--disable-autostart" => {
                let value = args.get(index + 1).ok_or("缺少 --disable-autostart 值")?;
                if value != "true" && value != "false" {
                    return Err("--disable-autostart 只允许 true/false".into());
                }
                index += 2;
            }
            "--core-path" => {
                let value = args.get(index + 1).ok_or("缺少 --core-path")?;
                if !is_core_path(Path::new(value), core) {
                    return Err("--core-path 必须是 resource/core/easytier-core".into());
                }
                index += 2;
            }
            "--service-work-dir" => {
                let value = args.get(index + 1).ok_or("缺少 --service-work-dir")?;
                if !is_under(Path::new(value), root) {
                    return Err("--service-work-dir 必须位于应用资源目录".into());
                }
                index += 2;
            }
            "--core-args" | "--" => {
                validate_core_args(&args[index + 1..])?;
                return Ok(());
            }
            other => return Err(format!("service install 不允许的选项: {other}")),
        }
    }
    Err("service install 缺少 core 参数".into())
}

fn validate_core_args(args: &[String]) -> Result<(), String> {
    if args.is_empty() || args.len() > 200 {
        return Err("core 参数数量不正确".into());
    }
    for value in args {
        if value.len() > 4096 || value.contains('\0') {
            return Err("core 参数过长或含有非法字符".into());
        }
    }
    Ok(())
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

fn validate_text(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 2048
        || value.chars().any(|ch| ch == '\0' || ch == '\n' || ch == '\r')
    {
        return Err("非法的文本参数".into());
    }
    Ok(())
}

fn validate_portal(portal: &str) -> Result<(), String> {
    let (host, port) = portal.rsplit_once(':').ok_or("RPC 地址缺少端口")?;
    if host != "localhost" {
        validate_ipv4(host)?;
    }
    let port: u16 = port.parse().map_err(|_| "RPC 端口非法")?;
    if port == 0 {
        return Err("RPC 端口非法".into());
    }
    Ok(())
}
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
        assert!(validate_args(&args(["service", "status"]), &core, &root).is_ok());
        assert!(validate_args(
            &args(["service", "-n", "easytier-a", "status", "extra"]),
            &core,
            &root
        )
        .is_err());
    }

    #[test]
    fn official_cli_start_requires_an_explicit_nssm_service_name() {
        let (core, root) = dirs();
        assert!(validate_args(
            &args(["service", "-n", "easytier-a", "start"]),
            &core,
            &root
        )
        .is_ok());
        let error = validate_args(&args(["service", "start"]), &core, &root).unwrap_err();
        assert!(error.contains("NSSM"), "{error}");
    }

    #[test]
    fn service_core_path_skips_option_values_and_core_args() {
        let core = "C:/res/resource/core/easytier-core.exe";
        let args = args([
            "service",
            "-n",
            "easytier-a",
            "install",
            "--description",
            "--core-path",
            "--disable-autostart",
            "true",
            "--core-path",
            core,
            "--service-work-dir",
            "C:/res/resource",
            "--core-args",
            "--core-path",
            "C:/evil.exe",
        ]);
        assert_eq!(service_core_path(&args), Some(Path::new(core)));
    }

    #[test]
    fn builds_post_install_reconfiguration_in_safe_order() {
        let install = args([
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
            "C:\\Program Files\\LightTier\\config\\a.toml",
            "--name",
            "node \"quoted\"",
        ]);
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        assert_eq!(
            reconfigure_steps(&install, launcher).unwrap(),
            vec![
                args([
                    "set",
                    "easytier-a",
                    "Application",
                    "C:/Program Files/LightTier/lighttier.exe"
                ]),
                args([
                    "set",
                    "easytier-a",
                    "AppParameters",
                    "--lighttier-service-core --config-file \"C:\\Program Files\\LightTier\\config\\a.toml\" --name \"node \\\"quoted\\\"\""
                ]),
                args(["set", "easytier-a", "AppDirectory", "C:/res/resource"]),
            ]
        );
    }

    #[test]
    fn reconfiguration_rejects_non_install_or_incomplete_arguments() {
        assert!(reconfigure_steps(
            &args(["service", "-n", "easytier-a", "status"]),
            Path::new("C:/LightTier/lighttier.exe")
        )
        .is_err());
        assert!(reconfigure_steps(
            &args([
                "service",
                "-n",
                "easytier-a",
                "install",
                "--disable-autostart",
                "true",
                "--core-args",
                "--config-file",
                "a.toml",
            ]),
            Path::new("C:/LightTier/lighttier.exe")
        )
        .is_err());
    }

    #[test]
    fn service_install_requires_explicitly_disabled_autostart() {
        let (core, root) = dirs();
        let mut install = args([
            "service",
            "-n",
            "easytier-a",
            "install",
            "--core-path",
            "C:/res/resource/core/easytier-core.exe",
            "--service-work-dir",
            "C:/res/resource",
            "--core-args",
            "--config-file",
            "C:/res/resource/config/a.toml",
        ]);
        assert!(validate_args(&install, &core, &root).is_err());

        install.splice(4..4, ["--disable-autostart".into(), "false".into()]);
        assert!(validate_args(&install, &core, &root).is_err());

        install[5] = "true".into();
        assert!(
            validate_args(&install, &core, &root).is_ok(),
            "{:?}",
            validate_args(&install, &core, &root)
        );
    }

    #[test]
    fn reconfiguration_fails_closed_and_stops_at_the_first_failure() {
        let steps = vec![
            args(["set", "easytier-a", "Application", "launcher.exe"]),
            args(["set", "easytier-a", "AppParameters", "parameters"]),
            args(["set", "easytier-a", "AppDirectory", "C:/res/resource"]),
        ];
        for failure_code in [Some(7), None] {
            let mut called = Vec::new();
            let error = run_reconfiguration(&steps, |step| {
                called.push(step.to_vec());
                Ok(CommandResult {
                    code: failure_code,
                    stdout: String::new(),
                    stderr: "rejected".into(),
                })
            })
            .unwrap_err();
            assert!(error.contains("SCM"), "{error}");
            assert_eq!(called, steps[..1]);
        }

        let mut called = Vec::new();
        let error = run_reconfiguration(&steps, |step| {
            called.push(step.to_vec());
            if called.len() == 2 {
                Err("spawn failed".into())
            } else {
                Ok(CommandResult {
                    code: Some(0),
                    stdout: String::new(),
                    stderr: String::new(),
                })
            }
        })
        .unwrap_err();
        assert!(error.contains("spawn failed"), "{error}");
        assert_eq!(called, steps[..2]);
    }

    #[test]
    fn reconfiguration_failure_identifies_residual_service_and_recovery() {
        let steps = vec![args(["set", "easytier-a", "Application", "launcher.exe"])];
        let error = run_reconfiguration(&steps, |_| {
            Ok(CommandResult {
                code: Some(5),
                stdout: String::new(),
                stderr: "denied".into(),
            })
        })
        .unwrap_err();
        assert!(error.contains("easytier-a"), "{error}");
        assert!(error.contains("services.msc"), "{error}");
    }

    #[test]
    fn install_reconfiguration_restores_existing_service_snapshot_on_failure() {
        let steps = vec![
            args(["set", "easytier-a", "Application", "new-launcher.exe"]),
            args([
                "set",
                "easytier-a",
                "AppParameters",
                "--lighttier-service-core --new",
            ]),
            args(["set", "easytier-a", "AppDirectory", "C:/new"]),
        ];
        let snapshot = ServiceSnapshot::Existing(vec![
            ("Application".into(), "C:/old/core.exe".into()),
            ("AppParameters".into(), "--config-file old.toml  ".into()),
            ("AppDirectory".into(), "C:/old".into()),
        ]);
        let state = std::cell::RefCell::new(std::collections::HashMap::from([
            ("Application".to_string(), "C:/old/core.exe".to_string()),
            (
                "AppParameters".to_string(),
                "--config-file old.toml  ".to_string(),
            ),
            ("AppDirectory".to_string(), "C:/old".to_string()),
        ]));
        let mut forward_calls = 0;
        let error = run_install_reconfiguration(
            &steps,
            &snapshot,
            |step| {
                forward_calls += 1;
                if forward_calls == 2 {
                    Ok(CommandResult {
                        code: Some(5),
                        stdout: String::new(),
                        stderr: "denied".into(),
                    })
                } else {
                    state.borrow_mut().insert(step[2].clone(), step[3].clone());
                    Ok(CommandResult {
                        code: Some(0),
                        stdout: String::new(),
                        stderr: String::new(),
                    })
                }
            },
            |step| {
                state.borrow_mut().insert(step[2].clone(), step[3].clone());
                Ok(CommandResult {
                    code: Some(0),
                    stdout: String::new(),
                    stderr: String::new(),
                })
            },
            |key| {
                Ok(CommandResult {
                    code: Some(0),
                    stdout: state.borrow().get(key).cloned().unwrap_or_default(),
                    stderr: String::new(),
                })
            },
        )
        .unwrap_err();
        assert!(error.contains("已恢复重配置前快照"), "{error}");
        assert_eq!(state.borrow()["Application"], "C:/old/core.exe");
        assert_eq!(state.borrow()["AppParameters"], "--config-file old.toml  ");
        assert_eq!(state.borrow()["AppDirectory"], "C:/old");
    }

    #[test]
    fn install_reconfiguration_removes_new_service_after_failure() {
        let steps = vec![args(["set", "easytier-a", "Application", "launcher.exe"])];
        let exists = std::cell::Cell::new(true);
        let error = run_install_reconfiguration(
            &steps,
            &ServiceSnapshot::Missing,
            |_| {
                Ok(CommandResult {
                    code: Some(5),
                    stdout: String::new(),
                    stderr: "denied".into(),
                })
            },
            |step| {
                if step[0] == "remove" {
                    exists.set(false);
                }
                Ok(CommandResult {
                    code: Some(0),
                    stdout: String::new(),
                    stderr: String::new(),
                })
            },
            |_| {
                Ok(CommandResult {
                    code: if exists.get() { Some(0) } else { Some(3) },
                    stdout: if exists.get() {
                        "launcher.exe".into()
                    } else {
                        String::new()
                    },
                    stderr: String::new(),
                })
            },
        )
        .unwrap_err();
        assert!(!exists.get());
        assert!(error.contains("已删除新建服务"), "{error}");
    }

    #[test]
    fn install_reconfiguration_reports_residual_service_when_restore_fails() {
        let steps = vec![args(["set", "easytier-a", "Application", "launcher.exe"])];
        let snapshot = ServiceSnapshot::Existing(vec![
            ("Application".into(), "C:/old/core.exe".into()),
            ("AppParameters".into(), String::new()),
            ("AppDirectory".into(), "C:/old".into()),
        ]);
        let error = run_install_reconfiguration(
            &steps,
            &snapshot,
            |_| {
                Ok(CommandResult {
                    code: Some(5),
                    stdout: String::new(),
                    stderr: "denied".into(),
                })
            },
            |_| Err("restore denied".into()),
            |_| {
                Ok(CommandResult {
                    code: Some(0),
                    stdout: "launcher.exe".into(),
                    stderr: String::new(),
                })
            },
        )
        .unwrap_err();
        assert!(error.contains("easytier-a"), "{error}");
        assert!(error.contains("可能残留"), "{error}");
        assert!(error.contains("services.msc"), "{error}");
        assert!(error.contains("restore denied"), "{error}");
    }

    #[test]
    fn service_snapshot_distinguishes_missing_from_unreadable_and_keeps_empty_parameters() {
        let values = std::collections::HashMap::from([
            ("Application".to_string(), "C:/old/core.exe".to_string()),
            ("AppParameters".to_string(), String::new()),
            ("AppDirectory".to_string(), "C:/old".to_string()),
        ]);
        let snapshot = capture_service_snapshot("easytier-a", |key| {
            Ok(CommandResult {
                code: Some(0),
                stdout: values.get(key).cloned().unwrap_or_default(),
                stderr: String::new(),
            })
        })
        .unwrap();
        assert_eq!(
            snapshot,
            ServiceSnapshot::Existing(vec![
                ("Application".into(), "C:/old/core.exe".into()),
                ("AppParameters".into(), String::new()),
                ("AppDirectory".into(), "C:/old".into()),
            ])
        );
        assert_eq!(
            capture_service_snapshot("easytier-a", |_| Ok(CommandResult {
                code: Some(3),
                stdout: String::new(),
                stderr: "Can not open service".into(),
            }))
            .unwrap(),
            ServiceSnapshot::Missing
        );
        assert!(
            capture_service_snapshot("easytier-a", |_| Ok(CommandResult {
                code: Some(5),
                stdout: String::new(),
                stderr: "access denied".into(),
            }))
            .is_err()
        );
    }

    #[test]
    fn reconfiguration_succeeds_only_after_every_step_returns_zero() {
        let steps = vec![args([
            "set",
            "easytier-a",
            "AppDirectory",
            "C:/res/resource",
        ])];
        assert!(run_reconfiguration(&steps, |_| {
            Ok(CommandResult {
                code: Some(0),
                stdout: String::new(),
                stderr: String::new(),
            })
        })
        .is_ok());
    }

    #[test]
    fn install_requires_a_name_core_path_and_workdir_before_cli_execution() {
        let (core, root) = dirs();
        let complete = args([
            "service",
            "-n",
            "easytier-a",
            "install",
            "--disable-autostart",
            "true",
            "--core-path",
            "C:/res/resource/core/easytier-core.exe",
            "--service-work-dir",
            "C:/res/resource",
            "--core-args",
            "--config-file",
            "a.toml",
        ]);
        assert!(
            validate_args(&complete, &core, &root).is_ok(),
            "{:?}",
            validate_args(&complete, &core, &root)
        );

        let mut unnamed = complete.clone();
        unnamed.drain(1..3);
        assert!(validate_args(&unnamed, &core, &root).is_err());

        for missing in ["--core-path", "--service-work-dir"] {
            let mut install = complete.clone();
            let option_index = install.iter().position(|value| value == missing).unwrap();
            install.drain(option_index..option_index + 2);
            assert!(validate_args(&install, &core, &root).is_err());
        }
    }

    #[test]
    fn quotes_windows_arguments_without_losing_quotes_or_backslashes() {
        assert_eq!(quote_windows_arg("plain"), "plain");
        assert_eq!(quote_windows_arg(""), "\"\"");
        assert_eq!(quote_windows_arg("a b"), "\"a b\"");
        assert_eq!(
            quote_windows_arg("node \"quoted\""),
            "\"node \\\"quoted\\\"\""
        );
        assert_eq!(
            quote_windows_arg("C:/dir with space\\"),
            "\"C:/dir with space\\\\\""
        );
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
        assert!(
            validate_args(&ok, &core, &root).is_ok(),
            "{:?}",
            validate_args(&ok, &core, &root)
        );

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
    if args.first().map(String::as_str) == Some("service")
        && args.get(1).map(String::as_str) == Some("-n")
        && args.get(3).map(String::as_str) == Some("start")
    {
        return super::nssm::run(app, vec!["start".into(), args[2].clone()]);
    }
    let cli = core.join(if cfg!(windows) {
        "easytier-cli.exe"
    } else {
        "easytier-cli"
    });
    let verified_cli = crate::kernel_manifest::open_verified_exe(
        &cli,
        crate::kernel_manifest::CoreFile::Cli,
        &core,
    )?;
    let verified_core = service_core_path(&args)
        .map(|path| {
            crate::kernel_manifest::open_verified_exe(
                path,
                crate::kernel_manifest::CoreFile::Core,
                &core,
            )
        })
        .transpose()?;
    // 必须在官方 CLI 安装前判定服务是否已存在，才能区分恢复旧服务与删除新建服务。
    let install_snapshot = parse_service_install(&args)
        .ok()
        .map(|install| {
            capture_service_snapshot(install.name, |key| {
                super::nssm::read_service_value(app, install.name, key)
            })
        })
        .transpose()?;
    let result = run_program(verified_cli.path(), &args);
    drop(verified_cli);

    // 官方 CLI 仅在 SCM 全部转换为安全启动器后返回成功；任一步失败都向调用方报错。
    if args.first().map(String::as_str) == Some("service")
        && result.as_ref().is_ok_and(|result| result.code == Some(0))
        && args.get(2).map(String::as_str) == Some("install")
    {
        let launcher = std::env::current_exe()
            .map_err(|error| format!("无法解析 LightTier 服务启动器: {error}"))?;
        let steps = reconfigure_steps(&args, &launcher)?;
        let snapshot = install_snapshot
            .as_ref()
            .ok_or("service install 缺少重配置前服务快照")?;
        let service_name = parse_service_install(&args)?.name;
        run_install_reconfiguration(
            &steps,
            snapshot,
            |step| super::nssm::run(app, step),
            |step| {
                if step.first().map(String::as_str) == Some("remove") {
                    super::nssm::run(app, step)
                } else {
                    super::nssm::restore_service_value(app, &step[1], &step[2], &step[3])
                }
            },
            |key| super::nssm::read_service_value(app, service_name, key),
        )?;
    }
    drop(verified_core);
    result
}

#[derive(Debug, PartialEq, Eq)]
enum ServiceSnapshot {
    Missing,
    Existing(Vec<(&'static str, String)>),
}

fn capture_service_snapshot(
    service_name: &str,
    mut read: impl FnMut(&str) -> Result<CommandResult, String>,
) -> Result<ServiceSnapshot, String> {
    validate_service_name(service_name)?;
    let application = read("Application")?;
    // 只有 NSSM 明确的服务不存在码才代表新建；权限/执行失败不能触发删除。
    if application.code == Some(3) {
        return Ok(ServiceSnapshot::Missing);
    }
    require_scm_success(&application, "get", "Application")?;
    let mut values = vec![(
        "Application",
        validate_snapshot_value("Application", &application.stdout)?,
    )];
    for key in ["AppParameters", "AppDirectory"] {
        let result = read(key)?;
        require_scm_success(&result, "get", key)?;
        values.push((key, validate_snapshot_value(key, &result.stdout)?));
    }
    Ok(ServiceSnapshot::Existing(values))
}

fn validate_snapshot_value(key: &str, value: &str) -> Result<String, String> {
    if value.len() > 8192
        || (key != "AppParameters" && value.is_empty())
        || value
            .chars()
            .any(|ch| ch == '\0' || ch == '\n' || ch == '\r')
    {
        return Err(format!("服务快照 {key} 值为空、过长或含有非法字符"));
    }
    Ok(value.to_string())
}

fn require_scm_success(result: &CommandResult, action: &str, key: &str) -> Result<(), String> {
    if result.code == Some(0) {
        return Ok(());
    }
    let diagnostic = [result.stderr.trim(), result.stdout.trim()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("; ");
    Err(format!(
        "SCM {action} {key} 失败（退出码 {:?}）: {diagnostic}",
        result.code
    ))
}

fn run_install_reconfiguration(
    steps: &[Vec<String>],
    snapshot: &ServiceSnapshot,
    mut run: impl FnMut(Vec<String>) -> Result<CommandResult, String>,
    mut restore: impl FnMut(Vec<String>) -> Result<CommandResult, String>,
    mut read: impl FnMut(&str) -> Result<CommandResult, String>,
) -> Result<(), String> {
    if let Err(error) = run_reconfiguration(steps, &mut run) {
        let service_name = steps
            .first()
            .and_then(|step| step.get(1))
            .map(String::as_str)
            .unwrap_or_default();
        let recovery = recover_service_snapshot(snapshot, service_name, &mut restore, &mut read)
            .map_err(|recovery_error| {
                format!(
                    "服务 {service_name} 可能残留，自动恢复失败: {recovery_error}；请通过 services.msc 检查并手动恢复 Application/AppParameters/AppDirectory，或删除该服务"
                )
            })?;
        return Err(format!("{error}; {recovery}"));
    }
    Ok(())
}

fn recover_service_snapshot(
    snapshot: &ServiceSnapshot,
    service_name: &str,
    restore: &mut impl FnMut(Vec<String>) -> Result<CommandResult, String>,
    read: &mut impl FnMut(&str) -> Result<CommandResult, String>,
) -> Result<String, String> {
    match snapshot {
        ServiceSnapshot::Missing => {
            let removed = restore(vec!["remove".into(), service_name.into(), "confirm".into()])?;
            require_scm_success(&removed, "remove", service_name)?;
            let check = read("Application")?;
            if check.code == Some(3) {
                Ok("已删除新建服务".into())
            } else {
                Err("删除后仍能读取新建服务".into())
            }
        }
        ServiceSnapshot::Existing(values) => {
            for (key, value) in values.iter().rev() {
                let result = restore(vec![
                    "set".into(),
                    service_name.into(),
                    (*key).into(),
                    value.clone(),
                ])?;
                require_scm_success(&result, "restore", key)?;
            }
            for (key, value) in values {
                let current = read(key)?;
                require_scm_success(&current, "verify", key)?;
                if current.stdout != *value {
                    return Err(format!("恢复后 {key} 与快照不一致"));
                }
            }
            Ok("已恢复重配置前快照".into())
        }
    }
}

fn run_reconfiguration(
    steps: &[Vec<String>],
    mut run: impl FnMut(Vec<String>) -> Result<CommandResult, String>,
) -> Result<(), String> {
    let service_name = steps
        .first()
        .and_then(|step| step.get(1))
        .map(String::as_str)
        .unwrap_or_default();
    let residual = format!("；服务 {service_name} 可能残留，请通过 services.msc 检查并恢复或删除");
    for step in steps {
        let key = step.get(2).cloned().unwrap_or_default();
        let result = run(step.clone())
            .map_err(|error| format!("SCM 重配置 {key} 失败: {error}{residual}"))?;
        if result.code != Some(0) {
            let diagnostic = [result.stderr.trim(), result.stdout.trim()]
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("; ");
            return Err(format!(
                "SCM 重配置 {key} 失败（退出码 {:?}）: {diagnostic}{residual}",
                result.code
            ));
        }
    }
    Ok(())
}

struct ServiceInstall<'a> {
    name: &'a str,
    core_path: &'a str,
    work_dir: &'a str,
    core_args: &'a [String],
}

fn parse_service_install(args: &[String]) -> Result<ServiceInstall<'_>, String> {
    if args.first().map(String::as_str) != Some("service") {
        return Err("不是 service 安装命令".into());
    }
    let mut index = 1;
    let mut name = None;
    if args.get(index).map(String::as_str) == Some("-n") {
        name = Some(args.get(index + 1).ok_or("缺少服务名")?.as_str());
        validate_service_name(name.unwrap())?;
        index += 2;
    }
    // 未具名的历史服务可以继续 status/stop/uninstall，但新安装必须明确重配置目标。
    if args.get(index).map(String::as_str) != Some("install") {
        return Err("不是 service install 命令".into());
    }
    let name = name.ok_or("service install 必须显式指定 -n 服务名")?;
    index += 1;

    let mut seen = std::collections::HashSet::new();
    let mut core_path = None;
    let mut work_dir = None;
    let mut disable_autostart = None;
    let mut core_args = None;
    while index < args.len() {
        let option = args[index].as_str();
        if !seen.insert(option) {
            return Err(format!("service install 重复选项: {option}"));
        }
        match option {
            "--core-args" | "--" => {
                core_args = Some(&args[index + 1..]);
                break;
            }
            "--description"
            | "--display-name"
            | "--disable-autostart"
            | "--core-path"
            | "--service-work-dir" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| format!("缺少 {option} 值"))?;
                match option {
                    "--description" | "--display-name" => validate_text(value)?,
                    "--core-path" | "--service-work-dir" => validate_text(value)?,
                    "--disable-autostart" => disable_autostart = Some(value.as_str()),
                    _ => unreachable!(),
                }
                if option == "--core-path" {
                    core_path = Some(value.as_str());
                } else if option == "--service-work-dir" {
                    work_dir = Some(value.as_str());
                }
                index += 2;
            }
            other => return Err(format!("service install 不允许的选项: {other}")),
        }
    }
    if disable_autostart != Some("true") {
        return Err("service install 必须显式传 --disable-autostart true".into());
    }
    let core_args = core_args.ok_or("service install 缺少 core 参数")?;
    validate_core_args(core_args)?;
    Ok(ServiceInstall {
        name,
        core_path: core_path.ok_or("service install 缺少 --core-path")?,
        work_dir: work_dir.ok_or("service install 缺少 --service-work-dir")?,
        core_args,
    })
}

fn service_core_path(args: &[String]) -> Option<&Path> {
    parse_service_install(args)
        .ok()
        .map(|install| Path::new(install.core_path))
}

fn reconfigure_steps(args: &[String], launcher: &Path) -> Result<Vec<Vec<String>>, String> {
    let install = parse_service_install(args)?;
    let parameters = std::iter::once(crate::service_launcher::SERVICE_CORE_ARG.to_string())
        .chain(install.core_args.iter().cloned())
        .collect::<Vec<_>>();
    let serialized = serialized_service_parameters(&parameters)?;
    Ok(vec![
        vec![
            "set".into(),
            install.name.into(),
            "Application".into(),
            launcher.to_string_lossy().into_owned(),
        ],
        vec![
            "set".into(),
            install.name.into(),
            "AppParameters".into(),
            serialized,
        ],
        vec![
            "set".into(),
            install.name.into(),
            "AppDirectory".into(),
            install.work_dir.into(),
        ],
    ])
}

fn serialized_service_parameters(args: &[String]) -> Result<String, String> {
    let value = args
        .iter()
        .map(|arg| quote_windows_arg(arg))
        .collect::<Vec<_>>()
        .join(" ");
    if value.len() > 8192 {
        return Err("服务内核参数序列化后过长".into());
    }
    Ok(value)
}

/// 按 Windows CommandLineToArgvW / CRT 规则引用参数，保留引号与末尾反斜杠。
fn quote_windows_arg(value: &str) -> String {
    if !value.is_empty() && !value.chars().any(|ch| ch.is_whitespace() || ch == '"') {
        return value.to_string();
    }
    let mut quoted = String::from("\"");
    let mut backslashes = 0usize;
    for ch in value.chars() {
        if ch == '\\' {
            backslashes += 1;
            continue;
        }
        if ch == '"' {
            for _ in 0..backslashes * 2 + 1 {
                quoted.push('\\');
            }
            quoted.push('"');
        } else {
            for _ in 0..backslashes {
                quoted.push('\\');
            }
            quoted.push(ch);
        }
        backslashes = 0;
    }
    for _ in 0..backslashes * 2 {
        quoted.push('\\');
    }
    quoted.push('"');
    quoted
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
        return validate_service(args, core, root);
    }
    Err("easytier-cli 不允许的参数组合".into())
}

fn validate_service(args: &[String], core: &Path, root: &Path) -> Result<(), String> {
    if args.first().map(String::as_str) != Some("service") {
        return Err("不是 service 命令".into());
    }
    let mut index = 1;
    if args.get(index).map(String::as_str) == Some("-n") {
        let name = args.get(index + 1).ok_or("缺少服务名")?;
        validate_service_name(name)?;
        index += 2;
    }
    let action = args.get(index).map(String::as_str).ok_or("缺少服务动作")?;
    index += 1;
    match action {
        "status" | "stop" | "uninstall" => {
            if index != args.len() {
                return Err(format!("service {action} 不接受额外参数"));
            }
            Ok(())
        }
        "start" => {
            if args.get(1).map(String::as_str) != Some("-n") {
                return Err("官方 CLI 默认服务无法定位具名 NSSM 服务，拒绝启动".into());
            }
            if index != args.len() {
                return Err("service start 不接受额外参数".into());
            }
            Ok(())
        }
        "install" => {
            let install = parse_service_install(args)?;
            if !is_core_path(Path::new(install.core_path), core) {
                return Err("--core-path 必须是直属 resource/core/easytier-core".into());
            }
            if !is_under(Path::new(install.work_dir), root) {
                return Err("--service-work-dir 必须位于应用资源目录".into());
            }
            let mut parameters = vec![crate::service_launcher::SERVICE_CORE_ARG.to_string()];
            parameters.extend_from_slice(install.core_args);
            serialized_service_parameters(&parameters)?;
            Ok(())
        }
        _ => Err(format!("service 不允许的动作: {action}")),
    }
}

fn validate_core_args(args: &[String]) -> Result<(), String> {
    if args.is_empty() || args.len() > 200 {
        return Err("core 参数数量不正确".into());
    }
    for value in args {
        if value.len() > 4096
            || value
                .chars()
                .any(|ch| ch == '\0' || ch == '\n' || ch == '\r')
        {
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
        || value
            .chars()
            .any(|ch| ch == '\0' || ch == '\n' || ch == '\r')
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

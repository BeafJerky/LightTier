//! NSSM 服务管理：校验固定 NSSM 与内核，并把 SCM 可执行路径统一改写为 LightTier 安全入口。

use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use sha2::{Digest, Sha256};

use crate::service_launcher::SERVICE_CORE_ARG;

use super::exec::{
    is_core_path, is_under, normalize_path, resource_root, run_program, CommandResult,
};

const ALLOWED_SET_KEYS: &[&str] = &[
    "Application",
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
        assert!(validate_args(
            &args([
                "set",
                "easytier-测试",
                "AppParameters",
                "--config-file,a.toml"
            ]),
            &core,
            &root
        )
        .is_ok());
        assert!(validate_args(&args(["remove", "easytier-测试", "confirm"]), &core, &root).is_ok());
        assert!(
            validate_args(&args(["get", "easytier-测试", "Application"]), &core, &root).is_err()
        );
        assert!(validate_args(
            &args(["get", "easytier-测试", "AppParameters"]),
            &core,
            &root
        )
        .is_err());
    }

    #[test]
    fn allows_core_application_update_and_rejects_bad_values() {
        let (core, root) = dirs();
        assert!(validate_args(
            &args([
                "set",
                "easytier-测试",
                "Application",
                "C:/res/resource/core/easytier-core.exe"
            ]),
            &core,
            &root
        )
        .is_ok());
        assert!(validate_args(
            &args(["set", "easytier-测试", "Application", "C:/evil.exe"]),
            &core,
            &root
        )
        .is_err());
        assert!(validate_args(
            &args(["set", "easytier-测试", "Start", "SERVICE_BAD"]),
            &core,
            &root
        )
        .is_err());
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

    #[test]
    fn rewrites_core_application_intent_to_lighttier_launcher() {
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        let core = "C:/res/resource/core/easytier-core.exe";
        assert_eq!(
            rewrite_args(&args(["install", "easytier-测试", core]), launcher),
            args([
                "install",
                "easytier-测试",
                "C:/Program Files/LightTier/lighttier.exe"
            ])
        );
        assert_eq!(
            rewrite_args(
                &args(["set", "easytier-测试", "Application", core]),
                launcher
            ),
            args([
                "set",
                "easytier-测试",
                "Application",
                "C:/Program Files/LightTier/lighttier.exe"
            ])
        );
    }

    #[test]
    fn prefixes_service_parameters_idempotently_without_changing_core_args() {
        let launcher = Path::new("C:/LightTier/lighttier.exe");
        let core_args = "--config-file \"C:/res/a.toml\" --rpc-portal 127.0.0.1:15888";
        let expected = format!("--lighttier-service-core {core_args}");
        let input = args(["set", "easytier-a", "AppParameters", core_args]);
        let rewritten = rewrite_args(&input, launcher);
        assert_eq!(rewritten[3], expected);
        assert_eq!(rewrite_args(&rewritten, launcher), rewritten);
        assert_eq!(strip_service_prefix(&expected), Some(core_args));
        assert_eq!(strip_service_prefix(core_args), None);
        assert_eq!(
            strip_service_prefix("--lighttier-service-core-extra --x"),
            None
        );
        assert_eq!(strip_service_prefix("--lighttier-service-core"), Some(""));
    }

    #[test]
    fn service_prefix_uses_only_windows_ascii_separator_boundaries() {
        let flag = SERVICE_CORE_ARG;
        assert_eq!(strip_service_prefix(&format!("{flag} --x")), Some("--x"));
        assert_eq!(strip_service_prefix(&format!("{flag}\t--x")), Some("--x"));
        assert_eq!(strip_service_prefix(&format!("{flag} \t --x")), Some("--x"));
        for separator in ['\u{00a0}', '\u{2003}', '\u{2028}', '\u{000b}', '\u{000c}'] {
            let value = format!("{flag}{separator}--x");
            assert_eq!(
                strip_service_prefix(&value),
                None,
                "separator {separator:?}"
            );
        }
    }

    #[test]
    fn migration_repairs_unicode_separator_instead_of_opening_gui() {
        let core = Path::new("C:/res/resource/core");
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        for separator in ['\u{00a0}', '\u{2003}'] {
            let parameters = format!("{SERVICE_CORE_ARG}{separator}--config-file a.toml");
            let steps = build_launcher_migration(
                "easytier-a",
                "C:/Program Files/LightTier/lighttier.exe",
                &parameters,
                core,
                launcher,
            )
            .unwrap()
            .unwrap();
            assert_eq!(
                steps,
                vec![args([
                    "set",
                    "easytier-a",
                    "AppParameters",
                    &format!("{SERVICE_CORE_ARG} {parameters}"),
                ])]
            );
        }
    }

    #[test]
    fn launcher_dispatch_keeps_os_argv_token_semantics() {
        let flag = SERVICE_CORE_ARG.to_string();
        assert_eq!(
            crate::service_launcher::parse_service_args(&[
                format!("{flag}\u{00a0}--x"),
                "--y".into(),
            ]),
            None
        );
        assert_eq!(
            crate::service_launcher::parse_service_args(&[flag.clone(), "--x".into()]),
            Some(["--x".to_string()].as_slice())
        );
    }

    #[test]
    fn rewrite_preserves_unrelated_steps_and_order() {
        let input = args(["set", "easytier-a", "AppDirectory", "C:/res/resource"]);
        assert_eq!(
            rewrite_args(&input, Path::new("C:/LightTier/lighttier.exe")),
            input
        );
    }

    #[test]
    fn start_and_internal_launcher_updates_verify_the_fixed_current_core() {
        let (core, root) = dirs();
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        let (_, intent) =
            validated_core_intent(&args(["start", "easytier-a"]), &core, &root, launcher).unwrap();
        assert_eq!(intent, Some(core_executable(&core)));

        let (_, intent) = validated_core_intent(
            &args([
                "set",
                "easytier-a",
                "Application",
                "C:/Program Files/LightTier/lighttier.exe",
            ]),
            &core,
            &root,
            launcher,
        )
        .unwrap();
        assert_eq!(intent, Some(launcher.to_path_buf()));
        assert!(validated_core_intent(
            &args(["set", "easytier-a", "Application", "C:/evil.exe"]),
            &core,
            &root,
            launcher,
        )
        .is_err());
    }

    #[test]
    fn migrates_only_allowed_direct_core_application_before_start() {
        let core = Path::new("C:/res/resource/core");
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        let steps = build_launcher_migration(
            "easytier-a",
            "C:/res/resource/core/easytier-core.exe",
            "--config-file \"C:/res/a.toml\"",
            core,
            launcher,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            steps,
            vec![
                args([
                    "set",
                    "easytier-a",
                    "AppParameters",
                    "--lighttier-service-core --config-file \"C:/res/a.toml\""
                ]),
                args([
                    "set",
                    "easytier-a",
                    "Application",
                    "C:/Program Files/LightTier/lighttier.exe"
                ]),
            ]
        );
    }

    #[test]
    fn migration_accepts_quoted_application_and_never_duplicates_launcher_prefix() {
        let core = Path::new("C:/res/resource/core");
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        let parameters = "--lighttier-service-core --config-file a.toml";
        let steps = build_launcher_migration(
            "easytier-a",
            "\"C:/res/resource/core/easytier-core.exe\"",
            parameters,
            core,
            launcher,
        )
        .unwrap()
        .unwrap();
        assert_eq!(steps[0][3], parameters);
        assert_eq!(
            build_launcher_migration(
                "easytier-a",
                "\"C:/Program Files/LightTier/lighttier.exe\"",
                parameters,
                core,
                launcher,
            )
            .unwrap(),
            None
        );
    }

    #[test]
    fn migration_rejects_untrusted_or_malformed_get_output() {
        let core = Path::new("C:/res/resource/core");
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        for application in [
            "C:/evil/easytier-core.exe",
            "C:/res/resource/core/nested/easytier-core.exe",
            "C:/res/resource/core/../evil/easytier-core.exe",
            "C:/res/resource/core/easytier-core.exe/extra",
            "C:/res/resource/core/not-core.exe",
            "relative/easytier-core.exe",
            "\"C:/res/resource/core/easytier-core.exe\" trailing",
            "",
        ] {
            assert!(
                build_launcher_migration("easytier-a", application, "", core, launcher).is_err(),
                "unexpectedly accepted {application}"
            );
        }
        assert!(build_launcher_migration(
            "easytier-a",
            "C:/res/resource/core/easytier-core.exe",
            "--x\nstarted",
            core,
            launcher,
        )
        .is_err());
    }

    #[test]
    fn migration_allows_empty_parameters_but_rejects_oversized_output() {
        let core = Path::new("C:/res/resource/core");
        let launcher = Path::new("C:/LightTier/lighttier.exe");
        let steps = build_launcher_migration(
            "easytier-a",
            "C:/res/resource/core/easytier-core.exe",
            "",
            core,
            launcher,
        )
        .unwrap()
        .unwrap();
        assert_eq!(steps[0][3], SERVICE_CORE_ARG);
        assert!(build_launcher_migration(
            "easytier-a",
            "C:/res/resource/core/easytier-core.exe",
            &"x".repeat(8193),
            core,
            launcher,
        )
        .is_err());
    }

    #[test]
    fn start_migration_fails_closed_before_start_on_get_or_set_failure() {
        let core = Path::new("C:/res/resource/core");
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        let start = args(["start", "easytier-a"]);
        let application = "C:/res/resource/core/easytier-core.exe";

        for failure_index in 0..4 {
            for failure_code in [Some(5), None] {
                let mut called = Vec::new();
                let error = run_start_sequence(&start, core, launcher, |step| {
                    called.push(step.to_vec());
                    Ok(CommandResult {
                        code: if called.len() - 1 == failure_index {
                            failure_code
                        } else {
                            Some(0)
                        },
                        stdout: if step[0] == "get" && step[2] == "Application" {
                            application.into()
                        } else {
                            "--config-file a.toml".into()
                        },
                        stderr: "rejected".into(),
                    })
                })
                .unwrap_err();
                assert!(error.contains("SCM"), "{error}");
                assert_eq!(called.len(), [1, 2, 5, 8][failure_index]);
                assert!(called.iter().all(|step| step[0] != "start"));
            }
        }
    }

    #[test]
    fn start_migration_stops_before_start_when_nssm_spawn_fails() {
        let core = Path::new("C:/res/resource/core");
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        let start = args(["start", "easytier-a"]);
        for failure_index in 0..4 {
            let mut called = Vec::new();
            let error = run_start_sequence(&start, core, launcher, |step| {
                called.push(step.to_vec());
                if called.len() - 1 == failure_index {
                    Err("spawn failed".into())
                } else {
                    Ok(CommandResult {
                        code: Some(0),
                        stdout: if step.get(2).map(String::as_str) == Some("Application") {
                            "C:/res/resource/core/easytier-core.exe".into()
                        } else {
                            "--config-file a.toml".into()
                        },
                        stderr: String::new(),
                    })
                }
            })
            .unwrap_err();
            assert!(error.contains("spawn failed"), "{error}");
            assert_eq!(called.len(), [1, 2, 5, 8][failure_index]);
            assert!(called.iter().all(|step| step[0] != "start"));
        }
    }

    #[test]
    fn second_migration_set_failure_restores_attempted_keys_in_reverse_and_verifies() {
        let core = Path::new("C:/res/resource/core");
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        let original_application = "C:/res/resource/core/easytier-core.exe";
        let original_parameters = "--config-file a.toml  ";
        let mut values = [
            ("Application", original_application.to_string()),
            ("AppParameters", original_parameters.to_string()),
        ];
        let mut called = Vec::new();
        let error = run_start_sequence(&args(["start", "easytier-a"]), core, launcher, |step| {
            called.push(step.to_vec());
            let key = step[2].as_str();
            let index = values.iter().position(|(name, _)| *name == key).unwrap();
            match step[0].as_str() {
                "get" => Ok(CommandResult {
                    code: Some(0),
                    stdout: values[index].1.clone(),
                    stderr: String::new(),
                }),
                "set" => {
                    // 模拟失败写入也可能已改变 SCM 值，因此失败键也必须进入恢复。
                    values[index].1 = step[3].clone();
                    Ok(CommandResult {
                        code: Some(if step[3] == launcher.to_string_lossy() {
                            5
                        } else {
                            0
                        }),
                        stdout: String::new(),
                        stderr: "set rejected".into(),
                    })
                }
                _ => panic!("失败迁移不得调用 start"),
            }
        })
        .unwrap_err();

        assert!(
            error.contains("Application") && error.contains("SCM"),
            "{error}"
        );
        assert_eq!(
            called,
            vec![
                args(["get", "easytier-a", "Application"]),
                args(["get", "easytier-a", "AppParameters"]),
                args([
                    "set",
                    "easytier-a",
                    "AppParameters",
                    "--lighttier-service-core --config-file a.toml  ",
                ]),
                args([
                    "set",
                    "easytier-a",
                    "Application",
                    "C:/Program Files/LightTier/lighttier.exe",
                ]),
                args(["set", "easytier-a", "Application", original_application]),
                args(["get", "easytier-a", "Application"]),
                args(["set", "easytier-a", "AppParameters", original_parameters]),
                args(["get", "easytier-a", "AppParameters"]),
            ]
        );
        assert_eq!(values[0].1, original_application);
        assert_eq!(values[1].1, original_parameters);
    }

    #[test]
    fn start_spawn_failure_restores_direct_core_values_in_reverse_and_verifies() {
        let core = Path::new("C:/res/resource/core");
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        let original_application = "C:/res/resource/core/easytier-core.exe";
        let original_parameters = "--config-file a.toml  ";
        let mut values = [
            ("Application", original_application.to_string()),
            ("AppParameters", original_parameters.to_string()),
        ];
        let mut called = Vec::new();
        let error = run_start_sequence(&args(["start", "easytier-a"]), core, launcher, |step| {
            called.push(step.to_vec());
            let key = step.get(2).map(String::as_str).unwrap_or_default();
            let index = values.iter().position(|(name, _)| *name == key);
            match step[0].as_str() {
                "get" => Ok(CommandResult {
                    code: Some(0),
                    stdout: values[index.unwrap()].1.clone(),
                    stderr: String::new(),
                }),
                "set" => {
                    let index = index.unwrap();
                    values[index].1 = step[3].clone();
                    Ok(CommandResult {
                        code: Some(0),
                        stdout: String::new(),
                        stderr: String::new(),
                    })
                }
                "start" => Err("spawn failed".into()),
                _ => unreachable!(),
            }
        })
        .unwrap_err();

        assert!(error.contains("spawn failed"), "{error}");
        assert_eq!(
            called,
            vec![
                args(["get", "easytier-a", "Application"]),
                args(["get", "easytier-a", "AppParameters"]),
                args([
                    "set",
                    "easytier-a",
                    "AppParameters",
                    "--lighttier-service-core --config-file a.toml  ",
                ]),
                args([
                    "set",
                    "easytier-a",
                    "Application",
                    "C:/Program Files/LightTier/lighttier.exe",
                ]),
                args(["start", "easytier-a"]),
                args(["set", "easytier-a", "Application", original_application]),
                args(["get", "easytier-a", "Application"]),
                args(["set", "easytier-a", "AppParameters", original_parameters]),
                args(["get", "easytier-a", "AppParameters"]),
            ]
        );
        assert_eq!(values[0].1, original_application);
        assert_eq!(values[1].1, original_parameters);
    }

    #[test]
    fn rollback_write_failure_is_explicit_and_other_keys_are_still_restored() {
        let core = Path::new("C:/res/resource/core");
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        let original_application = "C:/res/resource/core/easytier-core.exe";
        let original_parameters = "--config-file a.toml";
        let mut called = Vec::new();
        let error = run_start_sequence(&args(["start", "easytier-a"]), core, launcher, |step| {
            called.push(step.to_vec());
            if step[0] == "start" {
                return Err("spawn failed".into());
            }
            let restoring_application =
                step[0] == "set" && step[2] == "Application" && step[3] == original_application;
            Ok(CommandResult {
                code: if restoring_application {
                    Some(5)
                } else {
                    Some(0)
                },
                stdout: match step.get(2).map(String::as_str) {
                    Some("Application") => original_application.into(),
                    Some("AppParameters") => original_parameters.into(),
                    _ => String::new(),
                },
                stderr: if restoring_application {
                    "access denied".into()
                } else {
                    String::new()
                },
            })
        })
        .unwrap_err();

        assert!(error.contains("spawn failed"), "{error}");
        assert!(error.contains("迁移回滚失败"), "{error}");
        assert!(error.contains("Application 写回失败"), "{error}");
        assert_eq!(called.iter().filter(|step| step[0] == "start").count(), 1);
        assert!(called.contains(&args([
            "set",
            "easytier-a",
            "AppParameters",
            original_parameters,
        ])));
        assert!(called.contains(&args(["get", "easytier-a", "AppParameters"])));
    }

    #[test]
    fn rollback_readback_mismatch_is_an_error_not_success() {
        let core = Path::new("C:/res/resource/core");
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        let mut gets = 0;
        let error = run_start_sequence(&args(["start", "easytier-a"]), core, launcher, |step| {
            if step[0] == "start" {
                return Err("spawn failed".into());
            }
            if step[0] == "get" && step[2] == "AppParameters" {
                gets += 1;
            }
            Ok(CommandResult {
                code: Some(0),
                stdout: match step.get(2).map(String::as_str) {
                    Some("Application") => "C:/Program Files/LightTier/lighttier.exe".into(),
                    Some("AppParameters") if gets == 1 => String::new(),
                    Some("AppParameters") => "unexpected value".into(),
                    _ => String::new(),
                },
                stderr: String::new(),
            })
        })
        .unwrap_err();
        assert!(error.contains("迁移回滚失败"), "{error}");
        assert!(error.contains("AppParameters 回读不一致"), "{error}");
    }

    #[test]
    fn start_migration_runs_get_set_before_start_and_skips_sets_for_launcher() {
        let core = Path::new("C:/res/resource/core");
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        let start = args(["start", "easytier-a"]);
        let mut called = Vec::new();
        let result = run_start_sequence(&start, core, launcher, |step| {
            called.push(step.to_vec());
            Ok(CommandResult {
                code: Some(0),
                stdout: match step.get(2).map(String::as_str) {
                    Some("Application") => "C:/res/resource/core/easytier-core.exe".into(),
                    Some("AppParameters") => "--config-file a.toml".into(),
                    _ => String::new(),
                },
                stderr: String::new(),
            })
        })
        .unwrap();
        assert_eq!(result.code, Some(0));
        assert_eq!(called[0], args(["get", "easytier-a", "Application"]));
        assert_eq!(called[1], args(["get", "easytier-a", "AppParameters"]));
        assert_eq!(called[2][0], "set");
        assert_eq!(called[2][2], "AppParameters");
        assert_eq!(called[3][0], "set");
        assert_eq!(called[3][2], "Application");
        assert_eq!(called[4], start);

        called.clear();
        run_start_sequence(&start, core, launcher, |step| {
            called.push(step.to_vec());
            Ok(CommandResult {
                code: Some(0),
                stdout: if step.get(2).map(String::as_str) == Some("Application") {
                    "C:/Program Files/LightTier/lighttier.exe".into()
                } else {
                    "--lighttier-service-core --config-file a.toml".into()
                },
                stderr: String::new(),
            })
        })
        .unwrap();
        assert_eq!(
            called,
            vec![
                args(["get", "easytier-a", "Application"]),
                args(["get", "easytier-a", "AppParameters"]),
                start,
            ]
        );
    }

    #[test]
    fn launcher_without_service_flag_is_repaired_before_start() {
        let core = Path::new("C:/res/resource/core");
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        let start = args(["start", "easytier-a"]);
        let mut called = Vec::new();
        run_start_sequence(&start, core, launcher, |step| {
            called.push(step.to_vec());
            Ok(CommandResult {
                code: Some(0),
                stdout: match step.get(2).map(String::as_str) {
                    Some("Application") => "\"C:/Program Files/LightTier/lighttier.exe\"".into(),
                    Some("AppParameters") => "--config-file a.toml".into(),
                    _ => String::new(),
                },
                stderr: String::new(),
            })
        })
        .unwrap();
        assert_eq!(
            called,
            vec![
                args(["get", "easytier-a", "Application"]),
                args(["get", "easytier-a", "AppParameters"]),
                args([
                    "set",
                    "easytier-a",
                    "AppParameters",
                    "--lighttier-service-core --config-file a.toml"
                ]),
                start,
            ]
        );
    }

    #[test]
    fn launcher_parameter_repair_failure_prevents_gui_start() {
        let core = Path::new("C:/res/resource/core");
        let launcher = Path::new("C:/Program Files/LightTier/lighttier.exe");
        let start = args(["start", "easytier-a"]);
        let mut called = Vec::new();
        let error = run_start_sequence(&start, core, launcher, |step| {
            called.push(step.to_vec());
            Ok(CommandResult {
                code: if step[0] == "set" { Some(5) } else { Some(0) },
                stdout: match step.get(2).map(String::as_str) {
                    Some("Application") => "C:/Program Files/LightTier/lighttier.exe".into(),
                    Some("AppParameters") => String::new(),
                    _ => String::new(),
                },
                stderr: "rejected".into(),
            })
        })
        .unwrap_err();
        assert!(error.contains("SCM"), "{error}");
        assert_eq!(called.len(), 4);
        assert_eq!(called[2][0], "set");
        assert_eq!(called[3], args(["set", "easytier-a", "AppParameters", ""]));
        assert!(called.iter().all(|step| step[0] != "start"));
    }

    #[test]
    fn install_snapshot_covers_every_writable_scm_key_and_preserves_raw_values() {
        let mut called = Vec::new();
        let result = run_service_snapshot("easytier-a", |step| {
            called.push(step.to_vec());
            Ok(CommandResult {
                code: Some(0),
                stdout: match step[2].as_str() {
                    "Application" => "\"C:/res/core/easytier-core.exe\"".into(),
                    "AppParameters" => "--config-file a.toml  ".into(),
                    "AppDirectory" => "C:/res".into(),
                    "AppExit" => "Default 1500 Restart 5000".into(),
                    "Description" => String::new(),
                    "DisplayName" => "LightTier A".into(),
                    "ObjectName" => ".\\svc password with spaces".into(),
                    "Start" => "SERVICE_DEMAND_START".into(),
                    "Type" => "SERVICE_WIN32_OWN_PROCESS".into(),
                    _ => unreachable!(),
                },
                stderr: String::new(),
            })
        })
        .unwrap();
        let snapshot: serde_json::Value = serde_json::from_str(&result.stdout).unwrap();
        assert_eq!(
            snapshot,
            serde_json::json!({
                "Application": ["\"C:/res/core/easytier-core.exe\""],
                "AppParameters": ["--config-file a.toml  "],
                "AppDirectory": ["C:/res"],
                "AppExit": ["Default", "1500", "Restart", "5000"],
                "Description": [""],
                "DisplayName": ["LightTier A"],
                "ObjectName": [".\\svc", "password with spaces"],
                "Start": ["SERVICE_DEMAND_START"],
                "Type": ["SERVICE_WIN32_OWN_PROCESS"],
            })
        );
        assert_eq!(called.len(), ALLOWED_SET_KEYS.len());
        assert!(called.iter().all(|step| step[0] == "get"));
    }

    #[test]
    fn install_snapshot_fails_closed_when_object_name_cannot_be_read() {
        let mut called = Vec::new();
        let error = run_service_snapshot("easytier-a", |step| {
            called.push(step.to_vec());
            Ok(CommandResult {
                code: if step[2] == "ObjectName" {
                    Some(5)
                } else {
                    Some(0)
                },
                stdout: "value".into(),
                stderr: "access denied".into(),
            })
        })
        .unwrap_err();
        assert!(
            error.contains("ObjectName") && error.contains("access denied"),
            "{error}"
        );
        assert_eq!(called.last().unwrap()[2], "ObjectName");
    }

    #[test]
    fn install_restore_accepts_snapshot_arities_without_rewriting_application() {
        for key in ALLOWED_SET_KEYS {
            assert!(validate_snapshot_key(key).is_ok(), "{key}");
        }
        assert!(validate_restore_args(&args([
            "restore",
            "easytier-a",
            "Application",
            "C:/old/easytier-core.exe",
        ]))
        .is_ok());
        assert!(
            validate_restore_args(&args(["restore", "easytier-a", "AppParameters", "",])).is_ok()
        );
        assert!(validate_restore_args(&args([
            "restore",
            "easytier-a",
            "ObjectName",
            ".\\svc",
            "password with spaces",
        ]))
        .is_ok());
        assert!(validate_restore_args(&args([
            "restore",
            "easytier-a",
            "AppExit",
            "Default",
            "1500",
            "Restart",
            "5000",
        ]))
        .is_ok());
        assert!(
            validate_restore_args(&args(["restore", "easytier-a", "Description", "a", "b",]))
                .is_err()
        );
        assert!(validate_restore_args(&args([
            "restore",
            "easytier-a",
            "ObjectName",
            "LocalSystem",
            "unexpected",
        ]))
        .is_err());
        assert!(validate_restore_args(&args([
            "restore",
            "easytier-a",
            "AppParameters",
            "bad\nvalue",
        ]))
        .is_err());
    }

    #[test]
    fn install_restore_requires_the_exact_prior_snapshot_value() {
        let service = "easytier-restore-snapshot-test";
        let key = "Application";
        let original = vec!["C:/old/easytier-core.exe".to_string()];
        assert!(validate_restore_snapshot(service, key, &original).is_err());
        remember_service_snapshot(service, key, &original);
        assert!(validate_restore_snapshot(service, key, &original).is_ok());
        assert!(
            validate_restore_snapshot(service, key, &["C:/attacker/easytier-core.exe".into()],)
                .is_err()
        );
        assert!(validate_restore_snapshot(service, "AppParameters", &original,).is_err());
    }

    #[test]
    fn raw_nssm_reads_preserve_parameter_spaces_and_allow_empty_restore_values() {
        assert_eq!(
            decode_nssm_stdout(b"--config-file a.toml  \r\n"),
            "--config-file a.toml  "
        );
        assert_eq!(decode_nssm_stdout(b"\r\n"), "");
        assert!(validate_raw_service_value("AppParameters", "").is_ok());
        assert!(validate_raw_service_value("Application", "").is_err());
        assert!(validate_raw_service_value("ObjectName", "LocalSystem").is_ok());
    }

    #[test]
    fn nssm_must_be_directly_inside_resource() {
        let source =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/resource/nssm.exe");
        let root =
            std::env::temp_dir().join(format!("lighttier-nssm-nested-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("resource/nested")).unwrap();
        std::fs::copy(source, root.join("resource/nested/nssm.exe")).unwrap();
        assert!(open_verified_nssm(&root).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn start_revalidates_core_before_executing_nssm() {
        let source =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/resource/nssm.exe");
        let root =
            std::env::temp_dir().join(format!("lighttier-nssm-start-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("resource/core")).unwrap();
        std::fs::copy(source, root.join("resource/nssm.exe")).unwrap();
        let error = run_nssm_at(
            &root,
            &args(["start", "easytier-a"]),
            &root.join("resource/core"),
            Path::new("C:/LightTier/lighttier.exe"),
        )
        .unwrap_err();
        assert!(error.contains("无法解析内核文件"), "{error}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn bundled_nssm_matches_the_pinned_hash() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri");
        assert!(open_verified_nssm(&root).is_ok());
    }

    #[test]
    fn tampered_nssm_is_rejected_before_execution() {
        let root =
            std::env::temp_dir().join(format!("lighttier-nssm-tampered-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("resource")).unwrap();
        std::fs::write(root.join("resource/nssm.exe"), b"MZ tampered").unwrap();

        let error = run_nssm_at(
            &root,
            &args(["status", "easytier-a"]),
            &root.join("resource/core"),
            Path::new("C:/LightTier/lighttier.exe"),
        )
        .unwrap_err();
        assert!(
            error.contains("NSSM") && error.contains("校验失败"),
            "{error}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn verified_nssm_handle_blocks_write_and_delete_until_released() {
        use std::fs::OpenOptions;
        use std::os::windows::fs::OpenOptionsExt;

        let source =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/resource/nssm.exe");
        let root =
            std::env::temp_dir().join(format!("lighttier-nssm-share-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("resource")).unwrap();
        let path = root.join("resource/nssm.exe");
        std::fs::write(&path, std::fs::read(source).unwrap()).unwrap();

        let verified = open_verified_nssm(&root).unwrap();
        assert!(OpenOptions::new()
            .write(true)
            .share_mode(0x0000_0001)
            .open(&path)
            .is_err());
        assert!(std::fs::remove_file(&path).is_err());
        drop(verified);
        std::fs::remove_file(&path).unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }

    fn args<'a>(items: impl IntoIterator<Item = &'a str>) -> Vec<String> {
        items.into_iter().map(|item| item.to_string()).collect()
    }
}

pub fn run(app: &tauri::AppHandle, args: Vec<String>) -> Result<CommandResult, String> {
    let launcher = std::env::current_exe()
        .map_err(|error| format!("无法解析 LightTier 服务启动器: {error}"))?;
    run_nssm_at(
        &resource_root(app)?,
        &args,
        &super::exec::core_dir(app)?,
        &launcher,
    )
}

const NSSM_SHA256: &str = "86b89831b272bc3b80b63b209087c19db60a29934e0fff84d6172f33293c90c6";

/// 仅供安装回滚读取快照，不向前端开放任意 nssm get。
pub(crate) fn read_service_value(
    app: &tauri::AppHandle,
    service_name: &str,
    key: &str,
) -> Result<CommandResult, String> {
    let root = resource_root(app)?;
    read_service_value_at(&root, service_name, key)
}

fn read_service_value_at(
    root: &Path,
    service_name: &str,
    key: &str,
) -> Result<CommandResult, String> {
    validate_snapshot_key(key)?;
    validate_service_name(service_name)?;
    let verified = open_verified_nssm(root)?;
    run_verified_nssm_raw(
        &verified.path,
        &["get".into(), service_name.into(), key.into()],
    )
}

/// 回滚必须写回原始参数（包括空字符串和末尾空格），不能经过启动器参数规范化。
pub(crate) fn restore_service_value(
    app: &tauri::AppHandle,
    service_name: &str,
    key: &str,
    value: &str,
) -> Result<CommandResult, String> {
    validate_snapshot_key(key)?;
    validate_service_name(service_name)?;
    validate_raw_service_value(key, value)?;
    let verified = open_verified_nssm(&resource_root(app)?)?;
    run_verified_nssm_raw(
        &verified.path,
        &["set".into(), service_name.into(), key.into(), value.into()],
    )
}

fn validate_snapshot_key(key: &str) -> Result<(), String> {
    if ALLOWED_SET_KEYS.contains(&key) {
        Ok(())
    } else {
        Err(format!("服务回滚不允许修改 {key}"))
    }
}

type PendingSnapshots = HashMap<String, HashMap<String, Vec<String>>>;

static PENDING_SNAPSHOTS: OnceLock<Mutex<PendingSnapshots>> = OnceLock::new();

fn pending_snapshots() -> &'static Mutex<PendingSnapshots> {
    PENDING_SNAPSHOTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remember_service_snapshot(service_name: &str, key: &str, values: &[String]) {
    let mut snapshots = pending_snapshots()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if !snapshots.contains_key(service_name) && snapshots.len() >= 32 {
        if let Some(oldest) = snapshots.keys().next().cloned() {
            snapshots.remove(&oldest);
        }
    }
    snapshots
        .entry(service_name.to_string())
        .or_default()
        .insert(key.to_string(), values.to_vec());
}

/// restore 只能写回本进程刚读取的快照值，不能借回滚接口任意改写 SCM。
fn validate_restore_snapshot(
    service_name: &str,
    key: &str,
    values: &[String],
) -> Result<(), String> {
    let snapshots = pending_snapshots()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let expected = snapshots
        .get(service_name)
        .and_then(|service| service.get(key))
        .ok_or_else(|| format!("SCM restore {key} 缺少先行快照"))?;
    if expected != values {
        return Err(format!("SCM restore {key} 与先行快照不一致"));
    }
    Ok(())
}

fn consume_restored_snapshot(service_name: &str, key: &str) {
    let mut snapshots = pending_snapshots()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if let Some(service) = snapshots.get_mut(service_name) {
        service.remove(key);
        if service.is_empty() {
            snapshots.remove(service_name);
        }
    }
}

fn validate_restore_args(args: &[String]) -> Result<(), String> {
    if args.len() < 4 || args[0] != "restore" {
        return Err("SCM restore 参数数量不正确".into());
    }
    validate_service_name(&args[1])?;
    let key = args[2].as_str();
    validate_snapshot_key(key)?;
    let values = &args[3..];
    let valid_arity = match key {
        "ObjectName" => matches!(values.len(), 1 | 2),
        "AppExit" => matches!(values.len(), 1..=4),
        _ => values.len() == 1,
    };
    if !valid_arity {
        return Err(format!("SCM restore {key} 参数数量不正确"));
    }
    if values.iter().any(|value| {
        value.len() > 8192
            || value
                .chars()
                .any(|ch| ch == '\0' || ch == '\n' || ch == '\r')
    }) {
        return Err(format!("SCM restore {key} 值无效"));
    }
    if matches!(key, "Application" | "AppDirectory" | "Start" | "Type") && values[0].is_empty() {
        return Err(format!("SCM restore {key} 不能为空"));
    }
    if key == "ObjectName" && values[0].is_empty() {
        return Err("SCM restore ObjectName 用户名不能为空".into());
    }
    if key == "ObjectName" && values[0] == "LocalSystem" && values.len() != 1 {
        return Err("SCM restore LocalSystem 不接受密码".into());
    }
    Ok(())
}

/// 安装回滚专用快照：仅九个固定键，JSON 编码避免 IPC 层 trim 破坏末尾空格。
fn run_service_snapshot(
    service_name: &str,
    mut run: impl FnMut(&[String]) -> Result<CommandResult, String>,
) -> Result<CommandResult, String> {
    validate_service_name(service_name)?;
    let mut snapshot = serde_json::Map::new();
    for key in ALLOWED_SET_KEYS {
        let result = run_migration_step(
            &mut run,
            &["get".into(), service_name.into(), (*key).into()],
        )?;
        let values = decode_snapshot_value(key, &result.stdout)?;
        let mut restore = vec!["restore".into(), service_name.into(), (*key).into()];
        restore.extend(values.iter().cloned());
        validate_restore_args(&restore)?;
        snapshot.insert(
            (*key).into(),
            serde_json::Value::Array(
                values
                    .clone()
                    .into_iter()
                    .map(serde_json::Value::String)
                    .collect(),
            ),
        );
    }
    for key in ALLOWED_SET_KEYS {
        let values = snapshot[*key]
            .as_array()
            .expect("快照值必为数组")
            .iter()
            .map(|value| value.as_str().expect("快照值必为字符串").to_string())
            .collect::<Vec<_>>();
        remember_service_snapshot(service_name, key, &values);
    }
    let stdout = serde_json::to_string(&snapshot)
        .map_err(|error| format!("编码 SCM 服务快照失败: {error}"))?;
    Ok(CommandResult {
        code: Some(0),
        stdout,
        stderr: String::new(),
    })
}

fn decode_snapshot_value(key: &str, output: &str) -> Result<Vec<String>, String> {
    if output.len() > 8192
        || output
            .chars()
            .any(|ch| ch == '\0' || ch == '\n' || ch == '\r')
    {
        return Err(format!("SCM {key} 快照为空、过长或含有非法字符"));
    }
    match key {
        "ObjectName" => match output.split_once([' ', '\t']) {
            Some((user, password)) if !user.is_empty() => Ok(vec![user.into(), password.into()]),
            Some(_) => Err("SCM ObjectName 快照用户名为空".into()),
            None => Ok(vec![output.into()]),
        },
        "AppExit" => Ok(output
            .split([' ', '\t'])
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect()),
        _ => Ok(vec![output.into()]),
    }
}

fn validate_raw_service_value(key: &str, value: &str) -> Result<(), String> {
    validate_snapshot_key(key)?;
    if value.len() > 8192
        || (key != "AppParameters" && value.is_empty())
        || value
            .chars()
            .any(|ch| ch == '\0' || ch == '\n' || ch == '\r')
    {
        return Err(format!("服务回滚 {key} 值无效"));
    }
    Ok(())
}

fn run_verified_nssm_raw(program: &Path, args: &[String]) -> Result<CommandResult, String> {
    let mut command = Command::new(program);
    command.args(args);
    super::exec::hide_console(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("执行 NSSM 失败: {error}"))?;
    Ok(CommandResult {
        code: output.status.code(),
        stdout: decode_nssm_stdout(&output.stdout),
        stderr: super::decode_native(&output.stderr).trim_end().to_string(),
    })
}

fn decode_nssm_stdout(bytes: &[u8]) -> String {
    let mut text = super::decode_native(bytes);
    if text.ends_with("\r\n") {
        text.truncate(text.len() - 2);
    } else if text.ends_with(['\r', '\n']) {
        text.pop();
    }
    text
}

struct VerifiedNssm {
    path: PathBuf,
    _file: File,
}

fn open_nssm(path: &Path) -> Result<File, String> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        OpenOptions::new()
            .read(true)
            .share_mode(0x0000_0001)
            .open(path)
            .map_err(|error| format!("无法打开 NSSM: {error}"))
    }
    #[cfg(not(windows))]
    {
        File::open(path).map_err(|error| format!("无法打开 NSSM: {error}"))
    }
}

fn open_verified_nssm(root: &Path) -> Result<VerifiedNssm, String> {
    let verify = || -> Result<VerifiedNssm, String> {
        let resource = root
            .join("resource")
            .canonicalize()
            .map_err(|error| format!("无法解析直属 resource 目录: {error}"))?;
        let path = resource
            .join("nssm.exe")
            .canonicalize()
            .map_err(|error| format!("无法解析直属 resource/nssm.exe: {error}"))?;
        if path.parent() != Some(resource.as_path())
            || !path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("nssm.exe"))
        {
            return Err("NSSM 必须位于直属 resource 目录且文件名固定".into());
        }
        let mut file = open_nssm(&path)?;
        let before = file
            .metadata()
            .map_err(|error| format!("无法读取 NSSM 元数据: {error}"))?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        let mut bytes_read = 0u64;
        loop {
            let count = file
                .read(&mut buffer)
                .map_err(|error| format!("无法完整读取 NSSM: {error}"))?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
            bytes_read += count as u64;
        }
        let after = file
            .metadata()
            .map_err(|error| format!("无法复查 NSSM 元数据: {error}"))?;
        if bytes_read != before.len()
            || before.len() != after.len()
            || before.modified().ok() != after.modified().ok()
        {
            return Err("NSSM 在校验期间发生变化".into());
        }
        let mut actual = String::with_capacity(64);
        for byte in hasher.finalize() {
            write!(&mut actual, "{byte:02x}").expect("写入定长哈希字符串");
        }
        if actual != NSSM_SHA256 {
            return Err(format!("NSSM SHA256 不匹配: {actual}"));
        }
        Ok(VerifiedNssm { path, _file: file })
    };
    verify().map_err(|error| format!("NSSM 校验失败: {error}"))
}

fn core_executable(core: &Path) -> PathBuf {
    core.join(if cfg!(windows) {
        "easytier-core.exe"
    } else {
        "easytier-core"
    })
}

/// 路径意图在前端仍是 core；只有后端信任的当前可执行文件可直接作为 Application。
fn validated_core_intent(
    args: &[String],
    core: &Path,
    root: &Path,
    launcher: &Path,
) -> Result<(Vec<String>, Option<PathBuf>), String> {
    let mut checked = args.to_vec();
    let mut core_path = None;
    let application_index = match args.first().map(String::as_str) {
        Some("install") => Some(2),
        Some("set") if args.get(2).map(String::as_str) == Some("Application") => Some(3),
        _ => None,
    };
    if let Some(index) = application_index {
        if let Some(value) = args.get(index) {
            if normalize_path(Path::new(value)) == normalize_path(launcher) {
                checked[index] = core_executable(core).to_string_lossy().into_owned();
            }
            core_path = Some(PathBuf::from(value));
        }
    } else if args.first().map(String::as_str) == Some("start") {
        core_path = Some(core_executable(core));
    }
    validate_args(&checked, core, root)?;
    Ok((checked, core_path))
}

fn run_nssm_at(
    root: &Path,
    args: &[String],
    core: &Path,
    launcher: &Path,
) -> Result<CommandResult, String> {
    let verified_nssm = open_verified_nssm(root)?;
    match args.first().map(String::as_str) {
        Some("snapshot") => {
            if args.len() != 2 {
                return Err("SCM snapshot 参数数量不正确".into());
            }
            validate_service_name(&args[1])?;
            run_service_snapshot(&args[1], |step| {
                run_verified_nssm_raw(&verified_nssm.path, step)
            })
        }
        Some("restore") => {
            validate_restore_args(args)?;
            validate_restore_snapshot(&args[1], &args[2], &args[3..])?;
            // 恢复必须原样写回旧值，不能经过 Application/AppParameters 启动器改写。
            let result = run_verified_nssm_raw(&verified_nssm.path, args)?;
            if result.code == Some(0) {
                consume_restored_snapshot(&args[1], &args[2]);
            }
            Ok(result)
        }
        _ => {
            let (checked, core_intent) = validated_core_intent(args, core, root, launcher)?;
            let rewritten = rewrite_args(args, launcher);
            // 校验添加隐藏入口后的最终长度；Application 已由上面的可信意图校验。
            if checked.first().map(String::as_str) == Some("set")
                && checked.get(2).map(String::as_str) == Some("AppParameters")
            {
                single_value(rewritten.get(3..).unwrap_or_default(), "AppParameters")?;
            }
            let verified_core = match core_intent {
                Some(path) if normalize_path(&path) != normalize_path(launcher) => {
                    Some(crate::kernel_manifest::open_verified_exe(
                        &path,
                        crate::kernel_manifest::CoreFile::Core,
                        core,
                    )?)
                }
                Some(_) => Some(crate::kernel_manifest::open_verified_exe(
                    &core_executable(core),
                    crate::kernel_manifest::CoreFile::Core,
                    core,
                )?),
                None => None,
            };
            let result = if checked.first().map(String::as_str) == Some("start") {
                run_start_sequence(&rewritten, core, launcher, |step| {
                    // 快照与恢复保留 AppParameters 的末尾空格，不能使用会 trim 的通用执行器。
                    run_verified_nssm_raw(&verified_nssm.path, step)
                })
            } else {
                run_program(&verified_nssm.path, &rewritten)
            };
            // NSSM 与 core 的校验句柄均保留到 get/set/start 等外部进程全部结束。
            drop(verified_core);
            drop(verified_nssm);
            result
        }
    }
}

/// 仅根据受信 NSSM get 的原始输出构建内部迁移；任意 get 都不在 IPC 白名单内。
fn build_launcher_migration(
    service_name: &str,
    application: &str,
    parameters: &str,
    core: &Path,
    launcher: &Path,
) -> Result<Option<Vec<Vec<String>>>, String> {
    validate_service_name(service_name)?;
    let application = parse_application_output(application)?;
    validate_migration_parameters(parameters)?;
    let application = Path::new(&application);
    let is_launcher = normalize_path(application) == normalize_path(launcher);
    if !is_launcher && !is_core_path(application, core) {
        return Err("SCM Application 不是允许的当前 resource/core 内核".into());
    }

    let needs_parameter_repair = strip_service_prefix(parameters).is_none();
    let parameters = if strip_service_prefix(parameters).is_some() {
        parameters.to_string()
    } else if parameters.is_empty() {
        SERVICE_CORE_ARG.to_string()
    } else {
        format!("{SERVICE_CORE_ARG} {parameters}")
    };
    validate_migration_parameters(&parameters)?;
    if is_launcher {
        // 即使 Application 已是启动器，也必须确保首个参数是隐藏入口，避免服务账户启动 GUI。
        return Ok(needs_parameter_repair.then(|| {
            vec![vec![
                "set".into(),
                service_name.into(),
                "AppParameters".into(),
                parameters,
            ]]
        }));
    }
    Ok(Some(vec![
        // 先写隐藏入口，最后切换 Application；失败时旧 core 不会突然变成 GUI。
        vec![
            "set".into(),
            service_name.into(),
            "AppParameters".into(),
            parameters,
        ],
        vec![
            "set".into(),
            service_name.into(),
            "Application".into(),
            launcher.to_string_lossy().into_owned(),
        ],
    ]))
}

fn parse_application_output(output: &str) -> Result<String, String> {
    if output.is_empty()
        || output.len() > 8192
        || output
            .chars()
            .any(|ch| ch == '\0' || ch == '\n' || ch == '\r')
    {
        return Err("SCM Application 输出为空、过长或含有非法字符".into());
    }
    let value = output.trim();
    let unquoted = if value.starts_with('"') || value.ends_with('"') {
        if value.len() < 2 || !value.starts_with('"') || !value.ends_with('"') {
            return Err("SCM Application 输出引号不完整".into());
        }
        let inner = &value[1..value.len() - 1];
        if inner.contains('"') {
            return Err("SCM Application 输出含有非法引号".into());
        }
        inner
    } else {
        value
    };
    if unquoted.is_empty() || !Path::new(unquoted).is_absolute() {
        return Err("SCM Application 输出必须是绝对路径".into());
    }
    Ok(unquoted.to_string())
}

fn validate_migration_parameters(value: &str) -> Result<(), String> {
    if value.len() > 8192 {
        return Err("SCM AppParameters 输出过长".into());
    }
    if value
        .chars()
        .any(|ch| ch == '\0' || ch == '\n' || ch == '\r')
    {
        return Err("SCM AppParameters 输出含有非法字符".into());
    }
    Ok(())
}

fn run_start_sequence(
    start: &[String],
    core: &Path,
    launcher: &Path,
    mut run: impl FnMut(&[String]) -> Result<CommandResult, String>,
) -> Result<CommandResult, String> {
    if start.len() != 2 || start[0] != "start" {
        return Err("SCM start 参数数量不正确".into());
    }
    let service_name = &start[1];
    let application = run_migration_step(
        &mut run,
        &["get".into(), service_name.clone(), "Application".into()],
    )?;
    let parameters = run_migration_step(
        &mut run,
        &["get".into(), service_name.clone(), "AppParameters".into()],
    )?;
    if let Some(steps) = build_launcher_migration(
        service_name,
        &application.stdout,
        &parameters.stdout,
        core,
        launcher,
    )? {
        let mut attempted = Vec::new();
        for step in steps {
            let key = step[2].clone();
            let original = if key == "Application" {
                application.stdout.clone()
            } else {
                parameters.stdout.clone()
            };
            // set 失败也可能已写入，因此把当前尝试键一并纳入逆序恢复。
            attempted.push((key, original));
            if let Err(error) = run_migration_step(&mut run, &step) {
                return Err(rollback_migration(
                    &mut run,
                    service_name,
                    &attempted,
                    error,
                ));
            }
        }
        return run(start)
            .map_err(|error| {
                rollback_migration(
                    &mut run,
                    service_name,
                    &attempted,
                    format!("SCM start 失败: {error}"),
                )
            })
            .map(|result| {
                // start 的退出码不是最终成功依据；保留原结果供上层轮询 SCM 状态。
                result
            });
    }
    // start 的退出码不是最终成功依据；保留原结果供上层轮询 SCM 状态。
    run(start).map_err(|error| format!("SCM start 失败: {error}"))
}

fn rollback_migration(
    run: &mut impl FnMut(&[String]) -> Result<CommandResult, String>,
    service_name: &str,
    attempted: &[(String, String)],
    cause: String,
) -> String {
    let mut failures = Vec::new();
    for (key, original) in attempted.iter().rev() {
        let restore = [
            "set".into(),
            service_name.into(),
            key.clone(),
            original.clone(),
        ];
        if let Err(error) = run_migration_step(run, &restore) {
            failures.push(format!("{key} 写回失败: {error}"));
            continue;
        }
        let verify = ["get".into(), service_name.into(), key.clone()];
        match run_migration_step(run, &verify) {
            Ok(result) if result.stdout == *original => {}
            Ok(result) => failures.push(format!(
                "{key} 回读不一致（期望 {:?}，实际 {:?}）",
                original, result.stdout
            )),
            Err(error) => failures.push(format!("{key} 回读失败: {error}")),
        }
    }
    if failures.is_empty() {
        cause
    } else {
        format!("{cause}; SCM 迁移回滚失败: {}", failures.join("; "))
    }
}

fn run_migration_step(
    run: &mut impl FnMut(&[String]) -> Result<CommandResult, String>,
    step: &[String],
) -> Result<CommandResult, String> {
    let action = step.first().map(String::as_str).unwrap_or_default();
    let key = step.get(2).cloned().unwrap_or_default();
    let result = run(step).map_err(|error| format!("SCM 启动迁移 {action} {key} 失败: {error}"))?;
    if result.code != Some(0) {
        let diagnostic = [result.stderr.trim(), result.stdout.trim()]
            .into_iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(format!(
            "SCM 启动迁移 {action} {key} 失败（退出码 {:?}）: {diagnostic}",
            result.code
        ));
    }
    Ok(result)
}

fn rewrite_args(args: &[String], launcher: &Path) -> Vec<String> {
    let mut rewritten = args.to_vec();
    let application_index = match args.first().map(String::as_str) {
        Some("install") => Some(2),
        Some("set") if args.get(2).map(String::as_str) == Some("Application") => Some(3),
        _ => None,
    };
    if let Some(index) = application_index {
        rewritten[index] = launcher.to_string_lossy().into_owned();
    }
    if args.first().map(String::as_str) == Some("set")
        && args.get(2).map(String::as_str) == Some("AppParameters")
    {
        if let Some(value) = rewritten.get_mut(3) {
            if strip_service_prefix(value).is_none() {
                *value = format!("{SERVICE_CORE_ARG} {value}");
            }
        }
    }
    rewritten
}

fn strip_service_prefix(value: &str) -> Option<&str> {
    let rest = value.strip_prefix(SERVICE_CORE_ARG)?;
    if rest.is_empty() {
        Some(rest)
    } else if rest.starts_with([' ', '\t']) {
        Some(rest.trim_start_matches([' ', '\t']))
    } else {
        None
    }
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
                "Application" => {
                    let value = single_value(values, key)?;
                    if !is_core_path(Path::new(value), core) {
                        return Err("Application 只允许 resource/core 下的 easytier-core".into());
                    }
                    Ok(())
                }
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
    if values[0]
        .chars()
        .any(|ch| ch == '\0' || ch == '\n' || ch == '\r')
    {
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

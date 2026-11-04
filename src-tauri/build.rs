fn main() {
    // 应用通过 nssm.exe 安装/启停 Windows 服务，进程需要管理员权限；
    // 若后续改为按需提权（runas），把 windows.manifest.xml 的 level 降为 asInvoker 即可。
    let windows =
        tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows.manifest.xml"));

    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run build script");
}

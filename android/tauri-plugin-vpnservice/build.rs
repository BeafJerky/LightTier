const COMMANDS: &[&str] = &[
    "prepare_vpn",
    "start_vpn",
    "stop_vpn",
    "get_vpn_status",
    "register_listener",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}

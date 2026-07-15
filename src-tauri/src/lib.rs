//! Beadsmith application library.
//!
//! The Tauri command layer is wired up in later beads. For now this crate also
//! hosts pure-Rust adapters such as [`issues`], which integrate with Beadwork
//! through structured `bw` CLI output (ADR-0003) and are unit-testable without
//! the desktop app.

pub mod issues;
pub mod rpc;
pub mod settings;
pub mod workspace;

use tauri_plugin_log::{Target, TargetKind};

// Dev bridge for the `tauri-agent-tools` CLI (DOM/eval/screenshot inspection for
// agent-driven debugging). Debug builds only; compiled out entirely in release.
#[cfg(debug_assertions)]
pub(crate) mod dev_bridge;

/// Starts the dev bridge's HTTP server, used by the `tauri-agent-tools` CLI to
/// inspect and drive the app.
#[cfg(debug_assertions)]
fn start_dev_bridge(app: &tauri::AppHandle) {
    if let Err(e) = dev_bridge::start_bridge(app) {
        eprintln!("Warning: Failed to start dev bridge: {e}");
    }
}

/// Builds the official Tauri log plugin with Beadsmith's native logging policy.
///
/// - Debug builds accept `Debug` and write to `stdout` (developer feedback) and
///   the OS-managed `LogDir` (persistent diagnosis).
/// - Release builds accept `Info` and write only to `LogDir`, keeping release
///   binaries free of console output conventions.
/// - `LogDir` uses the platform-specific log directory for the bundle identifier
///   and the plugin names/rotates files using its default bounded strategy.
fn log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    #[cfg(debug_assertions)]
    {
        tauri_plugin_log::Builder::new()
            .level(log::LevelFilter::Debug)
            .target(Target::new(TargetKind::Stdout))
            .target(Target::new(TargetKind::LogDir { file_name: None }))
            .build()
    }
    #[cfg(not(debug_assertions))]
    {
        tauri_plugin_log::Builder::new()
            .level(log::LevelFilter::Info)
            .target(Target::new(TargetKind::LogDir { file_name: None }))
            .build()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub async fn run() {
    let workspace_api = rpc::BeadsmithApiImpl::default();
    let workspace_setup_api = workspace_api.clone();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(log_plugin());

    // WebDriver plugins back the end-to-end suite (see
    // docs/agents/webdriver-e2e.md). They are never registered outside debug
    // builds, so they never ship in a release binary.
    #[cfg(debug_assertions)]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .invoke_handler(rpc::router::<tauri::Wry>(workspace_api).into_handler())
        .setup(move |_app| {
            workspace_setup_api.initialize_workspace(_app.handle().clone());
            workspace_setup_api.initialize_settings(_app.handle().clone());
            #[cfg(debug_assertions)]
            start_dev_bridge(_app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

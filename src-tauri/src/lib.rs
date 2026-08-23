//! Beadsmith application library.
//!
//! The Tauri command layer is wired up in later beads. For now this crate also
//! hosts pure-Rust adapters such as [`issues`], which integrate with Beadwork
//! through structured `bw` CLI output (ADR-0003) and are unit-testable without
//! the desktop app.

pub mod issues;
pub mod refresh;
pub mod rpc;
pub mod settings;
pub mod workspace;

use tauri::Manager as _;
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
        // Single Instance must be registered before Deep Link so Linux
        // second launches are routed through the deep-link plugin.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
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
        .setup(move |app| {
            workspace_setup_api.initialize_workspace(app.handle().clone());
            workspace_setup_api.initialize_settings(app.handle().clone());
            workspace_setup_api.start_refresh();
            // Forward native focus-gain events to the refresh
            // coordinator so returning to the window refreshes the
            // Current Workspace immediately (ADR-0007 decision 3).
            // Focus loss and every other window event do nothing; every
            // observed focus gain refreshes, with no first-focus
            // suppression — attaching after setup may miss a startup
            // focus event, which is harmless because startup already
            // loads/restores the snapshot, and suppressing could
            // discard the user's first genuine return on platforms
            // that emit no startup event.
            if let Some(window) = app.get_webview_window("main") {
                let api = workspace_setup_api.clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::Focused(true)) {
                        api.request_forced_refresh();
                    }
                });
            }
            #[cfg(debug_assertions)]
            start_dev_bridge(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

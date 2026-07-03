//! Beadsmith application library.
//!
//! The Tauri command layer is wired up in later beads. For now this crate also
//! hosts pure-Rust adapters such as [`issues`], which integrate with Beadwork
//! through structured `bw` CLI output (ADR-0003) and are unit-testable without
//! the desktop app.

pub mod issues;
pub mod rpc;
mod workspace;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub async fn run() {
    workspace::apply_workspace_override(std::env::args());

    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    // WebDriver plugins back the end-to-end suite (see
    // docs/agents/webdriver-e2e.md). They are never registered outside debug
    // builds, so they never ship in a release binary.
    #[cfg(debug_assertions)]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .invoke_handler(rpc::router::<tauri::Wry>().into_handler())
        .setup(|_app| {
            #[cfg(debug_assertions)]
            start_dev_bridge(_app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

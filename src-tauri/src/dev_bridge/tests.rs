//! Outlined development-bridge tests.
//!
//! Migrated from the inline `mod tests` block at the bottom of
//! `dev_bridge.rs`. Test-only fixtures and helpers stay local to this
//! module so the production development-bridge surface remains unchanged.

use super::*;

#[test]
fn eval_callback_prefers_tauri_internals() {
    let script = build_eval_callback_js("document.title", "request-1");
    let internals = script.find("window.__TAURI_INTERNALS__.invoke").unwrap();
    let global = script.find("window.__TAURI__.core.invoke").unwrap();

    assert!(internals < global);
}

#[test]
fn eval_callback_keeps_global_tauri_fallback() {
    let script = build_eval_callback_js("document.title", "request-1");

    assert!(script.contains("window.__TAURI__.core.invoke"));
    assert!(!script.contains("app.withGlobalTauri"));
}

#[test]
fn eval_callback_safely_embeds_js_and_request_id() {
    let js = r#"document.querySelector("[data-name=\"x\"]").textContent"#;
    let request_id = r#"request-"quoted""#;
    let script = build_eval_callback_js(js, request_id);

    assert!(script.contains(&serde_json::to_string(js).unwrap()));
    assert!(script.contains(&serde_json::to_string(request_id).unwrap()));
}

#[test]
fn eval_callback_uses_dev_bridge_result_command() {
    let script = build_eval_callback_js("1 + 1", "request-1");

    assert!(script.contains("TauRPC__devBridge.result"));
    assert!(!script.contains("await window.__TAURI__.core.invoke"));
}

#[test]
fn eval_timeout_message_is_actionable() {
    assert!(EVAL_TIMEOUT_MESSAGE.contains("no result callback received"));
    assert!(EVAL_TIMEOUT_MESSAGE.contains("Re-copy"));
    assert!(EVAL_TIMEOUT_MESSAGE.contains("dev_bridge.rs"));
}

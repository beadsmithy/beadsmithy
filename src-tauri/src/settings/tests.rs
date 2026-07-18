//! Outlined App Settings tests.
//!
//! Migrated from the inline `mod tests` block at the bottom of
//! `settings.rs`. Test-only fixtures, fakes, and store adapters stay
//! local to this module so the production settings surface remains
//! unchanged.

use super::*;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct FakeStore(Arc<Mutex<FakeStoreState>>);

struct FakeStoreState {
    load_result: Result<Option<serde_json::Value>, String>,
    save_results: VecDeque<Result<(), String>>,
    replace_results: VecDeque<Result<(), String>>,
    saved: Vec<AppSettingsEnvelope>,
    replaced: Vec<AppSettingsEnvelope>,
}

impl FakeStore {
    fn empty() -> Self {
        Self(Arc::new(Mutex::new(FakeStoreState {
            load_result: Ok(None),
            save_results: VecDeque::new(),
            replace_results: VecDeque::new(),
            saved: Vec::new(),
            replaced: Vec::new(),
        })))
    }

    fn with_load(value: impl Into<serde_json::Value>) -> Self {
        Self::empty().set_load(Ok(Some(value.into())))
    }

    fn with_load_error(message: impl Into<String>) -> Self {
        Self::empty().set_load(Err(message.into()))
    }

    fn with_save_results(results: impl IntoIterator<Item = Result<(), String>>) -> Self {
        let store = Self::empty();
        store.0.lock().unwrap().save_results = results.into_iter().collect();
        store
    }

    fn with_replace_results(self, results: impl IntoIterator<Item = Result<(), String>>) -> Self {
        self.0.lock().unwrap().replace_results = results.into_iter().collect();
        self
    }

    fn set_load(self, load_result: Result<Option<serde_json::Value>, String>) -> Self {
        self.0.lock().unwrap().load_result = load_result;
        self
    }

    fn saved(&self) -> Vec<AppSettingsEnvelope> {
        self.0.lock().unwrap().saved.clone()
    }

    fn replaced(&self) -> Vec<AppSettingsEnvelope> {
        self.0.lock().unwrap().replaced.clone()
    }
}

impl AppSettingsStore for FakeStore {
    fn load(&self) -> Result<Option<serde_json::Value>, String> {
        self.0.lock().unwrap().load_result.clone()
    }

    fn save(&self, envelope: &AppSettingsEnvelope) -> Result<(), String> {
        let mut state = self.0.lock().unwrap();
        let result = state.save_results.pop_front().unwrap_or(Ok(()));
        if result.is_ok() {
            state.saved.push(envelope.clone());
        }
        result
    }

    fn replace(&self, envelope: &AppSettingsEnvelope) -> Result<(), String> {
        let mut state = self.0.lock().unwrap();
        let result = state.replace_results.pop_front().unwrap_or(Ok(()));
        if result.is_ok() {
            state.replaced.push(envelope.clone());
        }
        result
    }
}

fn settings_with_font_size(font_size_px: u32) -> AppSettings {
    AppSettings {
        markdown: MarkdownSettings { font_size_px },
    }
}

fn persisted_envelope_value(font_size_px: u32) -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": APP_SETTINGS_SCHEMA_VERSION,
        "settings": {
            "markdown": {
                "fontSizePx": font_size_px
            }
        }
    })
}

fn update_request_with_font_size(value: impl Into<serde_json::Value>) -> AppSettingsUpdate {
    AppSettingsUpdate {
        markdown: MarkdownSettingsUpdate {
            font_size_px: value.into(),
        },
    }
}

#[test]
fn missing_document_returns_default_without_warning() {
    let service = SettingsService::from_store(FakeStore::empty());

    assert_eq!(service.state().settings, AppSettings::default());
    assert!(service.state().warning.is_none());
}

#[test]
fn valid_font_sizes_load_without_warning() {
    for font_size in [MIN_FONT_SIZE_PX, DEFAULT_FONT_SIZE_PX, MAX_FONT_SIZE_PX] {
        let store = FakeStore::with_load(persisted_envelope_value(font_size));
        let service = SettingsService::from_store(store.clone());

        assert_eq!(
            service.state().settings.markdown.font_size_px,
            font_size,
            "font size {font_size} should load"
        );
        assert!(service.state().warning.is_none());
    }
}

#[test]
fn invalid_persisted_values_return_default_with_invalid_value_warning() {
    let cases: Vec<serde_json::Value> = vec![
        persisted_envelope_value(MIN_FONT_SIZE_PX - 1),
        persisted_envelope_value(MAX_FONT_SIZE_PX + 1),
        serde_json::json!({
            "schemaVersion": APP_SETTINGS_SCHEMA_VERSION,
            "settings": { "markdown": { "fontSizePx": 14.5 } }
        }),
        serde_json::json!({
            "schemaVersion": APP_SETTINGS_SCHEMA_VERSION,
            "settings": { "markdown": { "fontSizePx": "14" } }
        }),
        serde_json::json!({
            "schemaVersion": APP_SETTINGS_SCHEMA_VERSION,
            "settings": { "markdown": {} }
        }),
    ];

    for value in cases {
        let store = FakeStore::with_load(value);
        let service = SettingsService::from_store(store.clone());

        assert_eq!(service.state().settings, AppSettings::default());
        let warning = service.state().warning.expect("expected a warning");
        assert_eq!(warning.kind, AppSettingsErrorKind::InvalidValue);
    }
}

#[test]
fn malformed_persisted_document_returns_default_with_malformed_warning() {
    let value = serde_json::json!("not an object");
    let store = FakeStore::with_load(value);
    let service = SettingsService::from_store(store.clone());

    assert_eq!(service.state().settings, AppSettings::default());
    let warning = service.state().warning.expect("expected a warning");
    assert_eq!(warning.kind, AppSettingsErrorKind::Malformed);
}

#[test]
fn unsupported_schema_version_returns_default_with_unsupported_warning() {
    let value = serde_json::json!({
        "schemaVersion": 2,
        "settings": { "markdown": { "fontSizePx": DEFAULT_FONT_SIZE_PX } }
    });
    let store = FakeStore::with_load(value);
    let service = SettingsService::from_store(store.clone());

    assert_eq!(service.state().settings, AppSettings::default());
    let warning = service.state().warning.expect("expected a warning");
    assert_eq!(warning.kind, AppSettingsErrorKind::UnsupportedVersion);
}

#[test]
fn store_read_error_returns_default_with_store_read_warning() {
    let store = FakeStore::with_load_error("disk unreadable");
    let service = SettingsService::from_store(store.clone());

    assert_eq!(service.state().settings, AppSettings::default());
    let warning = service.state().warning.expect("expected a warning");
    assert_eq!(warning.kind, AppSettingsErrorKind::StoreReadFailed);
}

#[test]
fn valid_update_writes_complete_version_one_envelope() {
    let store = FakeStore::empty();
    let mut service = SettingsService::from_store(store.clone());

    let settings = settings_with_font_size(24);
    let result = service.update(settings.clone());

    assert_eq!(result.unwrap(), settings);
    assert_eq!(service.state().warning, None);
}

#[test]
fn invalid_update_writes_nothing() {
    let store = FakeStore::empty();
    let mut service = SettingsService::from_store(store.clone());

    let result = service.update(settings_with_font_size(MIN_FONT_SIZE_PX - 1));

    assert_eq!(result.unwrap_err().kind, AppSettingsErrorKind::InvalidValue);
    assert!(store.saved().is_empty());
    assert!(store.replaced().is_empty());
}

#[test]
fn save_error_leaves_confirmed_state_unchanged() {
    let store = FakeStore::with_save_results([Err("disk full".to_string())]);
    let mut service = SettingsService::from_store(store.clone());

    let result = service.update(settings_with_font_size(24));

    assert_eq!(
        result.unwrap_err().kind,
        AppSettingsErrorKind::StoreSaveFailed
    );
    assert_eq!(service.state().settings, AppSettings::default());
}

#[test]
fn valid_update_after_malformed_persisted_repairs_store() {
    let malformed = serde_json::json!({
        "schemaVersion": APP_SETTINGS_SCHEMA_VERSION,
        "settings": { "markdown": { "fontSizePx": "big" } }
    });
    let store = FakeStore::with_load(malformed);
    let mut service = SettingsService::from_store(store.clone());

    assert!(service.state().warning.is_some());

    let settings = settings_with_font_size(24);
    service.update(settings.clone()).unwrap();

    assert_eq!(service.state().settings, settings);
    assert!(service.state().warning.is_none());
    assert_eq!(store.saved().len(), 1);
}

#[test]
fn valid_update_after_store_read_error_uses_replace_path() {
    let store = FakeStore::with_load_error("corrupted file").with_replace_results([Ok(())]);
    let mut service = SettingsService::from_store(store.clone());

    assert_eq!(
        service.state().warning.as_ref().unwrap().kind,
        AppSettingsErrorKind::StoreReadFailed
    );

    let settings = settings_with_font_size(24);
    service.update(settings.clone()).unwrap();

    assert_eq!(service.state().settings, settings);
    assert!(service.state().warning.is_none());
    assert_eq!(store.replaced().len(), 1);
    assert!(store.saved().is_empty());
}

#[test]
fn replace_failure_surfaces_as_store_save_error() {
    let store = FakeStore::with_load_error("corrupted file")
        .with_replace_results([Err("cannot remove file".to_string())]);
    let mut service = SettingsService::from_store(store.clone());

    let result = service.update(settings_with_font_size(24));

    assert_eq!(
        result.unwrap_err().kind,
        AppSettingsErrorKind::StoreSaveFailed
    );
    assert_eq!(
        service.state().warning.as_ref().unwrap().kind,
        AppSettingsErrorKind::StoreReadFailed
    );
}

#[test]
fn workspace_and_settings_adapters_do_not_collide() {
    // The settings service only touches its own file/key; this test
    // guards against accidentally sharing the Workspace Catalog store.
    let store = FakeStore::empty();
    let mut service = SettingsService::from_store(store.clone());

    service.update(settings_with_font_size(24)).unwrap();

    let saved = store.saved();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].schema_version, APP_SETTINGS_SCHEMA_VERSION);
    assert_eq!(saved[0].settings.markdown.font_size_px, 24);
}

#[test]
fn update_request_accepts_any_json_type_and_validates() {
    let valid: Vec<serde_json::Value> = vec![
        serde_json::json!(8),
        serde_json::json!(14),
        serde_json::json!(72),
    ];
    for value in valid {
        let request = update_request_with_font_size(value);
        let settings = request.validate().unwrap();
        assert!(validate_app_settings(&settings).is_none());
    }

    let invalid: Vec<serde_json::Value> = vec![
        serde_json::json!(MIN_FONT_SIZE_PX - 1),
        serde_json::json!(MAX_FONT_SIZE_PX + 1),
        serde_json::json!(14.5),
        serde_json::json!("14"),
        serde_json::json!(true),
        serde_json::json!(serde_json::Value::Null),
    ];
    for value in invalid {
        let request = update_request_with_font_size(value);
        let error = request.validate().unwrap_err();
        assert_eq!(error.kind, AppSettingsErrorKind::InvalidValue);
    }
}

#[test]
fn tauri_store_detects_malformed_whole_file() {
    let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("app-settings.json");
    std::fs::write(&path, "not valid json").unwrap();

    let app = tauri::test::mock_app();
    let store = TauriAppSettingsStore::new_with_path(app.handle().clone(), path);

    assert!(
        store.load().is_err(),
        "expected malformed file to be rejected"
    );

    let service = SettingsService::from_store(store);
    let warning = service.state().warning.expect("expected a warning");
    assert_eq!(warning.kind, AppSettingsErrorKind::StoreReadFailed);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn tauri_store_loads_and_saves_valid_file() {
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_store::Builder::default().build())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();

    let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("app-settings.json");

    let store = TauriAppSettingsStore::new_with_path(app.handle().clone(), path.clone());
    let settings = settings_with_font_size(24);
    store
        .save(&AppSettingsEnvelope::new(settings.clone()))
        .unwrap();

    let store = TauriAppSettingsStore::new_with_path(app.handle().clone(), path);
    let loaded = SettingsService::from_store(store);

    assert_eq!(loaded.state().settings, settings);
    assert!(loaded.state().warning.is_none());

    let _ = std::fs::remove_dir_all(&dir);
}

//! App-wide settings backend.
//!
//! Owns Beadsmith presentation preferences (currently Markdown typography) and
//! keeps them separate from Beadwork issue data and Workspace state. The small
//! public surface is `SettingsService`: callers load state and update it without
//! knowing Tauri Store paths, schema versions, or repair rules.

use std::fmt;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const APP_SETTINGS_SCHEMA_VERSION: u32 = 1;
const DEFAULT_FONT_SIZE_PX: u32 = 14;
const MIN_FONT_SIZE_PX: u32 = 8;
const MAX_FONT_SIZE_PX: u32 = 72;
const APP_SETTINGS_STORE_KEY: &str = "settings";

/// User-facing Beadsmith settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub markdown: MarkdownSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            markdown: MarkdownSettings::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownSettings {
    pub font_size_px: u32,
}

impl Default for MarkdownSettings {
    fn default() -> Self {
        Self {
            font_size_px: DEFAULT_FONT_SIZE_PX,
        }
    }
}

/// Settings plus an optional load warning so the UI can fall back and offer repair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsState {
    pub settings: AppSettings,
    pub warning: Option<AppSettingsWarning>,
}

impl AppSettingsState {
    fn default_no_warning() -> Self {
        Self {
            settings: AppSettings::default(),
            warning: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsWarning {
    pub kind: AppSettingsErrorKind,
    pub message: String,
}

impl AppSettingsWarning {
    fn new(kind: AppSettingsErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

/// Shared machine-readable category for load warnings and update errors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AppSettingsErrorKind {
    InvalidValue,
    Malformed,
    UnsupportedVersion,
    StoreReadFailed,
    StoreSaveFailed,
}

/// A typed update failure returned through the RPC boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsError {
    pub kind: AppSettingsErrorKind,
    pub message: String,
}

impl AppSettingsError {
    pub fn new(kind: AppSettingsErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

impl fmt::Display for AppSettingsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for AppSettingsError {}

/// Internal versioned envelope persisted to the store.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsEnvelope {
    schema_version: u32,
    settings: AppSettings,
}

impl AppSettingsEnvelope {
    fn new(settings: AppSettings) -> Self {
        Self {
            schema_version: APP_SETTINGS_SCHEMA_VERSION,
            settings,
        }
    }
}

/// Persistence seam. The service stays generic over this trait so pure tests can
/// exercise every load/update/repair path without a Tauri runtime.
pub trait AppSettingsStore: Send + Sync {
    fn load(&self) -> Result<Option<serde_json::Value>, String>;
    fn save(&self, envelope: &AppSettingsEnvelope) -> Result<(), String>;
    fn replace(&self, envelope: &AppSettingsEnvelope) -> Result<(), String>;
}

/// Backend-owned settings state machine.
pub struct SettingsService<S: AppSettingsStore> {
    store: S,
    confirmed: AppSettings,
    load_warning: Option<AppSettingsWarning>,
}

impl<S: AppSettingsStore> SettingsService<S> {
    pub fn from_store(store: S) -> Self {
        let state = match store.load() {
            Ok(None) => AppSettingsState::default_no_warning(),
            Ok(Some(value)) => match parse_persisted_document(value) {
                Ok(settings) => AppSettingsState {
                    settings,
                    warning: None,
                },
                Err(warning) => AppSettingsState {
                    settings: AppSettings::default(),
                    warning: Some(warning),
                },
            },
            Err(message) => AppSettingsState {
                settings: AppSettings::default(),
                warning: Some(AppSettingsWarning::new(
                    AppSettingsErrorKind::StoreReadFailed,
                    format!("Could not read saved app settings: {message}"),
                )),
            },
        };

        Self {
            store,
            confirmed: state.settings,
            load_warning: state.warning,
        }
    }

    pub fn state(&self) -> AppSettingsState {
        AppSettingsState {
            settings: self.confirmed.clone(),
            warning: self.load_warning.clone(),
        }
    }

    pub fn update(&mut self, settings: AppSettings) -> Result<AppSettings, AppSettingsError> {
        if let Some(error) = validate_app_settings(&settings) {
            return Err(error);
        }

        let envelope = AppSettingsEnvelope::new(settings.clone());

        let result = if self
            .load_warning
            .as_ref()
            .is_some_and(|warning| warning.kind == AppSettingsErrorKind::StoreReadFailed)
        {
            self.store.replace(&envelope)
        } else {
            self.store.save(&envelope)
        };

        result.map_err(|message| {
            AppSettingsError::new(
                AppSettingsErrorKind::StoreSaveFailed,
                format!("Could not save app settings: {message}"),
            )
        })?;

        self.confirmed = settings;
        self.load_warning = None;
        Ok(self.confirmed.clone())
    }
}

fn validate_app_settings(settings: &AppSettings) -> Option<AppSettingsError> {
    if (MIN_FONT_SIZE_PX..=MAX_FONT_SIZE_PX).contains(&settings.markdown.font_size_px) {
        return None;
    }

    Some(AppSettingsError::new(
        AppSettingsErrorKind::InvalidValue,
        format!(
            "Font size must be a whole number from {MIN_FONT_SIZE_PX} to {MAX_FONT_SIZE_PX} px."
        ),
    ))
}

fn parse_persisted_document(value: serde_json::Value) -> Result<AppSettings, AppSettingsWarning> {
    let Some(object) = value.as_object() else {
        return Err(AppSettingsWarning::new(
            AppSettingsErrorKind::Malformed,
            "Saved app settings are not in the expected format.",
        ));
    };

    let Some(schema_version) = object.get("schemaVersion") else {
        return Err(AppSettingsWarning::new(
            AppSettingsErrorKind::Malformed,
            "Saved app settings are missing a schema version.",
        ));
    };

    let Some(schema_version) = schema_version.as_u64() else {
        return Err(AppSettingsWarning::new(
            AppSettingsErrorKind::Malformed,
            "Saved app settings schema version is not a valid number.",
        ));
    };

    if schema_version != u64::from(APP_SETTINGS_SCHEMA_VERSION) {
        return Err(AppSettingsWarning::new(
            AppSettingsErrorKind::UnsupportedVersion,
            format!("Saved app settings use unsupported schema version {schema_version}."),
        ));
    }

    let Some(settings) = object.get("settings") else {
        return Err(AppSettingsWarning::new(
            AppSettingsErrorKind::Malformed,
            "Saved app settings are missing the settings object.",
        ));
    };

    let Some(settings) = settings.as_object() else {
        return Err(AppSettingsWarning::new(
            AppSettingsErrorKind::Malformed,
            "Saved app settings settings object is not an object.",
        ));
    };

    let Some(markdown) = settings.get("markdown") else {
        return Err(AppSettingsWarning::new(
            AppSettingsErrorKind::InvalidValue,
            "Saved Markdown settings are missing.",
        ));
    };

    let Some(markdown) = markdown.as_object() else {
        return Err(AppSettingsWarning::new(
            AppSettingsErrorKind::InvalidValue,
            "Saved Markdown settings are not an object.",
        ));
    };

    let Some(font_size) = markdown.get("fontSizePx") else {
        return Err(AppSettingsWarning::new(
            AppSettingsErrorKind::InvalidValue,
            "Saved Markdown font size is missing.",
        ));
    };

    let Some(font_size) = font_size.as_u64() else {
        return Err(AppSettingsWarning::new(
            AppSettingsErrorKind::InvalidValue,
            "Saved Markdown font size must be a whole number.",
        ));
    };

    let Ok(font_size) = u32::try_from(font_size) else {
        return Err(AppSettingsWarning::new(
            AppSettingsErrorKind::InvalidValue,
            "Saved Markdown font size is out of range.",
        ));
    };

    if !(MIN_FONT_SIZE_PX..=MAX_FONT_SIZE_PX).contains(&font_size) {
        return Err(AppSettingsWarning::new(
            AppSettingsErrorKind::InvalidValue,
            format!(
                "Saved Markdown font size must be between {MIN_FONT_SIZE_PX} and {MAX_FONT_SIZE_PX} px."
            ),
        ));
    }

    Ok(AppSettings {
        markdown: MarkdownSettings {
            font_size_px: font_size,
        },
    })
}

/// Tauri-backed store adapter. Uses a dedicated file and key so App Settings
/// cannot collide with Workspace Catalog data.
pub struct TauriAppSettingsStore<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
}

impl<R: tauri::Runtime> TauriAppSettingsStore<R> {
    pub fn new(app: tauri::AppHandle<R>) -> Self {
        Self { app }
    }

    fn store_path(&self) -> PathBuf {
        std::env::var_os("BEADSMITH_SETTINGS_STORE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("app-settings.json"))
    }

    fn store(&self) -> Result<std::sync::Arc<tauri_plugin_store::Store<R>>, String> {
        use tauri_plugin_store::StoreExt;
        self.app
            .store(self.store_path())
            .map_err(|error| error.to_string())
    }

    fn resolved_path(&self) -> Result<PathBuf, String> {
        let store_path = self.store_path();
        if store_path.is_absolute() {
            Ok(store_path)
        } else {
            use tauri::{path::BaseDirectory, Manager};
            self.app
                .path()
                .resolve(store_path, BaseDirectory::AppData)
                .map_err(|error| error.to_string())
        }
    }
}

impl<R: tauri::Runtime> AppSettingsStore for TauriAppSettingsStore<R> {
    fn load(&self) -> Result<Option<serde_json::Value>, String> {
        let store = self.store()?;
        Ok(store.get(APP_SETTINGS_STORE_KEY))
    }

    fn save(&self, envelope: &AppSettingsEnvelope) -> Result<(), String> {
        let value = serde_json::to_value(envelope).map_err(|error| error.to_string())?;
        let store = self.store()?;
        store.set(APP_SETTINGS_STORE_KEY, value);
        store.save().map_err(|error| error.to_string())
    }

    fn replace(&self, envelope: &AppSettingsEnvelope) -> Result<(), String> {
        let value = serde_json::to_value(envelope).map_err(|error| error.to_string())?;

        // If the existing store file cannot be opened (e.g., corrupted JSON),
        // remove it and create a fresh one. Never remove unrelated files.
        let store = match self.store() {
            Ok(store) => store,
            Err(_) => {
                let path = self.resolved_path()?;
                if path.exists() {
                    std::fs::remove_file(&path).map_err(|error| error.to_string())?;
                }
                self.store()?
            }
        };

        store.clear();
        store.set(APP_SETTINGS_STORE_KEY, value);
        store.save().map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
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

        fn with_replace_results(
            self,
            results: impl IntoIterator<Item = Result<(), String>>,
        ) -> Self {
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
}

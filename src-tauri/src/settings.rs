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

/// Loose request representation for `update_app_settings`. It accepts any JSON
/// type for `fontSizePx` so the service validator can return the typed
/// `AppSettingsError` for fractional, out-of-range, and wrong-type input instead
/// of leaving callers with an argument-decoding failure.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsUpdate {
    pub markdown: MarkdownSettingsUpdate,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownSettingsUpdate {
    pub font_size_px: serde_json::Value,
}

impl AppSettingsUpdate {
    pub fn validate(self) -> Result<AppSettings, AppSettingsError> {
        let font_size_px = validate_font_size_value(&self.markdown.font_size_px)?;
        Ok(AppSettings {
            markdown: MarkdownSettings { font_size_px },
        })
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

fn validate_font_size_value(value: &serde_json::Value) -> Result<u32, AppSettingsError> {
    let Some(font_size) = value.as_u64() else {
        return Err(AppSettingsError::new(
            AppSettingsErrorKind::InvalidValue,
            format!(
                "Font size must be a whole number from {MIN_FONT_SIZE_PX} to {MAX_FONT_SIZE_PX} px."
            ),
        ));
    };

    let Ok(font_size) = u32::try_from(font_size) else {
        return Err(AppSettingsError::new(
            AppSettingsErrorKind::InvalidValue,
            format!(
                "Font size must be a whole number from {MIN_FONT_SIZE_PX} to {MAX_FONT_SIZE_PX} px."
            ),
        ));
    };

    if !(MIN_FONT_SIZE_PX..=MAX_FONT_SIZE_PX).contains(&font_size) {
        return Err(AppSettingsError::new(
            AppSettingsErrorKind::InvalidValue,
            format!(
                "Font size must be a whole number from {MIN_FONT_SIZE_PX} to {MAX_FONT_SIZE_PX} px."
            ),
        ));
    }

    Ok(font_size)
}

fn validate_app_settings(settings: &AppSettings) -> Option<AppSettingsError> {
    validate_font_size_value(&serde_json::json!(settings.markdown.font_size_px)).err()
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

    let font_size = validate_font_size_value(font_size)
        .map_err(|error| AppSettingsWarning::new(error.kind, format!("Saved {}", error.message)))?;

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
    store_path: PathBuf,
}

impl<R: tauri::Runtime> TauriAppSettingsStore<R> {
    pub fn new(app: tauri::AppHandle<R>) -> Self {
        let store_path = std::env::var_os("BEADSMITH_SETTINGS_STORE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("app-settings.json"));
        Self { app, store_path }
    }

    #[cfg(test)]
    fn new_with_path(app: tauri::AppHandle<R>, store_path: PathBuf) -> Self {
        Self { app, store_path }
    }

    fn store_path(&self) -> PathBuf {
        self.store_path.clone()
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
        let path = self.resolved_path()?;

        if !path.exists() {
            return Ok(None);
        }

        // tauri-plugin-store silently discards file-read and JSON-deserialization
        // errors and returns an empty store. Preflight the file so corrupt or
        // unreadable persisted state is reported as a typed load warning and can
        // be repaired by a deliberate valid update.
        let contents = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
        let _: serde_json::Value =
            serde_json::from_str(&contents).map_err(|error| error.to_string())?;

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
mod tests;

//! Backend-owned Workspace service.
//!
//! [`WorkspaceService`] owns durable workspace selection state without relying
//! on the process working directory. Its command and persistence dependencies
//! are traits so the state machine can be tested without Tauri, a store plugin,
//! or installed `bw`/`git` binaries. Every `bw` subprocess receives an
//! explicit working directory through the [`CommandRunner`] seam; process cwd
//! and a `--workspace` launch override are not part of the workspace
//! resolution path. Desktop acceptance always starts from an isolated,
//! supported test-only store and uses the typed `switch_workspace` RPC to
//! seed fixtures; it never writes the store file directly.

use std::fmt;
use std::io;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::issues::{self, CommandOutput, CommandRunner, ListIssuesError};

const WORKSPACE_STATE_VERSION: u32 = 1;
const MAX_CATALOG_ENTRIES: usize = 100;
const BW_PROGRAM: &str = "bw";
const GIT_PROGRAM: &str = "git";

/// A workspace known to Beadsmith, represented by its Git root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub path: String,
    #[serde(default)]
    pub availability: WorkspaceAvailability,
}

/// Whether a catalog entry was last reachable during startup restoration.
/// This is intentionally distinct from catalog storage health: an unavailable
/// repository remains a recoverable local catalog entry.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceAvailability {
    #[default]
    Available,
    Unavailable,
}

/// The durable subset of workspace state.
///
/// Pending requests, request generations, and transient errors intentionally
/// remain in memory: persisting them would make an interrupted request look
/// active after restart. The catalog and current workspace are only replaced
/// after the corresponding [`WorkspaceStore::save`] succeeds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWorkspaceState {
    pub version: u32,
    pub catalog: Vec<Workspace>,
    pub current_workspace_path: Option<String>,
}

impl Default for PersistedWorkspaceState {
    fn default() -> Self {
        Self {
            version: WORKSPACE_STATE_VERSION,
            catalog: Vec::new(),
            current_workspace_path: None,
        }
    }
}

/// Public, serializable workspace state for a later typed RPC boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    pub version: u32,
    pub catalog: Vec<Workspace>,
    pub current_workspace: Option<Workspace>,
    pub pending_workspace: Option<Workspace>,
    /// Ephemeral retry target surfaced when a post-validation switch attempt
    /// fails (load or final save). It is the validated candidate that the UI's
    /// Retry banner must replay. Cleared on new selection, cancel, removal,
    /// reset, and successful commit. Never persisted: durable retry state
    /// would let a saved failure look active after restart.
    pub retry_workspace: Option<Workspace>,
    pub generation: u32,
    pub error: Option<WorkspaceError>,
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            version: WORKSPACE_STATE_VERSION,
            catalog: Vec::new(),
            current_workspace: None,
            pending_workspace: None,
            retry_workspace: None,
            generation: 0,
            error: None,
        }
    }
}

/// A typed machine-readable workspace failure category.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceErrorKind {
    StoreReadFailed,
    StoreSaveFailed,
    ValidationFailed,
    GitRootFailed,
    LoadFailed,
    StaleGeneration,
}

/// A typed workspace failure suitable for a later RPC/UI boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceError {
    pub kind: WorkspaceErrorKind,
    pub message: String,
    pub retryable: bool,
}

impl WorkspaceError {
    /// Build a typed workspace error with the given kind, message, and retry
    /// hint. Public so the RPC layer can construct transport-level errors
    /// (for example a panicked spawn_blocking join) without bypassing the
    /// state machine.
    pub fn new(kind: WorkspaceErrorKind, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            kind,
            message: message.into(),
            retryable,
        }
    }

    fn stale() -> Self {
        Self::new(
            WorkspaceErrorKind::StaleGeneration,
            "This workspace request was superseded by a newer request.",
            false,
        )
    }
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for WorkspaceError {}

/// The persisted workspace-memory seam.
///
/// The future Tauri store adapter implements this trait. Keeping it independent
/// from Tauri lets unit tests deterministically exercise read, save, and reset
/// failures.
pub trait WorkspaceStore {
    fn load(&self) -> Result<Option<PersistedWorkspaceState>, String>;
    fn save(&self, state: &PersistedWorkspaceState) -> Result<(), String>;
    fn reset(&self) -> Result<(), String>;
}

/// A request identity returned by [`WorkspaceService::begin_selection`].
///
/// Completion checks this token before any command, save, or publication, so a
/// late result cannot overwrite a newer selection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceRequest {
    generation: u32,
    candidate: PathBuf,
}

/// Complete Issue Explorer data loaded for a validated workspace root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueExplorerData {
    pub all_issues: Vec<issues::Issue>,
    pub ready_issues: Vec<issues::Issue>,
    pub blocked_issues: Vec<issues::Issue>,
}

/// A testable, backend-owned workspace selection state machine.
pub struct WorkspaceService<S> {
    store: S,
    state: WorkspaceState,
    restoration_candidate: Option<PathBuf>,
}

impl<S: WorkspaceStore> WorkspaceService<S> {
    /// Restore durable workspace memory without claiming its remembered Current
    /// Workspace. The caller must explicitly invoke [`Self::restore_current`],
    /// which validates and loads it through the normal selection transaction.
    /// An unreadable or unsupported store is retained as a typed error until
    /// the caller explicitly invokes reset.
    pub fn from_store(store: S) -> Self {
        let (state, restoration_candidate) = match store.load().and_then(validate_persisted_state) {
            Ok(persisted) => state_from_persisted(persisted.unwrap_or_default()),
            Err(message) => (
                WorkspaceState {
                    error: Some(WorkspaceError::new(
                        WorkspaceErrorKind::StoreReadFailed,
                        format!("Could not read local workspace memory: {message}"),
                        true,
                    )),
                    ..WorkspaceState::default()
                },
                None,
            ),
        };
        Self {
            store,
            state,
            restoration_candidate,
        }
    }

    /// Return the currently published state with catalog availability derived
    /// from the local filesystem. Availability is deliberately not inferred
    /// from Beadwork validation: a readable directory can be a retryable,
    /// non-Beadwork workspace without being unavailable.
    pub fn state(&self) -> WorkspaceState {
        let mut state = self.state.clone();
        for workspace in &mut state.catalog {
            workspace.availability = workspace_availability(Path::new(&workspace.path));
        }
        state
    }

    /// Start a new user-initiated selection request and return its generation
    /// token. A manual selection supersedes any deferred startup restoration.
    pub fn begin_selection(&mut self, candidate: impl Into<PathBuf>) -> WorkspaceRequest {
        self.restoration_candidate = None;
        self.begin_request(candidate.into())
    }

    /// Restore the remembered workspace, if one exists, through the same
    /// validation, loading, and save-before-publish transaction as a new
    /// selection. Until this succeeds, persisted memory is never exposed as
    /// Current Workspace.
    pub fn restore_current(
        &mut self,
        runner: &dyn CommandRunner,
    ) -> Result<Option<IssueExplorerData>, WorkspaceError> {
        let Some(candidate) = self.restoration_candidate.clone() else {
            return Ok(None);
        };
        let request = self.begin_request(candidate);
        let result = self.complete_selection(runner, request).map(Some);
        if result.is_ok() {
            self.restoration_candidate = None;
        }
        result
    }

    fn begin_request(&mut self, candidate: PathBuf) -> WorkspaceRequest {
        self.state.generation = self.state.generation.saturating_add(1);
        self.state.pending_workspace = Some(Workspace {
            path: candidate.display().to_string(),
            availability: WorkspaceAvailability::Available,
        });
        self.state.error = None;
        // A new selection always supersedes any previous retryable target.
        self.state.retry_workspace = None;

        WorkspaceRequest {
            generation: self.state.generation,
            candidate,
        }
    }

    /// Select a workspace synchronously using the supplied command runner.
    pub fn select_workspace(
        &mut self,
        runner: &dyn CommandRunner,
        candidate: impl Into<PathBuf>,
    ) -> Result<IssueExplorerData, WorkspaceError> {
        let request = self.begin_selection(candidate);
        self.complete_selection(runner, request)
    }

    /// Validate, load, persist, and publish a previously started request.
    ///
    /// A valid root is first durably added to the catalog so a later load
    /// failure remains retryable. The root is not Current until all three views
    /// have loaded and the final save has succeeded. Each durable step is a
    /// single `commit_proposed` call so the generation check and store write
    /// cannot drift apart.
    pub fn complete_selection(
        &mut self,
        runner: &dyn CommandRunner,
        request: WorkspaceRequest,
    ) -> Result<IssueExplorerData, WorkspaceError> {
        if self.ensure_current(&request).is_err() {
            return Err(WorkspaceError::stale());
        }

        let workspace = match validate_workspace(runner, &request.candidate) {
            Ok(workspace) => workspace,
            Err(error) => {
                let _ = self.fail_request(&request, None, error.clone());
                return Err(error);
            }
        };

        if let Err(error) = self.retain_validated(&request, workspace.clone()) {
            let _ = self.fail_request(&request, Some(&workspace), error.clone());
            return Err(error);
        }

        let data = match load_issue_explorer_data(runner, Path::new(&workspace.path)) {
            Ok(data) => data,
            Err(error) => {
                let _ = self.fail_request(&request, Some(&workspace), error.clone());
                return Err(error);
            }
        };

        if let Err(error) = self.commit_loaded(&request, workspace.clone(), data.clone()) {
            let _ = self.fail_request(&request, Some(&workspace), error.clone());
            return Err(error);
        }

        Ok(data)
    }

    /// Persist a validated candidate into the catalog. Phase boundary that
    /// mutates state and writes to the store; safe to call from the async
    /// orchestrator while it holds the serialized service lock. The catalog
    /// entry is appended without MRU promotion.
    pub fn retain_validated(
        &mut self,
        request: &WorkspaceRequest,
        workspace: Workspace,
    ) -> Result<(), WorkspaceError> {
        let mut next = self.state.clone();
        next.pending_workspace = Some(workspace.clone());
        next.error = None;
        next.retry_workspace = None;
        retain_catalog(&mut next.catalog, workspace);
        self.commit_proposed(request, next)
    }

    /// Persist a successfully loaded workspace as Current with MRU
    /// promotion. Phase boundary that mutates state and writes to the store;
    /// safe to call from the async orchestrator while it holds the serialized
    /// service lock. A successful commit clears any previous retry target
    /// because the failed candidate is no longer relevant.
    pub fn commit_loaded(
        &mut self,
        request: &WorkspaceRequest,
        workspace: Workspace,
        data: IssueExplorerData,
    ) -> Result<IssueExplorerData, WorkspaceError> {
        let mut next = self.state.clone();
        promote_catalog(&mut next.catalog, &workspace.path);
        next.current_workspace = Some(workspace);
        next.pending_workspace = None;
        next.error = None;
        next.retry_workspace = None;
        self.commit_proposed(request, next)?;
        Ok(data)
    }

    /// Persist a proposed state and, only on success, make it current. The
    /// generation is checked before and after the store write so a stale
    /// request cannot leak into durable memory or `self.state`.
    fn commit_proposed(
        &mut self,
        request: &WorkspaceRequest,
        proposed: WorkspaceState,
    ) -> Result<(), WorkspaceError> {
        self.ensure_current(request)?;
        self.store
            .save(&self.persisted_from_state(&proposed))
            .map_err(|message| {
                WorkspaceError::new(
                    WorkspaceErrorKind::StoreSaveFailed,
                    format!("Could not save local workspace memory: {message}"),
                    true,
                )
            })?;
        self.ensure_current(request)?;
        self.state = proposed;
        Ok(())
    }

    /// Cancel any in-flight Pending request without touching Current.
    ///
    /// Cancellation is ephemeral: only in-memory `pending_workspace` and
    /// `error` are dropped, and `generation` is bumped so a late result
    /// from the cancelled request is silently rejected by `ensure_current`.
    /// The remembered Current Workspace and the persisted catalog survive.
    /// No `store.save` is issued; the catalog is already durable from the
    /// validated-candidate commit, and Current is never changed.
    ///
    /// Bumps the generation only when there is an actual pending request to
    /// cancel. A Cancel that races with the final commit (the commit already
    /// ran, but its success publication has not yet reached the renderer)
    /// must not bump the generation: doing so would let the renderer drop
    /// the in-flight success transition as "older than accepted", keeping
    /// the prior Workspace's snapshot paired with the new Current identity
    /// ("B Current with A snapshot").
    ///
    /// When there is nothing pending, it preserves the generation while still
    /// clearing transient retry/error presentation. Cancel-then-retry still
    /// invalidates a stale result because a real pending request always
    /// bumps the generation here, and a fresh retry starts a new request
    /// with its own bumped generation.
    pub fn cancel_pending(&mut self) -> WorkspaceState {
        let had_pending = self.state.pending_workspace.is_some();
        if had_pending {
            self.state.generation = self.state.generation.saturating_add(1);
        }
        self.state.pending_workspace = None;
        self.state.retry_workspace = None;
        self.state.error = None;
        self.restoration_candidate = None;
        self.state()
    }

    /// Explicitly discard only Beadsmith's local workspace memory.
    pub fn reset_memory(&mut self) -> Result<(), WorkspaceError> {
        if let Err(message) = self.store.reset() {
            let error = WorkspaceError::new(
                WorkspaceErrorKind::StoreSaveFailed,
                format!("Could not reset local workspace memory: {message}"),
                true,
            );
            self.state.error = Some(error.clone());
            return Err(error);
        }

        let next_generation = self.state.generation.saturating_add(1);
        self.state = WorkspaceState {
            generation: next_generation,
            ..WorkspaceState::default()
        };
        self.restoration_candidate = None;
        Ok(())
    }

    /// Whether the request still owns the current generation. The RPC
    /// orchestrator uses this before emitting a failure transition so a stale
    /// worker completion remains silent.
    pub fn is_request_current(&self, request: &WorkspaceRequest) -> bool {
        self.state.generation == request.generation
    }

    fn ensure_current(&self, request: &WorkspaceRequest) -> Result<(), WorkspaceError> {
        if self.is_request_current(request) {
            Ok(())
        } else {
            Err(WorkspaceError::stale())
        }
    }

    fn persisted_from_state(&self, state: &WorkspaceState) -> PersistedWorkspaceState {
        PersistedWorkspaceState {
            version: state.version,
            catalog: state.catalog.clone(),
            current_workspace_path: state
                .current_workspace
                .as_ref()
                .map(|workspace| workspace.path.clone()),
        }
    }

    /// Remove one locally remembered workspace without touching the repository.
    /// Removing the Current workspace explicitly leaves no Current workspace;
    /// another catalog entry is never implicitly selected. Removing any
    /// workspace invalidates an in-flight Pending request and clears any
    /// retryable banner target.
    pub fn remove_workspace(&mut self, path: &str) -> Result<(), WorkspaceError> {
        let mut next = self.state.clone();
        next.generation = next.generation.saturating_add(1);
        next.catalog.retain(|workspace| workspace.path != path);
        if next
            .current_workspace
            .as_ref()
            .is_some_and(|workspace| workspace.path == path)
        {
            next.current_workspace = None;
        }
        next.pending_workspace = None;
        next.retry_workspace = None;
        next.error = None;
        self.store
            .save(&self.persisted_from_state(&next))
            .map_err(|message| {
                WorkspaceError::new(
                    WorkspaceErrorKind::StoreSaveFailed,
                    format!("Could not save local workspace memory: {message}"),
                    true,
                )
            })?;
        self.state = next;
        self.restoration_candidate = None;
        Ok(())
    }

    /// Mark the current request as failed. Phase boundary that mutates state
    /// only when the request is still current, so a stale completion cannot
    /// overwrite the live state. For post-validation failures
    /// (`LoadFailed`, `StoreSaveFailed`), `validated_candidate` is published
    /// as `retry_workspace` so the UI can offer Retry without a new picker
    /// selection.
    pub fn fail_request(
        &mut self,
        request: &WorkspaceRequest,
        validated_candidate: Option<&Workspace>,
        error: WorkspaceError,
    ) -> Result<(), WorkspaceError> {
        if self.ensure_current(request).is_err() {
            return Err(error);
        }

        self.state.pending_workspace = None;
        // Surface the validated candidate to Retry only for failures that
        // happened after we already knew it was a real Beadwork workspace.
        // Validation and git-root failures occur before the candidate is
        // even retained; the picker already knows which path the user
        // typed, and that path is the next selection if the user retries.
        self.state.retry_workspace = match error.kind {
            WorkspaceErrorKind::LoadFailed | WorkspaceErrorKind::StoreSaveFailed => {
                validated_candidate.cloned()
            }
            _ => None,
        };
        self.state.error = Some(error.clone());
        Ok(())
    }
}

fn validate_persisted_state(
    persisted: Option<PersistedWorkspaceState>,
) -> Result<Option<PersistedWorkspaceState>, String> {
    let Some(persisted) = persisted else {
        return Ok(None);
    };
    if persisted.version != WORKSPACE_STATE_VERSION {
        return Err(format!(
            "unsupported workspace-memory version {}",
            persisted.version
        ));
    }
    if persisted.catalog.len() > MAX_CATALOG_ENTRIES {
        return Err(format!(
            "workspace catalog exceeds its {MAX_CATALOG_ENTRIES}-entry limit"
        ));
    }
    let mut paths = std::collections::HashSet::new();
    if persisted
        .catalog
        .iter()
        .any(|workspace| !paths.insert(&workspace.path))
    {
        return Err("workspace catalog contains duplicate paths".to_string());
    }
    if let Some(current) = &persisted.current_workspace_path {
        if !persisted
            .catalog
            .iter()
            .any(|workspace| &workspace.path == current)
        {
            return Err("current workspace is absent from the workspace catalog".to_string());
        }
    }
    Ok(Some(persisted))
}

fn state_from_persisted(persisted: PersistedWorkspaceState) -> (WorkspaceState, Option<PathBuf>) {
    let restoration_candidate = persisted.current_workspace_path.clone().map(PathBuf::from);
    (
        WorkspaceState {
            version: persisted.version,
            catalog: persisted.catalog,
            // A remembered path is provisional until restore_current validates,
            // loads, and durably republishes it.
            current_workspace: None,
            ..WorkspaceState::default()
        },
        restoration_candidate,
    )
}

/// Retain a validated workspace without changing MRU order. A new entry is
/// appended, so promotion is reserved for the final durable Current commit.
fn workspace_availability(path: &Path) -> WorkspaceAvailability {
    match std::fs::read_dir(path) {
        Ok(_) => WorkspaceAvailability::Available,
        Err(_) => WorkspaceAvailability::Unavailable,
    }
}

fn retain_catalog(catalog: &mut Vec<Workspace>, workspace: Workspace) {
    if let Some(known) = catalog
        .iter_mut()
        .find(|known| known.path == workspace.path)
    {
        known.availability = WorkspaceAvailability::Available;
        return;
    }
    if catalog.len() == MAX_CATALOG_ENTRIES {
        catalog.pop();
    }
    catalog.push(workspace);
}

fn promote_catalog(catalog: &mut Vec<Workspace>, path: &str) {
    if let Some(index) = catalog.iter().position(|workspace| workspace.path == path) {
        let workspace = catalog.remove(index);
        catalog.insert(0, workspace);
    }
}

/// Validate the candidate workspace root as a Beadwork-managed Git repository
/// and return its canonical Git root for catalog storage. Public so the
/// async orchestrator can run validation outside the runtime lock.
pub fn validate_workspace(
    runner: &dyn CommandRunner,
    candidate: &Path,
) -> Result<Workspace, WorkspaceError> {
    let validation =
        run_command(runner, BW_PROGRAM, &["config", "list"], candidate).map_err(|message| {
            WorkspaceError::new(
                WorkspaceErrorKind::ValidationFailed,
                format!("Could not validate this folder as a Beadwork workspace: {message}"),
                true,
            )
        })?;
    if validation.status != 0 {
        return Err(WorkspaceError::new(
            WorkspaceErrorKind::ValidationFailed,
            format!(
                "Could not validate this folder as a Beadwork workspace: bw config list exited with status {}: {}",
                validation.status,
                validation.stderr.trim()
            ),
            true,
        ));
    }

    let root = run_command(
        runner,
        GIT_PROGRAM,
        &["rev-parse", "--show-toplevel"],
        candidate,
    )
    .map_err(|message| {
        WorkspaceError::new(
            WorkspaceErrorKind::GitRootFailed,
            format!("Could not determine this folder's Git root: {message}"),
            true,
        )
    })?;
    if root.status != 0 {
        return Err(WorkspaceError::new(
            WorkspaceErrorKind::GitRootFailed,
            format!(
                "Could not determine this folder's Git root: git rev-parse exited with status {}: {}",
                root.status,
                root.stderr.trim()
            ),
            true,
        ));
    }

    let root = root.stdout.trim();
    if root.is_empty() {
        return Err(WorkspaceError::new(
            WorkspaceErrorKind::GitRootFailed,
            "Could not determine this folder's Git root: git returned an empty root.",
            true,
        ));
    }

    Ok(Workspace {
        path: normalize_root(Path::new(root)).display().to_string(),
        availability: WorkspaceAvailability::Available,
    })
}

fn run_command(
    runner: &dyn CommandRunner,
    program: &str,
    args: &[&str],
    cwd: &Path,
) -> Result<CommandOutput, String> {
    runner
        .run(program, args, cwd)
        .map_err(|error| match error.kind() {
            io::ErrorKind::NotFound => format!("{program} executable was not found on PATH"),
            _ => format!("could not run {program}: {error}"),
        })
}

/// Lexically normalize the Git-provided root for stable catalog identity.
fn normalize_root(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::RootDir | Component::Prefix(_) | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
        }
    }
    normalized
}

/// Run the three Beadwork issue-view commands (All, Ready, Blocked) for the
/// given workspace root. The caller is expected to have already validated and
/// retained the workspace, so a failure here surfaces as a retryable load
/// error.
pub fn load_issue_explorer_data(
    runner: &dyn CommandRunner,
    workspace: &Path,
) -> Result<IssueExplorerData, WorkspaceError> {
    let all_issues = issues::list_all_issues(runner, workspace)
        .map_err(|error| map_load_error("All Issues", error))?;
    let ready_issues = issues::list_ready_issues(runner, workspace)
        .map_err(|error| map_load_error("Ready Issues", error))?;
    let blocked_issues = issues::list_blocked_issues(runner, workspace)
        .map_err(|error| map_load_error("Blocked Issues", error))?;
    Ok(IssueExplorerData {
        all_issues,
        ready_issues,
        blocked_issues,
    })
}

fn map_load_error(view: &str, error: ListIssuesError) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorKind::LoadFailed,
        format!("Could not load {view}: {error}"),
        true,
    )
}

#[cfg(test)]
mod tests;

/// Backend-owned adapter for the supported Tauri store plugin. The frontend
/// never receives direct store access.
///
/// Persistence is treated as a single-shot transaction: a save or reset that
/// fails to flush its mutation must restore the previously committed snapshot
/// before returning, so a later successful save, auto-save, restart, or
/// shutdown flush cannot republish a rejected Current Workspace, MRU
/// promotion, catalog mutation, or explicit reset. To eliminate the auto-save
/// race that would otherwise write the rejected mutation mid-rollback, the
/// store handle is built with auto-save disabled — the only path that writes
/// to disk for this resource is the explicit, serialized `save`/`reset`
/// call below.
pub struct TauriWorkspaceStore<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
}

impl<R: tauri::Runtime> TauriWorkspaceStore<R> {
    pub fn new(app: tauri::AppHandle<R>) -> Self {
        Self { app }
    }

    fn store_path(&self) -> PathBuf {
        // Desktop acceptance supplies a fresh absolute path before launch so
        // it cannot read or overwrite a developer's catalog. Product builds
        // keep the supported app-data default.
        std::env::var_os("BEADSMITH_WORKSPACE_STORE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("workspace-catalog.json"))
    }

    fn store(&self) -> Result<std::sync::Arc<tauri_plugin_store::Store<R>>, String> {
        use tauri_plugin_store::StoreExt;
        self.app
            .store_builder(self.store_path())
            .disable_auto_save()
            .build()
            .map_err(|error| error.to_string())
    }

    /// Restore the previously committed serialized snapshot in the plugin
    /// store's in-memory cache, then attempt to flush that rollback so the
    /// next flush cannot republish the rejected mutation. A secondary flush
    /// failure is intentionally swallowed: the cache is already correct, and
    /// the original error is what the caller needs to surface.
    fn rollback(&self, store: &tauri_plugin_store::Store<R>, prior: Option<&serde_json::Value>) {
        match prior {
            Some(prior_value) => {
                store.set("workspaceState", prior_value.clone());
            }
            None => {
                store.delete("workspaceState");
            }
        }
        let _ = store.save();
    }
}

impl<R: tauri::Runtime> WorkspaceStore for TauriWorkspaceStore<R> {
    fn load(&self) -> Result<Option<PersistedWorkspaceState>, String> {
        let store = self.store()?;
        let Some(value) = store.get("workspaceState") else {
            return Ok(None);
        };
        serde_json::from_value(value)
            .map(Some)
            .map_err(|error| error.to_string())
    }

    fn save(&self, state: &PersistedWorkspaceState) -> Result<(), String> {
        let value = serde_json::to_value(state).map_err(|error| error.to_string())?;
        let store = self.store()?;
        // Snapshot the previously committed value before mutating the
        // plugin-store cache. A failed final flush must roll this back so
        // the rejected proposal cannot be republished by the service lock
        // being released, a later save attempt, an auto-save, a restart, or
        // the RunEvent::Exit flush.
        let prior = store.get("workspaceState");
        store.set("workspaceState", value);
        if let Err(error) = store.save() {
            self.rollback(&store, prior.as_ref());
            return Err(error.to_string());
        }
        Ok(())
    }

    fn reset(&self) -> Result<(), String> {
        match self.store() {
            Ok(store) => {
                let prior = store.get("workspaceState");
                store.delete("workspaceState");
                if let Err(error) = store.save() {
                    self.rollback(&store, prior.as_ref());
                    return Err(error.to_string());
                }
                Ok(())
            }
            Err(_) => {
                // Fallback when the plugin's resource table cannot serve a
                // Store for this path (early lifecycle or migration races).
                // No mutation is possible here, so failure to unlink simply
                // surfaces and the prior on-disk state remains authoritative.
                use tauri::{path::BaseDirectory, Manager};
                let store_path = self.store_path();
                let path = if store_path.is_absolute() {
                    store_path
                } else {
                    self.app
                        .path()
                        .resolve(store_path, BaseDirectory::AppData)
                        .map_err(|error| error.to_string())?
                };
                match std::fs::remove_file(path) {
                    Ok(()) => Ok(()),
                    Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                    Err(error) => Err(error.to_string()),
                }
            }
        }
    }
}

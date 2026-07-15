//! Workspace service foundation and the legacy startup override.
//!
//! [`WorkspaceService`] owns durable workspace selection state without relying
//! on the process working directory. Its command and persistence dependencies
//! are traits so the state machine can be tested without Tauri, a store plugin,
//! or installed `bw`/`git` binaries. Tauri store and dialog wiring deliberately
//! belongs to a later integration chunk.

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
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::VecDeque;

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct Invocation {
        program: String,
        args: Vec<String>,
        cwd: PathBuf,
    }

    struct FakeRunner {
        outputs: RefCell<VecDeque<io::Result<CommandOutput>>>,
        invocations: RefCell<Vec<Invocation>>,
    }

    impl FakeRunner {
        fn with_outputs(outputs: impl IntoIterator<Item = io::Result<CommandOutput>>) -> Self {
            Self {
                outputs: RefCell::new(outputs.into_iter().collect()),
                invocations: RefCell::new(Vec::new()),
            }
        }

        fn success(stdout: &str) -> io::Result<CommandOutput> {
            Ok(CommandOutput {
                status: 0,
                stdout: stdout.to_string(),
                stderr: String::new(),
            })
        }

        fn invocations(&self) -> Vec<Invocation> {
            self.invocations.borrow().clone()
        }
    }

    impl CommandRunner for FakeRunner {
        fn run(&self, program: &str, args: &[&str], cwd: &Path) -> io::Result<CommandOutput> {
            self.invocations.borrow_mut().push(Invocation {
                program: program.to_string(),
                args: args
                    .iter()
                    .map(|argument| (*argument).to_string())
                    .collect(),
                cwd: cwd.to_path_buf(),
            });
            self.outputs
                .borrow_mut()
                .pop_front()
                .expect("unexpected command invocation")
        }
    }

    struct FakeStore {
        load_result: RefCell<Result<Option<PersistedWorkspaceState>, String>>,
        save_results: RefCell<VecDeque<Result<(), String>>>,
        saved: RefCell<Vec<PersistedWorkspaceState>>,
        reset_result: RefCell<Result<(), String>>,
        reset_count: RefCell<usize>,
    }

    impl FakeStore {
        fn empty() -> Self {
            Self {
                load_result: RefCell::new(Ok(None)),
                save_results: RefCell::new(VecDeque::new()),
                saved: RefCell::new(Vec::new()),
                reset_result: RefCell::new(Ok(())),
                reset_count: RefCell::new(0),
            }
        }

        fn with_saves(save_results: impl IntoIterator<Item = Result<(), String>>) -> Self {
            Self {
                save_results: RefCell::new(save_results.into_iter().collect()),
                ..Self::empty()
            }
        }
    }

    #[derive(Clone, Default)]
    struct PersistentTestStore {
        state: std::rc::Rc<RefCell<Option<PersistedWorkspaceState>>>,
    }

    impl WorkspaceStore for PersistentTestStore {
        fn load(&self) -> Result<Option<PersistedWorkspaceState>, String> {
            Ok(self.state.borrow().clone())
        }

        fn save(&self, state: &PersistedWorkspaceState) -> Result<(), String> {
            *self.state.borrow_mut() = Some(state.clone());
            Ok(())
        }

        fn reset(&self) -> Result<(), String> {
            *self.state.borrow_mut() = None;
            Ok(())
        }
    }

    impl WorkspaceStore for FakeStore {
        fn load(&self) -> Result<Option<PersistedWorkspaceState>, String> {
            self.load_result.borrow().clone()
        }

        fn save(&self, state: &PersistedWorkspaceState) -> Result<(), String> {
            let result = self.save_results.borrow_mut().pop_front().unwrap_or(Ok(()));
            if result.is_ok() {
                self.saved.borrow_mut().push(state.clone());
            }
            result
        }

        fn reset(&self) -> Result<(), String> {
            *self.reset_count.borrow_mut() += 1;
            self.reset_result.borrow().clone()
        }
    }

    fn command_outputs(root: &str) -> Vec<io::Result<CommandOutput>> {
        vec![
            FakeRunner::success("setting=value\n"),
            FakeRunner::success(&format!("{root}\n")),
            FakeRunner::success("[]"),
            FakeRunner::success("[]"),
            FakeRunner::success("[]"),
        ]
    }

    #[test]
    fn validates_with_explicit_candidate_cwd_and_normalizes_git_root() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let runner = FakeRunner::with_outputs(command_outputs("/work/repo/subdir/.."));
        let candidate = Path::new("/work/repo/subdir");

        service
            .select_workspace(&runner, candidate)
            .expect("selection should succeed");

        assert_eq!(
            runner.invocations(),
            vec![
                Invocation {
                    program: "bw".to_string(),
                    args: vec!["config".to_string(), "list".to_string()],
                    cwd: candidate.to_path_buf(),
                },
                Invocation {
                    program: "git".to_string(),
                    args: vec!["rev-parse".to_string(), "--show-toplevel".to_string()],
                    cwd: candidate.to_path_buf(),
                },
                Invocation {
                    program: "bw".to_string(),
                    args: vec![
                        "list".to_string(),
                        "--all".to_string(),
                        "--json".to_string()
                    ],
                    cwd: PathBuf::from("/work/repo"),
                },
                Invocation {
                    program: "bw".to_string(),
                    args: vec!["ready".to_string(), "--json".to_string()],
                    cwd: PathBuf::from("/work/repo"),
                },
                Invocation {
                    program: "bw".to_string(),
                    args: vec!["blocked".to_string(), "--json".to_string()],
                    cwd: PathBuf::from("/work/repo"),
                },
            ]
        );
        assert_eq!(
            service.state().current_workspace,
            Some(Workspace {
                path: "/work/repo".to_string(),
                availability: WorkspaceAvailability::Available,
            })
        );
    }

    #[test]
    fn startup_restore_is_provisional_until_validation_and_load_succeed() {
        let store = FakeStore::empty();
        *store.load_result.borrow_mut() = Ok(Some(PersistedWorkspaceState {
            catalog: vec![Workspace {
                path: "/work/remembered".to_string(),
                availability: WorkspaceAvailability::Available,
            }],
            current_workspace_path: Some("/work/remembered".to_string()),
            ..PersistedWorkspaceState::default()
        }));
        let mut service = WorkspaceService::from_store(store);

        assert!(service.state().current_workspace.is_none());
        assert_eq!(service.state().catalog[0].path, "/work/remembered");

        let runner = FakeRunner::with_outputs(command_outputs("/work/remembered"));
        let data = service
            .restore_current(&runner)
            .expect("restoration should succeed")
            .expect("remembered workspace should be restored");

        assert!(data.all_issues.is_empty());
        assert_eq!(
            service.state().current_workspace,
            Some(Workspace {
                path: "/work/remembered".to_string(),
                availability: WorkspaceAvailability::Available,
            })
        );
    }

    #[test]
    fn invalid_startup_restore_remains_known_but_never_becomes_current() {
        let store = FakeStore::empty();
        *store.load_result.borrow_mut() = Ok(Some(PersistedWorkspaceState {
            catalog: vec![Workspace {
                path: "/work/remembered".to_string(),
                availability: WorkspaceAvailability::Available,
            }],
            current_workspace_path: Some("/work/remembered".to_string()),
            ..PersistedWorkspaceState::default()
        }));
        let mut service = WorkspaceService::from_store(store);
        let runner = FakeRunner::with_outputs([Ok(CommandOutput {
            status: 1,
            stdout: String::new(),
            stderr: "beadwork not initialized".to_string(),
        })]);

        let error = service
            .restore_current(&runner)
            .expect_err("invalid remembered workspace should not restore");

        assert_eq!(error.kind, WorkspaceErrorKind::ValidationFailed);
        assert!(service.state().current_workspace.is_none());
        assert_eq!(service.state().catalog[0].path, "/work/remembered");
    }

    #[test]
    fn true_empty_views_publish_a_current_workspace() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let runner = FakeRunner::with_outputs(command_outputs("/work/empty"));

        let data = service
            .select_workspace(&runner, "/work/empty")
            .expect("empty workspace is valid");

        assert!(data.all_issues.is_empty());
        assert!(data.ready_issues.is_empty());
        assert!(data.blocked_issues.is_empty());
        assert_eq!(
            service
                .state()
                .current_workspace
                .as_ref()
                .map(|workspace| &workspace.path),
            Some(&"/work/empty".to_string())
        );
    }

    #[test]
    fn validation_failure_preserves_existing_current_workspace() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        let failed = FakeRunner::with_outputs([Ok(CommandOutput {
            status: 1,
            stdout: String::new(),
            stderr: "beadwork not initialized".to_string(),
        })]);
        let error = service
            .select_workspace(&failed, "/work/invalid")
            .expect_err("validation should fail");

        assert_eq!(error.kind, WorkspaceErrorKind::ValidationFailed);
        assert_eq!(
            service
                .state()
                .current_workspace
                .as_ref()
                .map(|workspace| &workspace.path),
            Some(&"/work/first".to_string())
        );
        assert!(service.state().pending_workspace.is_none());
    }

    #[test]
    fn first_catalog_save_failure_discards_validated_candidate() {
        let store = FakeStore::with_saves([Err("disk full".to_string())]);
        let mut service = WorkspaceService::from_store(store);
        let runner = FakeRunner::with_outputs([
            FakeRunner::success("setting=value\n"),
            FakeRunner::success("/work/repo\n"),
        ]);

        let error = service
            .select_workspace(&runner, "/work/repo")
            .expect_err("catalog save should fail");

        assert_eq!(error.kind, WorkspaceErrorKind::StoreSaveFailed);
        assert!(service.state().catalog.is_empty());
        assert!(service.state().current_workspace.is_none());
        assert!(service.state().pending_workspace.is_none());
    }

    #[test]
    fn post_validation_load_failure_keeps_known_candidate_without_mru_promotion() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        let second = FakeRunner::with_outputs([
            FakeRunner::success("setting=value\n"),
            FakeRunner::success("/work/second\n"),
            Ok(CommandOutput {
                status: 2,
                stdout: String::new(),
                stderr: "failed to load issues".to_string(),
            }),
        ]);
        let error = service
            .select_workspace(&second, "/work/second")
            .expect_err("issue load should fail");

        assert_eq!(error.kind, WorkspaceErrorKind::LoadFailed);
        assert_eq!(
            service.state().current_workspace,
            Some(Workspace {
                path: "/work/first".to_string(),
                availability: WorkspaceAvailability::Available,
            })
        );
        assert_eq!(
            service
                .state()
                .catalog
                .iter()
                .map(|workspace| workspace.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/work/first", "/work/second"]
        );
        assert!(service.state().pending_workspace.is_none());
    }

    #[test]
    fn final_save_failure_does_not_publish_loaded_workspace() {
        let store = FakeStore::with_saves([Ok(()), Err("disk full".to_string())]);
        let mut service = WorkspaceService::from_store(store);
        let runner = FakeRunner::with_outputs(command_outputs("/work/repo"));

        let error = service
            .select_workspace(&runner, "/work/repo")
            .expect_err("final save should fail");

        assert_eq!(error.kind, WorkspaceErrorKind::StoreSaveFailed);
        assert!(service.state().current_workspace.is_none());
        assert_eq!(service.state().catalog.len(), 1);
        assert_eq!(service.state().catalog[0].path, "/work/repo");
        assert!(service.state().pending_workspace.is_none());
        assert_eq!(service.state().error, Some(error));
    }

    #[test]
    fn stale_generation_does_not_run_commands_or_save() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let stale = service.begin_selection("/work/first");
        let current = service.begin_selection("/work/second");
        let runner = FakeRunner::with_outputs(command_outputs("/work/second"));

        let error = service
            .complete_selection(&runner, stale)
            .expect_err("old request should be rejected");
        assert_eq!(error.kind, WorkspaceErrorKind::StaleGeneration);
        assert!(runner.invocations().is_empty());

        service
            .complete_selection(&runner, current)
            .expect("new request should still succeed");
        assert_eq!(service.state().generation, 2);
        assert_eq!(
            service.state().current_workspace.as_ref().unwrap().path,
            "/work/second"
        );
    }

    #[test]
    fn reset_explicitly_recovers_from_unreadable_memory() {
        let store = FakeStore::empty();
        *store.load_result.borrow_mut() = Err("invalid JSON".to_string());
        let mut service = WorkspaceService::from_store(store);

        assert_eq!(
            service.state().error.as_ref().map(|error| &error.kind),
            Some(&WorkspaceErrorKind::StoreReadFailed)
        );
        service.reset_memory().expect("reset should succeed");
        assert!(service.state().error.is_none());
        assert!(service.state().catalog.is_empty());
        assert!(service.state().current_workspace.is_none());
    }

    #[test]
    fn catalog_is_capped_at_one_hundred_entries() {
        let mut persisted = PersistedWorkspaceState::default();
        persisted.catalog = (0..100)
            .map(|index| Workspace {
                path: format!("/work/{index}"),
                availability: WorkspaceAvailability::Available,
            })
            .collect();
        let store = FakeStore::empty();
        *store.load_result.borrow_mut() = Ok(Some(persisted));
        let mut service = WorkspaceService::from_store(store);
        let runner = FakeRunner::with_outputs(command_outputs("/work/new"));

        service
            .select_workspace(&runner, "/work/new")
            .expect("selection should succeed");

        assert_eq!(service.state().catalog.len(), 100);
        assert_eq!(service.state().catalog[0].path, "/work/new");
        assert!(!service
            .state()
            .catalog
            .iter()
            .any(|workspace| workspace.path == "/work/99"));
    }

    #[test]
    fn persisted_current_restores_through_the_backend_store_on_restart() {
        let store = PersistentTestStore::default();
        WorkspaceService::from_store(store.clone())
            .select_workspace(
                &FakeRunner::with_outputs(command_outputs("/work/persisted")),
                "/work/persisted",
            )
            .expect("initial selection should durably save");

        let mut restarted = WorkspaceService::from_store(store);
        assert!(restarted.state().current_workspace.is_none());
        restarted
            .restore_current(&FakeRunner::with_outputs(command_outputs(
                "/work/persisted",
            )))
            .expect("restart should restore through the normal transaction");
        assert_eq!(
            restarted
                .state()
                .current_workspace
                .as_ref()
                .map(|workspace| &workspace.path),
            Some(&"/work/persisted".to_string())
        );
    }

    #[test]
    fn missing_catalog_path_is_unavailable_but_remains_known() {
        let path = std::env::temp_dir().join(format!(
            "beadsmith-missing-workspace-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&path);
        let path_string = path.display().to_string();
        let store = FakeStore::empty();
        *store.load_result.borrow_mut() = Ok(Some(PersistedWorkspaceState {
            catalog: vec![Workspace {
                path: path_string,
                availability: WorkspaceAvailability::Available,
            }],
            ..PersistedWorkspaceState::default()
        }));

        let service = WorkspaceService::from_store(store);

        assert_eq!(service.state().catalog.len(), 1);
        assert_eq!(
            service.state().catalog[0].availability,
            WorkspaceAvailability::Unavailable
        );
    }

    #[test]
    fn availability_is_derived_from_path_access_not_validation_failure() {
        let path = std::env::temp_dir().join(format!(
            "beadsmith-readable-workspace-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("temporary directory should be created");
        let path_string = path.display().to_string();
        let store = FakeStore::empty();
        *store.load_result.borrow_mut() = Ok(Some(PersistedWorkspaceState {
            catalog: vec![Workspace {
                path: path_string.clone(),
                availability: WorkspaceAvailability::Unavailable,
            }],
            current_workspace_path: Some(path_string),
            ..PersistedWorkspaceState::default()
        }));
        let mut service = WorkspaceService::from_store(store);
        let runner = FakeRunner::with_outputs([Ok(CommandOutput {
            status: 1,
            stdout: String::new(),
            stderr: "not a Beadwork workspace".to_string(),
        })]);

        service
            .restore_current(&runner)
            .expect_err("invalid workspace must not restore");

        assert!(service.state().current_workspace.is_none());
        assert_eq!(
            service.state().catalog[0].availability,
            WorkspaceAvailability::Available
        );
        std::fs::remove_dir_all(path).expect("temporary directory should be removed");
    }

    #[test]
    fn removing_current_clears_it_without_selecting_another_catalog_entry() {
        let mut service = WorkspaceService::from_store(FakeStore::empty());
        service
            .select_workspace(
                &FakeRunner::with_outputs(command_outputs("/work/first")),
                "/work/first",
            )
            .expect("first selection should succeed");
        service
            .select_workspace(
                &FakeRunner::with_outputs(command_outputs("/work/second")),
                "/work/second",
            )
            .expect("second selection should succeed");

        service
            .remove_workspace("/work/second")
            .expect("removal should persist");

        assert!(service.state().current_workspace.is_none());
        assert_eq!(service.state().catalog[0].path, "/work/first");
        assert!(service.state().pending_workspace.is_none());
    }

    #[test]
    fn validation_and_load_failure_retains_without_promoting_until_retry_succeeds() {
        let mut service = WorkspaceService::from_store(FakeStore::empty());
        service
            .select_workspace(
                &FakeRunner::with_outputs(command_outputs("/work/first")),
                "/work/first",
            )
            .expect("first selection should succeed");
        service
            .select_workspace(
                &FakeRunner::with_outputs([
                    FakeRunner::success("setting=value\n"),
                    FakeRunner::success("/work/second\n"),
                    Ok(CommandOutput {
                        status: 2,
                        stdout: String::new(),
                        stderr: "load failed".to_string(),
                    }),
                ]),
                "/work/second",
            )
            .expect_err("failed load must not promote");
        assert_eq!(
            service
                .state()
                .catalog
                .iter()
                .map(|workspace| workspace.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/work/first", "/work/second"]
        );

        service
            .select_workspace(
                &FakeRunner::with_outputs(command_outputs("/work/second")),
                "/work/second",
            )
            .expect("successful retry should promote");
        assert_eq!(
            service
                .state()
                .catalog
                .iter()
                .map(|workspace| workspace.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/work/second", "/work/first"]
        );
    }

    #[test]
    fn cancel_pending_drops_pending_workspace_and_bumps_generation() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        let second = FakeRunner::with_outputs(command_outputs("/work/second"));
        let request = service.begin_selection("/work/second");
        // First selection committed at gen 1, second begin bumps to gen 2.
        assert_eq!(service.state().generation, 2);
        assert_eq!(
            service
                .state()
                .pending_workspace
                .as_ref()
                .map(|w| w.path.as_str()),
            Some("/work/second")
        );

        let returned = service.cancel_pending();
        assert_eq!(returned.generation, 3);
        assert!(returned.pending_workspace.is_none());
        assert!(returned.error.is_none());
        assert_eq!(
            returned.current_workspace.as_ref().map(|w| w.path.as_str()),
            Some("/work/first")
        );
        // The catalog reflects the persisted prior workspace, not pending.
        assert_eq!(
            returned
                .catalog
                .iter()
                .map(|w| w.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/work/first"]
        );
        // Late resolution of the cancelled request is silently rejected.
        let error = service
            .complete_selection(&second, request)
            .expect_err("cancelled request must not publish");
        assert_eq!(error.kind, WorkspaceErrorKind::StaleGeneration);
        assert_eq!(service.state().generation, 3);
        assert_eq!(
            service
                .state()
                .current_workspace
                .as_ref()
                .map(|w| w.path.as_str()),
            Some("/work/first")
        );

        service
            .select_workspace(&second, "/work/second")
            .expect("fresh request after cancel should still succeed");
        // 1 (first select) + 1 (cancelled second) + 1 (third begin) commits 4.
        assert_eq!(service.state().generation, 4);
    }

    #[test]
    fn cancel_pending_with_no_pending_workspace_is_a_noop() {
        // Cancel-after-commit-before-success-publication safety: when there
        // is no actual pending request to cancel, the generation must not
        // bump. Bumping would race the in-flight success transition for the
        // just-committed request and let the renderer reject the success
        // transition as "older than accepted", leaving B Current paired
        // with A's snapshot.
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        let before = service.state().generation;
        let returned = service.cancel_pending();
        assert_eq!(
            returned.generation, before,
            "cancel_pending without a pending request must not bump the generation"
        );
        assert!(returned.pending_workspace.is_none());
        assert_eq!(
            returned.current_workspace.as_ref().map(|w| w.path.as_str()),
            Some("/work/first")
        );
    }

    #[test]
    fn cancel_pending_with_no_current_clears_pending_only() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let request = service.begin_selection("/work/first");
        assert!(service.state().pending_workspace.is_some());

        let returned = service.cancel_pending();
        assert!(returned.current_workspace.is_none());
        assert!(returned.pending_workspace.is_none());
        assert!(returned.error.is_none());
        // Catalog is unchanged: nothing durable was written before cancel.
        assert!(returned.catalog.is_empty());

        // The cancelled request still rejects late results.
        let runner = FakeRunner::with_outputs(command_outputs("/work/first"));
        let error = service
            .complete_selection(&runner, request)
            .expect_err("cancelled request must not publish");
        assert_eq!(error.kind, WorkspaceErrorKind::StaleGeneration);
    }

    #[test]
    fn cancel_pending_after_known_candidate_failure_only_clears_pending() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        let second = FakeRunner::with_outputs([
            FakeRunner::success("setting=value\n"),
            FakeRunner::success("/work/second\n"),
            Ok(CommandOutput {
                status: 2,
                stdout: String::new(),
                stderr: "load failed".to_string(),
            }),
        ]);
        service
            .select_workspace(&second, "/work/second")
            .expect_err("load failure should not promote");

        // After a load failure the known candidate stays in the catalog,
        // error is surfaced, and pending is None.
        assert_eq!(
            service
                .state()
                .catalog
                .iter()
                .map(|w| w.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/work/first", "/work/second"]
        );
        assert_eq!(
            service.state().error.as_ref().map(|e| e.kind.clone()),
            Some(WorkspaceErrorKind::LoadFailed)
        );

        let returned = service.cancel_pending();
        // The retryable catalog entry survives Cancel — Cancel does not
        // remove the known target.
        assert_eq!(
            returned
                .catalog
                .iter()
                .map(|w| w.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/work/first", "/work/second"]
        );
        assert!(returned.error.is_none());
        assert!(returned.pending_workspace.is_none());
        assert_eq!(
            returned.current_workspace.as_ref().map(|w| w.path.as_str()),
            Some("/work/first")
        );
    }

    #[test]
    fn cancel_pending_after_commit_does_not_bump_generation() {
        // Reproduces the bsm-kia.7 cancel-after-final-commit-before-success-
        // publication race: the user-visible commit has already landed in
        // `self.state` (current=B), but Taurpc has not yet published the
        // typed success transition. A Cancel that races the success
        // publication must not bump the generation; otherwise the renderer
        // would reject the in-flight success transition as "older than
        // accepted" and show B Current paired with A's snapshot.
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");
        let before = service.state().generation;

        // Successful switch to B commits (current=B, generation stays the
        // request's generation), then the user-visible Pending window has
        // already cleared because Phase 5 ran commit_loaded.
        let second = FakeRunner::with_outputs(command_outputs("/work/second"));
        service
            .select_workspace(&second, "/work/second")
            .expect("second switch should succeed");
        assert_eq!(
            service
                .state()
                .current_workspace
                .as_ref()
                .map(|w| w.path.as_str()),
            Some("/work/second")
        );
        assert!(
            service.state().pending_workspace.is_none(),
            "commit clears pending; the success transition is what has not yet been published"
        );

        // The Cancel arrives between commit and success publication. It
        // must not bump the generation, otherwise the in-flight success
        // transition would be rejected at the renderer as older than
        // accepted.
        let returned = service.cancel_pending();
        assert_eq!(
            returned.generation,
            before + 1,
            "cancel_pending after a successful commit must not bump the generation"
        );
        assert_eq!(
            returned.current_workspace.as_ref().map(|w| w.path.as_str()),
            Some("/work/second"),
            "current must remain the just-committed B"
        );
        assert!(
            returned.pending_workspace.is_none(),
            "no pending workspace was set by Cancel"
        );
    }

    #[test]
    fn post_validation_load_failure_sets_retry_workspace_to_validated_candidate() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        let second = FakeRunner::with_outputs([
            FakeRunner::success("setting=value\n"),
            FakeRunner::success("/work/second\n"),
            Ok(CommandOutput {
                status: 2,
                stdout: String::new(),
                stderr: "load failed".to_string(),
            }),
        ]);
        let error = service
            .select_workspace(&second, "/work/second")
            .expect_err("load failure should not promote");

        assert_eq!(error.kind, WorkspaceErrorKind::LoadFailed);
        let state = service.state();
        assert_eq!(
            state.retry_workspace.as_ref().map(|w| w.path.as_str()),
            Some("/work/second"),
            "retry_workspace must surface the validated candidate for Retry"
        );
        assert_eq!(
            state.error.as_ref().map(|e| e.kind.clone()),
            Some(WorkspaceErrorKind::LoadFailed)
        );
        assert!(state.pending_workspace.is_none());
    }

    #[test]
    fn final_save_failure_sets_retry_workspace_to_validated_candidate() {
        let store = FakeStore::with_saves([Ok(()), Err("disk full".to_string())]);
        let mut service = WorkspaceService::from_store(store);
        let runner = FakeRunner::with_outputs(command_outputs("/work/repo"));

        let error = service
            .select_workspace(&runner, "/work/repo")
            .expect_err("final save should fail");

        assert_eq!(error.kind, WorkspaceErrorKind::StoreSaveFailed);
        let state = service.state();
        assert_eq!(
            state.retry_workspace.as_ref().map(|w| w.path.as_str()),
            Some("/work/repo"),
            "retry_workspace must survive a final-save failure so Retry can replay"
        );
    }

    #[test]
    fn validation_failure_does_not_set_retry_workspace() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let runner = FakeRunner::with_outputs([Ok(CommandOutput {
            status: 1,
            stdout: String::new(),
            stderr: "beadwork not initialized".to_string(),
        })]);

        let error = service
            .select_workspace(&runner, "/work/invalid")
            .expect_err("validation should fail");

        assert_eq!(error.kind, WorkspaceErrorKind::ValidationFailed);
        let state = service.state();
        assert!(
            state.retry_workspace.is_none(),
            "no validated candidate exists for Retry when validation itself fails"
        );
    }

    #[test]
    fn git_root_failure_does_not_set_retry_workspace() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let runner = FakeRunner::with_outputs([
            FakeRunner::success("setting=value\n"),
            Ok(CommandOutput {
                status: 128,
                stdout: String::new(),
                stderr: "fatal: not a git repository".to_string(),
            }),
        ]);

        let error = service
            .select_workspace(&runner, "/work/notgit")
            .expect_err("git root should fail");

        assert_eq!(error.kind, WorkspaceErrorKind::GitRootFailed);
        let state = service.state();
        assert!(state.retry_workspace.is_none());
    }

    #[test]
    fn begin_selection_clears_a_previous_retry_workspace() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        // Cause a load failure so retry_workspace is set on /work/second.
        let failed = FakeRunner::with_outputs([
            FakeRunner::success("setting=value\n"),
            FakeRunner::success("/work/second\n"),
            Ok(CommandOutput {
                status: 2,
                stdout: String::new(),
                stderr: "load failed".to_string(),
            }),
        ]);
        service
            .select_workspace(&failed, "/work/second")
            .expect_err("load failure should not promote");
        assert_eq!(
            service
                .state()
                .retry_workspace
                .as_ref()
                .map(|w| w.path.as_str()),
            Some("/work/second")
        );

        // A new selection must supersede the previous retry target.
        let _request = service.begin_selection("/work/third");
        assert!(
            service.state().retry_workspace.is_none(),
            "a new begin_selection must clear the previous retry target"
        );
        assert!(service.state().pending_workspace.is_some());
    }

    #[test]
    fn cancel_pending_clears_retry_workspace() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        // Force a load failure on second so retry_workspace is set.
        let failed = FakeRunner::with_outputs([
            FakeRunner::success("setting=value\n"),
            FakeRunner::success("/work/second\n"),
            Ok(CommandOutput {
                status: 2,
                stdout: String::new(),
                stderr: "load failed".to_string(),
            }),
        ]);
        service
            .select_workspace(&failed, "/work/second")
            .expect_err("load failure should not promote");
        assert!(service.state().retry_workspace.is_some());

        let returned = service.cancel_pending();
        assert!(
            returned.retry_workspace.is_none(),
            "cancel must clear the retryable banner target"
        );
    }

    #[test]
    fn remove_workspace_clears_retry_workspace() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        // Force a load failure on second so retry_workspace is set on /work/second.
        let failed = FakeRunner::with_outputs([
            FakeRunner::success("setting=value\n"),
            FakeRunner::success("/work/second\n"),
            Ok(CommandOutput {
                status: 2,
                stdout: String::new(),
                stderr: "load failed".to_string(),
            }),
        ]);
        service
            .select_workspace(&failed, "/work/second")
            .expect_err("load failure should not promote");
        assert!(service.state().retry_workspace.is_some());

        service
            .remove_workspace("/work/second")
            .expect("removal should succeed");

        assert!(
            service.state().retry_workspace.is_none(),
            "removal must clear any retryable target"
        );
        assert!(service.state().error.is_none());
    }

    #[test]
    fn reset_memory_clears_retry_workspace() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        let failed = FakeRunner::with_outputs([
            FakeRunner::success("setting=value\n"),
            FakeRunner::success("/work/second\n"),
            Ok(CommandOutput {
                status: 2,
                stdout: String::new(),
                stderr: "load failed".to_string(),
            }),
        ]);
        service
            .select_workspace(&failed, "/work/second")
            .expect_err("load failure should not promote");
        assert!(service.state().retry_workspace.is_some());

        service.reset_memory().expect("reset should succeed");

        assert!(
            service.state().retry_workspace.is_none(),
            "reset must clear the retryable banner target"
        );
        assert!(service.state().error.is_none());
        assert!(service.state().catalog.is_empty());
        assert!(service.state().current_workspace.is_none());
    }

    #[test]
    fn successful_commit_clears_retry_workspace() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        // Establish a retry target on /work/second via load failure.
        let failed = FakeRunner::with_outputs([
            FakeRunner::success("setting=value\n"),
            FakeRunner::success("/work/second\n"),
            Ok(CommandOutput {
                status: 2,
                stdout: String::new(),
                stderr: "load failed".to_string(),
            }),
        ]);
        service
            .select_workspace(&failed, "/work/second")
            .expect_err("load failure should not promote");
        assert!(service.state().retry_workspace.is_some());

        // A successful commit for any candidate must clear the stale retry target.
        let third = FakeRunner::with_outputs(command_outputs("/work/third"));
        service
            .select_workspace(&third, "/work/third")
            .expect("third selection should succeed");

        assert!(
            service.state().retry_workspace.is_none(),
            "a successful commit must clear any stale retry target"
        );
    }

    #[test]
    fn retry_replays_validated_candidate_and_promotes_on_success() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        // First attempt: load fails, retry target is set to /work/second.
        let failed = FakeRunner::with_outputs([
            FakeRunner::success("setting=value\n"),
            FakeRunner::success("/work/second\n"),
            Ok(CommandOutput {
                status: 2,
                stdout: String::new(),
                stderr: "load failed".to_string(),
            }),
        ]);
        service
            .select_workspace(&failed, "/work/second")
            .expect_err("load failure should not promote");

        let retry_target = service
            .state()
            .retry_workspace
            .clone()
            .expect("retry target must be set after post-validation failure");
        assert_eq!(retry_target.path, "/work/second");

        // Retry replays the validated candidate with a fresh generation.
        let retry_runner = FakeRunner::with_outputs(command_outputs("/work/second"));
        service
            .select_workspace(&retry_runner, &retry_target.path)
            .expect("retry should succeed");

        let state = service.state();
        assert_eq!(
            state.current_workspace.as_ref().map(|w| w.path.as_str()),
            Some("/work/second")
        );
        assert!(state.retry_workspace.is_none());
        assert!(state.pending_workspace.is_none());
        assert!(state.error.is_none());
        // The catalog reflects MRU promotion: second is now first.
        assert_eq!(
            state
                .catalog
                .iter()
                .map(|w| w.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/work/second", "/work/first"]
        );
    }

    #[test]
    fn stale_cancellation_completion_does_not_set_error_or_retry() {
        // Simulates: user starts switch A→B, then selects C while B is
        // loading. B's late completion must not surface as a banner or
        // create a stale retry target.
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        let cancelled = service.begin_selection("/work/second");
        let _superseding = service.begin_selection("/work/third");
        let runner = FakeRunner::with_outputs(command_outputs("/work/second"));

        let error = service
            .complete_selection(&runner, cancelled)
            .expect_err("cancelled request must not publish");

        assert_eq!(error.kind, WorkspaceErrorKind::StaleGeneration);
        let state = service.state();
        assert!(
            state.retry_workspace.is_none(),
            "stale completions must not seed a retry target"
        );
        assert!(
            state.error.is_none(),
            "stale completions must not overwrite the current error or seed one"
        );
        assert_eq!(
            state.current_workspace.as_ref().map(|w| w.path.as_str()),
            Some("/work/first")
        );
    }

    #[test]
    fn removing_current_while_pending_clears_current_and_invalidates_pending() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        let second = FakeRunner::with_outputs(command_outputs("/work/second"));
        service
            .select_workspace(&second, "/work/second")
            .expect("second selection should succeed");

        let _pending = service.begin_selection("/work/pending");
        assert!(service.state().pending_workspace.is_some());

        service
            .remove_workspace("/work/second")
            .expect("removal of current should persist");

        let state = service.state();
        assert!(
            state.current_workspace.is_none(),
            "removing Current clears it without selecting another catalog entry"
        );
        assert!(
            state.pending_workspace.is_none(),
            "removing any workspace invalidates an in-flight pending request"
        );
        assert!(state.retry_workspace.is_none());
        // Catalog no longer contains the removed entry, but still has /work/first.
        assert_eq!(
            state
                .catalog
                .iter()
                .map(|w| w.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/work/first"]
        );
    }

    #[test]
    fn removing_pending_workspace_invalidates_pending_without_selecting_another() {
        let store = FakeStore::empty();
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        let _request = service.begin_selection("/work/pending");
        assert_eq!(
            service
                .state()
                .pending_workspace
                .as_ref()
                .map(|w| w.path.as_str()),
            Some("/work/pending")
        );

        service
            .remove_workspace("/work/pending")
            .expect("removing the pending target should succeed");

        let state = service.state();
        assert!(
            state.pending_workspace.is_none(),
            "removing the Pending target must invalidate it"
        );
        assert_eq!(
            state.current_workspace.as_ref().map(|w| w.path.as_str()),
            Some("/work/first"),
            "Current must remain unchanged when removing only the Pending target"
        );
        assert!(state.retry_workspace.is_none());
        assert_eq!(
            state
                .catalog
                .iter()
                .map(|w| w.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/work/first"],
            "the removed pending target must not remain in the catalog"
        );
    }

    #[test]
    fn retain_validated_phase_persists_without_promoting_mru() {
        let store = FakeStore::with_saves([Ok(()), Ok(())]);
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");
        // After the first select_workspace the save_results queue has two
        // successful saves remaining (catalog retain + final commit).

        let request = service.begin_selection("/work/second");
        let validated = Workspace {
            path: "/work/second".to_string(),
            availability: WorkspaceAvailability::Available,
        };

        service
            .retain_validated(&request, validated.clone())
            .expect("retain should succeed");

        let state = service.state();
        assert_eq!(
            state.pending_workspace.as_ref().map(|w| w.path.as_str()),
            Some("/work/second")
        );
        assert_eq!(
            state.current_workspace.as_ref().map(|w| w.path.as_str()),
            Some("/work/first"),
            "Current must remain A until the final commit phase"
        );
        assert_eq!(
            state
                .catalog
                .iter()
                .map(|w| w.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/work/first", "/work/second"],
            "catalog retain does not promote MRU order"
        );
    }

    #[test]
    fn retain_validated_phase_rejects_stale_generation() {
        let store = FakeStore::with_saves([Ok(())]);
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");
        // After the first select_workspace the save_results queue is empty;
        // any stale save attempt would panic if it ran.

        let stale = service.begin_selection("/work/stale");
        let _superseding = service.begin_selection("/work/newer");
        let validated = Workspace {
            path: "/work/stale".to_string(),
            availability: WorkspaceAvailability::Available,
        };

        let error = service
            .retain_validated(&stale, validated)
            .expect_err("stale retain must fail");
        assert_eq!(error.kind, WorkspaceErrorKind::StaleGeneration);
    }

    #[test]
    fn commit_loaded_phase_publishes_current_and_promotes_mru() {
        let store = FakeStore::with_saves([Ok(()), Ok(()), Ok(())]);
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        let request = service.begin_selection("/work/second");
        let validated = Workspace {
            path: "/work/second".to_string(),
            availability: WorkspaceAvailability::Available,
        };
        service
            .retain_validated(&request, validated.clone())
            .expect("retain should succeed");

        let data = IssueExplorerData {
            all_issues: Vec::new(),
            ready_issues: Vec::new(),
            blocked_issues: Vec::new(),
        };
        let returned = service
            .commit_loaded(&request, validated.clone(), data.clone())
            .expect("commit should succeed");
        assert_eq!(returned, data);

        let state = service.state();
        assert_eq!(
            state.current_workspace.as_ref().map(|w| w.path.as_str()),
            Some("/work/second")
        );
        assert!(state.pending_workspace.is_none());
        assert_eq!(
            state
                .catalog
                .iter()
                .map(|w| w.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/work/second", "/work/first"],
            "commit must promote MRU order"
        );
        assert!(state.retry_workspace.is_none());
        assert!(state.error.is_none());
    }

    #[test]
    fn commit_loaded_phase_rejects_stale_generation() {
        let store = FakeStore::with_saves([Ok(()), Ok(())]);
        let mut service = WorkspaceService::from_store(store);
        let first = FakeRunner::with_outputs(command_outputs("/work/first"));
        service
            .select_workspace(&first, "/work/first")
            .expect("first selection should succeed");

        let stale = service.begin_selection("/work/second");
        let _superseding = service.begin_selection("/work/newer");
        let validated = Workspace {
            path: "/work/second".to_string(),
            availability: WorkspaceAvailability::Available,
        };
        // Skip retain_validated (would have failed too).
        let data = IssueExplorerData {
            all_issues: Vec::new(),
            ready_issues: Vec::new(),
            blocked_issues: Vec::new(),
        };

        let error = service
            .commit_loaded(&stale, validated, data)
            .expect_err("stale commit must fail");
        assert_eq!(error.kind, WorkspaceErrorKind::StaleGeneration);
        assert_eq!(
            service
                .state()
                .current_workspace
                .as_ref()
                .map(|w| w.path.as_str()),
            Some("/work/first"),
            "Current must remain A when the commit phase is stale"
        );
    }
}

/// Backend-owned adapter for the supported Tauri store plugin. The frontend
/// never receives direct store access.
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
            .store(self.store_path())
            .map_err(|error| error.to_string())
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
        store.set("workspaceState", value);
        store.save().map_err(|error| error.to_string())
    }

    fn reset(&self) -> Result<(), String> {
        match self.store() {
            Ok(store) => {
                store.clear();
                store.save().map_err(|error| error.to_string())
            }
            Err(_) => {
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

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
    fn new(kind: WorkspaceErrorKind, message: impl Into<String>, retryable: bool) -> Self {
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
    remembered_current_path: Option<String>,
}

impl<S: WorkspaceStore> WorkspaceService<S> {
    /// Restore durable workspace memory without claiming its remembered Current
    /// Workspace. The caller must explicitly invoke [`Self::restore_current`],
    /// which validates and loads it through the normal selection transaction.
    /// An unreadable or unsupported store is retained as a typed error until
    /// the caller explicitly invokes reset.
    pub fn from_store(store: S) -> Self {
        let (state, restoration_candidate, remembered_current_path) =
            match store.load().and_then(validate_persisted_state) {
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
                    None,
                ),
            };
        Self {
            store,
            state,
            restoration_candidate,
            remembered_current_path,
        }
    }

    /// Return the currently published state.
    pub fn state(&self) -> &WorkspaceState {
        &self.state
    }

    /// Start a new user-initiated selection request and return its generation
    /// token. A manual selection supersedes any deferred startup restoration.
    pub fn begin_selection(&mut self, candidate: impl Into<PathBuf>) -> WorkspaceRequest {
        self.restoration_candidate = None;
        self.remembered_current_path = None;
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
            self.remembered_current_path = None;
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
    /// have loaded and the final save has succeeded.
    pub fn complete_selection(
        &mut self,
        runner: &dyn CommandRunner,
        request: WorkspaceRequest,
    ) -> Result<IssueExplorerData, WorkspaceError> {
        self.ensure_current(&request)?;

        let workspace = match validate_workspace(runner, &request.candidate) {
            Ok(workspace) => workspace,
            Err(error) => {
                if self.restoration_candidate.as_deref() == Some(request.candidate.as_path()) {
                    if let Err(store_error) = self.mark_unavailable(&request.candidate) {
                        return self.fail_current_request(&request, store_error);
                    }
                }
                return self.fail_current_request(&request, error);
            }
        };
        self.ensure_current(&request)?;

        let mut known_state = self.state.clone();
        known_state.pending_workspace = Some(workspace.clone());
        known_state.error = None;
        retain_catalog(&mut known_state.catalog, workspace.clone());
        if let Err(error) = self.save_proposed(&request, &known_state) {
            return self.fail_current_request(&request, error);
        }
        self.ensure_current(&request)?;
        self.state = known_state;

        let data = match load_issue_explorer_data(runner, Path::new(&workspace.path)) {
            Ok(data) => data,
            Err(error) => return self.fail_current_request(&request, error),
        };
        self.ensure_current(&request)?;

        let mut published_state = self.state.clone();
        promote_catalog(&mut published_state.catalog, &workspace.path);
        published_state.current_workspace = Some(workspace);
        published_state.pending_workspace = None;
        published_state.error = None;
        if let Err(error) = self.save_proposed(&request, &published_state) {
            return self.fail_current_request(&request, error);
        }
        self.ensure_current(&request)?;
        self.state = published_state;

        Ok(data)
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
        self.remembered_current_path = None;
        Ok(())
    }

    fn ensure_current(&self, request: &WorkspaceRequest) -> Result<(), WorkspaceError> {
        if self.state.generation == request.generation {
            Ok(())
        } else {
            Err(WorkspaceError::stale())
        }
    }

    fn save_proposed(
        &self,
        request: &WorkspaceRequest,
        proposed: &WorkspaceState,
    ) -> Result<(), WorkspaceError> {
        self.ensure_current(request)?;
        self.store
            .save(&self.persisted_from_state(proposed))
            .map_err(|message| {
                WorkspaceError::new(
                    WorkspaceErrorKind::StoreSaveFailed,
                    format!("Could not save local workspace memory: {message}"),
                    true,
                )
            })
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

    fn mark_unavailable(&mut self, candidate: &Path) -> Result<(), WorkspaceError> {
        let candidate = candidate.display().to_string();
        if let Some(workspace) = self
            .state
            .catalog
            .iter_mut()
            .find(|workspace| workspace.path == candidate)
        {
            workspace.availability = WorkspaceAvailability::Unavailable;
            self.store.save(&self.persisted_from_state(&self.state)).map_err(|message| {
                WorkspaceError::new(
                    WorkspaceErrorKind::StoreSaveFailed,
                    format!("Could not save local workspace memory: {message}"),
                    true,
                )
            })?;
        }
        Ok(())
    }

    /// Remove one locally remembered workspace without touching the repository.
    /// Removing the Current workspace explicitly leaves no Current workspace;
    /// another catalog entry is never implicitly selected.
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
        next.error = None;
        self.store.save(&self.persisted_from_state(&next)).map_err(|message| {
            WorkspaceError::new(
                WorkspaceErrorKind::StoreSaveFailed,
                format!("Could not save local workspace memory: {message}"),
                true,
            )
        })?;
        self.state = next;
        self.restoration_candidate = None;
        self.remembered_current_path = None;
        Ok(())
    }

    fn fail_current_request(
        &mut self,
        request: &WorkspaceRequest,
        error: WorkspaceError,
    ) -> Result<IssueExplorerData, WorkspaceError> {
        if self.ensure_current(request).is_ok() {
            self.state.pending_workspace = None;
            self.state.error = Some(error.clone());
        }
        Err(error)
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

fn state_from_persisted(
    persisted: PersistedWorkspaceState,
) -> (WorkspaceState, Option<PathBuf>, Option<String>) {
    let restoration_candidate = persisted.current_workspace_path.clone().map(PathBuf::from);
    let remembered_current_path = persisted.current_workspace_path;
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
        remembered_current_path,
    )
}

/// Retain a validated workspace without changing MRU order. A new entry is
/// appended, so promotion is reserved for the final durable Current commit.
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

fn validate_workspace(
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

fn load_issue_explorer_data(
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
            .restore_current(&FakeRunner::with_outputs(command_outputs("/work/persisted")))
            .expect("restart should restore through the normal transaction");
        assert_eq!(
            restarted.state().current_workspace.as_ref().map(|workspace| &workspace.path),
            Some(&"/work/persisted".to_string())
        );
    }

    #[test]
    fn failed_startup_restore_marks_the_known_workspace_unavailable() {
        let store = FakeStore::empty();
        *store.load_result.borrow_mut() = Ok(Some(PersistedWorkspaceState {
            catalog: vec![Workspace {
                path: "/work/missing".to_string(),
                availability: WorkspaceAvailability::Available,
            }],
            current_workspace_path: Some("/work/missing".to_string()),
            ..PersistedWorkspaceState::default()
        }));
        let mut service = WorkspaceService::from_store(store);
        let runner = FakeRunner::with_outputs([Ok(CommandOutput {
            status: 1,
            stdout: String::new(),
            stderr: "not a git repository".to_string(),
        })]);

        service
            .restore_current(&runner)
            .expect_err("missing workspace must not restore");

        assert!(service.state().current_workspace.is_none());
        assert_eq!(
            service.state().catalog[0].availability,
            WorkspaceAvailability::Unavailable
        );
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

    fn store(&self) -> Result<std::sync::Arc<tauri_plugin_store::Store<R>>, String> {
        use tauri_plugin_store::StoreExt;
        self.app
            .store("workspace-catalog.json")
            .map_err(|error| error.to_string())
    }
}

impl<R: tauri::Runtime> WorkspaceStore for TauriWorkspaceStore<R> {
    fn load(&self) -> Result<Option<PersistedWorkspaceState>, String> {
        let store = self.store()?;
        let Some(value) = store.get("workspaceState") else {
            return Ok(None);
        };
        serde_json::from_value(value).map(Some).map_err(|error| error.to_string())
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
                use tauri::{Manager, path::BaseDirectory};
                let path = self
                    .app
                    .path()
                    .resolve("workspace-catalog.json", BaseDirectory::AppData)
                    .map_err(|error| error.to_string())?;
                match std::fs::remove_file(path) {
                    Ok(()) => Ok(()),
                    Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                    Err(error) => Err(error.to_string()),
                }
            }
        }
    }
}

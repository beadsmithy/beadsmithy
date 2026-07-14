//! Typed TauRPC boundary for Beadsmith frontend/native calls.
//!
//! The RPC layer owns the frontend-facing contract. It delegates Beadwork CLI
//! access to the pure Rust `issues` adapter and maps adapter results/errors into
//! serializable, user-displayable payloads.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::Emitter;

use crate::issues::{self, ListIssuesError, ProcessRunner};
use crate::workspace::{
    load_issue_explorer_data, validate_workspace, IssueExplorerData, TauriWorkspaceStore,
    Workspace, WorkspaceError, WorkspaceErrorKind, WorkspaceRequest, WorkspaceService,
    WorkspaceState,
};

/// Name of the Tauri event used to publish workspace transition updates.
pub const WORKSPACE_TRANSITION_EVENT: &str = "workspace-transition";

/// Typed workspace transition payload published on [`WORKSPACE_TRANSITION_EVENT`]
/// after Pending, current-request failure, cancellation/removal, and successful
/// publication. `issue_data` is set only on a committed success so the frontend
/// can promote Issue Explorer state through the same generation-guarded
/// handler as the typed RPC response.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTransition {
    pub state: WorkspaceState,
    pub issue_data: Option<LoadIssueExplorerDataResponse>,
}

/// In-memory data is only published after the workspace service's durable
/// Current commit. It lets Issue Explorer reload without accepting a path.
struct WorkspaceRuntime {
    app: tauri::AppHandle<tauri::Wry>,
    service: WorkspaceService<TauriWorkspaceStore<tauri::Wry>>,
    snapshot: Option<IssueExplorerData>,
}

fn emit_transition(
    app: &tauri::AppHandle<tauri::Wry>,
    state: WorkspaceState,
    issue_data: Option<LoadIssueExplorerDataResponse>,
) {
    let transition = WorkspaceTransition { state, issue_data };
    if let Err(error) = app.emit(WORKSPACE_TRANSITION_EVENT, transition) {
        eprintln!("Beadsmith: failed to emit workspace transition: {error}");
    }
}

/// Build the TauRPC router, including TypeScript export configuration.
pub fn router<R: tauri::Runtime>(api: BeadsmithApiImpl) -> taurpc::Router<R> {
    let router = taurpc::Router::new()
        .export_config(specta_typescript::Typescript::default().header(
            "// oxlint-disable no-unused-vars typescript/ban-ts-comment import/consistent-type-specifier-style import/newline-after-import typescript/consistent-type-definitions\n// @ts-nocheck\n",
        ))
        .merge(api.into_handler());

    #[cfg(debug_assertions)]
    let router = router.merge(DevBridgeApiImpl.into_handler());

    router
}

/// Beadsmith's typed application RPC surface. Issue-loading methods deliberately
/// have no caller-provided workspace path.
#[taurpc::procedures(export_to = "../src/rpc/bindings.ts")]
pub trait BeadsmithApi {
    async fn list_issues() -> Result<ListIssuesResponse, IssueListError>;
    async fn load_issue_explorer_data() -> Result<LoadIssueExplorerDataResponse, IssueListError>;
    async fn workspace_state() -> WorkspaceState;
    async fn switch_workspace(
        candidate_path: String,
    ) -> Result<WorkspaceSwitchResponse, WorkspaceError>;
    async fn remove_workspace(path: String) -> Result<WorkspaceState, WorkspaceError>;
    async fn retry_workspace_memory() -> WorkspaceState;
    async fn reset_workspace_memory() -> Result<WorkspaceState, WorkspaceError>;
    async fn cancel_workspace() -> WorkspaceState;
}

/// Resolver implementation for Beadsmith's application RPC surface.
#[derive(Clone, Default)]
pub struct BeadsmithApiImpl {
    workspace: Arc<Mutex<Option<WorkspaceRuntime>>>,
}

impl BeadsmithApiImpl {
    /// Called once from Tauri setup after the store plugin has been registered.
    pub fn initialize_workspace(&self, app: tauri::AppHandle<tauri::Wry>) {
        let store = TauriWorkspaceStore::new(app.clone());
        let mut service = WorkspaceService::from_store(store);
        let snapshot = service
            .restore_current(&ProcessRunner::new())
            .ok()
            .flatten();
        *self
            .workspace
            .lock()
            .expect("workspace runtime lock poisoned") = Some(WorkspaceRuntime {
            app,
            service,
            snapshot,
        });
    }

    fn with_runtime<T>(&self, operation: impl FnOnce(&mut WorkspaceRuntime) -> T) -> T {
        let mut runtime = self
            .workspace
            .lock()
            .expect("workspace runtime lock poisoned");
        operation(
            runtime
                .as_mut()
                .expect("workspace runtime must initialize during Tauri setup"),
        )
    }

    /// Mark a still-current switch as failed and publish its transition. A
    /// stale worker completion returns its typed error to the direct caller
    /// but emits no transition or state mutation.
    fn fail_switch_request(
        &self,
        request: &WorkspaceRequest,
        validated: Option<&Workspace>,
        error: WorkspaceError,
    ) -> WorkspaceError {
        let transition = self.with_runtime(|runtime| {
            if !runtime.service.is_request_current(request) {
                return None;
            }
            let _ = runtime
                .service
                .fail_request(request, validated, error.clone());
            Some((runtime.app.clone(), runtime.service.state().clone()))
        });
        if let Some((app, state)) = transition {
            emit_transition(&app, state, None);
        }
        error
    }
}

#[taurpc::resolvers]
impl BeadsmithApi for BeadsmithApiImpl {
    async fn list_issues(self) -> Result<ListIssuesResponse, IssueListError> {
        self.with_runtime(|runtime| {
            let data = runtime
                .snapshot
                .as_ref()
                .ok_or_else(no_current_workspace_error)?;
            Ok(ListIssuesResponse {
                workspace_path: runtime
                    .service
                    .state()
                    .current_workspace
                    .as_ref()
                    .map(|workspace| workspace.path.clone())
                    .unwrap_or_default(),
                issues: map_issue_collection(data.all_issues.clone()),
            })
        })
    }

    async fn load_issue_explorer_data(
        self,
    ) -> Result<LoadIssueExplorerDataResponse, IssueListError> {
        self.with_runtime(|runtime| {
            let data = runtime
                .snapshot
                .as_ref()
                .ok_or_else(no_current_workspace_error)?;
            let state = runtime.service.state();
            let path = state
                .current_workspace
                .as_ref()
                .map(|workspace| workspace.path.as_str())
                .unwrap_or_default();
            Ok(workspace_data_response(data, path))
        })
    }

    async fn workspace_state(self) -> WorkspaceState {
        self.with_runtime(|runtime| runtime.service.state().clone())
    }

    async fn switch_workspace(
        self,
        candidate_path: String,
    ) -> Result<WorkspaceSwitchResponse, WorkspaceError> {
        let candidate = PathBuf::from(candidate_path);

        // Phase 1: begin the request under the lock and publish Pending before
        // any command runs. The lock is released immediately so Cancel and a
        // newer selection can acquire the runtime while the worker is blocked.
        let (request, app, pending_state) = self.with_runtime(|runtime| {
            let request = runtime.service.begin_selection(candidate.clone());
            (
                request,
                runtime.app.clone(),
                runtime.service.state().clone(),
            )
        });
        emit_transition(&app, pending_state, None);

        // Phase 2: validate outside the runtime mutex.
        let validated = match validate_workspace_outside_lock(candidate).await {
            Ok(workspace) => workspace,
            Err(error) => return Err(self.fail_switch_request(&request, None, error)),
        };

        // Phase 3: persist the validated catalog entry before loading. This is
        // the first durable transaction boundary and intentionally does not
        // promote MRU or replace Current.
        if let Err(error) = self.with_runtime(|runtime| {
            runtime
                .service
                .retain_validated(&request, validated.clone())
        }) {
            return Err(self.fail_switch_request(&request, Some(&validated), error));
        }

        // Phase 4: load all Issue Explorer views outside the runtime mutex.
        let data = match load_issue_explorer_data_outside_lock(validated.clone()).await {
            Ok(data) => data,
            Err(error) => {
                return Err(self.fail_switch_request(&request, Some(&validated), error));
            }
        };

        // Phase 5: the final save publishes Current and MRU together. The
        // snapshot assignment happens in this same critical section, never
        // during Pending or failure.
        let result = self.with_runtime(|runtime| {
            runtime
                .service
                .commit_loaded(&request, validated.clone(), data.clone())?;
            runtime.snapshot = Some(data.clone());
            let state = runtime.service.state().clone();
            let issue_data = workspace_data_response(&data, validated.path.as_str());
            Ok((runtime.app.clone(), state, issue_data))
        });
        let (app, state, issue_data) = match result {
            Ok(success) => success,
            Err(error) => {
                return Err(self.fail_switch_request(&request, Some(&validated), error));
            }
        };
        let response = WorkspaceSwitchResponse {
            state: state.clone(),
            issue_data: issue_data.clone(),
        };
        emit_transition(&app, state, Some(issue_data));
        Ok(response)
    }

    async fn remove_workspace(self, path: String) -> Result<WorkspaceState, WorkspaceError> {
        let (state, app) = self.with_runtime(|runtime| {
            let removed_current = runtime
                .service
                .state()
                .current_workspace
                .as_ref()
                .is_some_and(|workspace| workspace.path == path);
            runtime.service.remove_workspace(&path)?;
            if removed_current {
                runtime.snapshot = None;
            }
            let state = runtime.service.state().clone();
            let app = runtime.app.clone();
            Ok((state, app))
        })?;
        emit_transition(&app, state.clone(), None);
        Ok(state)
    }

    async fn retry_workspace_memory(self) -> WorkspaceState {
        self.with_runtime(|runtime| {
            let store = TauriWorkspaceStore::new(runtime.app.clone());
            let mut service = WorkspaceService::from_store(store);
            let snapshot = service
                .restore_current(&ProcessRunner::new())
                .ok()
                .flatten();
            runtime.service = service;
            runtime.snapshot = snapshot;
            runtime.service.state().clone()
        })
    }

    async fn reset_workspace_memory(self) -> Result<WorkspaceState, WorkspaceError> {
        let (state, app) = self.with_runtime(|runtime| {
            runtime.service.reset_memory()?;
            runtime.snapshot = None;
            let state = runtime.service.state().clone();
            let app = runtime.app.clone();
            Ok((state, app))
        })?;
        emit_transition(&app, state.clone(), None);
        Ok(state)
    }

    async fn cancel_workspace(self) -> WorkspaceState {
        let (state, app) = self.with_runtime(|runtime| {
            let state = runtime.service.cancel_pending();
            let app = runtime.app.clone();
            (state, app)
        });
        emit_transition(&app, state.clone(), None);
        state
    }
}

/// Validate a switch candidate on Tokio's blocking pool. No runtime mutex is
/// held while `bw config list` or `git rev-parse` execute.
async fn validate_workspace_outside_lock(candidate: PathBuf) -> Result<Workspace, WorkspaceError> {
    tokio::task::spawn_blocking(move || validate_workspace(&ProcessRunner::new(), &candidate))
        .await
        .unwrap_or_else(|error| {
            Err(WorkspaceError::new(
                WorkspaceErrorKind::LoadFailed,
                format!("Workspace validation worker failed: {error}"),
                true,
            ))
        })
}

/// Load the complete Issue Explorer snapshot on Tokio's blocking pool. No
/// runtime mutex is held while any Beadwork view command executes.
async fn load_issue_explorer_data_outside_lock(
    workspace: Workspace,
) -> Result<IssueExplorerData, WorkspaceError> {
    tokio::task::spawn_blocking(move || {
        load_issue_explorer_data(&ProcessRunner::new(), Path::new(&workspace.path))
    })
    .await
    .unwrap_or_else(|error| {
        Err(WorkspaceError::new(
            WorkspaceErrorKind::LoadFailed,
            format!("Issue loading worker failed: {error}"),
            true,
        ))
    })
}

/// Result of a successful switch; the frontend receives its complete snapshot
/// only after the service's durable Current commit.
#[taurpc::ipc_type]
#[derive(Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSwitchResponse {
    pub state: WorkspaceState,
    pub issue_data: LoadIssueExplorerDataResponse,
}

fn no_current_workspace_error() -> IssueListError {
    IssueListError {
        kind: IssueListErrorKind::NotBeadworkWorkspace,
        message: "Select a workspace to load issues.".to_string(),
    }
}

#[cfg(debug_assertions)]
#[taurpc::procedures(path = "devBridge")]
pub trait DevBridgeApi {
    async fn result(id: String, value: String);
}

#[cfg(debug_assertions)]
#[derive(Clone, Default)]
pub struct DevBridgeApiImpl;

#[cfg(debug_assertions)]
#[taurpc::resolvers]
impl DevBridgeApi for DevBridgeApiImpl {
    async fn result(self, id: String, value: String) {
        crate::dev_bridge::record_eval_result(id, value);
    }
}

/// Successful issue-list RPC payload.
#[taurpc::ipc_type]
#[derive(Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListIssuesResponse {
    pub workspace_path: String,
    pub issues: Vec<Issue>,
}

/// Successful Issue Explorer RPC payload containing Beadwork-authored base views.
#[taurpc::ipc_type]
#[derive(Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoadIssueExplorerDataResponse {
    pub workspace_path: String,
    pub all_issues: Vec<Issue>,
    pub ready_issues: Vec<Issue>,
    pub blocked_issues: Vec<Issue>,
}

/// Frontend-facing Issue contract for rendering the Issue List and future Issue Detail.
#[taurpc::ipc_type]
#[derive(Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: i32,
    #[serde(rename = "type")]
    pub issue_type: String,
    pub description: String,
    pub comments: Vec<IssueComment>,
    pub close_reason: String,
    pub assignee: String,
    pub labels: Vec<String>,
    pub parent: String,
    pub blocked_by: Vec<String>,
    pub blocks: Vec<String>,
    pub created: String,
    pub updated_at: String,
    pub closed_at: String,
    pub defer_until: String,
    pub due: String,
}

/// Frontend-facing Issue comment contract.
#[taurpc::ipc_type]
#[derive(Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueComment {
    pub text: String,
    pub author: String,
    pub timestamp: String,
}

/// Machine-readable issue-list error kind.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum IssueListErrorKind {
    MissingBinary,
    NotBeadworkWorkspace,
    CommandFailed,
    ParseFailed,
    ExecutionFailed,
}

/// User-displayable typed issue-list error payload.
#[taurpc::ipc_type]
#[derive(Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueListError {
    /// Machine-readable error kind.
    pub kind: IssueListErrorKind,
    pub message: String,
}

fn workspace_data_response(
    data: &IssueExplorerData,
    workspace_path: &str,
) -> LoadIssueExplorerDataResponse {
    LoadIssueExplorerDataResponse {
        workspace_path: workspace_path.to_string(),
        all_issues: map_issue_collection(data.all_issues.clone()),
        ready_issues: map_issue_collection(data.ready_issues.clone()),
        blocked_issues: map_issue_collection(data.blocked_issues.clone()),
    }
}

fn map_issue_collection(issues: Vec<issues::Issue>) -> Vec<Issue> {
    issues.into_iter().map(Issue::from).collect()
}

#[cfg(test)]
fn issue_list_error_with_view_context(error: ListIssuesError, view_label: &str) -> IssueListError {
    let mut mapped = IssueListError::from(error);
    mapped.message = format!("Could not load {view_label}: {}", mapped.message);
    mapped
}

impl From<issues::Issue> for Issue {
    fn from(issue: issues::Issue) -> Self {
        Self {
            id: issue.id,
            title: issue.title,
            status: issue.status,
            priority: i32::try_from(issue.priority).unwrap_or_default(),
            issue_type: issue.issue_type,
            description: issue.description,
            comments: issue.comments.into_iter().map(IssueComment::from).collect(),
            close_reason: issue.close_reason,
            assignee: issue.assignee,
            labels: issue.labels,
            parent: issue.parent.unwrap_or_default(),
            blocked_by: issue.blocked_by,
            blocks: issue.blocks,
            created: issue.created,
            updated_at: issue.updated_at.unwrap_or_default(),
            closed_at: issue.closed_at.unwrap_or_default(),
            defer_until: issue.defer_until.unwrap_or_default(),
            due: issue.due.unwrap_or_default(),
        }
    }
}

impl From<issues::IssueComment> for IssueComment {
    fn from(comment: issues::IssueComment) -> Self {
        Self {
            text: comment.text,
            author: comment.author,
            timestamp: comment.timestamp,
        }
    }
}

impl From<ListIssuesError> for IssueListError {
    fn from(error: ListIssuesError) -> Self {
        match error {
            ListIssuesError::MissingBinary => Self {
                kind: IssueListErrorKind::MissingBinary,
                message: "The bw executable was not found on PATH.".to_string(),
            },
            ListIssuesError::NotBeadworkWorkspace { .. } => Self {
                kind: IssueListErrorKind::NotBeadworkWorkspace,
                message: "The current directory is not a Beadwork workspace.".to_string(),
            },
            ListIssuesError::CommandFailed { status, .. } => Self {
                kind: IssueListErrorKind::CommandFailed,
                message: format!("bw could not list issues and exited with status {status}."),
            },
            ListIssuesError::Parse(_) => Self {
                kind: IssueListErrorKind::ParseFailed,
                message: "Beadwork returned issue data Beadsmith could not understand.".to_string(),
            },
            ListIssuesError::Io(_) => Self {
                kind: IssueListErrorKind::ExecutionFailed,
                message: "Beadsmith could not run bw to list issues.".to_string(),
            },
        }
    }
}

#[cfg(test)]
fn list_issues_from_adapter(
    runner: &dyn issues::CommandRunner,
    workspace: &Path,
) -> Result<ListIssuesResponse, IssueListError> {
    let workspace_path = workspace.display().to_string();
    let issues = map_issue_collection(
        issues::list_all_issues(runner, workspace).map_err(IssueListError::from)?,
    );
    Ok(ListIssuesResponse {
        workspace_path,
        issues,
    })
}

#[cfg(test)]
fn load_issue_explorer_data_from_adapter(
    runner: &dyn issues::CommandRunner,
    workspace: &Path,
) -> Result<LoadIssueExplorerDataResponse, IssueListError> {
    let all_issues = map_issue_collection(
        issues::list_all_issues(runner, workspace)
            .map_err(|error| issue_list_error_with_view_context(error, "All Issues"))?,
    );
    let ready_issues = map_issue_collection(
        issues::list_ready_issues(runner, workspace)
            .map_err(|error| issue_list_error_with_view_context(error, "Ready Issues"))?,
    );
    let blocked_issues = map_issue_collection(
        issues::list_blocked_issues(runner, workspace)
            .map_err(|error| issue_list_error_with_view_context(error, "Blocked Issues"))?,
    );
    Ok(LoadIssueExplorerDataResponse {
        workspace_path: workspace.display().to_string(),
        all_issues,
        ready_issues,
        blocked_issues,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::issues::{CommandOutput, CommandRunner};
    use std::collections::VecDeque;
    use std::io;
    use std::path::PathBuf;
    use std::sync::Mutex;

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct Invocation {
        program: String,
        args: Vec<String>,
        cwd: PathBuf,
    }

    struct FakeRunner {
        outputs: Mutex<VecDeque<Result<CommandOutput, io::ErrorKind>>>,
        recorded: Mutex<Vec<Invocation>>,
    }

    impl FakeRunner {
        fn ok(stdout: &str) -> Self {
            Self::with_outputs([Ok(CommandOutput {
                status: 0,
                stdout: stdout.to_string(),
                stderr: String::new(),
            })])
        }

        fn failed(status: i32, stderr: &str) -> Self {
            Self::with_outputs([Ok(CommandOutput {
                status,
                stdout: String::new(),
                stderr: stderr.to_string(),
            })])
        }

        fn io_error(kind: io::ErrorKind) -> Self {
            Self::with_outputs([Err(kind)])
        }

        fn with_outputs<const N: usize>(
            outputs: [Result<CommandOutput, io::ErrorKind>; N],
        ) -> Self {
            Self {
                outputs: Mutex::new(VecDeque::from(outputs)),
                recorded: Mutex::new(Vec::new()),
            }
        }

        fn recorded(&self) -> Vec<Invocation> {
            self.recorded.lock().unwrap().clone()
        }
    }

    impl CommandRunner for FakeRunner {
        fn run(&self, program: &str, args: &[&str], cwd: &Path) -> io::Result<CommandOutput> {
            self.recorded.lock().unwrap().push(Invocation {
                program: program.to_string(),
                args: args.iter().map(|arg| (*arg).to_string()).collect(),
                cwd: cwd.to_path_buf(),
            });
            let output = self
                .outputs
                .lock()
                .unwrap()
                .pop_front()
                .expect("expected a canned command output");

            match output {
                Ok(output) => Ok(output),
                Err(kind) => Err(io::Error::from(kind)),
            }
        }
    }

    fn test_workspace() -> PathBuf {
        PathBuf::from("selected-workspace")
    }

    fn assert_recorded_view_commands(runner: &FakeRunner, workspace: &Path) {
        assert_eq!(
            runner.recorded(),
            vec![
                Invocation {
                    program: "bw".to_string(),
                    args: vec![
                        "list".to_string(),
                        "--all".to_string(),
                        "--json".to_string()
                    ],
                    cwd: workspace.to_path_buf(),
                },
                Invocation {
                    program: "bw".to_string(),
                    args: vec!["ready".to_string(), "--json".to_string()],
                    cwd: workspace.to_path_buf(),
                },
                Invocation {
                    program: "bw".to_string(),
                    args: vec!["blocked".to_string(), "--json".to_string()],
                    cwd: workspace.to_path_buf(),
                },
            ]
        );
    }

    fn issue_json(id: &str, title: &str) -> String {
        format!(
            r#"[
              {{
                "assignee": "",
                "created": "2026-06-28T22:37:05Z",
                "id": "{id}",
                "priority": 2,
                "status": "open",
                "title": "{title}",
                "type": "task",
                "updated_at": "2026-06-29T08:19:43Z"
              }}
            ]"#
        )
    }

    fn successful_output(stdout: &str) -> Result<CommandOutput, io::ErrorKind> {
        Ok(CommandOutput {
            status: 0,
            stdout: stdout.to_string(),
            stderr: String::new(),
        })
    }

    fn failed_output(status: i32, stderr: &str) -> Result<CommandOutput, io::ErrorKind> {
        Ok(CommandOutput {
            status,
            stdout: String::new(),
            stderr: stderr.to_string(),
        })
    }

    #[test]
    fn maps_adapter_success_to_frontend_contract() {
        let runner = FakeRunner::ok(
            r#"[
              {
                "assignee": "Tomas",
                "blocked_by": ["bsm-a"],
                "blocks": ["bsm-c"],
                "closed_at": null,
                "close_reason": null,
                "created": "2026-06-28T22:37:05Z",
                "defer_until": null,
                "description": "details",
                "due": "2026-07-02T10:00:00Z",
                "id": "bsm-b",
                "labels": null,
                "parent": null,
                "comments": [
                  {"text": "ready for UI", "author": "tomas", "timestamp": "2026-06-29T08:19:43Z"}
                ],
                "priority": 2,
                "status": "open",
                "title": "Expose issues",
                "type": "task",
                "updated_at": "2026-06-29T08:19:43Z"
              }
            ]"#,
        );

        let ws = test_workspace();
        let response = list_issues_from_adapter(&runner, &ws).expect("expected success");
        assert!(!response.workspace_path.is_empty());
        let issue = response.issues.first().expect("expected issue");
        assert_eq!(issue.id, "bsm-b");
        assert_eq!(issue.issue_type, "task");
        assert_eq!(issue.labels, Vec::<String>::new());
        assert_eq!(issue.parent, "");
        assert_eq!(issue.blocked_by, vec!["bsm-a"]);
        assert_eq!(issue.blocks, vec!["bsm-c"]);
        assert_eq!(issue.closed_at, "");
        assert_eq!(issue.due, "2026-07-02T10:00:00Z");
        assert_eq!(issue.description, "details");
        assert_eq!(issue.close_reason, "");
        assert_eq!(issue.comments.len(), 1);
        assert_eq!(issue.comments[0].text, "ready for UI");
        assert_eq!(issue.comments[0].author, "tomas");
        assert_eq!(issue.comments[0].timestamp, "2026-06-29T08:19:43Z");
    }

    #[test]
    fn empty_issue_list_is_success_not_error() {
        let ws = test_workspace();
        let response = list_issues_from_adapter(&FakeRunner::ok("[]"), &ws)
            .expect("expected successful empty list");
        assert!(response.issues.is_empty());
    }

    #[test]
    fn maps_combined_issue_explorer_data_without_deriving_views() {
        let all_json = issue_json("bsm-all", "All issue");
        let ready_json = issue_json("bsm-ready", "Ready issue");
        let blocked_json = issue_json("bsm-blocked", "Blocked issue");
        let runner = FakeRunner::with_outputs([
            successful_output(&all_json),
            successful_output(&ready_json),
            successful_output(&blocked_json),
        ]);

        let ws = test_workspace();
        let response =
            load_issue_explorer_data_from_adapter(&runner, &ws).expect("expected success");

        assert_eq!(response.workspace_path, ws.display().to_string());
        assert_eq!(response.all_issues[0].id, "bsm-all");
        assert_eq!(response.ready_issues[0].id, "bsm-ready");
        assert_eq!(response.blocked_issues[0].id, "bsm-blocked");
        assert_recorded_view_commands(&runner, &ws);
    }

    #[test]
    fn combined_issue_explorer_data_accepts_empty_view_collections() {
        let runner = FakeRunner::with_outputs([
            successful_output("[]"),
            successful_output("null"),
            successful_output(""),
        ]);

        let ws = test_workspace();
        let response =
            load_issue_explorer_data_from_adapter(&runner, &ws).expect("expected success");

        assert!(response.all_issues.is_empty());
        assert!(response.ready_issues.is_empty());
        assert!(response.blocked_issues.is_empty());
        assert_recorded_view_commands(&runner, &ws);
    }

    #[test]
    fn combined_issue_explorer_data_errors_identify_failing_view() {
        let cases = [
            (
                FakeRunner::with_outputs([failed_output(2, "all failed")]),
                "All Issues",
            ),
            (
                FakeRunner::with_outputs([
                    successful_output("[]"),
                    failed_output(2, "ready failed"),
                ]),
                "Ready Issues",
            ),
            (
                FakeRunner::with_outputs([
                    successful_output("[]"),
                    successful_output("[]"),
                    failed_output(2, "blocked failed"),
                ]),
                "Blocked Issues",
            ),
        ];

        let ws = test_workspace();
        for (runner, expected_view) in cases {
            let error =
                load_issue_explorer_data_from_adapter(&runner, &ws).expect_err("expected error");
            assert_eq!(error.kind, IssueListErrorKind::CommandFailed);
            assert!(
                error.message.contains(expected_view),
                "expected message to identify {expected_view}, got {}",
                error.message
            );
        }
    }

    #[tokio::test]
    async fn generates_typescript_bindings() {
        let _handler = router::<tauri::Wry>(BeadsmithApiImpl::default()).into_handler();

        let bindings_path = "../src/rpc/bindings.ts";
        let generated_bindings =
            std::fs::read_to_string(bindings_path).expect("expected generated TauRPC bindings");
        // TauRPC currently emits trailing whitespace in a few type rows. Keep
        // the generated source stable so a binding verification test does not
        // leave the worktree dirty.
        let bindings = generated_bindings
            .lines()
            .map(str::trim_end)
            .collect::<Vec<_>>()
            .join("\n");
        if bindings != generated_bindings.trim_end() {
            std::fs::write(bindings_path, format!("{bindings}\n"))
                .expect("normalized bindings should be written");
        }
        assert!(bindings.contains("export type Issue"));
        assert!(bindings.contains("export type IssueComment"));
        assert!(bindings.contains("export type ListIssuesResponse"));
        assert!(bindings.contains("export type LoadIssueExplorerDataResponse"));
        let old_issue_type_name = ["Issue", "Summary"].concat();
        let old_response_type_name = ["ListIssue", "SummariesResponse"].concat();
        assert!(!bindings.contains(&old_issue_type_name));
        assert!(!bindings.contains(&old_response_type_name));
        for field in [
            "id: string",
            "title: string",
            "status: string",
            "priority: number",
            "type: string",
            "description: string",
            "comments: IssueComment[]",
            "closeReason: string",
            "assignee: string",
            "labels: string[]",
            "parent: string",
            "blockedBy: string[]",
            "blocks: string[]",
            "created: string",
            "updatedAt: string",
            "closedAt: string",
            "deferUntil: string",
            "due: string",
            "text: string",
            "author: string",
            "timestamp: string",
            "workspacePath: string",
            "allIssues: Issue[]",
            "readyIssues: Issue[]",
            "blockedIssues: Issue[]",
        ] {
            assert!(bindings.contains(field), "missing generated field {field}");
        }
        for kind in [
            "missingBinary",
            "notBeadworkWorkspace",
            "commandFailed",
            "parseFailed",
            "executionFailed",
        ] {
            assert!(
                bindings.contains(kind),
                "missing generated error kind {kind}"
            );
        }
        assert!(bindings.contains("list_issues"));
        assert!(bindings.contains("load_issue_explorer_data"));
        for method in [
            "workspace_state",
            "switch_workspace",
            "remove_workspace",
            "retry_workspace_memory",
            "reset_workspace_memory",
            "cancel_workspace",
        ] {
            assert!(bindings.contains(method), "missing workspace RPC {method}");
        }
        for type_name in [
            "WorkspaceState",
            "WorkspaceSwitchResponse",
            "WorkspaceAvailability",
        ] {
            assert!(
                bindings.contains(type_name),
                "missing workspace type {type_name}"
            );
        }
        assert!(
            bindings.contains("retryWorkspace"),
            "missing generated retry_workspace field"
        );
        let old_method_name = ["list_issue", "_summaries"].concat();
        assert!(!bindings.contains(&old_method_name));
        assert!(bindings.contains("createTauRPCProxy"));
    }

    #[test]
    fn maps_distinct_error_kinds() {
        let cases = [
            (
                FakeRunner::io_error(io::ErrorKind::NotFound),
                IssueListErrorKind::MissingBinary,
            ),
            (
                FakeRunner::failed(1, "error: not a git repository"),
                IssueListErrorKind::NotBeadworkWorkspace,
            ),
            (
                FakeRunner::failed(2, "boom"),
                IssueListErrorKind::CommandFailed,
            ),
            (FakeRunner::ok("not json"), IssueListErrorKind::ParseFailed),
        ];

        let ws = test_workspace();
        for (runner, expected_kind) in cases {
            let error = list_issues_from_adapter(&runner, &ws).expect_err("expected error");
            assert_eq!(error.kind, expected_kind);
            assert!(!error.message.is_empty());
        }
    }
}

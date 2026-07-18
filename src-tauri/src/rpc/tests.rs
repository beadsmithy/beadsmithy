//! Outlined TauRPC boundary tests.
//!
//! Migrated from the inline `mod tests` block at the bottom of `rpc.rs`. The
//! supporting fakes and command-output fixtures live at the root of this
//! file so the test bodies below can reuse them without widening the
//! production module's public surface.

use super::*;
use crate::issues::{CommandOutput, CommandRunner};
use crate::workspace::WorkspaceAvailability;
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

    fn with_outputs<const N: usize>(outputs: [Result<CommandOutput, io::ErrorKind>; N]) -> Self {
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
    let response = load_issue_explorer_data_from_adapter(&runner, &ws).expect("expected success");

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
    let response = load_issue_explorer_data_from_adapter(&runner, &ws).expect("expected success");

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
            FakeRunner::with_outputs([successful_output("[]"), failed_output(2, "ready failed")]),
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
        "WorkspaceRetryMemoryResponse",
        "WorkspaceCancelResponse",
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
    for method in ["app_settings_state", "update_app_settings"] {
        assert!(
            bindings.contains(method),
            "missing app settings RPC {method}"
        );
    }
    for type_name in [
        "AppSettings",
        "AppSettingsUpdate",
        "AppSettingsState",
        "AppSettingsError",
    ] {
        assert!(
            bindings.contains(type_name),
            "missing app settings type {type_name}"
        );
    }
    assert!(
        bindings.contains("fontSizePx"),
        "missing generated fontSizePx field"
    );
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

struct FakeStore {
    save_results: Mutex<VecDeque<Result<(), String>>>,
}

impl FakeStore {
    fn empty() -> Self {
        Self {
            save_results: Mutex::new(VecDeque::new()),
        }
    }

    fn with_saves(save_results: impl IntoIterator<Item = Result<(), String>>) -> Self {
        Self {
            save_results: Mutex::new(save_results.into_iter().collect()),
        }
    }
}

impl WorkspaceStore for FakeStore {
    fn load(&self) -> Result<Option<crate::workspace::PersistedWorkspaceState>, String> {
        Ok(None)
    }

    fn save(&self, _state: &crate::workspace::PersistedWorkspaceState) -> Result<(), String> {
        self.save_results
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(()))
    }

    fn reset(&self) -> Result<(), String> {
        Ok(())
    }
}

fn switch_command_outputs(root: &str) -> [Result<CommandOutput, io::ErrorKind>; 5] {
    [
        successful_output("setting=value\n"),
        successful_output(&format!("{root}\n")),
        successful_output("[]"),
        successful_output("[]"),
        successful_output("[]"),
    ]
}

fn empty_snapshot() -> IssueExplorerData {
    IssueExplorerData {
        all_issues: Vec::new(),
        ready_issues: Vec::new(),
        blocked_issues: Vec::new(),
    }
}

#[test]
fn switch_orchestration_publishes_pending_before_running_commands() {
    let runner = FakeRunner::with_outputs(switch_command_outputs("/work/b"));
    let mut service = WorkspaceService::from_store(FakeStore::empty());
    let mut snapshot = None;
    let mut transitions = Vec::new();

    execute_switch_workspace(
        &mut service,
        &mut snapshot,
        &runner,
        PathBuf::from("/work/b"),
        &mut |state, issue_data| {
            if state.pending_workspace.is_some() {
                assert!(runner.recorded().is_empty());
            }
            transitions.push((state, issue_data.is_some()));
        },
    )
    .expect("switch should commit");

    assert_eq!(transitions.len(), 2);
    assert!(transitions[0].0.pending_workspace.is_some());
    assert!(!transitions[0].1);
    assert!(transitions[1].0.current_workspace.is_some());
    assert!(transitions[1].1);
    assert_eq!(runner.recorded().len(), 5);
}

#[test]
fn stale_switch_completion_emits_neither_failure_nor_success_transition() {
    let mut service = WorkspaceService::from_store(FakeStore::empty());
    let mut snapshot = Some(empty_snapshot());
    let mut transitions = Vec::new();
    let stale = begin_switch_request(
        &mut service,
        PathBuf::from("/work/stale"),
        &mut |state, issue_data| transitions.push((state, issue_data.is_some())),
    );
    let _current = service.begin_selection("/work/current");

    let success_error = finish_switch_success(
        &mut service,
        &mut snapshot,
        &stale,
        Workspace {
            path: "/work/stale".to_string(),
            availability: WorkspaceAvailability::Available,
        },
        empty_snapshot(),
        &mut |state, issue_data| transitions.push((state, issue_data.is_some())),
    )
    .expect_err("stale completion must not commit");
    let failure_error = finish_switch_failure(
        &mut service,
        &stale,
        None,
        WorkspaceError::new(WorkspaceErrorKind::ValidationFailed, "invalid", true),
        &mut |state, issue_data| transitions.push((state, issue_data.is_some())),
    );

    assert_eq!(success_error.kind, WorkspaceErrorKind::StaleGeneration);
    assert_eq!(failure_error.kind, WorkspaceErrorKind::ValidationFailed);
    assert_eq!(transitions.len(), 1);
    assert!(transitions[0].0.pending_workspace.is_some());
    assert!(!transitions[0].1);
    assert_eq!(
        service.state().pending_workspace.unwrap().path,
        "/work/current"
    );
    assert_eq!(snapshot, Some(empty_snapshot()));
}

#[test]
fn switch_orchestration_replaces_snapshot_only_after_durable_commit() {
    let runner = FakeRunner::with_outputs(switch_command_outputs("/work/b"));
    let mut service = WorkspaceService::from_store(FakeStore::with_saves([
        Ok(()),
        Err("disk full".to_string()),
    ]));
    let original_snapshot = empty_snapshot();
    let mut snapshot = Some(original_snapshot.clone());
    let mut transitions = Vec::new();

    let error = execute_switch_workspace(
        &mut service,
        &mut snapshot,
        &runner,
        PathBuf::from("/work/b"),
        &mut |state, issue_data| transitions.push((state, issue_data.is_some())),
    )
    .expect_err("final save should fail");

    assert_eq!(error.kind, WorkspaceErrorKind::StoreSaveFailed);
    assert_eq!(snapshot, Some(original_snapshot));
    assert_eq!(transitions.len(), 2);
    assert!(!transitions[0].1);
    assert!(!transitions[1].1);
    assert!(transitions[1].0.current_workspace.is_none());
}

fn state_with_current(path: &str) -> WorkspaceState {
    WorkspaceState {
        catalog: vec![Workspace {
            path: path.to_string(),
            availability: WorkspaceAvailability::Available,
        }],
        current_workspace: Some(Workspace {
            path: path.to_string(),
            availability: WorkspaceAvailability::Available,
        }),
        ..WorkspaceState::default()
    }
}

#[test]
fn cancel_response_pairs_snapshot_with_state_after_commit() {
    // Cancel-after-commit-before-success-publication race: the durable
    // commit has already cleared the pending request and the local
    // snapshot matches the just-committed Current Workspace. The
    // renderer's response must include the matching Issue Explorer
    // snapshot so it can apply state and snapshot atomically.
    let state = state_with_current("/work/b");
    let snapshot = empty_snapshot();
    let response = cancel_response_issue_data(&state, Some(&snapshot), false);
    let response = response.expect("after-commit cancel must surface a snapshot");
    assert_eq!(response.workspace_path, "/work/b");
}

#[test]
fn cancel_response_omits_snapshot_for_a_real_cancellation() {
    // The user-initiated Cancel cleared an actual Pending request; the
    // renderer's prior Issue Explorer snapshot must remain untouched.
    // Returning the local snapshot here would force the renderer to
    // re-render the prior workspace's issue list just because Cancel
    // happened, contradicting the user intent.
    let state = WorkspaceState {
        current_workspace: Some(Workspace {
            path: "/work/a".to_string(),
            availability: WorkspaceAvailability::Available,
        }),
        ..WorkspaceState::default()
    };
    let snapshot = empty_snapshot();
    let response = cancel_response_issue_data(&state, Some(&snapshot), true);
    assert!(
        response.is_none(),
        "real Pending cancellation must not package any snapshot"
    );
}

#[test]
fn cancel_response_omits_snapshot_when_no_current_is_set() {
    // No committed snapshot to pair with (the catalog is empty and
    // there is no current workspace); the response stays snapshot-free
    // regardless of any local data.
    let snapshot = empty_snapshot();
    let response = cancel_response_issue_data(&WorkspaceState::default(), Some(&snapshot), false);
    assert!(
        response.is_none(),
        "no current workspace means there is nothing to pair a snapshot with"
    );
}

#[test]
fn cancel_response_omits_snapshot_when_locally_unavailable() {
    // The cancel races with a future commit publication that has not
    // yet populated the runtime snapshot. Returning an empty
    // workspace-path response here would be a regression.
    let state = state_with_current("/work/b");
    let response = cancel_response_issue_data(&state, None, false);
    assert!(
        response.is_none(),
        "absent runtime snapshot must not be invented"
    );
}

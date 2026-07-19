//! Tests for the refresh coordinator.
//!
//! These tests cover:
//!
//! - the `probe_beadwork_ref` subprocess seam (exact git args, success,
//!   non-zero exit, missing ref, spawn failure, empty output);
//! - the pure `CoordinatorState` reducer (unseeded, unchanged SHA,
//!   changed SHA, dirty coalescing during active load, load success /
//!   failure transitions);
//! - the success-event JSON shape (camelCase fields, full nested issue
//!   data) so a renderer-side envelope drift is caught at compile / test
//!   time.
//!
//! All subprocess tests use the in-memory `FakeCommandRunner` seam. No
//! real `git` or `bw` binary is invoked.

use super::*;
use crate::issues::{CommandOutput, CommandRunner};
use std::collections::VecDeque;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone)]
struct FakeInvocation {
    program: String,
    args: Vec<String>,
    cwd: PathBuf,
}

struct FakeCommandRunner {
    outputs: Mutex<VecDeque<Result<CommandOutput, io::Error>>>,
    recorded: Mutex<Vec<FakeInvocation>>,
}

impl FakeCommandRunner {
    fn new(outputs: Vec<Result<CommandOutput, io::Error>>) -> Self {
        Self {
            outputs: Mutex::new(VecDeque::from(outputs)),
            recorded: Mutex::new(Vec::new()),
        }
    }

    fn recorded(&self) -> Vec<FakeInvocation> {
        self.recorded.lock().unwrap().clone()
    }
}

impl CommandRunner for FakeCommandRunner {
    fn run(&self, program: &str, args: &[&str], cwd: &Path) -> io::Result<CommandOutput> {
        self.recorded.lock().unwrap().push(FakeInvocation {
            program: program.to_string(),
            args: args.iter().map(|arg| (*arg).to_string()).collect(),
            cwd: cwd.to_path_buf(),
        });
        self.outputs
            .lock()
            .unwrap()
            .pop_front()
            .expect("expected a canned command output")
    }
}

fn ok_output(stdout: &str) -> Result<CommandOutput, io::Error> {
    Ok(CommandOutput {
        status: 0,
        stdout: stdout.to_string(),
        stderr: String::new(),
    })
}

fn failed_output(status: i32, stderr: &str) -> Result<CommandOutput, io::Error> {
    Ok(CommandOutput {
        status,
        stdout: String::new(),
        stderr: stderr.to_string(),
    })
}

fn workspace_path() -> PathBuf {
    PathBuf::from("/work/beadwork-fixture")
}

#[test]
fn probe_uses_exact_git_program_args_and_cwd() {
    let runner = FakeCommandRunner::new(vec![ok_output("0123abc\n")]);
    let cwd = workspace_path();

    let sha = probe_beadwork_ref(&runner, &cwd).expect("expected successful probe");

    assert_eq!(sha, "0123abc");
    let recorded = runner.recorded();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].program, "git");
    assert_eq!(
        recorded[0].args,
        vec!["rev-parse", "--verify", "refs/heads/beadwork^{commit}"]
    );
    assert_eq!(recorded[0].cwd, cwd);
}

#[test]
fn probe_trims_successful_stdout() {
    let runner = FakeCommandRunner::new(vec![ok_output("   abcdef0123   \n")]);
    let sha = probe_beadwork_ref(&runner, &workspace_path()).expect("expected success");
    assert_eq!(sha, "abcdef0123");
}

#[test]
fn probe_preserves_full_sha_value() {
    // The probe intentionally does not validate SHA length so a future
    // SHA-256 Beadwork layout is not silently rejected.
    let long_sha = "a".repeat(64);
    let runner = FakeCommandRunner::new(vec![ok_output(&format!("{long_sha}\n"))]);
    let sha = probe_beadwork_ref(&runner, &workspace_path()).expect("expected success");
    assert_eq!(sha, long_sha);
}

#[test]
fn probe_rejects_missing_ref_as_command_failure() {
    let runner = FakeCommandRunner::new(vec![failed_output(
        128,
        "fatal: unknown revision or path not in the working tree.",
    )]);
    let error = probe_beadwork_ref(&runner, &workspace_path())
        .expect_err("expected missing ref to surface as a failure");
    match error {
        ProbeError::CommandFailed { status, stderr } => {
            assert_eq!(status, 128);
            assert!(stderr.contains("unknown revision"));
        }
        other => panic!("expected CommandFailed, got {other:?}"),
    }
}

#[test]
fn probe_rejects_non_zero_status_as_command_failure() {
    let runner = FakeCommandRunner::new(vec![failed_output(2, "boom")]);
    let error = probe_beadwork_ref(&runner, &workspace_path())
        .expect_err("expected non-zero status to surface as a failure");
    assert!(matches!(error, ProbeError::CommandFailed { status: 2, .. }));
}

#[test]
fn probe_classifies_missing_git_binary_as_spawn_error() {
    let runner =
        FakeCommandRunner::new(vec![Err(io::Error::from(io::ErrorKind::NotFound))]);
    let error = probe_beadwork_ref(&runner, &workspace_path())
        .expect_err("expected missing git binary to surface as a spawn error");
    match error {
        ProbeError::Spawn(message) => {
            assert!(message.contains("git"), "spawn message must name the program: {message}");
        }
        other => panic!("expected Spawn, got {other:?}"),
    }
}

#[test]
fn probe_rejects_successful_command_with_empty_output() {
    let runner = FakeCommandRunner::new(vec![ok_output("")]);
    let error = probe_beadwork_ref(&runner, &workspace_path())
        .expect_err("expected empty stdout to surface as invalid output");
    assert!(matches!(error, ProbeError::InvalidOutput(_)));
}

#[test]
fn probe_rejects_successful_command_with_whitespace_only_output() {
    let runner = FakeCommandRunner::new(vec![ok_output("   \n   ")]);
    let error = probe_beadwork_ref(&runner, &workspace_path())
        .expect_err("expected whitespace-only stdout to surface as invalid output");
    assert!(matches!(error, ProbeError::InvalidOutput(_)));
}

#[test]
fn unseeded_state_triggers_one_initial_load_on_first_probe() {
    let mut state = CoordinatorState::unseeded();
    let decision = state
        .apply_probe("abc123")
        .expect("unseeded coordinator must start one initial load");
    match decision {
        LoadDecision::StartLoad(binding) => {
            assert_eq!(binding.observed_sha, "abc123");
            assert_eq!(binding.refresh_revision, 1);
        }
    }
    assert!(state.has_active_load);
    assert_eq!(state.last_published_sha, None);
    assert_eq!(state.next_revision, 2);
}

#[test]
fn unchanged_published_sha_does_not_trigger_a_load() {
    let mut state = CoordinatorState::unseeded();
    state.apply_probe("abc123").expect("first probe starts load");
    state.apply_load_success(&LoadBinding {
        workspace_path: PathBuf::new(),
        workspace_selection_generation: 0,
        observed_sha: "abc123".to_string(),
        refresh_revision: 1,
    });

    let decision = state.apply_probe("abc123");
    assert!(
        decision.is_none(),
        "already-published SHA must not schedule another load"
    );
}

#[test]
fn changed_sha_after_publish_starts_exactly_one_load() {
    let mut state = CoordinatorState::unseeded();
    state.apply_probe("abc").expect("first probe");
    state.apply_load_success(&LoadBinding {
        workspace_path: PathBuf::new(),
        workspace_selection_generation: 0,
        observed_sha: "abc".to_string(),
        refresh_revision: 1,
    });

    let decision = state
        .apply_probe("def")
        .expect("changed SHA must start one load");
    match decision {
        LoadDecision::StartLoad(binding) => {
            assert_eq!(binding.observed_sha, "def");
            assert_eq!(binding.refresh_revision, 2);
        }
    }
    assert_eq!(state.next_revision, 3);
}

#[test]
fn repeated_same_sha_during_active_load_does_not_create_extra_work() {
    let mut state = CoordinatorState::unseeded();
    state.apply_probe("abc").expect("first probe starts load");

    let outcome = state.apply_probe("abc");
    assert!(outcome.is_none());
    assert!(state.dirty_target_sha.is_none());
    assert!(state.has_active_load);
}

#[test]
fn several_changed_shas_during_active_load_retain_only_newest_dirty_target() {
    let mut state = CoordinatorState::unseeded();
    state.apply_probe("v1").expect("first probe starts load");

    let mut probe_results = Vec::new();
    for sha in ["v2", "v3", "v4", "v5"] {
        probe_results.push(state.apply_probe(sha).is_none());
    }
    assert!(probe_results.iter().all(|is_none| *is_none));
    assert_eq!(state.dirty_target_sha.as_deref(), Some("v5"));
    assert!(state.has_active_load);
}

#[test]
fn dirty_target_is_cleared_when_a_load_starts() {
    let mut state = CoordinatorState::unseeded();
    state.apply_probe("v1").expect("first probe");
    state.apply_probe("v2");
    assert_eq!(state.dirty_target_sha.as_deref(), Some("v2"));

    state.apply_load_success(&LoadBinding {
        workspace_path: PathBuf::new(),
        workspace_selection_generation: 0,
        observed_sha: "v1".to_string(),
        refresh_revision: 1,
    });

    // Probing again must schedule a new load for v2, the newest dirty
    // target observed while the previous load was active.
    let decision = state
        .apply_probe("v2")
        .expect("dirty target SHA must start one load after active load completes");
    match decision {
        LoadDecision::StartLoad(binding) => {
            assert_eq!(binding.observed_sha, "v2");
        }
    }
}

#[test]
fn load_failure_does_not_advance_published_sha() {
    let mut state = CoordinatorState::unseeded();
    state.apply_probe("v1").expect("first probe");
    state.apply_load_failure();
    assert!(!state.has_active_load);
    assert_eq!(state.last_published_sha, None);
}

#[test]
fn load_success_advances_published_sha_and_revision() {
    let mut state = CoordinatorState::unseeded();
    state.apply_probe("v1").expect("first probe");
    state.apply_load_success(&LoadBinding {
        workspace_path: PathBuf::new(),
        workspace_selection_generation: 0,
        observed_sha: "v1".to_string(),
        refresh_revision: 1,
    });

    assert_eq!(state.last_published_sha.as_deref(), Some("v1"));
    assert_eq!(state.last_published_revision, Some(1));
    assert!(!state.has_active_load);
}

#[test]
fn take_dirty_target_clears_the_slot() {
    let mut state = CoordinatorState::unseeded();
    state.apply_probe("v1").expect("first probe");
    state.apply_probe("v2");
    assert_eq!(state.take_dirty_target().as_deref(), Some("v2"));
    assert!(state.take_dirty_target().is_none());
}

#[test]
fn refresh_event_payload_uses_camel_case_with_full_issue_data() {
    let issue = crate::rpc::Issue {
        id: "bsm-test".to_string(),
        title: "Probe".to_string(),
        status: "open".to_string(),
        priority: 2,
        issue_type: "task".to_string(),
        description: String::new(),
        comments: Vec::new(),
        close_reason: String::new(),
        assignee: String::new(),
        labels: Vec::new(),
        parent: String::new(),
        blocked_by: Vec::new(),
        blocks: Vec::new(),
        created: "2026-01-01T00:00:00Z".to_string(),
        updated_at: String::new(),
        closed_at: String::new(),
        defer_until: String::new(),
        due: String::new(),
    };
    let response = LoadIssueExplorerDataResponse {
        workspace_path: "/work/refresh".to_string(),
        workspace_generation: 3,
        all_issues: vec![issue.clone()],
        ready_issues: vec![issue.clone()],
        blocked_issues: vec![issue],
    };
    let event = IssueExplorerRefreshEvent {
        issue_data: response,
        observed_ref_sha: "0123456789abcdef".to_string(),
        refresh_revision: 7,
        workspace_path: "/work/refresh".to_string(),
        workspace_selection_generation: 3,
    };

    let json = serde_json::to_string(&event).expect("event must serialize");

    assert!(json.contains("\"issueData\""));
    assert!(json.contains("\"observedRefSha\":\"0123456789abcdef\""));
    assert!(json.contains("\"refreshRevision\":7"));
    assert!(json.contains("\"workspacePath\":\"/work/refresh\""));
    assert!(json.contains("\"workspaceSelectionGeneration\":3"));
    assert!(json.contains("\"workspaceGeneration\":3"));
    assert!(json.contains("\"allIssues\""));
    assert!(json.contains("\"readyIssues\""));
    assert!(json.contains("\"blockedIssues\""));
    assert!(json.contains("\"bsm-test\""));
}

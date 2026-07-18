//! Outlined Beadwork adapter tests.
//!
//! Migrated from the inline `mod tests` block at the bottom of
//! `issues/adapter.rs`. Test-only fixtures and fakes stay local to this
//! module so the production adapter surface remains unchanged.

use super::*;
use crate::issues::runner::ProcessRunner;
use std::io;
use std::path::PathBuf;
use std::sync::Mutex;

/// Records the last invocation and returns a canned, cloneable result.
enum Canned {
    Ok(CommandOutput),
    Err(io::ErrorKind),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Invocation {
    program: String,
    args: Vec<String>,
    cwd: PathBuf,
}

struct FakeRunner {
    result: Mutex<Canned>,
    recorded: Mutex<Vec<Invocation>>,
}

impl FakeRunner {
    fn ok(stdout: &str) -> Self {
        Self {
            result: Mutex::new(Canned::Ok(CommandOutput {
                status: 0,
                stdout: stdout.to_string(),
                stderr: String::new(),
            })),
            recorded: Mutex::new(Vec::new()),
        }
    }

    fn fail(status: i32, stderr: &str) -> Self {
        Self {
            result: Mutex::new(Canned::Ok(CommandOutput {
                status,
                stdout: String::new(),
                stderr: stderr.to_string(),
            })),
            recorded: Mutex::new(Vec::new()),
        }
    }

    fn io_err(kind: io::ErrorKind) -> Self {
        Self {
            result: Mutex::new(Canned::Err(kind)),
            recorded: Mutex::new(Vec::new()),
        }
    }

    fn recorded(&self) -> Invocation {
        self.recorded.lock().unwrap().last().cloned().unwrap()
    }
}

impl CommandRunner for FakeRunner {
    fn run(&self, program: &str, args: &[&str], cwd: &Path) -> io::Result<CommandOutput> {
        self.recorded.lock().unwrap().push(Invocation {
            program: program.to_string(),
            args: args.iter().map(|arg| (*arg).to_string()).collect(),
            cwd: cwd.to_path_buf(),
        });
        match self.result.lock().unwrap().clone() {
            Canned::Ok(output) => Ok(output),
            Canned::Err(kind) => Err(io::Error::from(kind)),
        }
    }
}

impl Clone for Canned {
    fn clone(&self) -> Self {
        match self {
            Canned::Ok(output) => Canned::Ok(output.clone()),
            Canned::Err(kind) => Canned::Err(*kind),
        }
    }
}

fn representative_issue_json() -> String {
    r#"[
          {
            "assignee": "Tomas",
            "blocked_by": ["bsm-aaa"],
            "blocks": ["bsm-bbb"],
            "closed_at": "2026-06-28T22:40:03Z",
            "close_reason": "done",
            "created": "2026-06-28T22:37:05Z",
            "defer_until": "2026-07-01T10:00:00Z",
            "description": "What to build. Details here.",
            "due": "2026-07-02T10:00:00Z",
            "id": "bsm-8ul",
            "labels": ["ready-for-agent", "backend"],
            "parent": "bsm-mq4",
            "comments": [
              {"text": "keep it pure Rust", "author": "tomas", "timestamp": "2026-06-29T08:19:43Z"}
            ],
            "priority": 2,
            "status": "open",
            "title": "Add pure Rust bw list adapter",
            "type": "task",
            "updated_at": "2026-06-29T08:19:43Z"
          }
        ]"#
    .to_string()
}

fn test_workspace() -> PathBuf {
    PathBuf::from("selected-workspace")
}

#[test]
fn invokes_exactly_bw_list_all_json_in_supplied_workspace() {
    let runner = FakeRunner::ok("[]");
    let ws = test_workspace();
    let _ = list_all_issues(&runner, &ws);
    let invocation = runner.recorded();
    assert_eq!(invocation.program, BW_PROGRAM);
    assert_eq!(invocation.args, vec!["list", "--all", "--json"]);
    assert_eq!(invocation.cwd, ws);
}

#[test]
fn invokes_exactly_bw_ready_json_in_supplied_workspace() {
    let runner = FakeRunner::ok("[]");
    let ws = test_workspace();
    let _ = list_ready_issues(&runner, &ws);
    let invocation = runner.recorded();
    assert_eq!(invocation.program, BW_PROGRAM);
    assert_eq!(invocation.args, vec!["ready", "--json"]);
    assert_eq!(invocation.cwd, ws);
}

#[test]
fn invokes_exactly_bw_blocked_json_in_supplied_workspace() {
    let runner = FakeRunner::ok("[]");
    let ws = test_workspace();
    let _ = list_blocked_issues(&runner, &ws);
    let invocation = runner.recorded();
    assert_eq!(invocation.program, BW_PROGRAM);
    assert_eq!(invocation.args, vec!["blocked", "--json"]);
    assert_eq!(invocation.cwd, ws);
}

#[test]
fn success_maps_representative_fields() {
    let runner = FakeRunner::ok(&representative_issue_json());
    let ws = test_workspace();
    let issues = list_all_issues(&runner, &ws).expect("expected success");
    assert_eq!(issues.len(), 1);
    let issue = &issues[0];
    assert_eq!(issue.id, "bsm-8ul");
    assert_eq!(issue.title, "Add pure Rust bw list adapter");
    assert_eq!(issue.status, "open");
    assert_eq!(issue.priority, 2);
    assert_eq!(issue.issue_type, "task");
    assert_eq!(issue.assignee, "Tomas");
    assert_eq!(issue.created, "2026-06-28T22:37:05Z");
    assert_eq!(issue.updated_at.as_deref(), Some("2026-06-29T08:19:43Z"));
    assert_eq!(issue.closed_at.as_deref(), Some("2026-06-28T22:40:03Z"));
    assert_eq!(issue.defer_until.as_deref(), Some("2026-07-01T10:00:00Z"));
    assert_eq!(issue.due.as_deref(), Some("2026-07-02T10:00:00Z"));
    assert_eq!(issue.parent.as_deref(), Some("bsm-mq4"));
    assert_eq!(issue.labels, vec!["ready-for-agent", "backend"]);
    assert_eq!(issue.blocks, vec!["bsm-bbb"]);
    assert_eq!(issue.blocked_by, vec!["bsm-aaa"]);
    assert_eq!(issue.description, "What to build. Details here.");
    assert_eq!(issue.close_reason, "done");
    assert_eq!(issue.comments.len(), 1);
    let comment = &issue.comments[0];
    assert_eq!(comment.text, "keep it pure Rust");
    assert_eq!(comment.author, "tomas");
    assert_eq!(comment.timestamp, "2026-06-29T08:19:43Z");
}

#[test]
fn ready_success_maps_representative_fields() {
    let runner = FakeRunner::ok(&representative_issue_json());
    let ws = test_workspace();
    let issues = list_ready_issues(&runner, &ws).expect("expected success");
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].id, "bsm-8ul");
    assert_eq!(issues[0].title, "Add pure Rust bw list adapter");
}

#[test]
fn blocked_success_ignores_open_blockers_field() {
    let json = r#"[
          {
            "assignee": "",
            "blocked_by": ["bsm-blocker"],
            "blocks": [],
            "created": "2026-06-28T22:37:05Z",
            "description": "Blocked issue body",
            "id": "bsm-blocked",
            "labels": ["ready-for-agent"],
            "open_blockers": ["bsm-blocker"],
            "priority": 2,
            "status": "open",
            "title": "Blocked by another issue",
            "type": "task",
            "updated_at": "2026-06-29T08:19:43Z"
          }
        ]"#;
    let runner = FakeRunner::ok(json);
    let ws = test_workspace();
    let issues = list_blocked_issues(&runner, &ws).expect("expected success");
    assert_eq!(issues.len(), 1);
    let issue = &issues[0];
    assert_eq!(issue.id, "bsm-blocked");
    assert_eq!(issue.title, "Blocked by another issue");
    assert_eq!(issue.blocked_by, vec!["bsm-blocker"]);
    assert_eq!(issue.description, "Blocked issue body");
}

#[test]
fn success_normalizes_null_and_missing_slices() {
    let json = r#"[
          {
            "assignee": "",
            "created": "2026-06-28T22:37:05Z",
            "id": "bsm-x",
            "priority": 0,
            "status": "open",
            "title": "T",
            "type": "task"
          }
        ]"#;
    let runner = FakeRunner::ok(json);
    let ws = test_workspace();
    let issues = list_all_issues(&runner, &ws).expect("expected success");
    assert_eq!(issues.len(), 1);
    let issue = &issues[0];
    assert!(issue.labels.is_empty());
    assert!(issue.blocks.is_empty());
    assert!(issue.blocked_by.is_empty());
    assert!(issue.updated_at.is_none());
    assert!(issue.closed_at.is_none());
    assert!(issue.defer_until.is_none());
    assert!(issue.due.is_none());
    assert!(issue.parent.is_none());
    assert_eq!(issue.description, "");
    assert!(issue.comments.is_empty());
    assert_eq!(issue.close_reason, "");
}

#[test]
fn success_normalizes_null_detail_fields_and_comment_authors() {
    let json = r#"[
          {
            "assignee": "",
            "close_reason": null,
            "created": "2026-06-28T22:37:05Z",
            "description": null,
            "id": "bsm-null",
            "comments": null,
            "priority": 0,
            "status": "open",
            "title": "Null details",
            "type": "task"
          },
          {
            "assignee": "",
            "created": "2026-06-28T22:37:05Z",
            "id": "bsm-comments",
            "comments": [
              {"text": "missing author", "timestamp": "2026-06-29T08:19:43Z"},
              {"text": "null author", "author": null, "timestamp": "2026-06-30T08:19:43Z"}
            ],
            "priority": 1,
            "status": "open",
            "title": "Comment details",
            "type": "task"
          }
        ]"#;
    let runner = FakeRunner::ok(json);
    let ws = test_workspace();
    let issues = list_all_issues(&runner, &ws).expect("expected success");
    assert_eq!(issues.len(), 2);

    let null_issue = &issues[0];
    assert_eq!(null_issue.description, "");
    assert!(null_issue.comments.is_empty());
    assert_eq!(null_issue.close_reason, "");

    let comments_issue = &issues[1];
    assert_eq!(comments_issue.description, "");
    assert_eq!(comments_issue.close_reason, "");
    assert_eq!(comments_issue.comments.len(), 2);
    assert_eq!(comments_issue.comments[0].author, "");
    assert_eq!(comments_issue.comments[1].author, "");
}

#[test]
fn empty_array_is_successful_empty_list() {
    let runner = FakeRunner::ok("[]");
    let ws = test_workspace();
    let issues = list_all_issues(&runner, &ws).expect("expected success");
    assert!(issues.is_empty());
}

#[test]
fn null_output_is_successful_empty_list() {
    let runner = FakeRunner::ok("null");
    let ws = test_workspace();
    let issues = list_all_issues(&runner, &ws).expect("expected success");
    assert!(issues.is_empty());
}

#[test]
fn empty_stdout_is_successful_empty_list() {
    let runner = FakeRunner::ok("");
    let ws = test_workspace();
    let issues = list_all_issues(&runner, &ws).expect("expected success");
    assert!(issues.is_empty());
}

#[test]
fn missing_binary_is_distinguishable() {
    let runner = FakeRunner::io_err(io::ErrorKind::NotFound);
    let ws = test_workspace();
    let err = list_all_issues(&runner, &ws).expect_err("expected error");
    assert!(matches!(err, ListIssuesError::MissingBinary), "got {err:?}");
}

#[test]
fn other_spawn_io_error_is_distinguishable() {
    let runner = FakeRunner::io_err(io::ErrorKind::PermissionDenied);
    let ws = test_workspace();
    let err = list_all_issues(&runner, &ws).expect_err("expected error");
    assert!(matches!(err, ListIssuesError::Io(_)), "got {err:?}");
}

#[test]
fn not_beadwork_uninitialized_git_dir_is_distinguishable() {
    let runner = FakeRunner::fail(1, "error: beadwork not initialized. Run: bw init");
    let ws = test_workspace();
    let err = list_all_issues(&runner, &ws).expect_err("expected error");
    match err {
        ListIssuesError::NotBeadworkWorkspace { stderr } => {
            assert!(stderr.contains("beadwork not initialized"));
        }
        other => panic!("expected NotBeadworkWorkspace, got {other:?}"),
    }
}

#[test]
fn not_beadwork_non_git_dir_is_distinguishable() {
    // `bw` in a non-git cwd emits this stderr and exits 1.
    let runner = FakeRunner::fail(1, "error: not a git repository");
    let ws = test_workspace();
    let err = list_all_issues(&runner, &ws).expect_err("expected error");
    match err {
        ListIssuesError::NotBeadworkWorkspace { stderr } => {
            assert!(stderr.contains("not a git repository"));
        }
        other => panic!("expected NotBeadworkWorkspace, got {other:?}"),
    }
}

#[test]
fn generic_nonzero_exit_is_distinguishable() {
    let runner = FakeRunner::fail(2, "error: something else went wrong");
    let ws = test_workspace();
    let err = list_all_issues(&runner, &ws).expect_err("expected error");
    match err {
        ListIssuesError::CommandFailed { status, stderr } => {
            assert_eq!(status, 2);
            assert_eq!(stderr, "error: something else went wrong");
        }
        other => panic!("expected CommandFailed, got {other:?}"),
    }
}

#[test]
fn stderr_only_failure_is_command_failed() {
    // Non-zero exit with no stdout and a stderr message.
    let runner = FakeRunner::fail(1, "error: beadwork store corrupt");
    let ws = test_workspace();
    let err = list_all_issues(&runner, &ws).expect_err("expected error");
    assert!(
        matches!(err, ListIssuesError::CommandFailed { .. }),
        "got {err:?}"
    );
}

#[test]
fn invalid_json_is_distinguishable() {
    let runner = FakeRunner::ok("{not valid json");
    let ws = test_workspace();
    let err = list_all_issues(&runner, &ws).expect_err("expected error");
    assert!(matches!(err, ListIssuesError::Parse(_)), "got {err:?}");
}

/// Smoke check against a real `bw` in the current working directory.
/// Ignored by default so `cargo test` does not depend on a Beadwork repo
/// being present. Run with `cargo test -- --ignored`.
#[test]
#[ignore]
fn real_bw_smoke() {
    let runner = ProcessRunner::new();
    let ws = test_workspace();
    let result = list_all_issues(&runner, &ws);
    // In a Beadwork workspace this must succeed; the count is unspecified.
    // The point is that no error variant fires in a real repo.
    match result {
        Ok(issues) => eprintln!("real_bw_smoke: {} issues", issues.len()),
        Err(err) => panic!("real bw failed in this workspace: {err}"),
    }
}

//! The `bw list` adapter.
//!
//! Executes exactly `bw list --all --json` in the process current working
//! directory, consumes only the structured JSON output, and returns a
//! normalized adapter result. Raw Beadwork JSON parsing is hidden behind this
//! API; callers receive [`Issue`] and [`ListIssuesError`].
//!
//! `--all` is required: the user-facing goal is All Issues across stored
//! statuses, not Beadwork's default actionable/open subset.

use std::{env, io};

use serde::{Deserialize, Serialize};

use super::error::ListIssuesError;
use super::raw::{RawComment, RawIssue};
use super::runner::{CommandOutput, CommandRunner};

/// The program and arguments the adapter runs. `--all` overrides Beadwork's
/// default actionable-only `bw list` behavior so every stored status is listed.
const BW_PROGRAM: &str = "bw";
const BW_ARGS: &[&str] = &["list", "--all", "--json"];

/// Markers Beadwork writes to stderr when the cwd is not a usable Beadwork
/// workspace. Used to distinguish that case from other non-zero exits. This is
/// stderr classification, not parsing of stdout TTY/markdown/prompt output
/// (ADR-0003). `bw` emits the first when the cwd is a git repo Beadwork has not
/// initialized, and the second when the cwd is not a git repo at all.
const NOT_BEADWORK_MARKERS: &[&str] = &["beadwork not initialized", "not a git repository"];

/// Adapter output: a normalized Beadwork issue loaded from the Issue List path.
///
/// This is adapter output, not the durable frontend contract. The TauRPC layer
/// maps this into the typed `Issue` React consumes. Fields mirror Beadwork's
/// structured JSON while normalizing nullable/missing list and detail fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Issue {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: i64,
    pub issue_type: String,
    pub description: String,
    pub comments: Vec<IssueComment>,
    pub close_reason: String,
    pub labels: Vec<String>,
    pub assignee: String,
    pub created: String,
    pub updated_at: Option<String>,
    pub closed_at: Option<String>,
    pub defer_until: Option<String>,
    pub due: Option<String>,
    pub parent: Option<String>,
    pub blocks: Vec<String>,
    pub blocked_by: Vec<String>,
}

/// A normalized Beadwork issue comment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IssueComment {
    pub text: String,
    pub author: String,
    pub timestamp: String,
}

/// List all Beadwork issues in the process current working directory.
///
/// Runs `bw list --all --json` through the supplied [`CommandRunner`] and
/// normalizes the result. A true empty result (`null` or `[]`) yields an empty
/// list. Missing `bw`, a non-Beadwork directory, a non-zero subprocess exit, and
/// a JSON parse failure each produce a distinct [`ListIssuesError`].
pub fn list_all_issues(runner: &dyn CommandRunner) -> Result<Vec<Issue>, ListIssuesError> {
    let workspace = env::current_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| ".".to_string());
    eprintln!("Beadsmith: running `bw list --all --json` in {workspace}");

    let result = runner
        .run(BW_PROGRAM, BW_ARGS)
        .map_err(map_spawn_error)
        .and_then(interpret_output);

    match &result {
        Ok(issues) => eprintln!("Beadsmith: loaded {} issue(s)", issues.len()),
        Err(error) => eprintln!(
            "Beadsmith: issue list command failed with {}",
            issue_list_error_kind(error)
        ),
    }

    result
}

fn issue_list_error_kind(error: &ListIssuesError) -> &'static str {
    match error {
        ListIssuesError::MissingBinary => "missing-binary",
        ListIssuesError::NotBeadworkWorkspace { .. } => "not-beadwork-workspace",
        ListIssuesError::CommandFailed { .. } => "command-failed",
        ListIssuesError::Parse(_) => "parse-failed",
        ListIssuesError::Io(_) => "io-error",
    }
}

/// Map a subprocess spawn failure. A missing binary is distinguishable from
/// other I/O errors via [`io::ErrorKind::NotFound`].
fn map_spawn_error(err: io::Error) -> ListIssuesError {
    if err.kind() == io::ErrorKind::NotFound {
        ListIssuesError::MissingBinary
    } else {
        ListIssuesError::Io(err)
    }
}

/// Interpret a finished command's output: classify non-zero exits, then parse.
fn interpret_output(output: CommandOutput) -> Result<Vec<Issue>, ListIssuesError> {
    if output.status != 0 {
        let stderr = output.stderr.trim().to_string();
        if NOT_BEADWORK_MARKERS.iter().any(|m| stderr.contains(m)) {
            return Err(ListIssuesError::NotBeadworkWorkspace { stderr });
        }
        return Err(ListIssuesError::CommandFailed {
            status: output.status,
            stderr,
        });
    }
    parse_issues(&output.stdout)
}

/// Parse `bw list --all --json` stdout into normalized issues.
///
/// `bw` prints `null` for a nil result slice and `[]` for an empty one; both
/// are a successful empty issue list. Any other stdout must deserialize as a
/// JSON array of issues.
fn parse_issues(stdout: &str) -> Result<Vec<Issue>, ListIssuesError> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Ok(Vec::new());
    }
    let raw: Vec<RawIssue> = serde_json::from_str(trimmed).map_err(ListIssuesError::Parse)?;
    Ok(raw.into_iter().map(Issue::from).collect())
}

impl From<RawIssue> for Issue {
    fn from(raw: RawIssue) -> Self {
        Self {
            id: raw.id,
            title: raw.title,
            status: raw.status,
            priority: raw.priority,
            issue_type: raw.issue_type,
            description: raw.description.unwrap_or_default(),
            comments: raw
                .comments
                .unwrap_or_default()
                .into_iter()
                .map(IssueComment::from)
                .collect(),
            close_reason: raw.close_reason.unwrap_or_default(),
            labels: raw.labels.unwrap_or_default(),
            assignee: raw.assignee,
            created: raw.created,
            updated_at: raw.updated_at,
            closed_at: raw.closed_at,
            defer_until: raw.defer_until,
            due: raw.due,
            parent: raw.parent,
            blocks: raw.blocks.unwrap_or_default(),
            blocked_by: raw.blocked_by.unwrap_or_default(),
        }
    }
}

impl From<RawComment> for IssueComment {
    fn from(raw: RawComment) -> Self {
        Self {
            text: raw.text,
            author: raw.author.unwrap_or_default(),
            timestamp: raw.timestamp,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::issues::runner::ProcessRunner;
    use std::io;
    use std::sync::Mutex;

    /// Records the last invocation and returns a canned, cloneable result.
    enum Canned {
        Ok(CommandOutput),
        Err(io::ErrorKind),
    }

    struct FakeRunner {
        result: Mutex<Canned>,
        recorded: Mutex<Vec<(String, Vec<String>)>>,
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

        fn recorded(&self) -> (String, Vec<String>) {
            self.recorded.lock().unwrap().last().cloned().unwrap()
        }
    }

    impl CommandRunner for FakeRunner {
        fn run(&self, program: &str, args: &[&str]) -> io::Result<CommandOutput> {
            self.recorded.lock().unwrap().push((
                program.to_string(),
                args.iter().map(|s| s.to_string()).collect(),
            ));
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

    #[test]
    fn invokes_exactly_bw_list_all_json() {
        let runner = FakeRunner::ok("[]");
        let _ = list_all_issues(&runner);
        let (program, args) = runner.recorded();
        assert_eq!(program, BW_PROGRAM);
        assert_eq!(args, vec!["list", "--all", "--json"]);
    }

    #[test]
    fn success_maps_representative_fields() {
        let runner = FakeRunner::ok(&representative_issue_json());
        let issues = list_all_issues(&runner).expect("expected success");
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
        let issues = list_all_issues(&runner).expect("expected success");
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
        let issues = list_all_issues(&runner).expect("expected success");
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
        let issues = list_all_issues(&runner).expect("expected success");
        assert!(issues.is_empty());
    }

    #[test]
    fn null_output_is_successful_empty_list() {
        let runner = FakeRunner::ok("null");
        let issues = list_all_issues(&runner).expect("expected success");
        assert!(issues.is_empty());
    }

    #[test]
    fn empty_stdout_is_successful_empty_list() {
        let runner = FakeRunner::ok("");
        let issues = list_all_issues(&runner).expect("expected success");
        assert!(issues.is_empty());
    }

    #[test]
    fn missing_binary_is_distinguishable() {
        let runner = FakeRunner::io_err(io::ErrorKind::NotFound);
        let err = list_all_issues(&runner).expect_err("expected error");
        assert!(matches!(err, ListIssuesError::MissingBinary), "got {err:?}");
    }

    #[test]
    fn other_spawn_io_error_is_distinguishable() {
        let runner = FakeRunner::io_err(io::ErrorKind::PermissionDenied);
        let err = list_all_issues(&runner).expect_err("expected error");
        assert!(matches!(err, ListIssuesError::Io(_)), "got {err:?}");
    }

    #[test]
    fn not_beadwork_uninitialized_git_dir_is_distinguishable() {
        let runner = FakeRunner::fail(1, "error: beadwork not initialized. Run: bw init");
        let err = list_all_issues(&runner).expect_err("expected error");
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
        let err = list_all_issues(&runner).expect_err("expected error");
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
        let err = list_all_issues(&runner).expect_err("expected error");
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
        let err = list_all_issues(&runner).expect_err("expected error");
        assert!(
            matches!(err, ListIssuesError::CommandFailed { .. }),
            "got {err:?}"
        );
    }

    #[test]
    fn invalid_json_is_distinguishable() {
        let runner = FakeRunner::ok("{not valid json");
        let err = list_all_issues(&runner).expect_err("expected error");
        assert!(matches!(err, ListIssuesError::Parse(_)), "got {err:?}");
    }

    /// Smoke check against a real `bw` in the current working directory.
    /// Ignored by default so `cargo test` does not depend on a Beadwork repo
    /// being present. Run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn real_bw_smoke() {
        let runner = ProcessRunner::new();
        let result = list_all_issues(&runner);
        // In a Beadwork workspace this must succeed; the count is unspecified.
        // The point is that no error variant fires in a real repo.
        match result {
            Ok(issues) => eprintln!("real_bw_smoke: {} issues", issues.len()),
            Err(err) => panic!("real bw failed in this workspace: {err}"),
        }
    }
}

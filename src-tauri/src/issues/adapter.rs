//! The Beadwork issue CLI adapter.
//!
//! Executes the authoritative Beadwork issue-view commands in the given
//! workspace directory, consumes only structured JSON output, and returns
//! normalized adapter results. Raw Beadwork JSON parsing is hidden behind this
//! API; callers receive [`Issue`] and [`ListIssuesError`].
//!
//! All view functions accept an explicit `workspace: &Path` parameter. The
//! caller is responsible for resolving the workspace; no fallback to
//! `env::current_dir()` is performed here.
//!
//! All Issues must run `bw list --all --json` so Beadsmith loads every stored
//! status, not Beadwork's default actionable/open subset. Ready and Blocked must
//! run `bw ready --json` and `bw blocked --json` respectively; Beadsmith does
//! not derive those view memberships locally.

use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::error::ListIssuesError;
use super::raw::{RawComment, RawIssue};
use super::runner::{CommandOutput, CommandRunner};

/// The Beadwork CLI program the adapter runs.
const BW_PROGRAM: &str = "bw";
/// `--all` overrides Beadwork's default actionable-only `bw list` behavior so
/// every stored status is listed.
const BW_LIST_ALL_ARGS: &[&str] = &["list", "--all", "--json"];
/// Beadwork-authored Ready view. Do not derive this membership locally.
const BW_READY_ARGS: &[&str] = &["ready", "--json"];
/// Beadwork-authored Blocked view. Do not derive this membership locally.
const BW_BLOCKED_ARGS: &[&str] = &["blocked", "--json"];

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

/// List all Beadwork issues at the given workspace path.
///
/// Runs `bw list --all --json` through the supplied [`CommandRunner`] in
/// `workspace` and normalizes the result. A true empty result (`null` or `[]`)
/// yields an empty list. Missing `bw`, a non-Beadwork directory, a non-zero
/// subprocess exit, and a JSON parse failure each produce a distinct
/// [`ListIssuesError`].
pub fn list_all_issues(
    runner: &dyn CommandRunner,
    workspace: &Path,
) -> Result<Vec<Issue>, ListIssuesError> {
    load_issues_for_view(runner, "All Issues", BW_LIST_ALL_ARGS, workspace)
}

/// List Beadwork issues in the Ready view at the given workspace path.
///
/// Runs `bw ready --json` through the supplied [`CommandRunner`] in
/// `workspace` and normalizes the result. Beadwork owns Ready membership and
/// ordering; the adapter only preserves the structured command result.
pub fn list_ready_issues(
    runner: &dyn CommandRunner,
    workspace: &Path,
) -> Result<Vec<Issue>, ListIssuesError> {
    load_issues_for_view(runner, "Ready Issues", BW_READY_ARGS, workspace)
}

/// List Beadwork issues in the Blocked view at the given workspace path.
///
/// Runs `bw blocked --json` through the supplied [`CommandRunner`] in
/// `workspace` and normalizes the result. Blocked-only JSON fields such as
/// `open_blockers` are intentionally ignored by the shared raw parser.
pub fn list_blocked_issues(
    runner: &dyn CommandRunner,
    workspace: &Path,
) -> Result<Vec<Issue>, ListIssuesError> {
    load_issues_for_view(runner, "Blocked Issues", BW_BLOCKED_ARGS, workspace)
}

fn load_issues_for_view(
    runner: &dyn CommandRunner,
    view_label: &str,
    args: &[&str],
    workspace: &Path,
) -> Result<Vec<Issue>, ListIssuesError> {
    // Route command diagnostics through Beadsmith's configured logging
    // facility (see `src-tauri/src/lib.rs`'s `log_plugin`). The release
    // policy only forwards `Info`+ to the OS-managed `LogDir`, so debug-
    // level context (which may include the workspace path) never reaches
    // release stderr, and the action-facing failure (warn) intentionally
    // omits the full workspace path to avoid routing user-specific
    // filesystem paths through unmanaged stderr or any third-party sink.
    let command = args.join(" ");
    log::debug!(
        "beadsmith: running `bw {command}` for {view_label} in {}",
        workspace.display()
    );

    let result = runner
        .run(BW_PROGRAM, args, workspace)
        .map_err(map_spawn_error)
        .and_then(interpret_output);

    match &result {
        Ok(issues) => log::debug!(
            "beadsmith: loaded {} issue(s) for {view_label}",
            issues.len()
        ),
        Err(error) => log::warn!(
            "beadsmith: {view_label} command failed with {}",
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

/// Parse Beadwork issue JSON stdout into normalized issues.
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
mod tests;

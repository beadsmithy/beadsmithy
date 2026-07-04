//! Typed TauRPC boundary for Beadsmith frontend/native calls.
//!
//! The RPC layer owns the frontend-facing contract. It delegates Beadwork CLI
//! access to the pure Rust `issues` adapter and maps adapter results/errors into
//! serializable, user-displayable payloads.

use std::env;

use crate::issues::{self, ListIssuesError, ProcessRunner};

/// Build the TauRPC router, including TypeScript export configuration.
pub fn router<R: tauri::Runtime>() -> taurpc::Router<R> {
    let router = taurpc::Router::new()
        .export_config(specta_typescript::Typescript::default().header(
            "// oxlint-disable no-unused-vars typescript/ban-ts-comment import/consistent-type-specifier-style import/newline-after-import typescript/consistent-type-definitions\n// @ts-nocheck\n",
        ))
        .merge(BeadsmithApiImpl.into_handler());

    #[cfg(debug_assertions)]
    let router = router.merge(DevBridgeApiImpl.into_handler());

    router
}

/// Beadsmith's typed application RPC surface.
#[taurpc::procedures(export_to = "../src/rpc/bindings.ts")]
pub trait BeadsmithApi {
    async fn list_issues() -> Result<ListIssuesResponse, IssueListError>;
}

/// Resolver implementation for Beadsmith's application RPC surface.
#[derive(Clone, Default)]
pub struct BeadsmithApiImpl;

#[taurpc::resolvers]
impl BeadsmithApi for BeadsmithApiImpl {
    async fn list_issues(self) -> Result<ListIssuesResponse, IssueListError> {
        list_issues_from_adapter(&ProcessRunner::new())
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

fn list_issues_from_adapter(
    runner: &dyn issues::CommandRunner,
) -> Result<ListIssuesResponse, IssueListError> {
    let workspace_path = env::current_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| ".".to_string());
    let issues = issues::list_all_issues(runner)
        .map_err(IssueListError::from)?
        .into_iter()
        .map(Issue::from)
        .collect();

    Ok(ListIssuesResponse {
        workspace_path,
        issues,
    })
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
mod tests {
    use super::*;
    use crate::issues::{CommandOutput, CommandRunner};
    use std::io;

    struct FakeRunner {
        output: Result<CommandOutput, io::ErrorKind>,
    }

    impl FakeRunner {
        fn ok(stdout: &str) -> Self {
            Self {
                output: Ok(CommandOutput {
                    status: 0,
                    stdout: stdout.to_string(),
                    stderr: String::new(),
                }),
            }
        }

        fn failed(status: i32, stderr: &str) -> Self {
            Self {
                output: Ok(CommandOutput {
                    status,
                    stdout: String::new(),
                    stderr: stderr.to_string(),
                }),
            }
        }

        fn io_error(kind: io::ErrorKind) -> Self {
            Self { output: Err(kind) }
        }
    }

    impl CommandRunner for FakeRunner {
        fn run(&self, _program: &str, _args: &[&str]) -> io::Result<CommandOutput> {
            match &self.output {
                Ok(output) => Ok(output.clone()),
                Err(kind) => Err(io::Error::from(*kind)),
            }
        }
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

        let response = list_issues_from_adapter(&runner).expect("expected success");
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
        let response = list_issues_from_adapter(&FakeRunner::ok("[]"))
            .expect("expected successful empty list");
        assert!(response.issues.is_empty());
    }

    #[tokio::test]
    async fn generates_typescript_bindings() {
        let _handler = router::<tauri::Wry>().into_handler();

        let bindings = std::fs::read_to_string("../src/rpc/bindings.ts")
            .expect("expected generated TauRPC bindings");
        assert!(bindings.contains("export type Issue"));
        assert!(bindings.contains("export type IssueComment"));
        assert!(bindings.contains("export type ListIssuesResponse"));
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

        for (runner, expected_kind) in cases {
            let error = list_issues_from_adapter(&runner).expect_err("expected error");
            assert_eq!(error.kind, expected_kind);
            assert!(!error.message.is_empty());
        }
    }
}

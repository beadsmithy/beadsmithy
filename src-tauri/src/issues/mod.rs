//! Beadwork issue adapter.
//!
//! Pure Rust integration with Beadwork's structured CLI output (ADR-0003).
//! This module is deliberately decoupled from Tauri/TauRPC/React so it can be
//! unit-tested without launching the desktop app.
//!
//! Public surface:
//! - [`list_all_issues`] — run `bw list --all --json` and normalize the result.
//! - [`list_ready_issues`] — run `bw ready --json` and normalize the result.
//! - [`list_blocked_issues`] — run `bw blocked --json` and normalize the result.
//! - [`Issue`] — adapter output to be mapped at the RPC boundary.
//! - [`ListIssuesError`] — distinguishable failure cases.
//! - [`CommandRunner`] / [`ProcessRunner`] — the subprocess seam.

mod adapter;
mod error;
mod raw;
mod runner;

pub use adapter::{list_all_issues, list_blocked_issues, list_ready_issues, Issue, IssueComment};
pub use error::ListIssuesError;
pub use runner::{CommandOutput, CommandRunner, ProcessRunner};

/// Markers Beadwork writes to stderr when the cwd is not a usable Beadwork
/// workspace. Shared with the refresh validity-check seam so the refresh
/// module classifies `bw config list` failures the same way the issue
/// adapter classifies `bw list/ready/blocked` failures. Re-exported from
/// the adapter so the two seams cannot drift apart on a future change.
pub use adapter::NOT_BEADWORK_MARKERS_LOCAL as NOT_BEADWORK_MARKERS;

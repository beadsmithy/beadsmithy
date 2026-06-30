//! Errors returned by the issue list adapter.
//!
//! Each variant is a distinct failure mode the future RPC boundary will
//! surface to the UI. They are deliberately not collapsed into a single
//! string so callers can render different empty/error states.

use std::fmt;

#[derive(Debug)]
pub enum ListIssuesError {
    /// `bw` was not found on PATH. The OS reports the program as missing.
    MissingBinary,
    /// The current directory is not a Beadwork workspace. Beadwork writes a
    /// stable marker to stderr for this case; see [`crate::issues::adapter`].
    NotBeadworkWorkspace { stderr: String },
    /// `bw` ran but exited with a non-zero status for some other reason.
    CommandFailed { status: i32, stderr: String },
    /// `bw` exited cleanly but its stdout was not valid JSON.
    Parse(serde_json::Error),
    /// An unrelated I/O error occurred while spawning or reading `bw`.
    Io(std::io::Error),
}

impl fmt::Display for ListIssuesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingBinary => write!(f, "bw executable was not found on PATH",),
            Self::NotBeadworkWorkspace { stderr } => {
                write!(f, "current directory is not a Beadwork workspace: {stderr}")
            }
            Self::CommandFailed { status, stderr } => {
                write!(f, "bw exited with non-zero status {status}: {stderr}")
            }
            Self::Parse(err) => write!(f, "failed to parse bw output as JSON: {err}"),
            Self::Io(err) => write!(f, "I/O error while running bw: {err}"),
        }
    }
}

impl std::error::Error for ListIssuesError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Parse(err) => Some(err),
            Self::Io(err) => Some(err),
            _ => None,
        }
    }
}

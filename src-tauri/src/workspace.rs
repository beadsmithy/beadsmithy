//! Startup workspace override.
//!
//! Beadsmith's Current Workspace is the process working directory (ADR-0003):
//! the `issues` adapter and the RPC layer both resolve it from
//! [`std::env::current_dir`]. Launching against a specific directory therefore
//! only requires switching the process cwd before the app starts.
//!
//! This exists primarily so the WebDriver end-to-end suite (see
//! `docs/agents/webdriver-e2e.md`) can point a built Beadsmith binary at a
//! deterministic, disposable Beadwork workspace without baking a
//! machine-specific path into the app. Production launches never pass
//! `--workspace` and behave exactly as before.

use std::env;

const WORKSPACE_FLAG: &str = "--workspace";

/// Extract the path following a `--workspace <path>` argument, if present.
/// Only the first occurrence is honored; unrecognized arguments are ignored.
pub(crate) fn workspace_arg<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let args: Vec<String> = args.into_iter().map(Into::into).collect();
    args.iter()
        .position(|arg| arg == WORKSPACE_FLAG)
        .and_then(|index| args.get(index + 1))
        .cloned()
}

/// Switch the process current directory to an overridden workspace, if one was
/// requested via `--workspace <path>`. Logs the resolved path (or failure) so
/// WebDriver end-to-end runs can diagnose workspace setup from stdout/stderr.
pub(crate) fn apply_workspace_override<I, S>(args: I)
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let Some(path) = workspace_arg(args) else {
        return;
    };

    match env::set_current_dir(&path) {
        Ok(()) => eprintln!("Beadsmith: launched against workspace override {path}"),
        Err(err) => eprintln!("Beadsmith: failed to switch to workspace override {path}: {err}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_workspace_path_after_flag() {
        let args = ["beadsmith", "--workspace", "/tmp/ws"];
        assert_eq!(workspace_arg(args).as_deref(), Some("/tmp/ws"));
    }

    #[test]
    fn returns_none_without_flag() {
        let args = ["beadsmith"];
        assert_eq!(workspace_arg(args), None);
    }

    #[test]
    fn returns_none_when_flag_is_last_argument() {
        let args = ["beadsmith", "--workspace"];
        assert_eq!(workspace_arg(args), None);
    }

    #[test]
    fn honors_first_occurrence_only() {
        let args = ["beadsmith", "--workspace", "/a", "--workspace", "/b"];
        assert_eq!(workspace_arg(args).as_deref(), Some("/a"));
    }
}

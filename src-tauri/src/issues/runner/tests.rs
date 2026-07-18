//! Outlined command-runner tests.
//!
//! Migrated from the inline `mod tests` block at the bottom of
//! `issues/runner.rs`. Test-only fixtures and helpers stay local to this
//! module so the production runner surface remains unchanged.

use super::*;
use std::fs;
use std::path::PathBuf;
use std::process;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEMP_DIRECTORY_COUNTER: AtomicUsize = AtomicUsize::new(0);

struct TemporaryWorkspace(PathBuf);

impl TemporaryWorkspace {
    fn new() -> Self {
        let unique_suffix = format!(
            "{}-{}-{}",
            process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after the Unix epoch")
                .as_nanos(),
            TEMP_DIRECTORY_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let path = std::env::temp_dir().join(format!("beadsmith-runner-{unique_suffix}"));
        fs::create_dir(&path).expect("temporary workspace should be created");
        Self(path)
    }
}

impl Drop for TemporaryWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(unix)]
#[test]
fn process_runner_runs_in_supplied_cwd() {
    let workspace = TemporaryWorkspace::new();
    let output = ProcessRunner::new()
        .run("pwd", &[], &workspace.0)
        .expect("pwd should run in the supplied cwd");

    assert_eq!(output.status, 0, "pwd stderr: {}", output.stderr);
    assert_eq!(
        fs::canonicalize(output.stdout.trim()).expect("pwd should print a valid path"),
        fs::canonicalize(&workspace.0).expect("workspace path should be valid")
    );
}

#[cfg(windows)]
#[test]
fn process_runner_runs_in_supplied_cwd() {
    let workspace = TemporaryWorkspace::new();
    let output = ProcessRunner::new()
        .run("cmd", &["/C", "cd"], &workspace.0)
        .expect("cmd should run in the supplied cwd");

    assert_eq!(output.status, 0, "cmd stderr: {}", output.stderr);
    assert_eq!(
        fs::canonicalize(output.stdout.trim()).expect("cmd should print a valid path"),
        fs::canonicalize(&workspace.0).expect("workspace path should be valid")
    );
}

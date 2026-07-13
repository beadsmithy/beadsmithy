//! Command-runner seam for the adapter.
//!
//! The adapter talks to Beadwork by running `bw`. To keep the core logic
//! deterministic and free of a real `bw` dependency, the actual subprocess
//! call lives behind [`CommandRunner`]. Tests inject a fake; production uses
//! [`ProcessRunner`].

use std::io;
use std::path::Path;
use std::process::Command;

/// Captured output of a finished subprocess.
#[derive(Debug, Clone)]
pub struct CommandOutput {
    /// The raw exit code, or `-1` when the platform does not report one.
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Run a command and capture its result.
///
/// The `cwd` parameter sets the working directory for the subprocess.
pub trait CommandRunner {
    fn run(&self, program: &str, args: &[&str], cwd: &Path) -> io::Result<CommandOutput>;
}

/// Real runner backed by [`std::process::Command`].
pub struct ProcessRunner;

impl ProcessRunner {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ProcessRunner {
    fn default() -> Self {
        Self::new()
    }
}

impl CommandRunner for ProcessRunner {
    fn run(&self, program: &str, args: &[&str], cwd: &Path) -> io::Result<CommandOutput> {
        let output = Command::new(program).args(args).current_dir(cwd).output()?;
        Ok(CommandOutput {
            status: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
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
}

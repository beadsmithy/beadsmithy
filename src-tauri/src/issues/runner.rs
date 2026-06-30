//! Command-runner seam for the adapter.
//!
//! The adapter talks to Beadwork by running `bw`. To keep the core logic
//! deterministic and free of a real `bw` dependency, the actual subprocess
//! call lives behind [`CommandRunner`]. Tests inject a fake; production uses
//! [`ProcessRunner`].

use std::io;
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
/// Implementations inherit the process current working directory. For this
/// slice the Current Workspace is the directory Beadsmith was launched from,
/// so no explicit cwd is threaded through here.
pub trait CommandRunner {
    fn run(&self, program: &str, args: &[&str]) -> io::Result<CommandOutput>;
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
    fn run(&self, program: &str, args: &[&str]) -> io::Result<CommandOutput> {
        let output = Command::new(program).args(args).output()?;
        Ok(CommandOutput {
            status: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

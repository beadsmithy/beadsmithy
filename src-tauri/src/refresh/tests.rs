//! Tests for the refresh coordinator.
//!
//! These tests cover:
//!
//! - the `probe_beadwork_ref` subprocess seam (exact git args, success,
//!   non-zero exit, missing ref, spawn failure, empty output);
//! - the pure `CoordinatorState` reducer (unseeded, unchanged SHA,
//!   changed SHA, dirty coalescing during active load, load success /
//!   failure transitions, binding rebind, deactivation);
//! - the success-event JSON shape (camelCase fields, full nested issue
//!   data) so a renderer-side envelope drift is caught at compile / test
//!   time.
//!
//! All subprocess tests use the in-memory `FakeCommandRunner` seam. No
//! real `git` or `bw` binary is invoked.

use super::*;
use crate::issues::{CommandOutput, CommandRunner};
use std::collections::VecDeque;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone)]
struct FakeInvocation {
    program: String,
    args: Vec<String>,
    cwd: PathBuf,
}

struct FakeCommandRunner {
    outputs: Mutex<VecDeque<Result<CommandOutput, io::Error>>>,
    recorded: Mutex<Vec<FakeInvocation>>,
}

impl FakeCommandRunner {
    fn new(outputs: Vec<Result<CommandOutput, io::Error>>) -> Self {
        Self {
            outputs: Mutex::new(VecDeque::from(outputs)),
            recorded: Mutex::new(Vec::new()),
        }
    }

    fn recorded(&self) -> Vec<FakeInvocation> {
        self.recorded.lock().unwrap().clone()
    }
}

impl CommandRunner for FakeCommandRunner {
    fn run(&self, program: &str, args: &[&str], cwd: &Path) -> io::Result<CommandOutput> {
        self.recorded.lock().unwrap().push(FakeInvocation {
            program: program.to_string(),
            args: args.iter().map(|arg| (*arg).to_string()).collect(),
            cwd: cwd.to_path_buf(),
        });
        self.outputs
            .lock()
            .unwrap()
            .pop_front()
            .expect("expected a canned command output")
    }
}

fn ok_output(stdout: &str) -> Result<CommandOutput, io::Error> {
    Ok(CommandOutput {
        status: 0,
        stdout: stdout.to_string(),
        stderr: String::new(),
    })
}

fn failed_output(status: i32, stderr: &str) -> Result<CommandOutput, io::Error> {
    Ok(CommandOutput {
        status,
        stdout: String::new(),
        stderr: stderr.to_string(),
    })
}

fn workspace_path() -> PathBuf {
    PathBuf::from("/work/beadwork-fixture")
}

fn binding_for(workspace: &str, generation: u32) -> RefreshBinding {
    RefreshBinding::new(PathBuf::from(workspace), generation)
}

fn git_sha(n: u8) -> String {
    // 40-char SHA-1 (lowercase hex).
    format!("{:0>40}", n)
}

#[test]
fn probe_uses_exact_git_program_args_and_cwd() {
    let runner = FakeCommandRunner::new(vec![ok_output("0123abc\n")]);
    let cwd = workspace_path();

    let sha = probe_beadwork_ref(&runner, &cwd).expect("expected successful probe");

    assert_eq!(sha, "0123abc");
    let recorded = runner.recorded();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].program, "git");
    assert_eq!(
        recorded[0].args,
        vec!["rev-parse", "--verify", "refs/heads/beadwork^{commit}"]
    );
    assert_eq!(recorded[0].cwd, cwd);
}

#[test]
fn probe_trims_successful_stdout() {
    let runner = FakeCommandRunner::new(vec![ok_output("   abcdef0123   \n")]);
    let sha = probe_beadwork_ref(&runner, &workspace_path()).expect("expected success");
    assert_eq!(sha, "abcdef0123");
}

#[test]
fn probe_preserves_full_sha_value() {
    // The probe intentionally does not validate SHA length so a future
    // SHA-256 Beadwork layout is not silently rejected.
    let long_sha = "a".repeat(64);
    let runner = FakeCommandRunner::new(vec![ok_output(&format!("{long_sha}\n"))]);
    let sha = probe_beadwork_ref(&runner, &workspace_path()).expect("expected success");
    assert_eq!(sha, long_sha);
}

#[test]
fn probe_rejects_missing_ref_as_command_failure() {
    let runner = FakeCommandRunner::new(vec![failed_output(
        128,
        "fatal: unknown revision or path not in the working tree.",
    )]);
    let error = probe_beadwork_ref(&runner, &workspace_path())
        .expect_err("expected missing ref to surface as a failure");
    match error {
        ProbeError::CommandFailed { status, stderr } => {
            assert_eq!(status, 128);
            assert!(stderr.contains("unknown revision"));
        }
        other => panic!("expected CommandFailed, got {other:?}"),
    }
}

#[test]
fn probe_rejects_non_zero_status_as_command_failure() {
    let runner = FakeCommandRunner::new(vec![failed_output(2, "boom")]);
    let error = probe_beadwork_ref(&runner, &workspace_path())
        .expect_err("expected non-zero status to surface as a failure");
    assert!(matches!(error, ProbeError::CommandFailed { status: 2, .. }));
}

#[test]
fn probe_classifies_missing_git_binary_as_spawn_error() {
    let runner = FakeCommandRunner::new(vec![Err(io::Error::from(io::ErrorKind::NotFound))]);
    let error = probe_beadwork_ref(&runner, &workspace_path())
        .expect_err("expected missing git binary to surface as a spawn error");
    match error {
        ProbeError::Spawn(message) => {
            assert!(
                message.contains("git"),
                "spawn message must name the program: {message}"
            );
        }
        other => panic!("expected Spawn, got {other:?}"),
    }
}

#[test]
fn probe_rejects_successful_command_with_empty_output() {
    let runner = FakeCommandRunner::new(vec![ok_output("")]);
    let error = probe_beadwork_ref(&runner, &workspace_path())
        .expect_err("expected empty stdout to surface as invalid output");
    assert!(matches!(error, ProbeError::InvalidOutput(_)));
}

#[test]
fn probe_rejects_successful_command_with_whitespace_only_output() {
    let runner = FakeCommandRunner::new(vec![ok_output("   \n   ")]);
    let error = probe_beadwork_ref(&runner, &workspace_path())
        .expect_err("expected whitespace-only stdout to surface as invalid output");
    assert!(matches!(error, ProbeError::InvalidOutput(_)));
}

#[test]
fn unseeded_state_triggers_one_initial_load_on_first_probe() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    let decision = state
        .apply_probe(&binding, "abc123", None, RefreshMode::IfChanged)
        .expect("unseeded coordinator must start one initial load");
    match decision {
        LoadDecision::StartLoad(binding) => {
            assert_eq!(binding.observed_sha, "abc123");
            assert_eq!(binding.refresh_revision, 1);
            assert_eq!(binding.binding.workspace_path, PathBuf::from("/work/a"));
            assert_eq!(binding.binding.workspace_selection_generation, 1);
        }
    }
    assert!(state.has_active_load);
    assert_eq!(state.active_binding, Some(binding));
    assert_eq!(state.last_published_revision, None);
    assert_eq!(state.next_revision, 2);
}

#[test]
fn unchanged_published_sha_does_not_trigger_a_load() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "abc123", None, RefreshMode::IfChanged)
        .expect("first probe starts load");
    state.apply_load_success(&LoadBinding {
        binding: binding.clone(),
        observed_sha: "abc123".to_string(),
        refresh_revision: 1,
    });

    let decision = state.apply_probe(&binding, "abc123", Some("abc123"), RefreshMode::IfChanged);
    assert!(
        decision.is_none(),
        "already-published SHA must not schedule another load"
    );
}

#[test]
fn changed_sha_after_publish_starts_exactly_one_load() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "abc", None, RefreshMode::IfChanged)
        .expect("first probe");
    state.apply_load_success(&LoadBinding {
        binding: binding.clone(),
        observed_sha: "abc".to_string(),
        refresh_revision: 1,
    });

    let decision = state
        .apply_probe(&binding, "def", Some("abc"), RefreshMode::IfChanged)
        .expect("changed SHA must start one load");
    match decision {
        LoadDecision::StartLoad(binding) => {
            assert_eq!(binding.observed_sha, "def");
            assert_eq!(binding.refresh_revision, 2);
        }
    }
    assert_eq!(state.next_revision, 3);
}

#[test]
fn repeated_same_sha_during_active_load_does_not_create_extra_work() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "abc", None, RefreshMode::IfChanged)
        .expect("first probe starts load");

    let outcome = state.apply_probe(&binding, "abc", None, RefreshMode::IfChanged);
    assert!(outcome.is_none());
    assert!(state.pending_refresh.is_none());
    assert!(state.has_active_load);
}

#[test]
fn several_changed_shas_during_active_load_remain_one_pending_if_changed() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "v1", None, RefreshMode::IfChanged)
        .expect("first probe starts load");

    let mut probe_results = Vec::new();
    for sha in ["v2", "v3", "v4", "v5"] {
        probe_results.push(
            state
                .apply_probe(&binding, sha, None, RefreshMode::IfChanged)
                .is_none(),
        );
    }
    assert!(probe_results.iter().all(|is_none| *is_none));
    // Pending work records intent, not a target SHA: a burst of ref
    // moves stays one pending `IfChanged` request and the follow-up
    // re-probes the current tip.
    assert_eq!(state.pending_refresh, Some(RefreshMode::IfChanged));
    assert!(state.has_active_load);
}

#[test]
fn pending_refresh_is_cleared_when_a_load_starts() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "v1", None, RefreshMode::IfChanged)
        .expect("first probe");
    state.apply_probe(&binding, "v2", None, RefreshMode::IfChanged);
    assert_eq!(state.pending_refresh, Some(RefreshMode::IfChanged));

    state.apply_load_success(&LoadBinding {
        binding: binding.clone(),
        observed_sha: "v1".to_string(),
        refresh_revision: 1,
    });

    // The follow-up request re-probes the current tip (v2). Starting
    // the follow-up load consumes the pending mode.
    let decision = state
        .apply_probe(&binding, "v2", Some("v1"), RefreshMode::IfChanged)
        .expect("pending refresh must start one load after the active load completes");
    match decision {
        LoadDecision::StartLoad(binding) => {
            assert_eq!(binding.observed_sha, "v2");
        }
    }
    assert!(state.pending_refresh.is_none());
}

#[test]
fn load_failure_does_not_advance_published_revision() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "v1", None, RefreshMode::IfChanged)
        .expect("first probe");
    state.apply_load_failure();
    assert!(!state.has_active_load);
    assert_eq!(state.last_published_revision, None);
}

#[test]
fn load_success_advances_published_revision() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "v1", None, RefreshMode::IfChanged)
        .expect("first probe");
    state.apply_load_success(&LoadBinding {
        binding: binding.clone(),
        observed_sha: "v1".to_string(),
        refresh_revision: 1,
    });

    assert_eq!(state.last_published_revision, Some(1));
    assert!(!state.has_active_load);
}

#[test]
fn take_pending_refresh_clears_the_slot() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "v1", None, RefreshMode::IfChanged)
        .expect("first probe");
    state.apply_probe(&binding, "v2", None, RefreshMode::IfChanged);
    assert_eq!(state.take_pending_refresh(), Some(RefreshMode::IfChanged));
    assert!(state.take_pending_refresh().is_none());
}

// =============================================================================
// Binding-aware coordinator tests.
// =============================================================================
//
// These tests pin the per-binding invariants the scheduler relies on:
//   - A probe for a new binding rebinds and starts one loader.
//   - A stale probe result for a previous binding does not mutate
//     the active state.
//   - Same-SHA revisit probe skips loading when the SHA map already
//     carries that binding's last-published SHA.
//   - Active-load dirty coalescing is binding-local: a probe for the
//     same binding's SHA only updates the dirty target.

#[test]
fn probe_for_a_new_binding_rebinds_and_starts_one_load() {
    let mut state = CoordinatorState::unseeded();
    let a = binding_for("/work/a", 1);
    let b = binding_for("/work/b", 2);

    // Bind to A.
    let _ = state
        .apply_probe(&a, "v1", None, RefreshMode::IfChanged)
        .expect("a probe starts load");

    // A probe for B rebinds and starts one load for B without
    // disturbing A's active load (the in-flight A worker is now stale
    // and powerless because its binding no longer matches).
    let decision = state
        .apply_probe(&b, "v2", None, RefreshMode::IfChanged)
        .expect("a new binding probe must start one load");
    match decision {
        LoadDecision::StartLoad(load_binding) => {
            assert_eq!(load_binding.binding, b);
            assert_eq!(load_binding.observed_sha, "v2");
            assert_eq!(load_binding.refresh_revision, 2);
        }
    }
    assert_eq!(state.active_binding, Some(b));
    assert!(state.has_active_load);
    assert_eq!(state.active_load_sha.as_deref(), Some("v2"));
}

#[test]
fn probe_for_same_unchanged_sha_with_cached_value_skips_loading() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);

    // First load completes and seeds the SHA map.
    let _ = state
        .apply_probe(&binding, "v1", None, RefreshMode::IfChanged)
        .expect("first probe");
    state.apply_load_success(&LoadBinding {
        binding: binding.clone(),
        observed_sha: "v1".to_string(),
        refresh_revision: 1,
    });

    // Same-SHA revisit probe: the SHA map already carries v1, so no
    // loader runs and no pending work is queued.
    let decision = state.apply_probe(&binding, "v1", Some("v1"), RefreshMode::IfChanged);
    assert!(
        decision.is_none(),
        "unchanged revisit must not schedule another load"
    );
    assert!(!state.has_active_load);
    assert!(state.pending_refresh.is_none());
}

#[test]
fn probe_for_changed_sha_with_cached_value_starts_one_load() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);

    let _ = state
        .apply_probe(&binding, "v1", None, RefreshMode::IfChanged)
        .expect("first probe");
    state.apply_load_success(&LoadBinding {
        binding: binding.clone(),
        observed_sha: "v1".to_string(),
        refresh_revision: 1,
    });

    let decision = state
        .apply_probe(&binding, "v2", Some("v1"), RefreshMode::IfChanged)
        .expect("changed SHA must start one load");
    match decision {
        LoadDecision::StartLoad(load_binding) => {
            assert_eq!(load_binding.observed_sha, "v2");
            assert_eq!(load_binding.refresh_revision, 2);
        }
    }
}

#[test]
fn deactivate_clears_active_binding_and_load_state() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "v1", None, RefreshMode::IfChanged)
        .expect("probe");
    state.apply_probe(&binding, "v2", None, RefreshMode::IfChanged);
    assert!(state.has_active_load);
    assert!(state.active_binding.is_some());
    assert!(state.pending_refresh.is_some());

    state.deactivate();

    assert!(state.active_binding.is_none());
    assert!(!state.has_active_load);
    assert!(state.active_load_sha.is_none());
    assert!(state.pending_refresh.is_none());
}

#[test]
fn rebind_to_new_binding_clears_load_state() {
    let mut state = CoordinatorState::unseeded();
    let a = binding_for("/work/a", 1);
    let b = binding_for("/work/b", 2);

    state
        .apply_probe(&a, "v1", None, RefreshMode::IfChanged)
        .expect("a probe");
    state.apply_probe(&a, "v2", None, RefreshMode::IfChanged);
    assert_eq!(state.pending_refresh, Some(RefreshMode::IfChanged));

    state.rebind_to(b.clone());

    assert_eq!(state.active_binding, Some(b));
    assert!(!state.has_active_load);
    assert!(state.active_load_sha.is_none());
    assert!(state.pending_refresh.is_none());
}

#[test]
fn rebind_to_same_binding_is_a_noop() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "v1", None, RefreshMode::IfChanged)
        .expect("probe");
    let original_next_revision = state.next_revision;
    let original_active_load_sha = state.active_load_sha.clone();

    state.rebind_to(binding.clone());

    assert_eq!(state.active_binding, Some(binding));
    assert!(state.has_active_load);
    assert_eq!(state.active_load_sha, original_active_load_sha);
    assert_eq!(state.next_revision, original_next_revision);
}

#[test]
fn scheduler_concurrent_probe_queues_pending_refresh_during_in_flight_load() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    assert_eq!(
        state
            .apply_probe(&binding, &git_sha(1), None, RefreshMode::IfChanged)
            .map(|d| matches!(d, LoadDecision::StartLoad(_))),
        Some(true),
        "first probe must start a load"
    );

    let decision = state.apply_probe(&binding, &git_sha(2), None, RefreshMode::IfChanged);
    assert!(
        decision.is_none(),
        "concurrent probe must not start a parallel load"
    );
    assert_eq!(state.pending_refresh, Some(RefreshMode::IfChanged));
    assert!(
        state.has_active_load,
        "the active load must still be tracked"
    );
}

#[test]
fn scheduler_follow_up_load_targets_current_tip_not_a_retained_sha() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    let _ = state.apply_probe(&binding, &git_sha(1), None, RefreshMode::IfChanged);
    for sha in [git_sha(2), git_sha(3), git_sha(4)] {
        assert!(state
            .apply_probe(&binding, &sha, None, RefreshMode::IfChanged)
            .is_none());
    }
    assert_eq!(state.pending_refresh, Some(RefreshMode::IfChanged));

    state.apply_load_success(&LoadBinding {
        binding: binding.clone(),
        observed_sha: git_sha(1),
        refresh_revision: 1,
    });

    let pending = state.take_pending_refresh();
    assert_eq!(pending, Some(RefreshMode::IfChanged));

    // The follow-up probe runs against the current ref tip, not any
    // retained SHA. With the last-published SHA in the map matching the
    // observed SHA, no new load is scheduled.
    let decision = state.apply_probe(
        &binding,
        &git_sha(1),
        Some(&git_sha(1)),
        RefreshMode::IfChanged,
    );
    assert!(
        decision.is_none(),
        "current tip matches published SHA; no follow-up"
    );
}

#[test]
fn apply_load_failure_does_not_clear_pending_refresh() {
    // bsm-wj1.2 review invariant: apply_load_failure clears the
    // active-load flag and the active SHA so the next probe can
    // retry, but it MUST leave the pending refresh untouched so a
    // burst of requests that fired during the failed load is not
    // silently dropped. Only terminal completion consumes pending work.
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "v1", None, RefreshMode::IfChanged)
        .expect("probe");
    state.apply_probe(&binding, "v2", None, RefreshMode::IfChanged);
    assert_eq!(state.pending_refresh, Some(RefreshMode::IfChanged));

    state.apply_load_failure();

    assert!(!state.has_active_load);
    assert!(state.active_load_sha.is_none());
    assert_eq!(
        state.pending_refresh,
        Some(RefreshMode::IfChanged),
        "apply_load_failure must preserve the pending refresh"
    );
}

// =============================================================================
// RefreshMode (Force / IfChanged) coordinator tests.
// =============================================================================
//
// These tests pin the bsm-wj1.4 mode-aware admission rules: the 60-second
// time trigger and the native focus-gain trigger both request `Force`
// refreshes through the same single-flight coordinator the ref probe
// uses, and pending work records intent (a mode) rather than a target
// SHA. `Force` dominates `IfChanged` when both arrive while a load is
// active.

#[test]
fn force_starts_a_load_when_the_published_sha_is_unchanged() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "abc123", None, RefreshMode::IfChanged)
        .expect("first probe starts load");
    state.apply_load_success(&LoadBinding {
        binding: binding.clone(),
        observed_sha: "abc123".to_string(),
        refresh_revision: 1,
    });

    let decision = state
        .apply_probe(&binding, "abc123", Some("abc123"), RefreshMode::Force)
        .expect("Force must start a load even when the SHA is unchanged");
    match decision {
        LoadDecision::StartLoad(load) => {
            assert_eq!(load.observed_sha, "abc123");
            assert_eq!(load.refresh_revision, 2);
        }
    }
    assert!(state.has_active_load);
}

#[test]
fn forced_request_during_active_same_sha_load_queues_one_forced_follow_up() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "abc", None, RefreshMode::IfChanged)
        .expect("first probe starts load");

    // The observed SHA matches the active load's SHA, so an `IfChanged`
    // request would be a no-op; `Force` must still queue one follow-up.
    let decision = state.apply_probe(&binding, "abc", None, RefreshMode::Force);
    assert!(decision.is_none(), "no parallel load while one is active");
    assert_eq!(state.pending_refresh, Some(RefreshMode::Force));

    state.apply_load_success(&LoadBinding {
        binding: binding.clone(),
        observed_sha: "abc".to_string(),
        refresh_revision: 1,
    });
    assert_eq!(state.take_pending_refresh(), Some(RefreshMode::Force));
    assert!(state.pending_refresh.is_none());
}

#[test]
fn changed_sha_request_then_force_upgrades_pending_to_force() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "v1", None, RefreshMode::IfChanged)
        .expect("first probe starts load");

    state.apply_probe(&binding, "v2", None, RefreshMode::IfChanged);
    assert_eq!(state.pending_refresh, Some(RefreshMode::IfChanged));

    // A timer/focus request arriving behind a queued ref-change
    // follow-up upgrades the pending work so the follow-up reloads even
    // if the ref settles back to the published SHA.
    state.apply_probe(&binding, "v2", None, RefreshMode::Force);
    assert_eq!(state.pending_refresh, Some(RefreshMode::Force));
}

#[test]
fn force_then_if_changed_does_not_downgrade_pending() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "v1", None, RefreshMode::IfChanged)
        .expect("first probe starts load");

    state.apply_probe(&binding, "v1", None, RefreshMode::Force);
    assert_eq!(state.pending_refresh, Some(RefreshMode::Force));

    state.apply_probe(&binding, "v2", None, RefreshMode::IfChanged);
    assert_eq!(state.pending_refresh, Some(RefreshMode::Force));
}

#[test]
fn repeated_force_requests_remain_one_pending_mode() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 1);
    state
        .apply_probe(&binding, "v1", None, RefreshMode::IfChanged)
        .expect("first probe starts load");

    for _ in 0..3 {
        let decision = state.apply_probe(&binding, "v1", None, RefreshMode::Force);
        assert!(decision.is_none(), "no parallel load while one is active");
    }
    assert_eq!(state.pending_refresh, Some(RefreshMode::Force));

    state.apply_load_success(&LoadBinding {
        binding: binding.clone(),
        observed_sha: "v1".to_string(),
        refresh_revision: 1,
    });
    // Exactly one pending mode survives; completion consumes it once.
    assert_eq!(state.take_pending_refresh(), Some(RefreshMode::Force));
    assert!(state.take_pending_refresh().is_none());
}

#[test]
fn forced_load_retains_binding_generation_and_monotonic_revision() {
    let mut state = CoordinatorState::unseeded();
    let binding = binding_for("/work/a", 7);
    state
        .apply_probe(&binding, "v1", None, RefreshMode::IfChanged)
        .expect("first probe starts load");
    state.apply_load_success(&LoadBinding {
        binding: binding.clone(),
        observed_sha: "v1".to_string(),
        refresh_revision: 1,
    });

    let decision = state
        .apply_probe(&binding, "v1", Some("v1"), RefreshMode::Force)
        .expect("forced refresh starts a load");
    match decision {
        LoadDecision::StartLoad(load) => {
            // The forced load carries the active binding's path and
            // workspace-selection generation, and the coordinator's
            // monotonic refresh revision keeps advancing.
            assert_eq!(load.binding, binding);
            assert_eq!(load.observed_sha, "v1");
            assert_eq!(load.refresh_revision, 2);
        }
    }
    assert_eq!(state.next_revision, 3);
}

#[test]
fn successful_forced_probe_participates_in_probe_health_recovery() {
    // The shared refresh-request handler applies
    // `RefreshHealthState::apply_probe_success` on every successful
    // probe — including a forced probe whose unchanged SHA schedules no
    // load — so a recovered probe banner/counter does not stay dirty
    // until the next 2-second tick. This pins the reducer contract the
    // forced path relies on: after a visible transient probe episode, a
    // successful probe reports Recovered and clears the slot.
    let mut health_state = RefreshHealthState::new();
    health_state.rebind_to_active(PathBuf::from("/work/a"), 1);
    let mut next_revision: u64 = 1;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = health_state.apply_transient_probe_failure("strike".into(), &mut next_revision);
    }
    assert!(health_state.health().ref_probe.is_some());

    let outcome = health_state.apply_probe_success(&mut next_revision);
    assert!(
        matches!(outcome, HealthApplyOutcome::Recovered { .. }),
        "a successful (forced) probe must recover probe health"
    );
    assert!(health_state.health().ref_probe.is_none());
    assert!(health_state.needs_publish());
}

// =============================================================================
// Time-trigger cadence seam test.
// =============================================================================

#[tokio::test(start_paused = true)]
async fn time_refresh_ticker_delays_first_tick_and_skips_missed_ticks() {
    let period = Duration::from_secs(60);
    let mut ticker = time_refresh_ticker(period);

    // No tick before the full configured period has elapsed: the initial
    // snapshot already supplies the current state, so the time trigger
    // must not fire early.
    tokio::time::advance(period - Duration::from_secs(1)).await;
    tokio::select! {
        _ = ticker.tick() => panic!("time ticker must not tick before the full period"),
        _ = tokio::task::yield_now() => {}
    }

    // The first tick fires at the full period.
    tokio::time::advance(Duration::from_secs(1)).await;
    ticker.tick().await;

    // Missed ticks are skipped: advancing several periods at once yields
    // exactly one immediately-available tick, never a catch-up burst.
    tokio::time::advance(period * 3).await;
    ticker.tick().await;
    tokio::select! {
        _ = ticker.tick() => panic!("MissedTickBehavior::Skip must not produce a catch-up burst"),
        _ = tokio::task::yield_now() => {}
    }
}

#[test]
fn load_completion_carries_observed_sha_for_event_publication() {
    // bsm-wj1.2 review: the LoadCompletion's observed_sha must
    // mirror the binding's observed_sha so build_event_for_completion
    // can publish it on the IssueExplorerRefreshEvent and
    // seed_refresh_sha can persist it under the same lock. An empty
    // observed_sha would silently seed the per-workspace SHA map
    // with "" and short-circuit every subsequent probe.
    let binding = LoadBinding {
        binding: binding_for("/work/a", 1),
        observed_sha: "0123456789abcdef".to_string(),
        refresh_revision: 1,
    };
    let completion = LoadCompletion {
        binding: binding.clone(),
        observed_sha: binding.observed_sha.clone(),
        outcome: LoadOutcome::Failure(ListIssuesError::CommandFailed {
            status: 1,
            stderr: "anything".to_string(),
        }),
    };
    assert_eq!(completion.observed_sha, "0123456789abcdef");
}

#[test]
fn refresh_event_snapshot_payload_uses_camel_case_with_full_issue_data() {
    let issue = crate::rpc::Issue {
        id: "bsm-test".to_string(),
        title: "Probe".to_string(),
        status: "open".to_string(),
        priority: 2,
        issue_type: "task".to_string(),
        description: String::new(),
        comments: Vec::new(),
        close_reason: String::new(),
        assignee: String::new(),
        labels: Vec::new(),
        parent: String::new(),
        blocked_by: Vec::new(),
        blocks: Vec::new(),
        created: "2026-01-01T00:00:00Z".to_string(),
        updated_at: String::new(),
        closed_at: String::new(),
        defer_until: String::new(),
        due: String::new(),
    };
    let response = LoadIssueExplorerDataResponse {
        workspace_path: "/work/refresh".to_string(),
        workspace_generation: 3,
        all_issues: vec![issue.clone()],
        ready_issues: vec![issue.clone()],
        blocked_issues: vec![issue],
    };
    let event = IssueExplorerRefreshEvent::Snapshot {
        issue_data: response,
        observed_ref_sha: "0123456789abcdef".to_string(),
        refresh_revision: 7,
        workspace_path: "/work/refresh".to_string(),
        workspace_selection_generation: 3,
    };

    let json = serde_json::to_string(&event).expect("event must serialize");

    assert!(json.contains("\"eventType\":\"snapshot\""));
    assert!(json.contains("\"issueData\""));
    assert!(json.contains("\"observedRefSha\":\"0123456789abcdef\""));
    assert!(json.contains("\"refreshRevision\":7"));
    assert!(json.contains("\"workspacePath\":\"/work/refresh\""));
    assert!(json.contains("\"workspaceSelectionGeneration\":3"));
    assert!(json.contains("\"workspaceGeneration\":3"));
    assert!(json.contains("\"allIssues\""));
    assert!(json.contains("\"readyIssues\""));
    assert!(json.contains("\"blockedIssues\""));
    assert!(json.contains("\"bsm-test\""));
}

#[test]
fn refresh_event_health_payload_uses_camel_case_with_complete_state() {
    let health = RefreshHealth {
        ref_probe: Some(RefreshFailure {
            error_kind: RefreshFailureKind::RefProbe,
            message: "boom".to_string(),
            transient: true,
            failure_revision: 2,
        }),
        loader: Some(RefreshFailure {
            error_kind: RefreshFailureKind::MissingBw,
            message: "bw missing".to_string(),
            transient: false,
            failure_revision: 1,
        }),
    };
    let event = IssueExplorerRefreshEvent::Health {
        health,
        refresh_revision: 4,
        workspace_path: "/work/refresh".to_string(),
        workspace_selection_generation: 5,
    };
    let json = serde_json::to_string(&event).expect("event must serialize");
    assert!(json.contains("\"eventType\":\"health\""));
    assert!(json.contains("\"refProbe\""));
    assert!(json.contains("\"loader\""));
    assert!(json.contains("\"errorKind\":\"refProbe\""));
    assert!(json.contains("\"errorKind\":\"missingBw\""));
    assert!(json.contains("\"transient\":true"));
    assert!(json.contains("\"transient\":false"));
    assert!(json.contains("\"failureRevision\":2"));
    assert!(json.contains("\"refreshRevision\":4"));
    assert!(json.contains("\"workspacePath\":\"/work/refresh\""));
    assert!(json.contains("\"workspaceSelectionGeneration\":5"));
}

// =============================================================================
// Classifier tests.
// =============================================================================
//
// The classifier is the boundary between the subprocess seam and the
// health reducer. It must:
// - classify missing `git` as structural `MissingGit`;
// - classify every other probe error as transient (5-strike counter);
// - classify missing `bw` and not-a-Beadwork-Workspace as structural;
// - classify every other loader error as transient.

#[test]
fn classify_probe_error_missing_git_is_structural() {
    let error = ProbeError::Spawn("git executable was not found on PATH".to_string());
    match classify_probe_error(&error) {
        ProbeClassification::MissingGit(message) => {
            assert!(message.contains("git"));
        }
        other => panic!("expected MissingGit, got {other:?}"),
    }
}

#[test]
fn classify_probe_error_non_zero_status_is_transient() {
    let error = ProbeError::CommandFailed {
        status: 128,
        stderr: "fatal: unknown revision".to_string(),
    };
    assert_eq!(
        classify_probe_error(&error),
        ProbeClassification::Transient(format!("{error:?}"))
    );
}

#[test]
fn classify_probe_error_invalid_output_is_transient() {
    let error = ProbeError::InvalidOutput("git returned empty".to_string());
    assert_eq!(
        classify_probe_error(&error),
        ProbeClassification::Transient(format!("{error:?}"))
    );
}

#[test]
fn classify_probe_error_other_spawn_is_transient() {
    // A spawn error that does NOT mention the missing-executable
    // marker is treated as transient so it can be retried.
    let error = ProbeError::Spawn("could not run git: permission denied".to_string());
    assert_eq!(
        classify_probe_error(&error),
        ProbeClassification::Transient(format!("{error:?}"))
    );
}

#[test]
fn classify_load_error_missing_binary_is_structural() {
    let error = ListIssuesError::MissingBinary;
    assert!(matches!(
        classify_load_error(&error),
        LoadClassification::MissingBw(_)
    ));
}

#[test]
fn classify_load_error_not_beadwork_workspace_is_structural() {
    let error = ListIssuesError::NotBeadworkWorkspace {
        stderr: "beadwork not initialized".to_string(),
    };
    assert!(matches!(
        classify_load_error(&error),
        LoadClassification::NotBeadworkWorkspace(_)
    ));
}

#[test]
fn classify_load_error_command_failed_is_transient() {
    let error = ListIssuesError::CommandFailed {
        status: 1,
        stderr: "boom".to_string(),
    };
    assert!(matches!(
        classify_load_error(&error),
        LoadClassification::Transient(_)
    ));
}

fn error_message(error: &ProbeError) -> String {
    format!("{error:?}")
}

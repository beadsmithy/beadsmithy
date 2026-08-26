//! Pure-state tests for the refresh health reducer.
//!
//! These tests cover:
//!
//! - strikes 1–5 and saturation behavior for both transient classes;
//! - independent counters (a probe failure never erases a pending
//!   loader counter, and vice versa);
//! - structural replacement and structural recovery;
//! - successful-operation slot isolation;
//! - complete-state dirty publication and latest-state supersession;
//! - Pending, no-Current, unavailable, path replacement, and same-path
//!   generation rebind semantics;
//! - deterministic banner priority inputs.

use super::*;

const PATH_A: &str = "/work/a";
const PATH_B: &str = "/work/b";
const GEN_1: u32 = 1;
const GEN_2: u32 = 2;

fn new_state() -> RefreshHealthState {
    RefreshHealthState::new()
}

fn rebind_active(state: &mut RefreshHealthState) -> RefreshHealthRebind {
    state.rebind_to_active(PathBuf::from(PATH_A), GEN_1)
}

#[test]
fn new_state_is_idle_with_no_visible_health() {
    let state = new_state();
    assert!(matches!(
        state.binding(),
        RefreshHealthBinding::IdleNoCurrent
    ));
    assert_eq!(state.health(), &RefreshHealth::default());
    assert!(!state.needs_publish());
    assert_eq!(state.health_revision(), None);
}

#[test]
fn rebind_to_active_from_idle_clears_state() {
    let mut state = new_state();
    let result = state.rebind_to_active(PathBuf::from(PATH_A), GEN_1);
    assert_eq!(result, RefreshHealthRebind::Cleared);
    assert!(matches!(
        state.binding(),
        RefreshHealthBinding::Active { .. }
    ));
    assert!(!state.needs_publish());
}

#[test]
fn transient_probe_failures_one_through_four_are_silent() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for strike in 1..TRANSIENT_FAILURE_THRESHOLD {
        let outcome = state.apply_transient_probe_failure(
            format!("ref probe failed ({strike})"),
            &mut next_revision,
        );
        assert_eq!(
            outcome,
            HealthApplyOutcome::Silent,
            "strike {strike} must remain silent"
        );
        assert!(state.health().ref_probe.is_none());
        assert!(!state.needs_publish());
    }
}

#[test]
fn transient_probe_failure_at_threshold_installs_visible_slot() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..(TRANSIENT_FAILURE_THRESHOLD - 1) {
        let _ = state.apply_transient_probe_failure("strike".into(), &mut next_revision);
    }
    let outcome = state.apply_transient_probe_failure("strike-five".into(), &mut next_revision);
    match outcome {
        HealthApplyOutcome::Visible { failure_revision } => {
            assert_eq!(
                state
                    .health()
                    .ref_probe
                    .as_ref()
                    .map(|f| f.failure_revision),
                Some(failure_revision)
            );
            assert!(state.needs_publish());
            assert_eq!(state.health_revision(), Some(failure_revision));
        }
        other => panic!("expected Visible, got {other:?}"),
    }
    let probe = state.health().ref_probe.as_ref().unwrap();
    assert_eq!(probe.error_kind, RefreshFailureKind::RefProbe);
    assert!(probe.transient);
}

#[test]
fn transient_probe_failures_saturate_at_threshold() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..(TRANSIENT_FAILURE_THRESHOLD + 5) {
        let _ = state.apply_transient_probe_failure("strike".into(), &mut next_revision);
    }
    assert_eq!(state.ref_probe_failures, TRANSIENT_FAILURE_THRESHOLD);
}

#[test]
fn transient_probe_failure_after_recovery_resets_counter() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_probe_failure("strike".into(), &mut next_revision);
    }
    // Recovery via a successful probe clears the slot and counter.
    let outcome = state.apply_probe_success(&mut next_revision);
    assert!(matches!(outcome, HealthApplyOutcome::Recovered { .. }));
    assert!(state.health().ref_probe.is_none());
    assert_eq!(state.ref_probe_failures, 0);
    assert!(state.needs_publish());
    state.mark_published();
    assert!(!state.needs_publish());
    // Next four strikes must be silent again.
    for _ in 0..(TRANSIENT_FAILURE_THRESHOLD - 1) {
        let outcome = state.apply_transient_probe_failure("strike".into(), &mut next_revision);
        assert_eq!(outcome, HealthApplyOutcome::Silent);
    }
}

#[test]
fn transient_loader_failures_are_independent_of_probe_failures() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..(TRANSIENT_FAILURE_THRESHOLD - 1) {
        let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
        let _ = state.apply_transient_loader_failure("loader".into(), &mut next_revision);
    }
    assert_eq!(state.ref_probe_failures, TRANSIENT_FAILURE_THRESHOLD - 1);
    assert_eq!(state.loader_failures, TRANSIENT_FAILURE_THRESHOLD - 1);
    assert!(state.health().ref_probe.is_none());
    assert!(state.health().loader.is_none());
    assert!(!state.needs_publish());
}

#[test]
fn successful_probe_resets_only_probe_counter_and_slot() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    }
    for _ in 0..(TRANSIENT_FAILURE_THRESHOLD - 1) {
        let _ = state.apply_transient_loader_failure("loader".into(), &mut next_revision);
    }
    // Strike loader to threshold so the slot is visible.
    let _ = state.apply_transient_loader_failure("loader".into(), &mut next_revision);
    assert!(state.health().ref_probe.is_some());
    assert!(state.health().loader.is_some());
    state.mark_published();
    let outcome = state.apply_probe_success(&mut next_revision);
    assert!(matches!(outcome, HealthApplyOutcome::Recovered { .. }));
    assert!(state.health().ref_probe.is_none());
    assert!(state.health().loader.is_some());
    assert_eq!(state.ref_probe_failures, 0);
    assert_eq!(state.loader_failures, TRANSIENT_FAILURE_THRESHOLD);
}

#[test]
fn successful_loader_resets_only_loader_counter_and_slot() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    }
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_loader_failure("loader".into(), &mut next_revision);
    }
    state.mark_published();
    let outcome = state.apply_loader_success(&mut next_revision);
    assert!(matches!(outcome, HealthApplyOutcome::Recovered { .. }));
    assert!(state.health().ref_probe.is_some());
    assert!(state.health().loader.is_none());
    assert_eq!(state.ref_probe_failures, TRANSIENT_FAILURE_THRESHOLD);
    assert_eq!(state.loader_failures, 0);
}

#[test]
fn missing_git_failure_installs_immediately_and_resets_counter() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    // Two transient strikes first to confirm the counter resets.
    let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    assert_eq!(state.ref_probe_failures, 2);
    let outcome = state.apply_missing_git_failure("git missing".into(), &mut next_revision);
    assert!(matches!(outcome, HealthApplyOutcome::Visible { .. }));
    assert_eq!(state.ref_probe_failures, 0);
    let probe = state.health().ref_probe.as_ref().unwrap();
    assert_eq!(probe.error_kind, RefreshFailureKind::MissingGit);
    assert!(!probe.transient);
}

#[test]
fn missing_bw_failure_installs_immediately_in_loader_slot() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    let _ = state.apply_transient_loader_failure("loader".into(), &mut next_revision);
    let outcome = state.apply_missing_bw_failure("bw missing".into(), &mut next_revision);
    assert!(matches!(outcome, HealthApplyOutcome::Visible { .. }));
    assert_eq!(state.loader_failures, 0);
    let loader = state.health().loader.as_ref().unwrap();
    assert_eq!(loader.error_kind, RefreshFailureKind::MissingBw);
    // Structural failures must carry `transient: false` so the
    // renderer's structural-over-transient banner priority works.
    assert!(
        !loader.transient,
        "structural MissingBw must be non-transient"
    );
}

#[test]
fn not_beadwork_workspace_failure_installs_immediately_in_loader_slot() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    let outcome = state.apply_not_beadwork_workspace_failure(
        "not a Beadwork workspace".into(),
        &mut next_revision,
    );
    assert!(matches!(outcome, HealthApplyOutcome::Visible { .. }));
    let loader = state.health().loader.as_ref().unwrap();
    assert_eq!(loader.error_kind, RefreshFailureKind::NotBeadworkWorkspace);
    // Structural failures must carry `transient: false` so the
    // renderer's structural-over-transient banner priority works.
    assert!(
        !loader.transient,
        "structural NotBeadworkWorkspace must be non-transient"
    );
}

#[test]
fn structural_replacement_replaces_visible_slot_and_resets_counter() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    // Transient strikes for both classes, then a structural replacement.
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    }
    let transient_revision = state.health().ref_probe.as_ref().unwrap().failure_revision;
    // Mark published so the next visible event must bump.
    state.mark_published();
    let outcome = state.apply_missing_git_failure("git missing".into(), &mut next_revision);
    let new_revision = match outcome {
        HealthApplyOutcome::Visible { failure_revision } => failure_revision,
        other => panic!("expected Visible, got {other:?}"),
    };
    assert!(new_revision > transient_revision);
    let probe = state.health().ref_probe.as_ref().unwrap();
    assert_eq!(probe.error_kind, RefreshFailureKind::MissingGit);
    assert_eq!(probe.failure_revision, new_revision);
}

#[test]
fn validity_check_success_clears_structural_loader_slot() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    let _ = state.apply_not_beadwork_workspace_failure("nbw".into(), &mut next_revision);
    state.mark_published();
    let outcome = state.apply_validity_check_success(&mut next_revision);
    assert!(matches!(outcome, HealthApplyOutcome::Recovered { .. }));
    assert!(state.health().loader.is_none());
}

#[test]
fn validity_check_success_does_not_clear_transient_loader_slot() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_loader_failure("loader".into(), &mut next_revision);
    }
    state.mark_published();
    let outcome = state.apply_validity_check_success(&mut next_revision);
    assert_eq!(outcome, HealthApplyOutcome::Idle);
    assert!(state.health().loader.is_some());
}

#[test]
fn prepare_publish_returns_revision_when_dirty() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    }
    let revision = state.prepare_publish(&mut next_revision).unwrap();
    assert_eq!(revision, state.health_revision().unwrap());
    state.mark_published();
    assert!(state.prepare_publish(&mut next_revision).is_none());
}

#[test]
fn repeated_visible_failures_bump_revision() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    }
    let first = state.health_revision().unwrap();
    // Simulate a failed transport publish and another visible failure
    // arriving before retry. The new envelope must use a newer revision
    // and discard the obsolete one.
    let outcome = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    match outcome {
        HealthApplyOutcome::Visible { failure_revision } => {
            assert!(failure_revision > first);
        }
        other => panic!("expected Visible, got {other:?}"),
    }
}

#[test]
fn rebind_to_same_active_binding_is_a_noop() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    }
    state.mark_published();
    let probe_before = state.health().ref_probe.clone();
    let result = state.rebind_to_active(PathBuf::from(PATH_A), GEN_1);
    assert_eq!(result, RefreshHealthRebind::Noop);
    assert!(!state.needs_publish());
    assert_eq!(state.health().ref_probe, probe_before);
}

#[test]
fn rebind_to_same_path_new_generation_preserves_counters_and_health() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    }
    state.mark_published();
    let health_before = state.health().clone();
    let result = state.rebind_to_active(PathBuf::from(PATH_A), GEN_2);
    assert_eq!(result, RefreshHealthRebind::Republish);
    assert_eq!(state.health(), &health_before);
    assert!(state.needs_publish());
    assert_eq!(state.ref_probe_failures, TRANSIENT_FAILURE_THRESHOLD);
}

#[test]
fn rebind_to_different_path_clears_counters_and_health() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    }
    state.mark_published();
    let result = state.rebind_to_active(PathBuf::from(PATH_B), GEN_2);
    assert_eq!(result, RefreshHealthRebind::Cleared);
    assert_eq!(state.health(), &RefreshHealth::default());
    assert_eq!(state.ref_probe_failures, 0);
    assert!(!state.needs_publish());
    assert_eq!(state.health_revision(), None);
}

#[test]
fn suspend_for_pending_preserves_counters_and_health() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    }
    state.mark_published();
    let health_before = state.health().clone();
    state.suspend_for_pending();
    assert!(matches!(
        state.binding(),
        RefreshHealthBinding::SuspendedPending { .. }
    ));
    assert_eq!(state.health(), &health_before);
    // No probe/load failures while pending.
    let outcome = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    assert_eq!(outcome, HealthApplyOutcome::Idle);
}

#[test]
fn rebind_after_suspend_to_same_path_republishes() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    }
    state.mark_published();
    let health_before = state.health().clone();
    state.suspend_for_pending();
    // Mark published before rebind so we can observe dirty afterwards.
    state.mark_published();
    assert!(!state.needs_publish());
    let result = state.rebind_to_active(PathBuf::from(PATH_A), GEN_1);
    assert_eq!(result, RefreshHealthRebind::Republish);
    assert_eq!(state.health(), &health_before);
    assert!(state.needs_publish());
}

#[test]
fn enter_idle_no_current_clears_state() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    }
    state.enter_idle_no_current();
    assert!(matches!(
        state.binding(),
        RefreshHealthBinding::IdleNoCurrent
    ));
    assert_eq!(state.health(), &RefreshHealth::default());
    assert!(!state.needs_publish());
    let outcome = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    assert_eq!(outcome, HealthApplyOutcome::Idle);
}

#[test]
fn enter_idle_unavailable_publishes_empty_health_when_active_binding_existed() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    // Strike 5 installed a transient failure at some revision.
    let prior_revision = state
        .health_revision()
        .expect("strike-five installs a visible failure with a revision");
    state.mark_published();
    // The unavailable-workspace entry path must invalidate the prior
    // revision so the empty-state envelope has a strictly-newer
    // revision that the renderer admits.
    let had_identity = state.enter_idle_unavailable(false);
    assert!(had_identity);
    assert!(matches!(
        state.binding(),
        RefreshHealthBinding::IdleUnavailable { .. }
    ));
    assert!(state.needs_publish());
    assert_eq!(state.health(), &RefreshHealth::default());
    assert!(state.health_revision().is_none());
    let prepared = state.prepare_publish(&mut next_revision);
    let new_revision = prepared.expect("empty-state envelope is dirty");
    assert!(
        new_revision > prior_revision,
        "new revision {new_revision} must be strictly newer than prior published revision {prior_revision}",
    );
    assert_eq!(next_revision, new_revision + 1);
}

#[test]
fn enter_idle_unavailable_with_no_current_binding_does_not_publish() {
    let mut state = new_state();
    let had_identity = state.enter_idle_unavailable(false);
    assert!(!had_identity);
    assert!(matches!(
        state.binding(),
        RefreshHealthBinding::IdleNoCurrent
    ));
    assert!(!state.needs_publish());
}

#[test]
fn enter_idle_unavailable_path_still_available_does_not_publish_empty_health() {
    let mut state = new_state();
    rebind_active(&mut state);
    state.mark_published();
    let had_identity = state.enter_idle_unavailable(true);
    assert!(had_identity);
    // The path is still readable: stay bound to IdleUnavailable but do
    // not publish an empty Health event (probes may resume if the path
    // becomes available again).
    assert!(matches!(
        state.binding(),
        RefreshHealthBinding::IdleUnavailable { .. }
    ));
    assert!(!state.needs_publish());
}

#[test]
fn rebind_after_unavailable_to_same_path_republishes() {
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    }
    state.mark_published();
    state.enter_idle_unavailable(false);
    state.mark_published();
    let result = state.rebind_to_active(PathBuf::from(PATH_A), GEN_1);
    assert_eq!(result, RefreshHealthRebind::Republish);
    assert!(matches!(
        state.binding(),
        RefreshHealthBinding::Active { .. }
    ));
    assert!(state.needs_publish());
}

#[test]
fn binding_path_and_generation_helpers() {
    let mut state = new_state();
    rebind_active(&mut state);
    assert_eq!(state.binding().path(), Some(&PathBuf::from(PATH_A)));
    assert_eq!(state.binding().generation(), Some(GEN_1));
    assert!(state.binding().has_visible_identity());
    state.suspend_for_pending();
    assert_eq!(state.binding().path(), Some(&PathBuf::from(PATH_A)));
    assert_eq!(state.binding().generation(), Some(GEN_1));
    state.enter_idle_no_current();
    assert_eq!(state.binding().path(), None);
    assert_eq!(state.binding().generation(), None);
    assert!(!state.binding().has_visible_identity());
}

#[test]
fn complete_state_supersession_discards_obsolete_envelope() {
    // Simulate a failed publish followed by a visible change. The next
    // allocation must use a strictly newer revision.
    let mut state = new_state();
    rebind_active(&mut state);
    let mut next_revision: u64 = 100;
    for _ in 0..TRANSIENT_FAILURE_THRESHOLD {
        let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    }
    let first = state.health_revision().unwrap();
    // Simulate a failed transport publish (we keep needs_publish = true).
    // Subsequent visible change bumps the revision.
    let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    let second = state.health_revision().unwrap();
    assert!(second > first);
    // mark_published simulates a successful retry of the *second*
    // envelope. After that, a new dirty event must bump again.
    state.mark_published();
    let _ = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    let third = state.health_revision().unwrap();
    assert!(third > second);
}

#[test]
fn apply_outcome_idle_when_no_active_binding() {
    let mut state = new_state();
    let mut next_revision: u64 = 100;
    let outcome = state.apply_transient_probe_failure("probe".into(), &mut next_revision);
    assert_eq!(outcome, HealthApplyOutcome::Idle);
    let outcome = state.apply_transient_loader_failure("loader".into(), &mut next_revision);
    assert_eq!(outcome, HealthApplyOutcome::Idle);
    let outcome = state.apply_probe_success(&mut next_revision);
    assert_eq!(outcome, HealthApplyOutcome::Idle);
    let outcome = state.apply_loader_success(&mut next_revision);
    assert_eq!(outcome, HealthApplyOutcome::Idle);
}

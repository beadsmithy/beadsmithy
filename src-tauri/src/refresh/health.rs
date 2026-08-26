//! Refresh health reducer.
//!
//! Owns the full-state refresh health of the current binding:
//! independent counters for transient ref-probe and loader failures,
//! two-slot visible health state, transient-vs-structural classification
//! rules, recovery semantics, and publication-dirty tracking.
//!
//! The renderer receives this complete health state via a tagged-union
//! event contract ([`RefreshHealth`]); it does not track per-class event
//! watermarks, recovery tokens, or event-history queues. The backend
//! therefore owns every transition rule so the renderer can admit or
//! reject a `Health` event atomically.
//!
//! ## Counter rules
//!
//! - One transient ref-probe failure increments only `ref_probe_failures`.
//! - One transient loader failure increments only `loader_failures`.
//! - Counters saturate at [`TRANSIENT_FAILURE_THRESHOLD`].
//! - Strikes 1–4 do not change the visible health and do not publish.
//! - Strike 5 installs the transient failure in its slot, assigns a
//!   monotonic `failure_revision`, and marks health dirty.
//! - Missing `git` installs an immediate structural ref-probe failure.
//! - Missing `bw` and invalid Beadwork Workspace install immediate
//!   structural loader failures.
//! - A structural failure replaces the visible slot for its class and
//!   resets that class's transient counter.
//! - A successful probe resets only the probe counter and clears only
//!   the probe slot.
//! - A successful complete All/Ready/Blocked load resets only the loader
//!   counter and clears only the loader slot.
//! - A successful refresh-only Beadwork validity check may clear a
//!   structural loader slot, but never resets a transient loader episode.
//!
//! ## Binding lifecycle
//!
//! - **Pending**: counters and visible health are preserved; the previously
//!   active binding is retained so a re-activation can match the same
//!   identity.
//! - **Different Current path**: counters and health are cleared.
//! - **Same path, new generation**: counters and health are preserved and
//!   the complete health state is marked dirty for republication.
//! - **No Current**: counters and health are cleared (idle).
//! - **Unavailable/deleted Current**: an empty Health event for the
//!   previously rendered identity is published once, then counters and
//!   health are cleared.
//!
//! ## Publication revision semantics
//!
//! - The visible health state is a single value that fully replaces the
//!   renderer's previous health; there is no event-history queue.
//! - A failed transport retry reuses the same logical event/revision.
//! - If the health changes before a pending emission lands, the
//!   scheduler discards the obsolete envelope and publishes the latest
//!   complete health state with a newer revision.
//! - The event revision allocator is process-lifetime monotonic and
//!   shared between Snapshot and Health events (see
//!   [`crate::refresh::CoordinatorState::next_revision`]).

use std::path::PathBuf;

use serde::Serialize;

/// Number of consecutive transient failures of the same class that
/// must accumulate before the visible health is updated.
pub const TRANSIENT_FAILURE_THRESHOLD: u8 = 5;

/// Banner copy selection. Drives both the backend error kind and the
/// frontend banner message selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RefreshFailureKind {
    /// Transient `git rev-parse` failure (non-zero exit, invalid output,
    /// spawn I/O failure).
    RefProbe,
    /// Transient `bw list/ready/blocked` failure (command failed, parse
    /// failed, I/O error).
    Loader,
    /// Structural: `git` executable missing from PATH.
    MissingGit,
    /// Structural: `bw` executable missing from PATH.
    MissingBw,
    /// Structural: current directory is not a Beadwork workspace.
    NotBeadworkWorkspace,
}

/// One refresh failure slot. `transient = true` failures are the
/// five-strike kind; `transient = false` failures are immediate
/// structural kinds (missing git, missing bw, not a Beadwork Workspace).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RefreshFailure {
    pub error_kind: RefreshFailureKind,
    pub message: String,
    pub transient: bool,
    pub failure_revision: u64,
}

/// Refresh health state for the active binding.
///
/// Each slot is independent: a successful ref probe clears only the
/// ref-probe slot and resets only the ref-probe counter; a successful
/// loader clears only the loader slot and resets only the loader counter.
/// A `None` slot is "recovered" — the renderer renders no banner copy
/// for that class.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RefreshHealth {
    pub ref_probe: Option<RefreshFailure>,
    pub loader: Option<RefreshFailure>,
}

/// Binding that owns the refresh health state.
///
/// Distinct from the workspace `Option<...>` because Pending and no
/// Current both report `None` from the workspace binding, yet have
/// different health behavior: Pending preserves counters and visible
/// health; no Current clears them. The workspace selection generation
/// has already advanced by the time Pending arrives, so the previously
/// active binding must be retained inside the health module.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RefreshHealthBinding {
    /// A current binding is active and probed.
    Active {
        workspace_path: PathBuf,
        workspace_selection_generation: u32,
    },
    /// A Pending transition is in flight. Counters and visible health
    /// are preserved against the retained binding.
    SuspendedPending {
        retained_workspace_path: PathBuf,
        retained_workspace_selection_generation: u32,
    },
    /// No Current Workspace. Service is idle; no probes, no errors,
    /// no banner.
    IdleNoCurrent,
    /// The retained binding's path is no longer readable. An empty
    /// Health event for the previously rendered identity is published
    /// once, then backend counters and health are cleared.
    IdleUnavailable {
        retained_workspace_path: PathBuf,
        retained_workspace_selection_generation: u32,
    },
}

impl RefreshHealthBinding {
    /// Whether the binding owns a visible identity that could currently
    /// have a banner rendered.
    pub const fn has_visible_identity(&self) -> bool {
        matches!(
            self,
            Self::Active { .. } | Self::SuspendedPending { .. } | Self::IdleUnavailable { .. }
        )
    }

    /// The path associated with this binding when a visible identity
    /// exists. Returns `None` for `IdleNoCurrent`.
    pub fn path(&self) -> Option<&PathBuf> {
        match self {
            Self::Active { workspace_path, .. } => Some(workspace_path),
            Self::SuspendedPending {
                retained_workspace_path,
                ..
            } => Some(retained_workspace_path),
            Self::IdleUnavailable {
                retained_workspace_path,
                ..
            } => Some(retained_workspace_path),
            Self::IdleNoCurrent => None,
        }
    }

    /// The selection generation associated with this binding when a
    /// visible identity exists. Returns `None` for `IdleNoCurrent`.
    pub fn generation(&self) -> Option<u32> {
        match self {
            Self::Active {
                workspace_selection_generation,
                ..
            } => Some(*workspace_selection_generation),
            Self::SuspendedPending {
                retained_workspace_selection_generation,
                ..
            } => Some(*retained_workspace_selection_generation),
            Self::IdleUnavailable {
                retained_workspace_selection_generation,
                ..
            } => Some(*retained_workspace_selection_generation),
            Self::IdleNoCurrent => None,
        }
    }
}

/// Result of [`RefreshHealthState::rebind_to_active`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshHealthRebind {
    /// No change to binding or state.
    Noop,
    /// Same path, new generation. Counters and visible health preserved;
    /// complete health state marked dirty for republication under the new
    /// identity.
    Republish,
    /// Different path or no prior binding. Counters and visible health
    /// cleared; new binding installed.
    Cleared,
}

/// Outcome of one failure / success application to the health reducer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HealthApplyOutcome {
    /// No active binding; no error or counter change.
    Idle,
    /// Transient failure absorbed silently (under threshold).
    Silent,
    /// Transient failure crossed the threshold or a structural failure
    /// was installed. The visible health state changed; the caller must
    /// publish a new Health event with `failure_revision`.
    Visible { failure_revision: u64 },
    /// Recovery: the visible slot was cleared by a successful operation.
    /// The caller must publish a new Health event so the renderer clears
    /// the banner.
    Recovered { failure_revision: u64 },
}

/// Pure health reducer state.
///
/// All counter, slot, recovery, rebind, and publication-dirty rules live
/// here behind a small reducer-style interface. Scheduler callers report
/// operation outcomes; they do not manipulate counters or slots
/// directly.
///
/// The reducer is decoupled from [`crate::refresh::CoordinatorState`] so
/// the scheduler can lock the two states independently. Methods that
/// allocate a new event revision take a `&mut u64` next-revision slot
/// rather than a `&mut CoordinatorState`, which keeps the borrow
/// discipline simple and lets the scheduler lock the coordinator and
/// the health reducer in a defined order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefreshHealthState {
    binding: RefreshHealthBinding,
    ref_probe_failures: u8,
    loader_failures: u8,
    health: RefreshHealth,
    /// Revision assigned to the most recent Health event allocated for
    /// publication. Reused across retries; bumped when the visible
    /// health changes before the previous emission lands.
    health_revision: Option<u64>,
    /// True when the visible health state has changed since the last
    /// successful publication (or the initial dirty state).
    needs_publish: bool,
}

impl Default for RefreshHealthState {
    fn default() -> Self {
        Self::new()
    }
}

impl RefreshHealthState {
    pub fn new() -> Self {
        Self {
            binding: RefreshHealthBinding::IdleNoCurrent,
            ref_probe_failures: 0,
            loader_failures: 0,
            health: RefreshHealth::default(),
            health_revision: None,
            needs_publish: false,
        }
    }

    /// The current binding.
    pub fn binding(&self) -> &RefreshHealthBinding {
        &self.binding
    }

    /// The visible health state. The renderer replaces its complete
    /// state with this value when it admits a Health event.
    pub fn health(&self) -> &RefreshHealth {
        &self.health
    }

    /// The revision assigned to the most recent Health event allocation.
    pub fn health_revision(&self) -> Option<u64> {
        self.health_revision
    }

    /// True when the visible health state has changed since the last
    /// successful publication.
    pub fn needs_publish(&self) -> bool {
        self.needs_publish
    }

    /// Bind the reducer to an active binding.
    ///
    /// Same path, same generation: no-op (no state change, no
    /// publication). Same path, new generation: preserve counters and
    /// visible health, mark complete health state for republication
    /// under the new identity. Different path: clear counters and
    /// health; bind the new path with no publication (a subsequent
    /// probe or load completion may publish).
    pub fn rebind_to_active(
        &mut self,
        workspace_path: PathBuf,
        workspace_selection_generation: u32,
    ) -> RefreshHealthRebind {
        match &self.binding {
            RefreshHealthBinding::Active {
                workspace_path: existing_path,
                workspace_selection_generation: existing_generation,
            } => {
                if existing_path == &workspace_path {
                    if *existing_generation == workspace_selection_generation {
                        return RefreshHealthRebind::Noop;
                    }
                    // Same path, new generation: preserve counters and
                    // health; mark complete health state dirty.
                    self.binding = RefreshHealthBinding::Active {
                        workspace_path,
                        workspace_selection_generation,
                    };
                    self.needs_publish = true;
                    return RefreshHealthRebind::Republish;
                }
                self.clear_counters_and_health();
                self.binding = RefreshHealthBinding::Active {
                    workspace_path,
                    workspace_selection_generation,
                };
                self.needs_publish = false;
                RefreshHealthRebind::Cleared
            }
            RefreshHealthBinding::SuspendedPending {
                retained_workspace_path,
                retained_workspace_selection_generation: _,
            } => {
                if retained_workspace_path == &workspace_path {
                    // Rebinding from Pending to Active under the same
                    // path: preserve counters and health, mark dirty.
                    self.binding = RefreshHealthBinding::Active {
                        workspace_path,
                        workspace_selection_generation,
                    };
                    self.needs_publish = true;
                    return RefreshHealthRebind::Republish;
                }
                self.clear_counters_and_health();
                self.binding = RefreshHealthBinding::Active {
                    workspace_path,
                    workspace_selection_generation,
                };
                self.needs_publish = false;
                RefreshHealthRebind::Cleared
            }
            RefreshHealthBinding::IdleUnavailable {
                retained_workspace_path,
                retained_workspace_selection_generation: _,
            } => {
                if retained_workspace_path == &workspace_path {
                    // Rebinding from Unavailable to Active under the
                    // same path: preserve counters and health, mark dirty.
                    self.binding = RefreshHealthBinding::Active {
                        workspace_path,
                        workspace_selection_generation,
                    };
                    self.needs_publish = true;
                    return RefreshHealthRebind::Republish;
                }
                self.clear_counters_and_health();
                self.binding = RefreshHealthBinding::Active {
                    workspace_path,
                    workspace_selection_generation,
                };
                self.needs_publish = false;
                RefreshHealthRebind::Cleared
            }
            RefreshHealthBinding::IdleNoCurrent => {
                self.clear_counters_and_health();
                self.binding = RefreshHealthBinding::Active {
                    workspace_path,
                    workspace_selection_generation,
                };
                self.needs_publish = false;
                RefreshHealthRebind::Cleared
            }
        }
    }

    /// Suspend for a Pending transition. Preserves counters and visible
    /// health against the previously active binding. No-op when the
    /// binding is not active.
    pub fn suspend_for_pending(&mut self) {
        let retained = match &self.binding {
            RefreshHealthBinding::Active {
                workspace_path,
                workspace_selection_generation,
            } => (workspace_path.clone(), *workspace_selection_generation),
            _ => return,
        };
        self.binding = RefreshHealthBinding::SuspendedPending {
            retained_workspace_path: retained.0,
            retained_workspace_selection_generation: retained.1,
        };
    }

    /// Enter the no-Current idle state. Clears counters and visible
    /// health. The renderer must also clear its health when the
    /// workspace state shows the chooser.
    pub fn enter_idle_no_current(&mut self) {
        self.clear_counters_and_health();
        self.binding = RefreshHealthBinding::IdleNoCurrent;
    }

    /// Enter the unavailable idle state. Returns true if the reducer
    /// had a previously rendered identity that should receive one final
    /// empty Health event before the backend health is cleared.
    ///
    /// `workspace_path_available` should be `false` when the bound path
    /// is no longer a readable directory; in that case the reducer
    /// publishes an empty Health event for the retained identity (if
    /// any), then clears backend counters and health so subsequent
    /// probes are not scheduled.
    pub fn enter_idle_unavailable(&mut self, workspace_path_available: bool) -> bool {
        let retained = match &self.binding {
            RefreshHealthBinding::Active {
                workspace_path,
                workspace_selection_generation,
            } => Some((workspace_path.clone(), *workspace_selection_generation)),
            RefreshHealthBinding::SuspendedPending {
                retained_workspace_path,
                retained_workspace_selection_generation,
            } => Some((
                retained_workspace_path.clone(),
                *retained_workspace_selection_generation,
            )),
            RefreshHealthBinding::IdleUnavailable {
                retained_workspace_path,
                retained_workspace_selection_generation,
            } => Some((
                retained_workspace_path.clone(),
                *retained_workspace_selection_generation,
            )),
            RefreshHealthBinding::IdleNoCurrent => None,
        };
        let Some((path, generation)) = retained else {
            self.clear_counters_and_health();
            self.binding = RefreshHealthBinding::IdleNoCurrent;
            return false;
        };
        if !workspace_path_available {
            // Publish an empty Health event for the previously rendered
            // identity, then clear backend health so future probes are
            // not scheduled. The renderer only admits a strictly-newer
            // revision, so drop the published revision and let
            // `prepare_publish` allocate a fresh one for the empty
            // state — otherwise the recovery envelope would be
            // discarded and a stale banner would linger behind the
            // chooser.
            self.health = RefreshHealth::default();
            self.health_revision = None;
            self.needs_publish = true;
        }
        self.ref_probe_failures = 0;
        self.loader_failures = 0;
        self.binding = RefreshHealthBinding::IdleUnavailable {
            retained_workspace_path: path,
            retained_workspace_selection_generation: generation,
        };
        true
    }

    /// Apply one transient ref-probe failure.
    pub fn apply_transient_probe_failure(
        &mut self,
        message: String,
        next_revision: &mut u64,
    ) -> HealthApplyOutcome {
        if !matches!(self.binding, RefreshHealthBinding::Active { .. }) {
            return HealthApplyOutcome::Idle;
        }
        let prior = self.ref_probe_failures;
        self.ref_probe_failures = prior.saturating_add(1).min(TRANSIENT_FAILURE_THRESHOLD);
        if self.ref_probe_failures < TRANSIENT_FAILURE_THRESHOLD {
            return HealthApplyOutcome::Silent;
        }
        self.install_or_refresh_ref_probe_failure(
            RefreshFailureKind::RefProbe,
            message,
            true,
            next_revision,
        )
    }

    /// Apply one transient loader failure.
    pub fn apply_transient_loader_failure(
        &mut self,
        message: String,
        next_revision: &mut u64,
    ) -> HealthApplyOutcome {
        if !matches!(self.binding, RefreshHealthBinding::Active { .. }) {
            return HealthApplyOutcome::Idle;
        }
        let prior = self.loader_failures;
        self.loader_failures = prior.saturating_add(1).min(TRANSIENT_FAILURE_THRESHOLD);
        if self.loader_failures < TRANSIENT_FAILURE_THRESHOLD {
            return HealthApplyOutcome::Silent;
        }
        self.install_or_refresh_loader_failure(message, next_revision)
    }

    /// Apply a structural `missing-git` failure. Immediate: bypasses the
    /// five-strike threshold.
    pub fn apply_missing_git_failure(
        &mut self,
        message: String,
        next_revision: &mut u64,
    ) -> HealthApplyOutcome {
        if !matches!(self.binding, RefreshHealthBinding::Active { .. }) {
            return HealthApplyOutcome::Idle;
        }
        // Reset the transient ref-probe counter; the structural failure
        // starts a new failure episode.
        self.ref_probe_failures = 0;
        self.install_or_refresh_ref_probe_failure(
            RefreshFailureKind::MissingGit,
            message,
            false,
            next_revision,
        )
    }

    /// Apply a structural `missing-bw` failure. Immediate: bypasses the
    /// five-strike threshold.
    pub fn apply_missing_bw_failure(
        &mut self,
        message: String,
        next_revision: &mut u64,
    ) -> HealthApplyOutcome {
        if !matches!(self.binding, RefreshHealthBinding::Active { .. }) {
            return HealthApplyOutcome::Idle;
        }
        self.loader_failures = 0;
        self.install_or_refresh_loader_failure_with_kind(
            RefreshFailureKind::MissingBw,
            message,
            false,
            next_revision,
        )
    }

    /// Apply a structural `not-a-Beadwork-workspace` failure. Immediate:
    /// bypasses the five-strike threshold.
    pub fn apply_not_beadwork_workspace_failure(
        &mut self,
        message: String,
        next_revision: &mut u64,
    ) -> HealthApplyOutcome {
        if !matches!(self.binding, RefreshHealthBinding::Active { .. }) {
            return HealthApplyOutcome::Idle;
        }
        self.loader_failures = 0;
        self.install_or_refresh_loader_failure_with_kind(
            RefreshFailureKind::NotBeadworkWorkspace,
            message,
            false,
            next_revision,
        )
    }

    /// A successful ref probe resets only the ref-probe counter and
    /// clears only the ref-probe slot. Independent of any loader
    /// failure in flight.
    pub fn apply_probe_success(&mut self, next_revision: &mut u64) -> HealthApplyOutcome {
        if !matches!(self.binding, RefreshHealthBinding::Active { .. }) {
            return HealthApplyOutcome::Idle;
        }
        if self.health.ref_probe.is_none() && self.ref_probe_failures == 0 {
            return HealthApplyOutcome::Idle;
        }
        self.ref_probe_failures = 0;
        let was_set = self.health.ref_probe.is_some();
        self.health.ref_probe = None;
        if was_set {
            let failure_revision = self.allocate_revision(next_revision);
            self.needs_publish = true;
            HealthApplyOutcome::Recovered { failure_revision }
        } else {
            HealthApplyOutcome::Idle
        }
    }

    /// A successful complete All/Ready/Blocked load resets only the
    /// loader counter and clears only the loader slot.
    pub fn apply_loader_success(&mut self, next_revision: &mut u64) -> HealthApplyOutcome {
        if !matches!(self.binding, RefreshHealthBinding::Active { .. }) {
            return HealthApplyOutcome::Idle;
        }
        if self.health.loader.is_none() && self.loader_failures == 0 {
            return HealthApplyOutcome::Idle;
        }
        self.loader_failures = 0;
        let was_set = self.health.loader.is_some();
        self.health.loader = None;
        if was_set {
            let failure_revision = self.allocate_revision(next_revision);
            self.needs_publish = true;
            HealthApplyOutcome::Recovered { failure_revision }
        } else {
            HealthApplyOutcome::Idle
        }
    }

    /// A successful refresh-only Beadwork validity check may clear a
    /// structural loader slot (missing-bw / not-beadwork-workspace) but
    /// never resets a transient loader episode. Use this to recover
    /// from a structural loader failure after the user has repaired the
    /// dependency, while preserving the rule that only a complete
    /// loader success resets a transient loader failure.
    pub fn apply_validity_check_success(&mut self, next_revision: &mut u64) -> HealthApplyOutcome {
        if !matches!(self.binding, RefreshHealthBinding::Active { .. }) {
            return HealthApplyOutcome::Idle;
        }
        let was_structural_loader = matches!(
            self.health.loader,
            Some(RefreshFailure {
                error_kind: RefreshFailureKind::MissingBw,
                ..
            }) | Some(RefreshFailure {
                error_kind: RefreshFailureKind::NotBeadworkWorkspace,
                ..
            })
        );
        if !was_structural_loader {
            return HealthApplyOutcome::Idle;
        }
        self.health.loader = None;
        let failure_revision = self.allocate_revision(next_revision);
        self.needs_publish = true;
        HealthApplyOutcome::Recovered { failure_revision }
    }

    /// Allocate a fresh event revision from the shared monotonic
    /// allocator. The new revision becomes the revision the next Health
    /// publication must use.
    ///
    /// Per the plan's publication rules: a failed transport retry
    /// reuses the same revision; only a change to the visible health
    /// bumps the revision. This allocator therefore bumps only when
    /// the health state actually changed (the public
    /// `install_or_refresh_*` helpers drive that gating).
    fn allocate_revision(&mut self, next_revision: &mut u64) -> u64 {
        let revision = *next_revision;
        *next_revision = next_revision.saturating_add(1);
        self.health_revision = Some(revision);
        revision
    }

    /// Mark the most recent publication as successfully emitted. The
    /// next call to `prepare_publish` returns `None` unless something
    /// else dirties the state.
    pub fn mark_published(&mut self) {
        self.needs_publish = false;
    }

    /// Prepare the next publication. Returns the revision the next
    /// Health event must use, allocating a fresh revision when none
    /// was previously assigned (e.g., a clear recovery after a stale
    /// state).
    pub fn prepare_publish(&mut self, next_revision: &mut u64) -> Option<u64> {
        if !self.needs_publish {
            return None;
        }
        let revision = match self.health_revision {
            Some(r) => r,
            None => self.allocate_revision(next_revision),
        };
        Some(revision)
    }

    fn install_or_refresh_ref_probe_failure(
        &mut self,
        kind: RefreshFailureKind,
        message: String,
        transient: bool,
        next_revision: &mut u64,
    ) -> HealthApplyOutcome {
        // Always allocate a fresh revision: a structural replacement or
        // a new transient episode both need a distinct revision so the
        // renderer can clear the previous failure and present the new
        // one.
        let failure_revision = self.allocate_revision(next_revision);
        let next = RefreshFailure {
            error_kind: kind,
            message,
            transient,
            failure_revision,
        };
        self.health.ref_probe = Some(next);
        self.needs_publish = true;
        HealthApplyOutcome::Visible { failure_revision }
    }

    fn install_or_refresh_loader_failure(
        &mut self,
        message: String,
        next_revision: &mut u64,
    ) -> HealthApplyOutcome {
        self.install_or_refresh_loader_failure_with_kind(
            RefreshFailureKind::Loader,
            message,
            true,
            next_revision,
        )
    }

    fn install_or_refresh_loader_failure_with_kind(
        &mut self,
        kind: RefreshFailureKind,
        message: String,
        transient: bool,
        next_revision: &mut u64,
    ) -> HealthApplyOutcome {
        let failure_revision = self.allocate_revision(next_revision);
        let next = RefreshFailure {
            error_kind: kind,
            message,
            transient,
            failure_revision,
        };
        self.health.loader = Some(next);
        self.needs_publish = true;
        HealthApplyOutcome::Visible { failure_revision }
    }

    fn clear_counters_and_health(&mut self) {
        self.ref_probe_failures = 0;
        self.loader_failures = 0;
        self.health = RefreshHealth::default();
        self.health_revision = None;
        self.needs_publish = false;
    }
}

#[cfg(test)]
mod tests;

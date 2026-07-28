//! Backend refresh coordinator for the Current Workspace.
//!
//! Polls the local Beadwork Git ref (`refs/heads/beadwork`) and emits a typed
//! event when the snapshot at that ref moves. The coordinator is the narrow,
//! single-flight owner of automatic Issue Explorer refreshes inside an
//! already-selected Current Workspace:
//!
//! - A 2-second probe resolves the ref through the existing `CommandRunner`
//!   seam (`git rev-parse --verify refs/heads/beadwork^{commit}`), preserving
//!   the explicit per-workspace `cwd` ADR-0006 mandates and avoiding any
//!   parsing of loose / packed / atomic ref files.
//! - A non-overlapping full Beadwork loader fills in behind every observed
//!   SHA change. While a load is in flight, intermediate SHAs are coalesced
//!   into the newest dirty target and exactly one follow-up load is
//!   scheduled when the current load completes if the data is still stale.
//! - The success event carries the full `LoadIssueExplorerDataResponse`, the
//!   observed ref SHA, the workspace-selection generation that owned the
//!   load, the workspace path, and a monotonic refresh revision. The
//!   renderer admits only events for the snapshot it is currently rendering.
//!
//! The first probe for an unseeded coordinator intentionally triggers one
//! silent refresh rather than merely establishing a baseline: the ref may
//! move between the initial startup snapshot and the first poll tick.
//! Subsequent equal-SHA ticks are coalesced to zero load work. The first
//! tick is delayed by 2 seconds so the renderer has registered its listener
//! before any event can fire.
//!
//! This module deliberately does not own Workspace selection, persistence,
//! or rendering. Its async task is started once at Tauri setup and routed
//! through the existing `WorkspaceRuntime` for Current-path/generation
//! verification and snapshot publication. The single lifecycle `Notify`
//! the RPC layer calls after every Workspace transition is the only wake
//! source the coordinator uses to react to a binding change; both probes
//! and load completions carry their captured binding so a stale A worker
//! that completes after B has become Current cannot mutate or publish
//! over B's snapshot.
//!
//! Later epic tasks (`bsm-wj1.3` failure classification, `bsm-wj1.4`
//! time/focus triggers) all route through the same single-flight seam and
//! the same binding-aware completion admission.
//!
//! [`bsm-wj1.2`]: bind the refresh coordinator lifecycle to the existing
//! backend Current Workspace state.

use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::Notify;
use tokio::task::JoinHandle;
use tokio::time::{interval_at, Instant, MissedTickBehavior};

use crate::issues::{CommandOutput, CommandRunner, ListIssuesError, ProcessRunner};
use crate::rpc::{
    build_refresh_event, current_workspace_binding, emit_refresh_event,
    LoadIssueExplorerDataResponse, WorkspaceRuntime,
};
use crate::workspace::IssueExplorerData;

pub use health::{
    HealthApplyOutcome, RefreshFailure, RefreshFailureKind, RefreshHealth,
    RefreshHealthBinding, RefreshHealthRebind, RefreshHealthState,
    TRANSIENT_FAILURE_THRESHOLD,
};

/// Subprocess seam for the refresh scheduler. The production
/// implementation wraps [`ProcessRunner`]; tests inject a fake so the
/// scheduler's wiring can be exercised without spawning `git` or `bw`.
///
/// The trait exposes `probe_op`, `load_op`, and `validity_op` returning
/// `Box<dyn Fn>` so each call can hand a fresh closure to
/// `tokio::task::spawn_blocking` (which requires `Send + 'static` and
/// cannot share `&dyn RefreshOps` across the move). Implementors that
/// hold `Arc<Self>` can return `Arc::clone(self).probe(...)`-shaped
/// closures; the default below works for static implementations.
///
/// `load_op` returns the typed [`ListIssuesError`] instead of a string so
/// the scheduler can classify failures at the boundary without parsing
/// free-form messages. `validity_op` runs `bw config list` for the
/// workspace path and returns the same typed error, used after an
/// admitted transient probe failure to detect a Workspace that lost its
/// Beadwork initialization.
pub(crate) trait RefreshOps: Send + Sync + 'static {
    fn probe_op(&self) -> Box<dyn Fn(&Path) -> Result<String, ProbeError> + Send + 'static>;
    fn load_op(
        &self,
    ) -> Box<dyn Fn(&Path) -> Result<IssueExplorerData, ListIssuesError> + Send + 'static>;
    fn validity_op(
        &self,
    ) -> Box<dyn Fn(&Path) -> Result<(), ListIssuesError> + Send + 'static>;
}

/// Production [`RefreshOps`] that shells out to `git rev-parse` and
/// `bw list/ready/blocked` via the existing [`ProcessRunner`].
struct ProcessOps;

impl RefreshOps for ProcessOps {
    fn probe_op(&self) -> Box<dyn Fn(&Path) -> Result<String, ProbeError> + Send + 'static> {
        Box::new(|p| probe_beadwork_ref(&ProcessRunner::new(), p))
    }

    fn load_op(
        &self,
    ) -> Box<dyn Fn(&Path) -> Result<IssueExplorerData, ListIssuesError> + Send + 'static> {
        Box::new(|p| {
            let runner = ProcessRunner::new();
            let all_issues = crate::issues::list_all_issues(&runner, p)?;
            let ready_issues = crate::issues::list_ready_issues(&runner, p)?;
            let blocked_issues = crate::issues::list_blocked_issues(&runner, p)?;
            Ok(IssueExplorerData {
                all_issues,
                ready_issues,
                blocked_issues,
            })
        })
    }

    fn validity_op(
        &self,
    ) -> Box<dyn Fn(&Path) -> Result<(), ListIssuesError> + Send + 'static> {
        Box::new(|p| check_bw_validity(&ProcessRunner::new(), p))
    }
}

/// Git program used for ref resolution.
const GIT_PROGRAM: &str = "git";

/// `bw` program used for the validity check.
const BW_PROGRAM: &str = "bw";

/// Arguments that resolve the local Beadwork ref tip to its commit SHA.
///
/// `^{commit}` follows the ref through any peeled annotated-tag-style indirection
/// (Beadwork itself does not use annotated tags, but the syntax is the canonical
/// way to ask for a commit SHA) so a future tag-based layout would still resolve.
const PROBE_ARGS: &[&str] = &["rev-parse", "--verify", "refs/heads/beadwork^{commit}"];

/// Tauri event name used to publish Issue Explorer refreshes.
///
/// Following the existing `workspace-transition` convention: snake-case/kebab
/// URL style with a stable resource suffix.
pub const ISSUE_EXPLORER_REFRESH_EVENT: &str = "beadwork://issue-explorer-state-changed";

/// Interval between successive ref probes in steady state.
///
/// Two seconds matches the polling cadence chosen in ADR-0007 and keeps the
/// end-to-end convergence budget inside the roughly-three-second acceptance
/// criterion. Missed ticks are skipped rather than burst-executed so a
/// blocked loader cannot trigger a flood of catch-up probes.
pub const PROBE_INTERVAL: Duration = Duration::from_secs(2);

/// Outcome of a refresh-load completion that decides whether the
/// coordinator advances its admission markers and seeds the per-workspace
/// SHA map.
///
/// `Published`: the snapshot was admitted for the bound Current Workspace and
/// the renderer was notified. The coordinator's revision advances and the
/// SHA map entry for the binding is seeded.
/// `Discarded`: the completion's binding no longer matches the active
/// coordinator binding or the live non-Pending Current binding. The
/// backend snapshot is untouched, the SHA map is untouched, and the
/// coordinator logs the discard.
/// `EmitFailed`: the snapshot was admitted but the Tauri event could not be
/// emitted. The backend snapshot is updated so later `load_issue_explorer_data`
/// reads stay fresh, but the SHA is intentionally left retryable so a later
/// probe can re-emit the same snapshot to a reachable renderer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublishOutcome {
    Published,
    Discarded,
    EmitFailed,
}

/// Refresh event payload, the canonical source of truth for the
/// renderer-side envelope.
///
/// The event is a two-variant tagged union: `Snapshot` carries a new
/// full `IssueExplorerData` snapshot, while `Health` carries the
/// complete [`RefreshHealth`] state. Both share the
/// `refreshRevision`/`workspacePath`/`workspaceSelectionGeneration`
/// identity triple and the same process-lifetime monotonic revision
/// allocator. The renderer admits events with matching identity and a
/// strictly newer revision, and tracks separate accepted revisions for
/// Snapshot and Health events so delivery order between a successful
/// snapshot and a health change does not affect correctness.
///
/// camelCase fields follow the existing `workspace-transition`
/// convention.
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "eventType",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum IssueExplorerRefreshEvent {
    Snapshot {
        issue_data: LoadIssueExplorerDataResponse,
        observed_ref_sha: String,
        refresh_revision: u64,
        workspace_path: String,
        workspace_selection_generation: u32,
    },
    Health {
        health: RefreshHealth,
        refresh_revision: u64,
        workspace_path: String,
        workspace_selection_generation: u32,
    },
}

/// Internal typed errors from the ref probe. Distinguishing spawn failure
/// from non-zero exit and from an empty/unparseable SHA keeps future
/// classification (`bsm-wj1.3`) free to map these to banner rules without
/// replacing the probe seam.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeError {
    /// Spawning `git` failed. `message` carries the OS error.
    Spawn(String),
    /// `git` returned non-zero. `status` and `stderr` are preserved.
    CommandFailed { status: i32, stderr: String },
    /// `git` succeeded but stdout was empty or unparseable.
    InvalidOutput(String),
}

/// Resolve the local Beadwork ref tip through the supplied [`CommandRunner`].
///
/// A successful probe is `status == 0` and trimmed, non-empty stdout. The
/// SHA length is intentionally not validated: Beadwork's SHA-1 will be
/// 40 hex chars today, but SHA-256 hash algorithms are a Beadwork future
/// concern and a length check here would silently reject that change.
pub fn probe_beadwork_ref(
    runner: &dyn CommandRunner,
    workspace: &Path,
) -> Result<String, ProbeError> {
    let output: CommandOutput =
        runner
            .run(GIT_PROGRAM, PROBE_ARGS, workspace)
            .map_err(|error| match error.kind() {
                io::ErrorKind::NotFound => {
                    ProbeError::Spawn(format!("{GIT_PROGRAM} executable was not found on PATH"))
                }
                _ => ProbeError::Spawn(format!("could not run {GIT_PROGRAM}: {error}")),
            })?;

    if output.status != 0 {
        return Err(ProbeError::CommandFailed {
            status: output.status,
            stderr: output.stderr.trim().to_string(),
        });
    }

    let trimmed = output.stdout.trim();
    if trimmed.is_empty() {
        return Err(ProbeError::InvalidOutput(
            "git rev-parse returned an empty ref".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

/// Outcome of a refresh-only Beadwork validity check.
///
/// The validity check runs `bw config list` for the bound workspace and
/// classifies the result into the typed [`ListIssuesError`] shape so the
/// scheduler can decide between structural `MissingBw` /
/// `NotBeadworkWorkspace` (immediate banner), transient (silent), and
/// success (potential recovery of a structural loader slot).
pub fn check_bw_validity(
    runner: &dyn CommandRunner,
    workspace: &Path,
) -> Result<(), ListIssuesError> {
    use crate::issues::NOT_BEADWORK_MARKERS;
    let output: CommandOutput = runner
        .run(BW_PROGRAM, &["config", "list"], workspace)
        .map_err(map_spawn_error_for_validity)?;
    if output.status != 0 {
        let stderr = output.stderr.trim().to_string();
        if NOT_BEADWORK_MARKERS.iter().any(|marker| stderr.contains(marker)) {
            return Err(ListIssuesError::NotBeadworkWorkspace { stderr });
        }
        return Err(ListIssuesError::CommandFailed {
            status: output.status,
            stderr,
        });
    }
    Ok(())
}

fn map_spawn_error_for_validity(error: std::io::Error) -> ListIssuesError {
    if error.kind() == std::io::ErrorKind::NotFound {
        ListIssuesError::MissingBinary
    } else {
        ListIssuesError::Io(error)
    }
}

/// The binding that owns a refresh coordinator's current focus: the
/// canonical workspace path plus the backend `WorkspaceState.generation`
/// that the snapshot was admitted under. The path is the
/// `Workspace.path` the [`WorkspaceService`] persisted (a normalized Git
/// root); the generation is the bumped-on-each-selection counter the
/// same service owns.
///
/// `bsm-wj1.2` deliberately uses `(path, generation)` as the only
/// refresh identity. There is no separate lifecycle epoch: the existing
/// workspace service already changes `generation` for selection, real
/// cancellation, removal, and reset, so the same counter is reused for
/// refresh admission and an old A worker that completes after B has
/// become Current is silently rejected because its `generation` no
/// longer matches.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RefreshBinding {
    pub workspace_path: PathBuf,
    pub workspace_selection_generation: u32,
}

impl RefreshBinding {
    pub fn new(workspace_path: PathBuf, workspace_selection_generation: u32) -> Self {
        Self {
            workspace_path,
            workspace_selection_generation,
        }
    }
}

/// Immutable binding captured for one in-flight load.
///
/// Each started load carries its `(binding, observed_sha, refresh_revision)`
/// tuple. Publication rechecks the binding against both the coordinator's
/// active binding AND the live non-Pending Current binding so a stale
/// completion cannot overwrite a newer workspace's snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadBinding {
    pub binding: RefreshBinding,
    pub observed_sha: String,
    pub refresh_revision: u64,
}

/// Outcome of a single load attempt, before backend publication.
///
/// Failures here mean the coordinator leaves its admission markers
/// unchanged so the next probe retries. The failure variant carries
/// the typed [`ListIssuesError`] so the scheduler can classify the
/// failure into a banner-friendly [`RefreshFailureKind`] at the boundary.
#[derive(Debug)]
pub enum LoadOutcome {
    Success(LoadBinding, IssueExplorerData),
    Failure(ListIssuesError),
    Stale,
}

/// Pure coordinator state.
///
/// The state is plain data so the decision logic is testable without
/// spinning up a Tokio runtime or a Tauri app handle. The async
/// scheduler (`start_refresh_task` / `run_refresh_loop`) wraps this
/// with `interval_at`, an mpsc load-completion channel, and a shared
/// lifecycle `Notify`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoordinatorState {
    /// Current focus `(path, generation)`. `None` until the first probe
    /// binds the coordinator or when the lifecycle reports no Current
    /// Workspace. Drives both the ticker's rebind check and the
    /// completion's stale-binding rejection.
    pub active_binding: Option<RefreshBinding>,
    /// Highest revision already published for the current selection, or
    /// `None` for an unseeded coordinator. Independent of
    /// `WorkspaceState::generation`: the workspace selection may stay at
    /// generation 7 across many refreshes, while `last_published_revision`
    /// advances on every admitted refresh.
    pub last_published_revision: Option<u64>,
    /// Highest revision handed to any in-flight or queued load. Monotonic
    /// across the coordinator's lifetime.
    pub next_revision: u64,
    /// SHA observed for the load that is currently in flight, or `None`
    /// when no load is running. Repeated probes that match this SHA are
    /// coalesced; only a different SHA becomes a dirty target.
    pub active_load_sha: Option<String>,
    /// SHA observed for the next load that should start after the current
    /// load completes, or `None` when no follow-up is queued.
    pub dirty_target_sha: Option<String>,
    /// True when at least one full Issue Explorer loader is currently
    /// running for the active binding. The scheduler may not start a
    /// parallel load.
    pub has_active_load: bool,
}

impl CoordinatorState {
    /// Unseeded coordinator. The next probe is treated as the first
    /// observed SHA for this selection and triggers one silent refresh;
    /// the [`ADR-0007 startup-race note`](docs/adr/0007-refresh-issue-list-by-polling-beadwork-ref.md)
    /// explains why this avoids the ref-moves-between-snapshot-and-first-poll
    /// race.
    pub fn unseeded() -> Self {
        Self {
            active_binding: None,
            last_published_revision: None,
            next_revision: 1,
            active_load_sha: None,
            dirty_target_sha: None,
            has_active_load: false,
        }
    }

    /// Replace the active binding, clearing load-local state. Used by the
    /// lifecycle handler when the backend's Current Workspace identity
    /// changes (selection, retry bump, cancellation that bumped the
    /// generation, removal of another entry). Idempotent on the same
    /// binding so callers can invoke it unconditionally.
    pub fn rebind_to(&mut self, binding: RefreshBinding) {
        if self.active_binding.as_ref() != Some(&binding) {
            self.active_binding = Some(binding);
            self.has_active_load = false;
            self.active_load_sha = None;
            self.dirty_target_sha = None;
        }
    }

    /// Drop the active binding entirely. Used by the lifecycle handler
    /// when no Current Workspace exists (reset, removal of the Current
    /// Workspace, restore-current failure) or when Pending hides the
    /// binding.
    pub fn deactivate(&mut self) {
        self.active_binding = None;
        self.has_active_load = false;
        self.active_load_sha = None;
        self.dirty_target_sha = None;
    }

    /// Apply one probe result. Returns `Some(LoadDecision::StartLoad)`
    /// when the scheduler should start a load, `None` when the SHA matches
    /// the last published value (or the in-flight load's SHA) and no work
    /// is needed.
    ///
    /// When the active binding differs from the probe's binding, the
    /// coordinator rebinds before deciding. That makes the probe handler
    /// safe to call from any context; the lifecycle handler also uses
    /// the explicit [`Self::rebind_to`] for clarity.
    ///
    /// When a load is already active, an observed SHA that differs from
    /// the active load's SHA becomes (or replaces) the dirty target;
    /// only the latest dirty SHA survives, so the dirty follow-up does
    /// the right thing for a burst of ref moves.
    pub fn apply_probe(
        &mut self,
        binding: &RefreshBinding,
        observed_sha: &str,
        last_published_sha: Option<&str>,
    ) -> Option<LoadDecision> {
        if self.active_binding.as_ref() != Some(binding) {
            self.rebind_to(binding.clone());
        }

        if self.has_active_load {
            let active_matches = self
                .active_load_sha
                .as_deref()
                .is_some_and(|active| active == observed_sha);
            if !active_matches {
                self.dirty_target_sha = Some(observed_sha.to_string());
            }
            return None;
        }

        let unchanged = last_published_sha.is_some_and(|published| published == observed_sha);
        if unchanged {
            self.dirty_target_sha = None;
            return None;
        }

        let revision = self.next_revision;
        self.next_revision = self.next_revision.saturating_add(1);
        self.has_active_load = true;
        self.active_load_sha = Some(observed_sha.to_string());
        self.dirty_target_sha = None;

        let load_binding = LoadBinding {
            binding: binding.clone(),
            observed_sha: observed_sha.to_string(),
            refresh_revision: revision,
        };
        Some(LoadDecision::StartLoad(load_binding))
    }

    /// Handle a successful load completion whose binding still matches the
    /// bound Current Workspace.
    pub fn apply_load_success(&mut self, binding: &LoadBinding) {
        self.last_published_revision = Some(binding.refresh_revision);
        self.has_active_load = false;
        self.active_load_sha = None;
    }

    /// Handle a load failure. The active state is reset so the next probe
    /// can retry.
    pub fn apply_load_failure(&mut self) {
        self.has_active_load = false;
        self.active_load_sha = None;
    }

    /// Consume and return the current dirty target, if any.
    pub fn take_dirty_target(&mut self) -> Option<String> {
        self.dirty_target_sha.take()
    }
}

/// Result of a probe → reducer step. `StartLoad` requires the scheduler to
/// spawn one Issue Explorer loader for the captured binding; `Idle` means
/// no work is required this tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoadDecision {
    StartLoad(LoadBinding),
}

/// Start one process-lifetime refresh task bound to the supplied
/// runtime. The task:
///
/// - delays its first tick by `PROBE_INTERVAL` so the renderer has time
///   to register its listener before any event can fire;
/// - uses `MissedTickBehavior::Skip` so a blocked load cannot trigger a
///   flood of catch-up probes;
/// - selects over the lifecycle `Notify` (wakes on every Workspace
///   transition), the load-completion channel, and the two-second ticker;
/// - continues probing while a load is in flight, coalescing intermediate
///   SHAs into the newest dirty target;
/// - performs at most one follow-up load after each completion for the
///   current tip, never the dirty SHA itself (avoids loading a SHA that
///   has already reverted);
/// - holds no subprocess work while the `WorkspaceRuntime` mutex is held
///   (probes and loads run on `spawn_blocking`).
///
/// Returns the [`JoinHandle`] so the caller can abort it during teardown.
pub(crate) fn start_refresh_task(
    runtime: Arc<Mutex<Option<WorkspaceRuntime>>>,
    lifecycle: Arc<Notify>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        run_refresh_loop(runtime, lifecycle, Arc::new(ProcessOps)).await;
    })
}

/// Outcome of a single load attempt plus the binding it was started
/// for, sent back to the scheduler loop when the load task completes.
#[derive(Debug)]
struct LoadCompletion {
    binding: LoadBinding,
    observed_sha: String,
    outcome: LoadOutcome,
}

impl LoadCompletion {
    fn revision(&self) -> u64 {
        self.binding.refresh_revision
    }

    fn workspace_path(&self) -> &Path {
        &self.binding.binding.workspace_path
    }

    fn generation(&self) -> u32 {
        self.binding.binding.workspace_selection_generation
    }
}

async fn run_refresh_loop(
    runtime: Arc<Mutex<Option<WorkspaceRuntime>>>,
    lifecycle: Arc<Notify>,
    ops: Arc<dyn RefreshOps>,
) {
    let coordinator = Arc::new(Mutex::new(CoordinatorState::unseeded()));
    let health = Arc::new(Mutex::new(RefreshHealthState::new()));
    let (load_done_tx, mut load_done_rx) = tokio::sync::mpsc::unbounded_channel::<LoadCompletion>();

    let mut ticker = interval_at(Instant::now() + PROBE_INTERVAL, PROBE_INTERVAL);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        let notified = lifecycle.notified();
        tokio::select! {
            _ = ticker.tick() => {
                handle_probe(&runtime, &coordinator, &health, &load_done_tx, ops.clone()).await;
            }
            _ = notified => {
                handle_lifecycle(&runtime, &coordinator, &health, &load_done_tx, ops.clone()).await;
            }
            maybe_completion = load_done_rx.recv() => {
                let Some(completion) = maybe_completion else {
                    continue;
                };
                handle_completion(
                    &runtime,
                    &coordinator,
                    &health,
                    &load_done_tx,
                    ops.clone(),
                    completion,
                )
                .await;
            }
        }
    }
}

/// Probe the ref for the live binding and let the coordinator decide
/// whether to start a load. Probes during an in-flight load only update
/// the dirty target; the load completion handler picks them up.
///
/// Probe failures are classified at the boundary and fed into the
/// refresh health reducer. Transient strikes 1–4 are silent; strike 5
/// and immediate structural kinds (missing `git`) install a visible
/// failure slot and mark the health dirty. After a non-zero / invalid
/// probe failure, one validity check is run for the same binding so a
/// missing or replaced Beadwork initialization can be surfaced
/// immediately as a structural loader failure.
async fn handle_probe(
    runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>,
    coordinator: &Arc<Mutex<CoordinatorState>>,
    health: &Arc<Mutex<RefreshHealthState>>,
    load_done_tx: &tokio::sync::mpsc::UnboundedSender<LoadCompletion>,
    ops: Arc<dyn RefreshOps>,
) {
    let Some((path, generation)) = runtime_binding(runtime) else {
        return;
    };
    let observed = match probe_off_lock(&path, ops.as_ref()).await {
        Ok(sha) => sha,
        Err(error) => {
            classify_and_apply_probe_failure(
                runtime,
                coordinator,
                health,
                load_done_tx,
                ops.clone(),
                &path,
                generation,
                error,
            )
            .await;
            return;
        }
    };

    let binding = RefreshBinding::new(path.clone(), generation);
    let last_published = read_last_published_sha(runtime, &path);
    let decision = {
        let mut state = coordinator.lock().expect("coordinator lock poisoned");
        state.apply_probe(&binding, &observed, last_published.as_deref())
    };
    let Some(LoadDecision::StartLoad(load_binding)) = decision else {
        // A successful probe always clears the transient ref-probe
        // counter and slot, even when no new load is scheduled.
        let outcome = {
            let mut next_revision = coordinator.lock().expect("coordinator lock poisoned").next_revision;
            let mut health_state = health.lock().expect("health lock poisoned");
            health_state.apply_probe_success(&mut next_revision)
        };
        if matches!(outcome, HealthApplyOutcome::Recovered { .. }) {
            publish_health(runtime, health, coordinator);
        }
        // While a structural loader slot is active, retry the validity
        // check on later active ticks so repairing `bw` or the Workspace
        // clears the structural banner even when the ref is unchanged.
        // Per the plan: do not add permanent validity polling when no
        // structural loader slot exists.
        let structural_loader_active = {
            let health_state = health.lock().expect("health lock poisoned");
            matches!(
                health_state.health().loader,
                Some(RefreshFailure {
                    error_kind: RefreshFailureKind::MissingBw,
                    transient: false,
                    ..
                }) | Some(RefreshFailure {
                    error_kind: RefreshFailureKind::NotBeadworkWorkspace,
                    transient: false,
                    ..
                })
            )
        };
        if structural_loader_active {
            run_validity_retry_tick(runtime, coordinator, health, ops, &path, generation).await;
        }
        return;
    };
    spawn_load(
        runtime.clone(),
        load_done_tx.clone(),
        load_binding,
        ops.clone(),
    );
}

/// Classify a [`ProbeError`] into the [`RefreshFailureKind`] the health
/// reducer should receive. Missing `git` (spawn `NotFound`) is
/// structural; everything else is a transient ref-probe failure that
/// increments the per-class counter.
///
/// This classifier is intentionally best-effort: `Command::output()`
/// can report `NotFound` for either a missing executable or a missing
/// working directory. The scheduler mitigates that ambiguity by
/// re-checking the bound path's readability before classifying; this
/// function only sees the typed error.
pub(crate) fn classify_probe_error(error: &ProbeError) -> ProbeClassification {
    match error {
        ProbeError::Spawn(message) if message.contains("executable was not found") => {
            ProbeClassification::MissingGit(message.clone())
        }
        other => {
            let message = format!("{other:?}");
            ProbeClassification::Transient(message)
        }
    }
}

/// Classify a [`ListIssuesError`] from a refresh load attempt. Missing
/// `bw` and not-a-Beadwork-Workspace are structural (immediate banner);
/// every other variant is transient (loader counter).
pub(crate) fn classify_load_error(error: &ListIssuesError) -> LoadClassification {
    let message = format!("{error}");
    match error {
        ListIssuesError::MissingBinary => LoadClassification::MissingBw(message),
        ListIssuesError::NotBeadworkWorkspace { .. } => {
            LoadClassification::NotBeadworkWorkspace(message)
        }
        _ => LoadClassification::Transient(message),
    }
}

/// Classifier output for a probe failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ProbeClassification {
    /// Transient probe failure (counter incremented; silent until threshold).
    Transient(String),
    /// Structural probe failure: `git` executable is missing from PATH.
    /// Immediate banner.
    MissingGit(String),
}

/// Classifier output for a refresh load failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LoadClassification {
    /// Transient loader failure (counter incremented; silent until threshold).
    Transient(String),
    /// Structural loader failure: `bw` executable is missing from PATH.
    /// Immediate banner.
    MissingBw(String),
    /// Structural loader failure: the current directory is no longer a
    /// Beadwork workspace. Immediate banner.
    NotBeadworkWorkspace(String),
}

/// Apply a probe failure classification to the health reducer under
/// the coordinator and health mutexes. Returns the reducer's outcome so
/// the caller can decide whether to publish a Health event.
fn apply_probe_classification(
    health: &Arc<Mutex<RefreshHealthState>>,
    coordinator: &Arc<Mutex<CoordinatorState>>,
    classification: ProbeClassification,
) -> HealthApplyOutcome {
    let mut coordinator_guard = coordinator.lock().expect("coordinator lock poisoned");
    let mut health_state = health.lock().expect("health lock poisoned");
    match classification {
        ProbeClassification::Transient(message) => {
            health_state.apply_transient_probe_failure(message, &mut coordinator_guard.next_revision)
        }
        ProbeClassification::MissingGit(message) => {
            health_state.apply_missing_git_failure(message, &mut coordinator_guard.next_revision)
        }
    }
}

/// Apply a load failure classification to the health reducer.
fn apply_load_classification(
    health: &Arc<Mutex<RefreshHealthState>>,
    coordinator: &Arc<Mutex<CoordinatorState>>,
    classification: LoadClassification,
) -> HealthApplyOutcome {
    let mut coordinator_guard = coordinator.lock().expect("coordinator lock poisoned");
    let mut health_state = health.lock().expect("health lock poisoned");
    match classification {
        LoadClassification::Transient(message) => {
            health_state.apply_transient_loader_failure(message, &mut coordinator_guard.next_revision)
        }
        LoadClassification::MissingBw(message) => {
            health_state.apply_missing_bw_failure(message, &mut coordinator_guard.next_revision)
        }
        LoadClassification::NotBeadworkWorkspace(message) => health_state
            .apply_not_beadwork_workspace_failure(
                message,
                &mut coordinator_guard.next_revision,
            ),
    }
}

/// Classify a probe failure and feed it into the refresh health
/// reducer. Missing `git` is structural (immediate banner); transient
/// command / spawn failures increment the per-class counter. After an
/// admitted transient command / invalid-output probe failure, run one
/// refresh-only `bw config list` validity check so a Workspace that
/// lost its Beadwork initialization can be surfaced immediately.
async fn classify_and_apply_probe_failure(
    runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>,
    coordinator: &Arc<Mutex<CoordinatorState>>,
    health: &Arc<Mutex<RefreshHealthState>>,
    load_done_tx: &tokio::sync::mpsc::UnboundedSender<LoadCompletion>,
    ops: Arc<dyn RefreshOps>,
    path: &Path,
    generation: u32,
    error: ProbeError,
) {
    log::warn!(
        target: "beadsmith::refresh",
        "ref probe failed for {}: {:?}",
        path.display(),
        error,
    );
    let classification = classify_probe_error(&error);
    let probe_outcome = apply_probe_classification(health, coordinator, classification);
    if matches!(
        probe_outcome,
        HealthApplyOutcome::Visible { .. } | HealthApplyOutcome::Recovered { .. }
    ) {
        publish_health(runtime, health, coordinator);
    }
    if matches!(probe_outcome, HealthApplyOutcome::Visible { .. }) {
        if matches!(error, ProbeError::CommandFailed { .. } | ProbeError::InvalidOutput(_)) {
            run_post_failure_validity_check(runtime, coordinator, health, ops, path, generation)
                .await;
        }
    }
    let _ = load_done_tx;
}

/// Handle one lifecycle wake. The shared `Notify` carries no paths, so
/// the handler always rereads authoritative runtime state under the lock.
///
/// The lifecycle handler also rebinds the refresh health state. The
/// health reducer's binding lifecycle rules are:
/// - Pending transition: suspend (preserve counters and visible health).
/// - Different Current path: clear counters and health.
/// - Same path, new generation: preserve counters and health, mark the
///   complete state dirty for republication.
/// - No Current: enter idle, clear counters and health.
/// - Unavailable/deleted Current: publish one empty Health event for
///   the previously rendered identity, then enter idle.
async fn handle_lifecycle(
    runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>,
    coordinator: &Arc<Mutex<CoordinatorState>>,
    health: &Arc<Mutex<RefreshHealthState>>,
    load_done_tx: &tokio::sync::mpsc::UnboundedSender<LoadCompletion>,
    ops: Arc<dyn RefreshOps>,
) {
    let (new_binding, catalog_paths, pending_present, prior_active_path) = {
        let guard = runtime.lock().expect("runtime lock poisoned");
        let Some(runtime_ref) = guard.as_ref() else {
            return;
        };
        let state = runtime_ref.service.state();
        let new_binding = current_workspace_binding(runtime_ref);
        let pending_present = state.pending_workspace.is_some();
        let prior_active_path = state
            .current_workspace
            .as_ref()
            .map(|workspace| PathBuf::from(&workspace.path));
        let catalog_paths: HashSet<PathBuf> = state
            .catalog
            .iter()
            .map(|workspace| PathBuf::from(&workspace.path))
            .collect();
        (new_binding, catalog_paths, pending_present, prior_active_path)
    };

    enum LifecycleAction {
        Deactivate,
        Probe(RefreshBinding),
        Noop,
    }

    // Rebind the health reducer to mirror the workspace selection before
    // consuming the binding tuple in the action selector below.
    {
        let mut health_state = health.lock().expect("health lock poisoned");
        match &new_binding {
            Some((path, generation)) if !pending_present => {
                health_state.rebind_to_active(path.clone(), *generation);
            }
            Some(_) => {
                // A Pending transition: suspend the health reducer.
                health_state.suspend_for_pending();
            }
            None => {
                if let Some(path) = prior_active_path.as_ref() {
                    // The Current Workspace was removed; the path may
                    // already be unavailable. Treat as unavailable and
                    // emit one final empty Health event.
                    let available = path.is_dir();
                    health_state.enter_idle_unavailable(available);
                } else {
                    health_state.enter_idle_no_current();
                }
            }
        }
    }
    let health_dirty_after_rebind = {
        let health_state = health.lock().expect("health lock poisoned");
        health_state.needs_publish()
    };

    let action = {
        let mut state = coordinator.lock().expect("coordinator lock poisoned");
        match new_binding {
            None => {
                if state.active_binding.is_some() {
                    state.deactivate();
                    LifecycleAction::Deactivate
                } else {
                    LifecycleAction::Noop
                }
            }
            Some((path, generation)) => {
                let binding = RefreshBinding::new(path.clone(), generation);
                if state.active_binding.as_ref() != Some(&binding) {
                    state.rebind_to(binding.clone());
                    LifecycleAction::Probe(binding)
                } else {
                    let has_sha = {
                        let guard = runtime.lock().expect("runtime lock poisoned");
                        guard.as_ref().is_some_and(|runtime_ref| {
                            runtime_ref.refresh_sha_by_workspace.contains_key(&path)
                        })
                    };
                    if has_sha {
                        LifecycleAction::Noop
                    } else {
                        LifecycleAction::Probe(binding)
                    }
                }
            }
        }
    };

    // Evict SHA entries absent from the catalog so a removed workspace
    // does not leave a stale per-workspace SHA behind.
    {
        let mut guard = runtime.lock().expect("runtime lock poisoned");
        if let Some(runtime_ref) = guard.as_mut() {
            runtime_ref
                .refresh_sha_by_workspace
                .retain(|key, _| catalog_paths.contains(key));
        }
    }
    if health_dirty_after_rebind {
        publish_health(runtime, health, coordinator);
    }

    if let LifecycleAction::Probe(binding) = action {
        let observed = match probe_off_lock(&binding.workspace_path, ops.as_ref()).await {
            Ok(sha) => sha,
            Err(error) => {
                log::warn!(
                    target: "beadsmith::refresh",
                    "lifecycle probe failed for {}: {:?}",
                    binding.workspace_path.display(),
                    error,
                );
                classify_and_apply_probe_failure(
                    runtime,
                    coordinator,
                    health,
                    load_done_tx,
                    ops.clone(),
                    &binding.workspace_path,
                    binding.workspace_selection_generation,
                    error,
                )
                .await;
                return;
            }
        };
        let last_published = read_last_published_sha(runtime, &binding.workspace_path);
        let decision = {
            let mut state = coordinator.lock().expect("coordinator lock poisoned");
            state.apply_probe(&binding, &observed, last_published.as_deref())
        };
        let Some(LoadDecision::StartLoad(load_binding)) = decision else {
            return;
        };
        spawn_load(
            runtime.clone(),
            load_done_tx.clone(),
            load_binding,
            ops.clone(),
        );
    }
}

/// One load-completion step: build and emit the event (under the
/// runtime lock for the build, outside the lock for the emit), advance
/// the coordinator's revision and seed the SHA map only when both the
/// coordinator's active binding AND the live non-Pending Current binding
/// still match, and trigger at most one follow-up load if the previous
/// load's lifetime observed a different SHA.
///
/// The completion outcome is also fed into the refresh health reducer:
/// a successful load clears the loader slot and resets its counter; a
/// loader failure increments the loader counter (visible at strike 5).
/// Structural `MissingBinary` / `NotBeadworkWorkspace` errors install
/// an immediate structural loader failure that bypasses the
/// five-strike threshold.
async fn handle_completion(
    runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>,
    coordinator: &Arc<Mutex<CoordinatorState>>,
    health: &Arc<Mutex<RefreshHealthState>>,
    load_done_tx: &tokio::sync::mpsc::UnboundedSender<LoadCompletion>,
    ops: Arc<dyn RefreshOps>,
    completion: LoadCompletion,
) {
    // A completion is admitted only when its binding matches both the
    // coordinator's active binding and the live non-Pending Current
    // binding. Otherwise ignore completely: it cannot clear active
    // state, consume dirty state, update SHA memory/snapshot, or emit.
    let active_matches = {
        let state = coordinator.lock().expect("coordinator lock poisoned");
        state
            .active_binding
            .as_ref()
            .is_some_and(|active| active == &completion.binding.binding)
    };
    let still_matches = runtime_workspace_matches(
        runtime,
        completion.workspace_path(),
        completion.generation(),
    );
    if !active_matches || !still_matches {
        // Stale completion: ignore it completely. It cannot clear
        // active state, consume dirty state, update SHA memory or
        // snapshot, or emit. A blocking A worker that finished after
        // B became Current has no publication or mutation rights.
        return;
    }

    // Feed the outcome into the refresh health reducer before deciding
    // what to publish. The reducer reports whether the visible health
    // state changed; on success we publish a Health event after the
    // Snapshot, on failure we publish the Health event alone.
    let health_outcome = match &completion.outcome {
        LoadOutcome::Success(_, _) => {
            let mut coordinator_guard =
                coordinator.lock().expect("coordinator lock poisoned");
            let mut health_state = health.lock().expect("health lock poisoned");
            health_state.apply_loader_success(&mut coordinator_guard.next_revision)
        }
        LoadOutcome::Failure(error) => {
            let classification = classify_load_error(error);
            apply_load_classification(health, coordinator, classification)
        }
        LoadOutcome::Stale => HealthApplyOutcome::Idle,
    };

    let build = build_event_for_completion(runtime, &completion).await;

    let dirty_observed = {
        let mut state = coordinator.lock().expect("coordinator lock poisoned");
        state.take_dirty_target()
    };

    let Some((app, event)) = build else {
        // No event to emit (failure/stale). Update the coordinator so
        // the active-load flag is cleared and a future probe can start
        // a new load; the dirty follow-up below will still run if the
        // previous load's lifetime observed a different SHA.
        let needs_dirty_followup = {
            let mut state = coordinator.lock().expect("coordinator lock poisoned");
            state.apply_load_failure();
            dirty_observed.is_some()
        };
        if needs_dirty_followup {
            handle_dirty_follow_up(runtime, coordinator, load_done_tx, ops).await;
        }
        maybe_publish_health(runtime, coordinator, health, health_outcome);
        return;
    };

    let published =
        emit_refresh_event(&app, event, completion.revision(), &completion.observed_sha);

    // Revalidate the live binding under the lock AFTER the emit. The
    // lock is released between `build_refresh_event` and `emit_refresh_event`,
    // so a concurrent switch may have advanced the selection generation
    // or installed a Pending transition that makes the emitted event
    // stale for the renderer. In that case leave the SHA map untouched
    // so the dirty follow-up (or the next probe) re-emits a current-tip
    // load for the renderer.
    let still_matches_after_emit = runtime_workspace_matches(
        runtime,
        completion.workspace_path(),
        completion.generation(),
    );
    let active_matches_after_emit = {
        let state = coordinator.lock().expect("coordinator lock poisoned");
        state
            .active_binding
            .as_ref()
            .is_some_and(|active| active == &completion.binding.binding)
    };

    {
        let mut state = coordinator.lock().expect("coordinator lock poisoned");
        match (published, still_matches_after_emit, active_matches_after_emit) {
            (PublishOutcome::Published, true, true) => {
                state.apply_load_success(&completion.binding);
            }
            _ => {
                // Either the emit failed or the binding drifted between
                // build and emit (or after emit). Leave the SHA map
                // untouched so a future probe can re-emit a current-tip
                // load for the renderer.
                state.apply_load_failure();
            }
        }
    }

    if published == PublishOutcome::Published
        && still_matches_after_emit
        && active_matches_after_emit
    {
        seed_refresh_sha(
            runtime,
            completion.workspace_path(),
            &completion.observed_sha,
        );
    }

    maybe_publish_health(runtime, coordinator, health, health_outcome);

    if dirty_observed.is_some() {
        handle_dirty_follow_up(runtime, coordinator, load_done_tx, ops).await;
    }
}

/// Seed the per-workspace SHA map under the runtime lock. Only ever
/// called after a load completion whose binding still matches the live
/// non-Pending Current binding AND the coordinator's active binding.
fn seed_refresh_sha(runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>, path: &Path, sha: &str) {
    let mut guard = runtime.lock().expect("runtime lock poisoned");
    if let Some(runtime_ref) = guard.as_mut() {
        runtime_ref
            .refresh_sha_by_workspace
            .insert(path.to_path_buf(), sha.to_string());
    }
}

/// Publish the latest health state as a [`IssueExplorerRefreshEvent::Health`]
/// event when the reducer has marked the visible health dirty.
fn publish_health(
    runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>,
    health: &Arc<Mutex<RefreshHealthState>>,
    coordinator: &Arc<Mutex<CoordinatorState>>,
) {
    let revision = {
        let mut coordinator_guard =
            coordinator.lock().expect("coordinator lock poisoned");
        let mut health_state = health.lock().expect("health lock poisoned");
        let Some(revision) = health_state.prepare_publish(&mut coordinator_guard.next_revision) else {
            return;
        };
        let snapshot_health = health_state.health().clone();
        let binding = match health_state.binding() {
            RefreshHealthBinding::Active {
                workspace_path,
                workspace_selection_generation,
            } => Some((workspace_path.clone(), *workspace_selection_generation)),
            _ => None,
        };
        let Some((path, generation)) = binding else {
            return;
        };
        let build = {
            let mut guard = runtime.lock().expect("runtime lock poisoned");
            guard.as_mut().and_then(|runtime_ref| {
                crate::rpc::build_health_event(
                    runtime_ref,
                    &path,
                    generation,
                    snapshot_health,
                    revision,
                )
            })
        };
        if let Some((app, event)) = build {
            let published = crate::rpc::emit_refresh_event(&app, event, revision, "");
            // We don't track a per-event SHA for health events; the SHA
            // map is only relevant for snapshot publications. A failed
            // health publish leaves `needs_publish = true` so the next
            // tick retries with the same revision.
            if matches!(published, crate::refresh::PublishOutcome::Published) {
                health_state.mark_published();
            }
        }
        revision
    };
    let _ = revision;
}

/// Publish a Health event when the reducer reported a visible change.
fn maybe_publish_health(
    runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>,
    coordinator: &Arc<Mutex<CoordinatorState>>,
    health: &Arc<Mutex<RefreshHealthState>>,
    outcome: HealthApplyOutcome,
) {
    if matches!(
        outcome,
        HealthApplyOutcome::Visible { .. } | HealthApplyOutcome::Recovered { .. }
    ) {
        publish_health(runtime, health, coordinator);
    }
}

/// After an admitted transient probe failure, run one refresh-only
/// `bw config list` validity check for the same binding so a Workspace
/// that lost its Beadwork initialization can be surfaced immediately as
/// a structural loader failure.
async fn run_post_failure_validity_check(
    runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>,
    coordinator: &Arc<Mutex<CoordinatorState>>,
    health: &Arc<Mutex<RefreshHealthState>>,
    ops: Arc<dyn RefreshOps>,
    path: &Path,
    generation: u32,
) {
    let validity_result = check_bw_validity_off_lock(path, ops.as_ref()).await;
    let outcome = {
        let mut coordinator_guard =
            coordinator.lock().expect("coordinator lock poisoned");
        let mut health_state = health.lock().expect("health lock poisoned");
        match validity_result {
            Ok(()) => health_state.apply_validity_check_success(&mut coordinator_guard.next_revision),
            Err(ListIssuesError::MissingBinary) => health_state.apply_missing_bw_failure(
                "bw missing from PATH".to_string(),
                &mut coordinator_guard.next_revision,
            ),
            Err(ListIssuesError::NotBeadworkWorkspace { .. }) => {
                health_state.apply_not_beadwork_workspace_failure(
                    "workspace is no longer a Beadwork workspace".to_string(),
                    &mut coordinator_guard.next_revision,
                )
            }
            Err(other) => {
                log::warn!(
                    target: "beadsmith::refresh",
                    "post-failure validity check failed for {}: {}",
                    path.display(),
                    other,
                );
                HealthApplyOutcome::Idle
            }
        }
    };
    if matches!(
        outcome,
        HealthApplyOutcome::Visible { .. } | HealthApplyOutcome::Recovered { .. }
    ) {
        publish_health(runtime, health, coordinator);
    }
    let _ = generation;
}

async fn check_bw_validity_off_lock(path: &Path, ops: &dyn RefreshOps) -> Result<(), ListIssuesError> {
    let path = path.to_path_buf();
    let ops = ops.validity_op();
    tokio::task::spawn_blocking(move || ops(path.as_path()))
        .await
        .expect("validity check task panicked")
}

/// Run the validity check on a later active tick to recover from a
/// structural loader slot (MissingBw / NotBeadworkWorkspace). Invoked
/// from `handle_probe` only when the structural loader slot is already
/// active; transient / no-slot states skip the call so we don't add
/// permanent validity polling when Git probes are healthy.
async fn run_validity_retry_tick(
    runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>,
    coordinator: &Arc<Mutex<CoordinatorState>>,
    health: &Arc<Mutex<RefreshHealthState>>,
    ops: Arc<dyn RefreshOps>,
    path: &Path,
    generation: u32,
) {
    let validity_result = check_bw_validity_off_lock(path, ops.as_ref()).await;
    let outcome = {
        let mut coordinator_guard =
            coordinator.lock().expect("coordinator lock poisoned");
        let mut health_state = health.lock().expect("health lock poisoned");
        match validity_result {
            Ok(()) => health_state
                .apply_validity_check_success(&mut coordinator_guard.next_revision),
            Err(ListIssuesError::MissingBinary) => health_state.apply_missing_bw_failure(
                "bw missing from PATH".to_string(),
                &mut coordinator_guard.next_revision,
            ),
            Err(ListIssuesError::NotBeadworkWorkspace { .. }) => health_state
                .apply_not_beadwork_workspace_failure(
                    "workspace is no longer a Beadwork workspace".to_string(),
                    &mut coordinator_guard.next_revision,
                ),
            Err(other) => {
                log::warn!(
                    target: "beadsmith::refresh",
                    "validity retry tick failed for {}: {}",
                    path.display(),
                    other,
                );
                HealthApplyOutcome::Idle
            }
        }
    };
    if matches!(
        outcome,
        HealthApplyOutcome::Visible { .. } | HealthApplyOutcome::Recovered { .. }
    ) {
        publish_health(runtime, health, coordinator);
    }
    let _ = generation;
}

/// Post-completion dirty handling: if the previous load's lifetime
/// observed a different SHA, probe the current ref tip and start at
/// most one follow-up load for it. Runs on every terminal load
/// outcome (success, failure, stale) because the dirty observation
/// is independent of the load result.
async fn handle_dirty_follow_up(
    runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>,
    coordinator: &Arc<Mutex<CoordinatorState>>,
    load_done_tx: &tokio::sync::mpsc::UnboundedSender<LoadCompletion>,
    ops: Arc<dyn RefreshOps>,
) {
    let Some((path, generation)) = runtime_binding(runtime) else {
        return;
    };
    let observed = match probe_off_lock(&path, ops.as_ref()).await {
        Ok(sha) => sha,
        Err(error) => {
            log::warn!(
                target: "beadsmith::refresh",
                "post-load probe failed for {}: {:?}",
                path.display(),
                error,
            );
            return;
        }
    };
    let last_published = read_last_published_sha(runtime, &path);
    let binding = RefreshBinding::new(path.clone(), generation);
    let decision = {
        let mut state = coordinator.lock().expect("coordinator lock poisoned");
        state.apply_probe(&binding, &observed, last_published.as_deref())
    };
    let Some(LoadDecision::StartLoad(followup_binding)) = decision else {
        return;
    };
    spawn_load(
        runtime.clone(),
        load_done_tx.clone(),
        followup_binding,
        ops.clone(),
    );
}

/// Build the refresh event payload under the runtime lock and return
/// the (AppHandle, event) pair outside it. `None` when the binding no
/// longer matches, when a Pending transition arrived, when the runtime
/// is uninitialized, or when the load outcome was a failure/stale.
async fn build_event_for_completion(
    runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>,
    completion: &LoadCompletion,
) -> Option<(tauri::AppHandle<tauri::Wry>, IssueExplorerRefreshEvent)> {
    match &completion.outcome {
        LoadOutcome::Success(_, data) => {
            let data = data.clone();
            let mut guard = runtime.lock().expect("runtime lock poisoned");
            let runtime_ref = guard.as_mut()?;
            build_refresh_event(
                runtime_ref,
                completion.workspace_path(),
                completion.generation(),
                &completion.observed_sha,
                completion.revision(),
                data,
            )
        }
        LoadOutcome::Failure(message) => {
            log::warn!(
                target: "beadsmith::refresh",
                "refresh load failed for {}: {}",
                completion.workspace_path().display(),
                message,
            );
            None
        }
        LoadOutcome::Stale => None,
    }
}

/// Spawn one full-load task and route its completion back to the
/// scheduler loop through the supplied mpsc sender.
fn spawn_load(
    runtime: Arc<Mutex<Option<WorkspaceRuntime>>>,
    load_done_tx: tokio::sync::mpsc::UnboundedSender<LoadCompletion>,
    binding: LoadBinding,
    ops: Arc<dyn RefreshOps>,
) {
    tokio::spawn(async move {
        let observed_sha = binding.observed_sha.clone();
        let outcome = run_load(&runtime, &binding, ops).await;
        let _ = load_done_tx.send(LoadCompletion {
            binding,
            observed_sha,
            outcome,
        });
    });
}

/// Read the Current Workspace binding from the runtime mutex briefly.
/// Returns `None` when no Current exists, when Pending is present, or
/// when the runtime has not been initialized yet.
fn runtime_binding(runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>) -> Option<(PathBuf, u32)> {
    let guard = runtime.lock().expect("runtime lock poisoned");
    let runtime = guard.as_ref()?;
    current_workspace_binding(runtime)
}

/// Read the most recently published SHA for `path` from the runtime's
/// per-workspace SHA map. Returns `None` when the runtime has not been
/// initialized, the entry has not been seeded, or the entry was evicted.
fn read_last_published_sha(runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>, path: &Path) -> Option<String> {
    let guard = runtime.lock().expect("runtime lock poisoned");
    let runtime_ref = guard.as_ref()?;
    runtime_ref.refresh_sha_by_workspace.get(path).cloned()
}

/// True when the runtime's live non-Pending Current Workspace identity
/// equals `(path, generation)`. Used by the load-completion admission
/// gate to revalidate the binding under the lock.
fn runtime_workspace_matches(
    runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>,
    path: &Path,
    generation: u32,
) -> bool {
    let guard = runtime.lock().expect("runtime lock poisoned");
    let Some(runtime_ref) = guard.as_ref() else {
        return false;
    };
    let state = runtime_ref.service.state();
    state.pending_workspace.is_none()
        && state
            .current_workspace
            .as_ref()
            .is_some_and(|current| Path::new(&current.path) == path)
        && state.generation == generation
}

async fn probe_off_lock(path: &Path, ops: &dyn RefreshOps) -> Result<String, ProbeError> {
    let path = path.to_path_buf();
    let ops = ops.probe_op();
    tokio::task::spawn_blocking(move || ops(path.as_path()))
        .await
        .expect("probe task panicked")
}

async fn run_load(
    runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>,
    binding: &LoadBinding,
    ops: Arc<dyn RefreshOps>,
) -> LoadOutcome {
    let path = binding.binding.workspace_path.clone();
    let binding_for_task = binding.clone();
    let coordinator_marker = runtime.clone();
    let load_op = ops.load_op();
    tokio::task::spawn_blocking(move || {
        // Re-verify the binding under the runtime lock before any work
        // starts so a Pending transition that arrived while this load
        // was queued can short-circuit.
        {
            let guard = coordinator_marker.lock().expect("runtime lock poisoned");
            let Some(runtime) = guard.as_ref() else {
                return LoadOutcome::Stale;
            };
            let state = runtime.service.state();
            let matches = state
                .current_workspace
                .as_ref()
                .is_some_and(|current| current.path == path.display().to_string())
                && state.generation == binding_for_task.binding.workspace_selection_generation
                && state.pending_workspace.is_none();
            if !matches {
                return LoadOutcome::Stale;
            }
        }
        match load_op(&path) {
            Ok(data) => LoadOutcome::Success(binding_for_task, data),
            Err(error) => LoadOutcome::Failure(error),
        }
    })
    .await
    .expect("load task panicked")
}

mod health;

#[cfg(test)]
mod tests;
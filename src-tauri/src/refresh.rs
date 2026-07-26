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
//!   scheduled when the current load completes.
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
//! verification and snapshot publication.
//!
//! Later epic tasks (`bsm-wj1.2` per-Workspace revisit cache and switch
//! lifecycle, `bsm-wj1.3` failure classification, `bsm-wj1.4` time/focus
//! triggers) all route into this coordinator rather than create parallel
//! loaders.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tokio::task::JoinHandle;
use tokio::time::{interval_at, Instant, MissedTickBehavior};

use crate::issues::{CommandOutput, CommandRunner, ProcessRunner};
use crate::rpc::{
    build_refresh_event, current_workspace_binding, emit_refresh_event,
    LoadIssueExplorerDataResponse, WorkspaceRuntime,
};
use crate::workspace::{load_issue_explorer_data, IssueExplorerData};

/// Subprocess seam for the refresh scheduler. The production
/// implementation wraps [`ProcessRunner`]; tests inject a fake so the
/// scheduler's wiring can be exercised without spawning `git` or `bw`.
///
/// The trait exposes `probe_op` returning a `Box<dyn Fn>` so each
/// call can hand a fresh closure to `tokio::task::spawn_blocking`
/// (which requires `Send + 'static` and cannot share `&dyn RefreshOps`
/// across the move). Implementors that hold `Arc<Self>` can return
/// `Arc::clone(self).probe(...)`-shaped closures; the default below
/// works for static implementations.
pub(crate) trait RefreshOps: Send + Sync + 'static {
    fn probe_op(&self) -> Box<dyn Fn(&Path) -> Result<String, ProbeError> + Send + 'static>;
}

/// Production [`RefreshOps`] that shells out to `git rev-parse` and
/// `bw list/ready/blocked` via the existing [`ProcessRunner`].
struct ProcessOps;

impl RefreshOps for ProcessOps {
    fn probe_op(&self) -> Box<dyn Fn(&Path) -> Result<String, ProbeError> + Send + 'static> {
        Box::new(|p| probe_beadwork_ref(&ProcessRunner::new(), p))
    }
}

/// Git program used for ref resolution.
const GIT_PROGRAM: &str = "git";

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
/// coordinator advances `last_published_sha`.
///
/// `Published`: the snapshot was admitted for the bound Current Workspace and
/// the renderer was notified. The coordinator's SHA advances.
/// `Discarded`: the completion's binding no longer matches the current
/// runtime (e.g. the user switched workspaces while the load was running).
/// The backend snapshot is untouched, the published SHA is unchanged, and
/// the coordinator logs the discard.
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

/// Successful refresh event payload, the canonical source of truth for
/// the renderer-side envelope.
///
/// `issue_data` reuses the generated `LoadIssueExplorerDataResponse` (which
/// now carries `workspace_generation`) so the refresh contract cannot drift
/// from the typed RPC nested payload. The wrapper is camelCase to follow
/// the existing `workspace-transition` convention.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueExplorerRefreshEvent {
    pub issue_data: LoadIssueExplorerDataResponse,
    pub observed_ref_sha: String,
    pub refresh_revision: u64,
    pub workspace_path: String,
    pub workspace_selection_generation: u32,
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

/// Immutable binding captured for one in-flight load.
///
/// Each started load carries its `(workspace_path, selection_generation,
/// observed_sha, refresh_revision)` tuple. Publication rechecks the
/// `(workspace_path, selection_generation)` pair against the live runtime
/// so a stale completion cannot overwrite a newer workspace's snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadBinding {
    pub workspace_path: PathBuf,
    pub workspace_selection_generation: u32,
    pub observed_sha: String,
    pub refresh_revision: u64,
}

/// Outcome of a single load attempt, before backend publication.
///
/// Failures here mean the coordinator leaves `last_published_sha` unchanged
/// so the next probe retries.
#[derive(Debug, Clone)]
pub enum LoadOutcome {
    Success(LoadBinding, IssueExplorerData),
    Failure(String),
    Stale,
}

/// Pure coordinator state.
///
/// The state is plain data so the decision logic is testable without
/// spinning up a Tokio runtime or a Tauri app handle. The async
/// scheduler (`start_refresh_task` / `run_refresh_loop`) wraps this
/// with `interval_at` and an mpsc load-completion channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoordinatorState {
    /// Highest revision already published for the current selection, or
    /// `None` for an unseeded coordinator. Independent of
    /// `WorkspaceState::generation`: the workspace selection may stay at
    /// generation 7 across many refreshes, while `last_published_revision`
    /// advances on every admitted refresh.
    pub last_published_revision: Option<u64>,
    /// Highest revision handed to any in-flight or queued load. Monotonic
    /// across the coordinator's lifetime.
    pub next_revision: u64,
    /// Most recently successfully-published SHA, if any. A probe that
    /// returns this value is a no-op.
    pub last_published_sha: Option<String>,
    /// SHA observed for the load that is currently in flight, or `None`
    /// when no load is running. Repeated probes that match this SHA are
    /// coalesced; only a different SHA becomes a dirty target.
    pub active_load_sha: Option<String>,
    /// SHA observed for the next load that should start after the current
    /// load completes, or `None` when no follow-up is queued.
    pub dirty_target_sha: Option<String>,
    /// True when at least one full Issue Explorer loader is currently
    /// running. The scheduler may not start a parallel load.
    pub has_active_load: bool,
}

impl CoordinatorState {
    /// Unseeded coordinator. The next probe is treated as the first
    /// observed SHA for this selection and triggers one silent refresh;
    /// the [ADR-0007 startup-race note](docs/adr/0007-refresh-issue-list-by-polling-beadwork-ref.md)
    /// explains why this avoids the ref-moves-between-snapshot-and-first-poll
    /// race.
    pub fn unseeded() -> Self {
        Self {
            last_published_revision: None,
            next_revision: 1,
            last_published_sha: None,
            active_load_sha: None,
            dirty_target_sha: None,
            has_active_load: false,
        }
    }

    /// Apply one probe result. Returns `Some(LoadDecision::StartLoad)`
    /// when the scheduler should start a load, `None` when the SHA matches
    /// the last published value (or the in-flight load's SHA) and no work
    /// is needed.
    ///
    /// When a load is already active, an observed SHA that differs from
    /// the active load's SHA becomes (or replaces) the dirty target;
    /// only the latest dirty SHA survives, so the dirty follow-up does
    /// the right thing for a burst of ref moves.
    pub fn apply_probe(&mut self, observed_sha: &str) -> Option<LoadDecision> {
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

        let unchanged = self
            .last_published_sha
            .as_deref()
            .is_some_and(|published| published == observed_sha);
        if unchanged {
            self.dirty_target_sha = None;
            return None;
        }

        let revision = self.next_revision;
        self.next_revision = self.next_revision.saturating_add(1);
        self.has_active_load = true;
        self.active_load_sha = Some(observed_sha.to_string());
        self.dirty_target_sha = None;

        let binding = LoadBinding {
            workspace_path: PathBuf::new(),
            workspace_selection_generation: 0,
            observed_sha: observed_sha.to_string(),
            refresh_revision: revision,
        };
        Some(LoadDecision::StartLoad(binding))
    }

    /// Handle a successful load completion whose binding still matches the
    /// bound Current Workspace.
    pub fn apply_load_success(&mut self, binding: &LoadBinding) {
        self.last_published_sha = Some(binding.observed_sha.clone());
        self.last_published_revision = Some(binding.refresh_revision);
        self.has_active_load = false;
        self.active_load_sha = None;
    }

    /// Handle a load failure. The SHA is intentionally left untouched so
    /// the next probe can retry.
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
/// - continues probing while a load is in flight, coalescing intermediate
///   SHAs into the newest dirty target;
/// - performs at most one follow-up load after each completion for the
///   current tip, never the dirty SHA itself (avoids loading a SHA that
///   has already reverted);
/// - holds no subprocess work while the `WorkspaceRuntime` mutex is held
///   (probes and loads run on `spawn_blocking`).
///
/// Returns the [`JoinHandle`] so the caller can abort it during teardown.
pub(crate) fn start_refresh_task(runtime: Arc<Mutex<Option<WorkspaceRuntime>>>) -> JoinHandle<()> {
    tokio::spawn(async move {
        run_refresh_loop(runtime, Arc::new(ProcessOps)).await;
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
        &self.binding.workspace_path
    }
}

async fn run_refresh_loop(runtime: Arc<Mutex<Option<WorkspaceRuntime>>>, ops: Arc<dyn RefreshOps>) {
    let coordinator = Arc::new(Mutex::new(CoordinatorState::unseeded()));
    let (load_done_tx, mut load_done_rx) = tokio::sync::mpsc::unbounded_channel::<LoadCompletion>();

    let mut ticker = interval_at(Instant::now() + PROBE_INTERVAL, PROBE_INTERVAL);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                handle_tick(&runtime, &coordinator, &load_done_tx, ops.clone()).await;
            }
            maybe_completion = load_done_rx.recv() => {
                let Some(completion) = maybe_completion else {
                    continue;
                };
                handle_completion(
                    &runtime,
                    &coordinator,
                    &load_done_tx,
                    ops.clone(),
                    completion,
                )
                .await;
            }
        }
    }
}

/// One probe-tick step: snapshot the runtime binding, probe the ref,
/// and let the coordinator decide whether to start a load. Probes
/// during an in-flight load only update the dirty target; the load
/// completion handler picks them up.
async fn handle_tick(
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
                "ref probe failed for {}: {:?}",
                path.display(),
                error,
            );
            return;
        }
    };

    let decision = {
        let mut state = coordinator.lock().expect("coordinator lock poisoned");
        state.apply_probe(&observed)
    };
    let Some(LoadDecision::StartLoad(mut load_binding)) = decision else {
        return;
    };
    load_binding.workspace_path = path;
    load_binding.workspace_selection_generation = generation;
    spawn_load(
        runtime.clone(),
        load_done_tx.clone(),
        load_binding,
        observed,
    );
}

/// One load-completion step: build and emit the event (under the
/// runtime lock for the build, outside the lock for the emit), advance
/// the coordinator's published SHA only when the binding is still
/// current, and trigger at most one follow-up load for the current
/// ref tip if the previous load's lifetime observed a different SHA.
async fn handle_completion(
    runtime: &Arc<Mutex<Option<WorkspaceRuntime>>>,
    coordinator: &Arc<Mutex<CoordinatorState>>,
    load_done_tx: &tokio::sync::mpsc::UnboundedSender<LoadCompletion>,
    ops: Arc<dyn RefreshOps>,
    completion: LoadCompletion,
) {
    let build = build_event_for_completion(runtime, &completion).await;

    // Always do dirty follow-up work, regardless of whether the load
    // built an event. The dirty target is set by probes that ran
    // during the load's lifetime and is independent of whether the
    // load itself succeeded.
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
        return;
    };

    let published =
        emit_refresh_event(&app, event, completion.revision(), &completion.observed_sha);

    // Revalidate the binding under the lock AFTER the emit. The lock
    // is released between `build_refresh_event` and `emit_refresh_event`,
    // so a concurrent switch may have advanced the selection generation
    // or installed a Pending transition that makes the emitted event
    // stale for the renderer. In that case leave `last_published_sha`
    // unchanged so the dirty follow-up (or the next probe) re-emits a
    // current-tip load for the renderer.
    let still_matches = {
        let mut guard = runtime.lock().expect("runtime lock poisoned");
        match guard.as_mut() {
            Some(runtime_ref) => {
                runtime_ref.service.state().pending_workspace.is_none()
                    && runtime_ref
                        .service
                        .state()
                        .current_workspace
                        .as_ref()
                        .is_some_and(|current| {
                            current.path == completion.workspace_path().display().to_string()
                        })
                    && runtime_ref.service.state().generation
                        == completion.binding.workspace_selection_generation
            }
            None => false,
        }
    };

    {
        let mut state = coordinator.lock().expect("coordinator lock poisoned");
        match (published, still_matches) {
            (PublishOutcome::Published, true) => {
                state.apply_load_success(&completion.binding);
            }
            _ => {
                // Either the emit failed or the binding drifted
                // between build and emit. Leave `last_published_sha`
                // unchanged so a future probe can re-emit a
                // current-tip load for the renderer.
                state.apply_load_failure();
            }
        }
    }

    if dirty_observed.is_some() {
        handle_dirty_follow_up(runtime, coordinator, load_done_tx, ops).await;
    }
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
    let needs_followup = {
        let state = coordinator.lock().expect("coordinator lock poisoned");
        state
            .last_published_sha
            .as_deref()
            .is_none_or(|published| published != observed.as_str())
    };
    if !needs_followup {
        return;
    }
    let decision = {
        let mut state = coordinator.lock().expect("coordinator lock poisoned");
        state.apply_probe(&observed)
    };
    let Some(LoadDecision::StartLoad(mut followup_binding)) = decision else {
        return;
    };
    followup_binding.workspace_path = path;
    followup_binding.workspace_selection_generation = generation;
    spawn_load(
        runtime.clone(),
        load_done_tx.clone(),
        followup_binding,
        observed,
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
                completion.binding.workspace_selection_generation,
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
    observed_sha: String,
) {
    tokio::spawn(async move {
        let outcome = run_load(&runtime, &binding).await;
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
) -> LoadOutcome {
    let path = binding.workspace_path.clone();
    let binding_for_task = binding.clone();
    let coordinator_marker = runtime.clone();
    let probe_outcome = tokio::task::spawn_blocking(move || {
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
                && state.generation == binding_for_task.workspace_selection_generation
                && state.pending_workspace.is_none();
            if !matches {
                return LoadOutcome::Stale;
            }
        }
        match load_issue_explorer_data(&ProcessRunner::new(), &path) {
            Ok(data) => LoadOutcome::Success(binding_for_task, data),
            Err(error) => {
                LoadOutcome::Failure(format!("Could not load Issue Explorer data: {error}"))
            }
        }
    })
    .await
    .expect("load task panicked");
    probe_outcome
}

#[cfg(test)]
mod tests;

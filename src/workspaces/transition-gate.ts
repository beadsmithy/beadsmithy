/**
 * Renderer-only admission model for Workspace transitions.
 *
 * The backend `WorkspaceService` already owns the durable selection
 * state machine: it validates a candidate, retains a validated catalog
 * entry, loads the Issue Explorer snapshot, and only then commits
 * Current Workspace and MRU state. The renderer receives the same
 * transaction through two asynchronous paths — typed TauRPC responses
 * and `workspace-transition` events — and must publish a Workspace
 * identity and its Issue Explorer snapshot as one visible unit.
 *
 * This module encodes that admission protocol as one pure, typed
 * state object and one pure transition function. It owns only
 * admission/presentation decisions, never RPC calls, React state, or
 * backend persistence. Callers receive an exhaustive decision kind
 * rather than reconstructing ordering predicates at each call site.
 */
import type { IssueExplorerLoadState } from "../issues/issue-loader";
import type {
  LoadIssueExplorerDataResponse,
  WorkspaceState,
} from "../rpc/bindings";
import { isRetryableSwitchFailureKind } from "../workspace-switch-failure";

/**
 * Renderer-side lifecycle markers. One immutable record replaces the
 * independent refs previously held inside `App.applyTransition`:
 *
 * - `acceptedGeneration`: highest backend generation the renderer has
 *   admitted. The next direct `switch_workspace` request expects
 *   `acceptedGeneration + 1` so a newer selection already bumped to a
 *   later generation supersedes any in-flight result.
 * - `committedGeneration`: highest generation whose matching Issue
 *   Explorer snapshot has been published. Once a generation has been
 *   promoted to Current with its snapshot, that generation is terminal
 *   against any delayed same-generation Pending event.
 * - `terminalGeneration`: highest generation whose accepted switch
 *   failure is terminal against a same-generation Pending replay, so
 *   neither the retry banner nor inline validation feedback is
 *   overwritten by stale Pending events.
 * - `confirmedWorkspacePath`: path of the snapshot currently rendered
 *   by the Issue Explorer. It lets a remove-current transition replace
 *   that snapshot with the chooser state without clearing A during
 *   Pending or a failed replacement.
 */
export interface WorkspaceTransitionGateState {
  readonly acceptedGeneration: number;
  readonly committedGeneration: number;
  readonly terminalGeneration: number;
  readonly confirmedWorkspacePath: string | null;
}

/**
 * Initial renderer state. The committed and terminal markers start
 * below the lowest possible backend generation (0) so the first
 * accepted payload is never silently dropped as already-terminal.
 * The accepted marker starts at 0 so the first `switch_workspace`
 * request expects generation 1.
 */
export const INITIAL_WORKSPACE_TRANSITION_GATE_STATE: WorkspaceTransitionGateState =
  {
    acceptedGeneration: 0,
    committedGeneration: -1,
    confirmedWorkspacePath: null,
    terminalGeneration: -1,
  };

/**
 * A renderer-bound Workspace transition payload. `issueData` is `null`
 * for Pending, failed, cancellation-without-snapshot, and ordinary
 * state-refresh responses; it is a `LoadIssueExplorerDataResponse`
 * only when the payload commits a matching Issue Explorer snapshot.
 */
export interface WorkspaceTransitionPayload {
  readonly state: WorkspaceState;
  readonly issueData: LoadIssueExplorerDataResponse | null;
}

/**
 * Discriminated decision the renderer applies after the gate has
 * admitted (or rejected) a payload. Callers must not re-derive
 * admission rules: the decision kind is exhaustive and self-describing.
 *
 * - `ignore`: payload was stale, mismatched, terminally superseded, or
 *   lacked a publishable matching snapshot.
 * - `acceptStateRetainSnapshot`: selector/workspace state is current
 *   enough to render, but the existing Issue Explorer snapshot and
 *   remount key must remain unchanged.
 * - `commitSnapshot`: a Current Workspace and supplied Issue Explorer
 *   snapshot have matching paths; publish both and advance the remount
 *   key. `remountKey` is the snapshot's `workspacePath`.
 * - `clearSnapshot`: Current Workspace is absent and a snapshot was
 *   previously confirmed; clear the confirmation and present the
 *   chooser. `remountKey` is a sentinel that forces the explorer's
 *   remount before the chooser renders.
 */
export type WorkspaceTransitionDecision =
  | { readonly kind: "ignore" }
  | { readonly kind: "acceptStateRetainSnapshot" }
  | {
      readonly kind: "commitSnapshot";
      readonly snapshot: LoadIssueExplorerDataResponse;
      readonly remountKey: string;
    }
  | {
      readonly kind: "clearSnapshot";
      readonly remountKey: string;
    };

/**
 * Sentinel remount key used when a confirmed Issue Explorer snapshot
 * is cleared because Current Workspace was removed. Choosing a path
 * that no real workspace can occupy forces a remount of the explorer
 * subtree so the prior Workspace's selected Issue and search are
 * dropped before the chooser renders.
 */
export const CLEARED_WORKSPACE_REMOUNT_KEY = "/__removed__";

/**
 * Result of admitting one transition payload.
 */
export interface WorkspaceTransitionResult {
  readonly next: WorkspaceTransitionGateState;
  readonly decision: WorkspaceTransitionDecision;
}

/**
 * Result of admitting one startup issue-loader response. The startup
 * helper shares the gate state with the regular transition function
 * but uses the commitSnapshot/ignore vocabulary to avoid a parallel
 * "admit initial snapshot" rule the renderer would otherwise have to
 * duplicate. `remountKey` advances the explorer's remount key on a
 * successful initial snapshot and is the current key on failure so
 * callers can apply it unconditionally.
 */
export interface WorkspaceStartupResult {
  readonly next: WorkspaceTransitionGateState;
  readonly decision: WorkspaceStartupDecision;
}

/**
 * Startup admission decision.
 */
export type WorkspaceStartupDecision =
  | { readonly kind: "ignore" }
  | {
      readonly kind: "commitSnapshot";
      readonly snapshot: IssueExplorerLoadState;
      readonly remountKey: string;
    };

/**
 * Sentinel remount key for the initial-issue-load branch. The gate
 * returns it for a failed startup load so callers can apply the
 * `setWorkspaceKey` call idempotently without inspecting the
 * snapshot's status themselves.
 */
export const INITIAL_WORKSPACE_REMOUNT_KEY = "/__initial__";

/**
 * Admit one transition payload against the current gate state.
 *
 * The decision ordering mirrors the previous `App.applyTransition`
 * implementation exactly:
 *
 * 1. **Committed-success terminal guard**: payloads at or below the
 *    highest committed generation are dropped without advancing any
 *    marker. This is what prevents a delayed same-generation Pending
 *    event from regressing a confirmed Current + matching snapshot.
 * 2. **Expected-generation and stale-older rejection**: a direct
 *    `switch_workspace` response whose generation does not match the
 *    expected one (derived at dispatch time) is dropped. Any payload
 *    older than the highest accepted generation is also dropped.
 * 3. **Failure-terminal guard for Pending replay only**: a Pending
 *    payload whose generation is at or below the highest terminal
 *    generation is dropped. Non-Pending payloads bypass this guard
 *    because the retryable/inline-error terminal behavior is encoded
 *    by advancing `terminalGeneration` on accepted failures below.
 *
 * Once admitted, the workspace state is always updated and
 * `acceptedGeneration` advances. The snapshot decision branches:
 *
 * - matching `issueData.workspacePath` and `currentPath` → commit
 * - `currentPath === null` and a snapshot was previously confirmed →
 *   clear
 * - otherwise → accept state but retain the prior snapshot
 *
 * When the payload has no pending workspace and either a retryable
 * error kind or a non-retryable error with no retry target,
 * `terminalGeneration` advances so a delayed same-generation Pending
 * replay cannot regress the retry banner or inline validation
 * feedback.
 */
export const applyWorkspaceTransition = (
  current: WorkspaceTransitionGateState,
  payload: WorkspaceTransitionPayload,
  expectedGeneration: number | null
): WorkspaceTransitionResult => {
  const { state } = payload;
  const { generation } = state;

  if (generation <= current.committedGeneration) {
    return { decision: { kind: "ignore" }, next: current };
  }

  if (
    (expectedGeneration !== null && generation !== expectedGeneration) ||
    generation < current.acceptedGeneration
  ) {
    return { decision: { kind: "ignore" }, next: current };
  }

  if (
    state.pendingWorkspace !== null &&
    generation <= current.terminalGeneration
  ) {
    return { decision: { kind: "ignore" }, next: current };
  }

  const currentPath = state.currentWorkspace?.path ?? null;
  const { issueData } = payload;

  let { confirmedWorkspacePath } = current;
  let decision: WorkspaceTransitionDecision;

  if (issueData !== null && issueData.workspacePath === currentPath) {
    confirmedWorkspacePath = currentPath;
    decision = {
      kind: "commitSnapshot",
      remountKey: issueData.workspacePath,
      snapshot: issueData,
    };
  } else if (currentPath === null && current.confirmedWorkspacePath !== null) {
    confirmedWorkspacePath = null;
    decision = {
      kind: "clearSnapshot",
      remountKey: CLEARED_WORKSPACE_REMOUNT_KEY,
    };
  } else {
    decision = { kind: "acceptStateRetainSnapshot" };
  }

  let { terminalGeneration } = current;
  if (
    state.pendingWorkspace === null &&
    (isRetryableSwitchFailureKind(state.error?.kind) ||
      (state.error !== null && state.retryWorkspace === null))
  ) {
    terminalGeneration = generation;
  }

  return {
    decision,
    next: {
      acceptedGeneration: generation,
      committedGeneration:
        decision.kind === "commitSnapshot"
          ? generation
          : current.committedGeneration,
      confirmedWorkspacePath,
      terminalGeneration,
    },
  };
};

/**
 * Admit the result of the initial issue-loader RPC.
 *
 * The initial `load_issue_explorer_data` call dispatches before the
 * renderer's first interactive state and may resolve after a
 * user-driven switch has already committed. The dispatch-time
 * `committedGeneration` baseline lets the gate reject a stale startup
 * snapshot without consulting any ref the caller owns: a later
 * committed transition wins, and the startup result is discarded.
 *
 * A non-superseded successful load establishes the confirmed snapshot
 * path so a later remove-current transition can clear it. A
 * non-superseded failed load publishes the failure snapshot but does
 * not record a confirmed path.
 */
export const applyStartupIssueLoad = (
  current: WorkspaceTransitionGateState,
  load: IssueExplorerLoadState,
  dispatchedAtCommittedGeneration: number
): WorkspaceStartupResult => {
  if (current.committedGeneration > dispatchedAtCommittedGeneration) {
    return { decision: { kind: "ignore" }, next: current };
  }

  if (load.status === "success") {
    return {
      decision: {
        kind: "commitSnapshot",
        remountKey: load.workspacePath,
        snapshot: load,
      },
      next: {
        ...current,
        confirmedWorkspacePath: load.workspacePath,
      },
    };
  }

  return {
    decision: {
      kind: "commitSnapshot",
      remountKey: INITIAL_WORKSPACE_REMOUNT_KEY,
      snapshot: load,
    },
    next: current,
  };
};

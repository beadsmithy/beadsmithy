/**
 * Renderer-side types for the `beadwork://issue-explorer-state-changed`
 * refresh event contract.
 *
 * Mirrors the Rust `IssueExplorerRefreshEvent` tagged union from
 * `src-tauri/src/refresh.rs`. The refresh event is published by the
 * backend on the Tauri event channel; it is not part of the Taurpc
 * generated bindings.
 *
 * Two variants share the same `(workspacePath, workspaceSelectionGeneration,
 * refreshRevision)` identity triple:
 *
 * - `snapshot` carries a new full `LoadIssueExplorerDataResponse`. The
 *   renderer replaces its issue explorer snapshot in place; the outer
 *   remount key, active view, search, and selected Issue are stable
 *   because the underlying identity is unchanged.
 * - `health` carries the complete two-slot refresh health state. The
 *   renderer replaces its complete health with the new state and renders
 *   a non-blocking banner above the issue list when at least one slot
 *   is filled.
 *
 * The renderer admits each variant against a confirmed rendered snapshot
 * identity with a strictly newer revision. Snapshot and Health revisions
 * are tracked separately so delivery order between them does not affect
 * correctness.
 */
import type { LoadIssueExplorerDataResponse } from "./rpc/bindings";

/**
 * Refresh failure slot kind. The renderer maps this to banner copy.
 */
export type RefreshFailureKind =
  | "refProbe"
  | "loader"
  | "missingGit"
  | "missingBw"
  | "notBeadworkWorkspace";

/**
 * One refresh failure slot. `transient = true` failures are the
 * five-strike kind (banner appears only after five consecutive
 * failures of the same class); `transient = false` failures are
 * immediate structural kinds that surface without any budget.
 */
export interface RefreshFailure {
  readonly errorKind: RefreshFailureKind;
  readonly message: string;
  readonly transient: boolean;
  readonly failureRevision: number;
}

/**
 * Refresh health state for the active binding. Each slot is
 * independent: a successful ref probe clears only the ref-probe slot;
 * a successful loader clears only the loader slot. A `null` slot is
 * "recovered" — the renderer renders no banner copy for that class.
 */
export interface RefreshHealth {
  readonly refProbe: RefreshFailure | null;
  readonly loader: RefreshFailure | null;
}

/**
 * Tagged union of the two refresh event variants.
 */
export type IssueExplorerRefreshEvent =
  | IssueExplorerRefreshSnapshotEvent
  | IssueExplorerRefreshHealthEvent;

export interface IssueExplorerRefreshSnapshotEvent {
  readonly eventType: "snapshot";
  readonly issueData: LoadIssueExplorerDataResponse;
  readonly observedRefSha: string;
  readonly refreshRevision: number;
  readonly workspacePath: string;
  readonly workspaceSelectionGeneration: number;
}

export interface IssueExplorerRefreshHealthEvent {
  readonly eventType: "health";
  readonly health: RefreshHealth;
  readonly refreshRevision: number;
  readonly workspacePath: string;
  readonly workspaceSelectionGeneration: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isRefreshFailureKind = (value: unknown): value is RefreshFailureKind =>
  value === "refProbe" ||
  value === "loader" ||
  value === "missingGit" ||
  value === "missingBw" ||
  value === "notBeadworkWorkspace";

const isRefreshFailure = (value: unknown): value is RefreshFailure => {
  if (!isObject(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isRefreshFailureKind(candidate.errorKind) &&
    typeof candidate.message === "string" &&
    typeof candidate.transient === "boolean" &&
    typeof candidate.failureRevision === "number"
  );
};

const isRefreshFailureOrNull = (
  value: unknown
): value is RefreshFailure | null => {
  if (value === null) {
    return true;
  }
  return isRefreshFailure(value);
};

export const isRefreshHealth = (value: unknown): value is RefreshHealth => {
  if (!isObject(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isRefreshFailureOrNull(candidate.refProbe) &&
    isRefreshFailureOrNull(candidate.loader)
  );
};

/**
 * Discriminant guard. Returns true when the payload is a
 * `IssueExplorerRefreshEvent` (any variant). False otherwise.
 *
 * The guard validates the variant-specific required fields so a
 * partially-malformed envelope does not poison the renderer state.
 */
export const isIssueExplorerRefreshEvent = (
  payload: unknown
): payload is IssueExplorerRefreshEvent => {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.eventType !== "string") {
    return false;
  }
  if (
    typeof candidate.workspacePath !== "string" ||
    typeof candidate.workspaceSelectionGeneration !== "number" ||
    typeof candidate.refreshRevision !== "number"
  ) {
    return false;
  }
  if (candidate.eventType === "snapshot") {
    return (
      isObject(candidate.issueData) &&
      typeof candidate.observedRefSha === "string"
    );
  }
  if (candidate.eventType === "health") {
    return isRefreshHealth(candidate.health);
  }
  return false;
};

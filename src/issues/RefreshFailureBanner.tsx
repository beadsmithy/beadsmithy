/**
 * Non-disruptive banner that surfaces refresh failures above the Issue
 * Explorer list.
 *
 * The banner is rendered when the backend reports at least one refresh
 * failure slot (ref-probe or loader) for the active Workspace. The
 * banner copy is selected by the [`RefreshFailureKind`] of the active
 * failure slot:
 *
 * - `missingGit`: tells the user Beadsmith needs `git` on PATH to
 *   detect Beadwork changes.
 * - `missingBw`: tells the user Beadsmith needs `bw` on PATH to read
 *   Beadwork data.
 * - `notBeadworkWorkspace`: tells the user the Workspace is no longer
 *   a Beadwork Workspace and to choose a valid one.
 * - `refProbe`: transient ref-probe failures (banner appears at strike 5).
 * - `loader`: transient loader failures (banner appears at strike 5).
 *
 * The banner does NOT replace the Issue List; the last successful
 * snapshot remains rendered below it. Search, sidebar counts, view
 * switching, and Issue Detail remain functional.
 */
import type { ReactElement } from "react";

import { AlertTriangle } from "lucide-react";

import type {
  RefreshFailure,
  RefreshFailureKind,
} from "../refresh-health";

interface RefreshFailureBannerProps {
  /**
   * The refresh failure to display. `null` hides the banner.
   * Callers should pre-select which slot to show when both are active
   * (structural before transient; within the same category, the
   * highest `failureRevision`).
   */
  readonly failure: RefreshFailure | null;
}

/**
 * Canonical copy for each banner copy. Kept in one place so backend
 * and frontend stay aligned with the implementation plan.
 */
const BANNER_COPY: Record<RefreshFailureKind, string> = {
  loader: "Automatic refresh is failing while reading Beadwork. Retrying…",
  missingBw:
    "Automatic refresh needs bw on PATH to read Beadwork data. Install Beadwork and restart Beadsmith.",
  missingGit:
    "Automatic refresh needs git on PATH to detect Beadwork changes. Install git and restart Beadsmith.",
  notBeadworkWorkspace:
    "This Workspace is no longer a Beadwork Workspace. Choose a valid Beadwork Workspace.",
  refProbe:
    "Automatic refresh is failing while checking Beadwork changes. Retrying…",
};

/**
 * Pick the highest-priority banner from a complete `RefreshHealth`.
 *
 * Priority:
 * 1. structural before transient;
 * 2. within the same category, highest `failureRevision`.
 */
export const selectBannerFailure = (
  health: { readonly refProbe: RefreshFailure | null; readonly loader: RefreshFailure | null }
): RefreshFailure | null => {
  const candidates: RefreshFailure[] = [];
  if (health.refProbe !== null) {
    candidates.push(health.refProbe);
  }
  if (health.loader !== null) {
    candidates.push(health.loader);
  }
  if (candidates.length === 0) {
    return null;
  }
  const structural = candidates.filter((failure) => !failure.transient);
  const pool = structural.length > 0 ? structural : candidates;
  let selected = pool[0];
  for (const candidate of pool.slice(1)) {
    if (candidate.failureRevision > selected.failureRevision) {
      selected = candidate;
    }
  }
  return selected;
};

export const RefreshFailureBanner = ({
  failure,
}: RefreshFailureBannerProps): ReactElement | null => {
  if (failure === null) {
    return null;
  }
  return (
    <div
      aria-live="polite"
      className="flex items-start gap-3 border-b border-border-main bg-danger/10 p-3"
      data-testid="refresh-failure-banner"
      role="alert"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="flex min-w-0 flex-col">
        <p className="text-sm font-medium text-red-200">
          {BANNER_COPY[failure.errorKind]}
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted">
          {failure.errorKind} (failureRevision {failure.failureRevision})
        </p>
      </div>
    </div>
  );
};

/**
 * Shared flow for the refresh-trigger desktop scenarios (bsm-wj1.4):
 * `issue-list.time-refresh.spec.ts` (time trigger) and
 * `issue-list.focus-refresh.spec.ts` (native focus trigger). Both
 * scenarios select the same single-baseline fixture, create a deferred
 * Issue after launch, wait for the ref poll to publish the deferred
 * snapshot, then let exactly one trigger (the shortened minute timer or
 * a native focus gain) move the Issue into Ready after its boundary.
 *
 * The shared causal assertions live here so each spec only owns the
 * trigger act itself and its oracle comments.
 */
import { browser, expect } from "@wdio/globals";

import {
  FIXTURE_TIME_BASELINE_TITLE,
  FIXTURE_TIME_DEFERRED_TITLE,
  createPostLaunchDeferredIssue,
} from "../fixtures/workspace.ts";
import {
  expectIssueNotVisible,
  expectIssueVisible,
  invokeTypedWorkspaceSwitch,
} from "./rpc.ts";
import {
  expectCurrentWorkspace,
  expectSidebarCount,
  selectIssueListView,
} from "./sidebar.ts";

/** Defer boundary far enough out that the ref poll publishes the
 * deferred snapshot before it passes, near enough to keep the scenario
 * inside the mocha timeout. */
const DEFER_BOUNDARY_LEAD_MS = 10_000;

const REFRESH_FAILURE_BANNER_SELECTOR =
  '[data-testid="refresh-failure-banner"]';

/** The RFC3339 `defer_until` boundary chosen when the deferred Issue
 * was created, in epoch milliseconds. Only one refresh-trigger spec
 * runs per WDIO session, so the module-level holder cannot leak across
 * scenarios. */
let deferBoundaryEpochMs: number | undefined;

/** Assert no refresh-failure banner rendered at any point. */
export const expectNoRefreshFailureBanner = async (): Promise<void> => {
  const banner = await browser.$(REFRESH_FAILURE_BANNER_SELECTOR);
  await browser.waitUntil(async () => !(await banner.isExisting()), {
    timeout: 30_000,
    timeoutMsg:
      "Expected no refresh-failure banner during refresh trigger proof",
  });
};

/**
 * Shared first test: select the disposable workspace through the typed
 * RPC and render the stable baseline issue.
 */
export const selectRefreshTriggerBaselineWorkspace = async (
  fixtureA: string
): Promise<void> => {
  const initialState = await invokeTypedWorkspaceSwitch(fixtureA);
  if ("failure" in initialState) {
    throw new Error(initialState.failure);
  }
  expect(initialState.issueData.allIssues).toHaveLength(1);
  expect(initialState.issueData.readyIssues).toHaveLength(1);

  // The direct typed transport changes backend state; reload so the
  // real frontend performs its normal startup state read before DOM
  // assertions.
  await browser.refresh();

  await expectCurrentWorkspace(fixtureA);
  await expectSidebarCount("All", "1 issue");
  await expectSidebarCount("Ready", "1 issue");
  await selectIssueListView("Ready", "ready");
  await expectIssueVisible(FIXTURE_TIME_BASELINE_TITLE);
};

/**
 * Shared second test: create the dedicated deferred Issue with a
 * near-future boundary after launch and wait for the normal ref poll
 * to publish the snapshot in which it is still deferred/not Ready.
 * Proving this intermediate state first makes the final Ready
 * transition attributable to the scenario's trigger alone.
 */
export const publishPostLaunchDeferredSnapshot = async (
  fixtureA: string
): Promise<void> => {
  // Set the boundary after launch so the startup snapshot cannot
  // satisfy the later Ready assertion.
  const deferBoundary = Date.now() + DEFER_BOUNDARY_LEAD_MS;
  deferBoundaryEpochMs = deferBoundary;
  const deferUntil = new Date(deferBoundary).toISOString();
  const deferred = createPostLaunchDeferredIssue(fixtureA, deferUntil);
  console.log(
    `[e2e:spec] created deferred issue ${deferred.id} with boundary ${deferred.deferUntil}`
  );

  await expectSidebarCount("All", "2 issues");
  await expectSidebarCount("Ready", "1 issue");
  await expectSidebarCount("Deferred", "1 issue");

  await selectIssueListView("Ready", "ready");
  await expectIssueVisible(FIXTURE_TIME_BASELINE_TITLE);
  await expectIssueNotVisible(FIXTURE_TIME_DEFERRED_TITLE);

  await selectIssueListView("Deferred", "deferred");
  await expectIssueVisible(FIXTURE_TIME_DEFERRED_TITLE);
};

/** Wait until the established defer boundary has passed. */
export const waitForDeferBoundaryToPass = async (): Promise<void> => {
  if (deferBoundaryEpochMs === undefined) {
    throw new Error("Defer boundary was never established");
  }
  const boundary = deferBoundaryEpochMs;
  console.log(
    `[e2e:spec] waiting for the defer boundary to pass at ${new Date(boundary).toISOString()}`
  );
  await browser.waitUntil(() => Date.now() > boundary, {
    interval: 250,
    timeout: 30_000,
    timeoutMsg: "Defer boundary never passed",
  });
};

/**
 * Shared final assertions after the scenario's trigger fired: the
 * deferred Issue entered Ready without a ref move, the stable baseline
 * never blanked, and no refresh-failure banner appeared. The Issue's
 * status stays `deferred` (only `bw undefer` changes it); the
 * time-derived change is Ready membership alone.
 */
export const expectDeferredIssueReadyAfterTrigger = async (): Promise<void> => {
  await expectSidebarCount("Ready", "2 issues");
  await expectSidebarCount("Deferred", "1 issue");

  await selectIssueListView("Ready", "ready");
  await expectIssueVisible(FIXTURE_TIME_DEFERRED_TITLE);
  // The stable baseline proves the list never blanked during the
  // silent in-place refresh.
  await expectIssueVisible(FIXTURE_TIME_BASELINE_TITLE);

  await selectIssueListView("Deferred", "deferred");
  await expectIssueVisible(FIXTURE_TIME_DEFERRED_TITLE);

  await expectNoRefreshFailureBanner();
};

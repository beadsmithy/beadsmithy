/**
 * Time-trigger refresh proof (bsm-wj1.4): launches the real Beadsmith
 * debug binary with the debug-only shortened time-refresh cadence
 * (`BEADSMITH_REFRESH_TIME_INTERVAL_MS=3000`, wired by
 * `e2e/issue-list/scripts/run-scenario.ts`) and proves that a deferred
 * Issue enters Ready when its `defer_until` boundary passes WITHOUT a
 * Beadwork ref move.
 *
 * Causal oracle: after the post-mutation snapshot lands, the spec runs
 * no further `bw` commands, so `refs/heads/beadwork` cannot move. The
 * 2-second ref probe keeps observing the unchanged SHA and cannot start
 * a load; only the forced time trigger runs the loader that moves the
 * Issue into Ready. Beadsmith never calculates Ready membership
 * locally.
 */
import {
  expectDeferredIssueReadyAfterTrigger,
  publishPostLaunchDeferredSnapshot,
  selectRefreshTriggerBaselineWorkspace,
  waitForDeferBoundaryToPass,
} from "./helpers/refresh-trigger.ts";
import { parseHarnessEnvironment } from "./scripts/harness-inputs.ts";

const { fixtureA } = parseHarnessEnvironment(process.env);

describe("Issue explorer (WebDriver e2e): time-trigger refresh moves a deferred Issue into Ready without a ref move", () => {
  it("selects the disposable workspace and renders the stable baseline issue", async () => {
    await selectRefreshTriggerBaselineWorkspace(fixtureA);
  });

  it("publishes the post-launch deferred Issue as not Ready through the ref poll", async () => {
    await publishPostLaunchDeferredSnapshot(fixtureA);
  });

  it("moves the deferred Issue into Ready through the time trigger after the boundary passes", async () => {
    // No further `bw` mutations from here on: the ref cannot move, so
    // only the forced 3-second time trigger can refresh the snapshot.
    await waitForDeferBoundaryToPass();

    await expectDeferredIssueReadyAfterTrigger();
  });
});

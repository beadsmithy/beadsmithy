/**
 * Focus-trigger refresh proof (bsm-wj1.4): launches the real Beadsmith
 * debug binary with the debug time cadence pushed an hour out
 * (`BEADSMITH_REFRESH_TIME_INTERVAL_MS=3600000`, wired by
 * `e2e/issue-list/scripts/run-scenario.ts`) and proves that a native
 * window focus gain refreshes the Current Workspace: a deferred Issue
 * enters Ready after its `defer_until` boundary passes WITHOUT a
 * Beadwork ref move and without the time trigger.
 *
 * Causal oracle: after the post-mutation snapshot lands, the spec runs
 * no further `bw` commands, so `refs/heads/beadwork` cannot move; the
 * 2-second ref probe keeps observing the unchanged SHA; the minute
 * timer is an hour out. Only the native `WindowEvent::Focused(true)`
 * -> forced-refresh path can run the loader that moves the Issue into
 * Ready.
 *
 * Native focus is driven through real OS activation: AppleScript moves
 * the frontmost application away from Beadsmith and back, which
 * delivers genuine `WindowEvent::Focused(false)` /
 * `WindowEvent::Focused(true)` pairs to the running binary. The spec
 * skips cleanly on non-macOS hosts.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { browser, expect } from "@wdio/globals";

import {
  FIXTURE_TIME_BASELINE_TITLE,
  FIXTURE_TIME_DEFERRED_TITLE,
  createPostLaunchDeferredIssue,
} from "./fixtures/workspace.ts";
import {
  expectIssueNotVisible,
  expectIssueVisible,
  invokeTypedWorkspaceSwitch,
} from "./helpers/rpc.ts";
import {
  expectCurrentWorkspace,
  expectSidebarCount,
  selectIssueListView,
} from "./helpers/sidebar.ts";
import { parseHarnessEnvironment } from "./scripts/harness-inputs.ts";

const execFileAsync = promisify(execFile);

const { fixtureA } = parseHarnessEnvironment(process.env);

/** Defer boundary far enough out that the ref poll publishes the
 * deferred snapshot before it passes, near enough to keep the scenario
 * inside the mocha timeout. */
const DEFER_BOUNDARY_LEAD_MS = 10_000;

/** The RFC3339 `defer_until` boundary chosen in the mutation test, in
 * epoch milliseconds. */
let deferBoundaryEpochMs: number | undefined;

const REFRESH_FAILURE_BANNER_SELECTOR =
  '[data-testid="refresh-failure-banner"]';

const expectNoRefreshFailureBanner = async (): Promise<void> => {
  const banner = await browser.$(REFRESH_FAILURE_BANNER_SELECTOR);
  await browser.waitUntil(async () => !(await banner.isExisting()), {
    timeout: 30_000,
    timeoutMsg: "Expected no refresh-failure banner during focus refresh",
  });
};

const runOsascript = (script: string): Promise<string> =>
  execFileAsync("osascript", ["-e", script]).then(({ stdout }) =>
    stdout.trim()
  );

/**
 * Move the OS frontmost application away from Beadsmith, delivering a
 * native `WindowEvent::Focused(false)` to the running binary. Finder is
 * always present on macOS.
 */
const defocusBeadsmithWindow = async (): Promise<void> => {
  console.log("[e2e:spec] moving OS focus away from Beadsmith (Finder)");
  await runOsascript('tell application "Finder" to activate');
};

/**
 * Return OS focus to the Beadsmith window, delivering a native
 * `WindowEvent::Focused(true)`. The debug binary runs as a bare
 * executable, so activation goes through System Events by process name.
 */
const focusBeadsmithWindow = async (): Promise<void> => {
  console.log("[e2e:spec] returning OS focus to the Beadsmith window");
  await runOsascript(
    'tell application "System Events" to set frontmost of the first process whose name is "beadsmith" to true'
  );
};

describe("Issue explorer (WebDriver e2e): focus-gain refresh moves a deferred Issue into Ready without a ref move", () => {
  before(function skipOnNonMacOS() {
    if (process.platform !== "darwin") {
      console.log(
        "[e2e:spec] focus-refresh scenario drives native focus through AppleScript; skipping on non-macOS host"
      );
      this.skip();
    }
  });

  it("selects the disposable workspace and renders the stable baseline issue", async () => {
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
  });

  it("publishes the post-launch deferred Issue as not Ready through the ref poll", async () => {
    // Set the boundary after launch so the startup snapshot cannot
    // satisfy the later Ready assertion.
    const deferBoundary = Date.now() + DEFER_BOUNDARY_LEAD_MS;
    deferBoundaryEpochMs = deferBoundary;
    const deferUntil = new Date(deferBoundary).toISOString();
    const deferred = createPostLaunchDeferredIssue(fixtureA, deferUntil);
    console.log(
      `[e2e:spec] created deferred issue ${deferred.id} with boundary ${deferred.deferUntil}`
    );

    // The 2-second ref poll observes the mutation and publishes the
    // snapshot in which the Issue is still deferred (boundary in the
    // future). Proving this intermediate state first makes the final
    // Ready transition attributable to the focus trigger alone.
    await expectSidebarCount("All", "2 issues");
    await expectSidebarCount("Ready", "1 issue");
    await expectSidebarCount("Deferred", "1 issue");

    await selectIssueListView("Ready", "ready");
    await expectIssueVisible(FIXTURE_TIME_BASELINE_TITLE);
    await expectIssueNotVisible(FIXTURE_TIME_DEFERRED_TITLE);

    await selectIssueListView("Deferred", "deferred");
    await expectIssueVisible(FIXTURE_TIME_DEFERRED_TITLE);
  });

  it("moves the deferred Issue into Ready through native focus gain after the boundary passes", async () => {
    // No further `bw` mutations from here on: the ref cannot move, the
    // minute timer is an hour out, so only a native focus gain can
    // refresh the snapshot.
    if (deferBoundaryEpochMs === undefined) {
      throw new Error("Defer boundary was never established");
    }
    const boundary = deferBoundaryEpochMs;

    // Blur first: the refresh trigger must react to focus GAIN, and a
    // genuine defocus/refocus pair is the real user path.
    await defocusBeadsmithWindow();

    console.log(
      `[e2e:spec] waiting for the defer boundary to pass at ${new Date(boundary).toISOString()}`
    );
    await browser.waitUntil(() => Date.now() > boundary, {
      interval: 250,
      timeout: 30_000,
      timeoutMsg: "Defer boundary never passed",
    });

    // Still not Ready after the boundary: nothing has refreshed the
    // snapshot yet (ref unchanged, timer an hour out, window blurred).
    await expectSidebarCount("Ready", "1 issue");

    await focusBeadsmithWindow();

    await expectSidebarCount("Ready", "2 issues");
    // The Issue's status stays `deferred`; the time-derived change is
    // Ready membership alone.
    await expectSidebarCount("Deferred", "1 issue");

    await selectIssueListView("Ready", "ready");
    await expectIssueVisible(FIXTURE_TIME_DEFERRED_TITLE);
    // The stable baseline proves the list never blanked during the
    // silent in-place refresh.
    await expectIssueVisible(FIXTURE_TIME_BASELINE_TITLE);

    await expectNoRefreshFailureBanner();
  });
});

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

import {
  expectDeferredIssueReadyAfterTrigger,
  publishPostLaunchDeferredSnapshot,
  selectRefreshTriggerBaselineWorkspace,
  waitForDeferBoundaryToPass,
} from "./helpers/refresh-trigger.ts";
import { expectSidebarCount } from "./helpers/sidebar.ts";
import { parseHarnessEnvironment } from "./scripts/harness-inputs.ts";

const execFileAsync = promisify(execFile);

const { fixtureA } = parseHarnessEnvironment(process.env);

// Activation AppleScripts normally finish in well under a second; ten
// seconds only fires on a genuinely stalled OS automation call.
const OSASCRIPT_TIMEOUT_MS = 10_000;

const runOsascript = async (script: string): Promise<string> => {
  // A stalled AppleScript (e.g. an unresponsive System Events or a
  // pending Automation permission prompt) must not hang the awaited
  // retry loops forever: bound every call and force-kill on timeout.
  const { stdout } = await execFileAsync("osascript", ["-e", script], {
    killSignal: "SIGKILL",
    timeout: OSASCRIPT_TIMEOUT_MS,
  });
  return stdout.trim();
};

const sleep = (milliseconds: number): Promise<void> =>
  // eslint-disable-next-line promise/avoid-new
  // oxlint-disable-next-line promise/avoid-new
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

// Back-to-back scenario runs can leave a dying beadsmith process from
// the previous launch behind for a few seconds; `whose name is
// "beadsmith"` would then target the zombie and the frontmost request
// would no-op. Every activation script therefore filters to beadsmith
// processes that still own at least one window — the zombie owns none.

/** True when the OS reports a window-owning beadsmith process as frontmost. */
const isBeadsmithFrontmost = async (): Promise<boolean> =>
  (await runOsascript(
    [
      'tell application "System Events"',
      'repeat with p in (every process whose name is "beadsmith")',
      'if frontmost of p and (count of windows of p) > 0 then return "true"',
      "end repeat",
      'return "false"',
      "end tell",
    ].join("\n")
  )) === "true";

const MAX_FOCUS_ATTEMPTS = 10;
const FOCUS_ATTEMPTS = Array.from(
  { length: MAX_FOCUS_ATTEMPTS },
  (_, index) => index + 1
);

/**
 * Move the OS frontmost application away from Beadsmith, delivering a
 * native `WindowEvent::Focused(false)` to the running binary. Finder is
 * always present on macOS. OS activation from a background terminal is
 * racy, so the blur is verified and retried before the scenario
 * proceeds.
 */
const defocusBeadsmithWindow = async (): Promise<void> => {
  console.log("[e2e:spec] moving OS focus away from Beadsmith (Finder)");
  // Retries must run sequentially, so the loop awaits each step.
  for (const attempt of FOCUS_ATTEMPTS) {
    // oxlint-disable-next-line no-await-in-loop
    await runOsascript('tell application "Finder" to activate');
    // oxlint-disable-next-line no-await-in-loop
    await sleep(500);
    // oxlint-disable-next-line no-await-in-loop
    if (!(await isBeadsmithFrontmost())) {
      return;
    }
    console.log(`[e2e:spec] blur attempt ${attempt} did not take; retrying`);
  }
  throw new Error("Could not move OS focus away from the Beadsmith window");
};

/**
 * Return OS focus to the Beadsmith window, delivering a native
 * `WindowEvent::Focused(true)`. The debug binary runs as a bare
 * executable, so activation goes through System Events by process name.
 * OS activation from a background terminal is racy (an earlier spike
 * showed the frontmost request occasionally not taking effect), so the
 * refocus is verified and retried, raising the window explicitly.
 */
const focusBeadsmithWindow = async (): Promise<void> => {
  console.log("[e2e:spec] returning OS focus to the Beadsmith window");
  // Retries must run sequentially, so the loop awaits each step.
  for (const attempt of FOCUS_ATTEMPTS) {
    // oxlint-disable-next-line no-await-in-loop
    await runOsascript(
      [
        'tell application "System Events"',
        'repeat with p in (every process whose name is "beadsmith")',
        "if (count of windows of p) > 0 then set frontmost of p to true",
        "end repeat",
        "end tell",
      ].join("\n")
    );
    // oxlint-disable-next-line no-await-in-loop
    await runOsascript(
      [
        'tell application "System Events"',
        'repeat with p in (every process whose name is "beadsmith")',
        'if (count of windows of p) > 0 then perform action "AXRaise" of window 1 of p',
        "end repeat",
        "end tell",
      ].join("\n")
    ).catch(() => {
      // AXRaise is best-effort; frontmost alone is sufficient when the
      // window is already visible.
    });
    // oxlint-disable-next-line no-await-in-loop
    await sleep(500);
    // oxlint-disable-next-line no-await-in-loop
    if (await isBeadsmithFrontmost()) {
      return;
    }
    console.log(`[e2e:spec] refocus attempt ${attempt} did not take; retrying`);
  }
  throw new Error("Could not return OS focus to the Beadsmith window");
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
    await selectRefreshTriggerBaselineWorkspace(fixtureA);
  });

  it("publishes the post-launch deferred Issue as not Ready through the ref poll", async () => {
    await publishPostLaunchDeferredSnapshot(fixtureA);
  });

  it("moves the deferred Issue into Ready through native focus gain after the boundary passes", async () => {
    // No further `bw` mutations from here on: the ref cannot move, the
    // minute timer is an hour out, so only a native focus gain can
    // refresh the snapshot.

    // Blur first: the refresh trigger must react to focus GAIN, and a
    // genuine defocus/refocus pair is the real user path.
    await defocusBeadsmithWindow();

    await waitForDeferBoundaryToPass();

    // Still not Ready after the boundary: nothing has refreshed the
    // snapshot yet (ref unchanged, timer an hour out, window blurred).
    await expectSidebarCount("Ready", "1 issue");

    await focusBeadsmithWindow();

    await expectDeferredIssueReadyAfterTrigger();
  });
});

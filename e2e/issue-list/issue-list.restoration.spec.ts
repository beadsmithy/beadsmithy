/**
 * Real-desktop coverage for the workspace-restoration acceptance gate
 * (bsm-kia.5). Two sequential binary launches share a single
 * scenario-owned store; the harness scripts/run-scenario.ts owns the
 * fixture lifecycle and store path, and runs each phase as its own
 * `wdio run` invocation so each launch is a real binary restart.
 *
 * Phase 1: prove empty startup, select Workspace A through the typed
 *   `TauRPC__switch_workspace`, and assert the rendered state. The desktop
 *   binary persists the successful switch into the scenario-owned store.
 *
 * Phase 2: the harness launches a NEW real Beadsmith debug binary against
 *   the same scenario-owned store. This spec must prove the second binary
 *   restored Workspace A from persistence alone — the spec issues no
 *   `switch_workspace` and reads only what the renderer shows.
 *
 * Renderer refresh is not allowed as lifecycle proof: restoration
 * acceptance belongs exclusively to this two-binary scenario.
 */
import path from "node:path";

import { browser, expect } from "@wdio/globals";

import {
  FIXTURE_BLOCKER_TITLE,
  FIXTURE_DESCRIPTION_INLINE_CODE,
  FIXTURE_ISSUE_TITLE,
  FIXTURE_READY_TITLE,
} from "./fixtures/workspace.ts";
import {
  expectIssueVisible,
  invokeTypedWorkspaceSwitch,
  invokeWorkspaceState,
} from "./helpers/rpc.ts";
import { expectCurrentWorkspace } from "./helpers/sidebar.ts";
import { parseHarnessEnvironment } from "./scripts/harness-inputs.ts";

const harnessInputs = parseHarnessEnvironment(process.env);
if (harnessInputs.scenario !== "restoration") {
  throw new Error("Restoration spec requires the restoration scenario");
}

const expectSidebarWorkspaceAbsent = async () => {
  // The sidebar's committed-basename element only renders when there is a
  // committed Current Workspace. Empty startup must keep only the chooser.
  const basename = await browser.$("[aria-label='Workspace'] p.truncate");
  await basename.waitForExist({
    reverse: true,
    timeout: 30_000,
    timeoutMsg:
      "Expected no committed Current Workspace basename on the sidebar at startup",
  });
  const chooserText = await browser.$(
    "//section[@aria-label='Workspace']//p[contains(., 'No workspace selected')]"
  );
  await chooserText.waitForExist({
    timeout: 30_000,
    timeoutMsg: "Expected the empty chooser text on the sidebar at startup",
  });
};

const phaseTag = (() => {
  const phase = process.env.BEADSMITH_E2E_PHASE ?? "1";
  if (phase !== "2") {
    return "phase 1: select A through the typed switch";
  }
  return "phase 2: restore A from the scenario-owned store";
})();

describe(`Workspace restoration (WebDriver e2e) [${phaseTag}]`, () => {
  let workspaceA: string;
  before(() => {
    workspaceA = harnessInputs.fixtureA;
  });

  it("phase 1 starts with no Current Workspace; phase 2 has already restored A from the scenario-owned store on startup", async () => {
    const phase = process.env.BEADSMITH_E2E_PHASE ?? "1";
    const initialState = await invokeWorkspaceState();
    if (phase === "1") {
      // Phase 1 is a first-launch against an empty store; the binary must
      // surface an empty chooser until the spec issues `switch_workspace`.
      expect(initialState.currentWorkspace).toBeNull();
      await expectSidebarWorkspaceAbsent();
      return;
    }
    // Phase 2 is a fresh binary launch against the same scenario-owned
    // store. By the time `workspace_state` is callable, the binary has
    // already restored A from the persisted state through the normal
    // startup load path. This proves the second binary restored the
    // workspace without any seed selection RPC.
    expect(initialState.currentWorkspace).not.toBeNull();
    expect(initialState.currentWorkspace?.path).toContain(
      path.basename(workspaceA)
    );
  });

  it("phase 1 commits A through the typed switch; phase 2 reads A from the persisted store alone", async () => {
    const phase = process.env.BEADSMITH_E2E_PHASE ?? "1";

    if (phase === "1") {
      const result = await invokeTypedWorkspaceSwitch(workspaceA);
      if ("failure" in result) {
        throw new Error(result.failure);
      }
      expect(
        result.issueData.allIssues.some(
          (issue) => issue.title === FIXTURE_ISSUE_TITLE
        )
      ).toBe(true);
      expect(
        result.issueData.readyIssues.some(
          (issue) => issue.title === FIXTURE_READY_TITLE
        )
      ).toBe(true);
      expect(
        result.issueData.blockedIssues.some(
          (issue) => issue.title === FIXTURE_BLOCKER_TITLE
        )
      ).toBe(true);
      expect(result.issueData.workspacePath).toContain(
        path.basename(workspaceA)
      );
      return;
    }
    // Phase 2: no `switch_workspace`; the renderer should already render
    // Workspace A's committed Issue Explorer snapshot.
    await expectCurrentWorkspace(workspaceA);
    await expectIssueVisible(FIXTURE_ISSUE_TITLE);
    await expectIssueVisible(FIXTURE_READY_TITLE);
    await expectIssueVisible(FIXTURE_BLOCKER_TITLE);
  });

  it("phase 2 restores the persisted Workspace detail content for the current Issue", async () => {
    const phase = process.env.BEADSMITH_E2E_PHASE ?? "1";
    if (phase === "1") {
      // Phase 1 ends with the typed switch; detail rendering is exercised
      // by the issues scenario.
      return;
    }
    // Phase 2 should render the same Issue Detail content from the
    // persisted snapshot alone. Search for the Issue by title and confirm
    // the rendered description contains the inline-code token captured in
    // the fixture.
    const issueRow = await expectIssueVisible(FIXTURE_ISSUE_TITLE);
    const issueButton = await issueRow.$("button[data-issue-id]");
    await issueButton.click();

    const detail = await browser.$('main[aria-label="Issue detail"]');
    await browser.waitUntil(
      async () => {
        const text = await detail.getText();
        return (
          text.includes(FIXTURE_ISSUE_TITLE) &&
          text.includes(FIXTURE_DESCRIPTION_INLINE_CODE)
        );
      },
      {
        timeout: 30_000,
        timeoutMsg:
          "Expected Issue Detail to render from the persisted scenario-owned store on phase 2",
      }
    );
  });
});

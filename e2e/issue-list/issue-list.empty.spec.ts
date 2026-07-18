/**
 * Empty-state coverage starts with no Current Workspace, then uses the same
 * typed switch transport as the product to select a real zero-issue fixture.
 */
import { browser, expect } from "@wdio/globals";

import { invokeTypedWorkspaceSwitch } from "./helpers/rpc.ts";

describe("Issue List (WebDriver e2e): workspace with zero Beadwork issues", () => {
  it("renders the empty state instead of a failure or stale loading state", async () => {
    const workspaceB = process.env.BEADSMITH_E2E_WORKSPACE_B;
    if (!workspaceB) {
      throw new Error("BEADSMITH_E2E_WORKSPACE_B is not set");
    }
    const result = await invokeTypedWorkspaceSwitch(workspaceB);
    if ("failure" in result) {
      throw new Error(result.failure);
    }
    await browser.refresh();

    console.log("[e2e:spec] waiting for the empty-issue-list state to render");
    const emptyState = await browser.$("h2=No issues found");
    await emptyState.waitForExist({ timeout: 120_000 });
    await expect(emptyState).toBeDisplayed();

    const failureAlert = await browser.$('[role="alert"]');
    expect(await failureAlert.isExisting()).toBe(false);

    const issueList = await browser.$('[aria-label="Issues"]');
    expect(await issueList.isExisting()).toBe(false);
  });
});

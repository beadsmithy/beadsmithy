/**
 * Empty-state coverage starts with no Current Workspace, then uses the same
 * typed switch transport as the product to select a real zero-issue fixture.
 */
import { browser, expect } from "@wdio/globals";

import {
  invokeTypedWorkspaceSwitch,
  invokeWorkspaceState,
} from "./helpers/rpc.ts";
import { parseHarnessEnvironment } from "./scripts/harness-inputs.ts";

const { fixtureB } = parseHarnessEnvironment(process.env);

const expectSidebarWorkspaceAbsent = async (): Promise<void> => {
  // The committed-basename element on the sidebar only renders when there
  // is a Current Workspace. Empty startup must keep only the chooser
  // without that element.
  const committedBasename = await browser.$(
    "[aria-label='Workspace'] p.truncate"
  );
  await committedBasename.waitForExist({
    reverse: true,
    timeout: 30_000,
    timeoutMsg:
      "Expected no committed Current Workspace basename on the sidebar at startup",
  });
  // The chooser text must surface so the empty-startup invariant is
  // visible at the DOM level.
  const chooserText = await browser.$(
    "//section[@aria-label='Workspace']//p[contains(., 'No workspace selected')]"
  );
  await chooserText.waitForExist({
    timeout: 30_000,
    timeoutMsg: "Expected the empty chooser text on the sidebar at startup",
  });
};

describe("Issue List (WebDriver e2e): workspace with zero Beadwork issues", () => {
  it("starts empty and proves the selector is in the empty chooser state", async () => {
    const initial = await invokeWorkspaceState();
    expect(initial.currentWorkspace).toBeNull();
    await expectSidebarWorkspaceAbsent();
  });

  it("renders the empty state instead of a failure or stale loading state", async () => {
    const result = await invokeTypedWorkspaceSwitch(fixtureB);
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

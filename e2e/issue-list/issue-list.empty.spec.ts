/**
 * Empty-state coverage for the Issue List slice (bsm-mq4.5): launches the
 * real Beadsmith debug binary against a Beadwork workspace with zero issues
 * and asserts the true-empty state renders, distinct from loading/failure.
 */
import { browser, expect } from "@wdio/globals";

describe("Issue List (WebDriver e2e): workspace with zero Beadwork issues", () => {
  it("renders the empty state instead of a failure or stale loading state", async () => {
    console.log("[e2e:spec] waiting for the empty-issue-list state to render");
    const emptyState = await browser.$("p=No issues found");
    await emptyState.waitForExist({ timeout: 120_000 });
    await expect(emptyState).toBeDisplayed();

    const failureAlert = await browser.$('[role="alert"]');
    expect(await failureAlert.isExisting()).toBe(false);

    const issueList = await browser.$('[aria-label="Issues"]');
    expect(await issueList.isExisting()).toBe(false);
  });
});

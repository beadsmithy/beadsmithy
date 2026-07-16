/**
 * Proves the Issue explorer and selected Issue Detail end to end: launches
 * the real Beadsmith debug binary against a disposable Beadwork workspace
 * built via `bw` and asserts the issue explorer renders a real `Issue`
 * through the full Rust adapter -> TauRPC -> Effect -> React path.
 */
import path from "node:path";

import { browser, expect } from "@wdio/globals";

import {
  FIXTURE_BLOCKER_TITLE,
  FIXTURE_CLOSED_TITLE,
  FIXTURE_COMMENT_AUTHOR,
  FIXTURE_COMMENT_TEXT,
  FIXTURE_DEFERRED_TITLE,
  FIXTURE_DESCRIPTION_BULLET,
  FIXTURE_DESCRIPTION_HEADING,
  FIXTURE_DESCRIPTION_INLINE_CODE,
  FIXTURE_ISSUE_TITLE,
  FIXTURE_READY_SEARCH_QUERY,
  FIXTURE_READY_TITLE,
} from "./fixtures/workspace.ts";
import {
  expectIssueNotVisible,
  expectIssueVisible,
  invokeTypedWorkspaceSwitch,
  invokeWorkspaceMemoryRetry,
  invokeWorkspaceState,
} from "./helpers/rpc.ts";
import {
  expectCurrentWorkspace,
  expectSidebarCount,
  selectIssueListView,
} from "./helpers/sidebar.ts";
import { parseHarnessEnvironment } from "./scripts/harness-inputs.ts";

const { fixtureA, fixtureB } = parseHarnessEnvironment(process.env);

describe("Issue explorer (WebDriver e2e): workspace with selectable Issue List Views and Issue Detail", () => {
  it("starts empty and seeds the populated fixture through typed workspace switch", async () => {
    const initialState = await invokeWorkspaceState();
    expect(initialState.currentWorkspace).toBeNull();

    const result = await invokeTypedWorkspaceSwitch(fixtureA);
    if ("failure" in result) {
      throw new Error(result.failure);
    }

    const { issueData } = result;
    console.log(
      `[e2e:spec] typed workspace switch returned ${issueData.allIssues.length} issue(s)`
    );
    expect(
      issueData.allIssues.some((issue) => issue.title === FIXTURE_ISSUE_TITLE)
    ).toBe(true);
    expect(
      issueData.allIssues.some(
        (issue) =>
          issue.title === FIXTURE_CLOSED_TITLE && issue.status === "closed"
      )
    ).toBe(true);
    expect(
      issueData.allIssues.some(
        (issue) =>
          issue.title === FIXTURE_DEFERRED_TITLE && issue.status === "deferred"
      )
    ).toBe(true);
    expect(
      issueData.readyIssues.some((issue) => issue.title === FIXTURE_READY_TITLE)
    ).toBe(true);
    expect(
      issueData.blockedIssues.some(
        (issue) => issue.title === FIXTURE_ISSUE_TITLE
      )
    ).toBe(true);

    // The direct typed transport changes backend state; reload so the real
    // frontend performs its normal startup state read before DOM assertions.
    await browser.refresh();
  });

  it("renders sidebar counts, switches Issue List Views, and searches the active view", async () => {
    console.log("[e2e:spec] waiting for sidebar counts from combined load");
    await expectSidebarCount("All", "5 issues");
    await expectSidebarCount("Ready", "2 issues");
    await expectSidebarCount("Blocked", "1 issue");
    await expectSidebarCount("Closed", "1 issue");
    await expectSidebarCount("Deferred", "1 issue");

    await selectIssueListView("Ready", "ready");
    await expectIssueVisible(FIXTURE_READY_TITLE);
    await expectIssueVisible(FIXTURE_BLOCKER_TITLE);
    await expectIssueNotVisible(FIXTURE_ISSUE_TITLE);

    console.log(
      `[e2e:spec] searching active Ready view for ${FIXTURE_READY_SEARCH_QUERY}`
    );
    const searchInput = await browser.$("#issue-search");
    await searchInput.setValue(FIXTURE_READY_SEARCH_QUERY);
    await expect(searchInput).toHaveValue(FIXTURE_READY_SEARCH_QUERY);
    await expectIssueVisible(FIXTURE_READY_TITLE);
    await expectIssueNotVisible(FIXTURE_BLOCKER_TITLE);

    await selectIssueListView("Blocked", "blocked");
    await expect(searchInput).toHaveValue(FIXTURE_READY_SEARCH_QUERY);
    await expectIssueNotVisible(FIXTURE_READY_TITLE);
    await expectIssueNotVisible(FIXTURE_ISSUE_TITLE);
    const emptyState = await browser.$(
      '[data-empty-reason="search-filtered-empty"]'
    );
    await emptyState.waitForExist({
      timeout: 30_000,
      timeoutMsg:
        "Expected preserved search query to empty the Blocked Issue List View",
    });

    console.log("[e2e:spec] clearing search in Blocked view");
    await searchInput.clearValue();
    await expect(searchInput).toHaveValue("");
    const blockedIssueRow = await expectIssueVisible(FIXTURE_ISSUE_TITLE);
    await expectIssueNotVisible(FIXTURE_READY_TITLE);

    const blockedIssueButton = await blockedIssueRow.$("button[data-issue-id]");
    await blockedIssueButton.click();
    const detail = await browser.$('main[aria-label="Issue detail"]');
    await browser.waitUntil(
      async () => {
        const detailText = await detail.getText();
        return detailText.includes(FIXTURE_ISSUE_TITLE);
      },
      {
        timeout: 30_000,
        timeoutMsg:
          "Selected visible Issue did not render through Issue Detail after view/search interaction",
      }
    );

    await selectIssueListView("Closed", "closed");
    await expectIssueVisible(FIXTURE_CLOSED_TITLE);
    await expectIssueNotVisible(FIXTURE_ISSUE_TITLE);

    await selectIssueListView("Deferred", "deferred");
    await expectIssueVisible(FIXTURE_DEFERRED_TITLE);
    await expectIssueNotVisible(FIXTURE_CLOSED_TITLE);
  });

  it("renders the fixture issue with its label and blocking dependency", async () => {
    console.log(
      "[e2e:spec] waiting for the issue explorer to render the fixture issue"
    );
    await selectIssueListView("All", "all");
    const issueRow = await expectIssueVisible(FIXTURE_ISSUE_TITLE);

    const rowText = await issueRow.getText();
    console.log(`[e2e:spec] fixture issue row text: ${rowText}`);
    expect(rowText).toContain(FIXTURE_ISSUE_TITLE);
    expect(rowText).toContain("e2e-fixture");
    expect(rowText).toContain("blocked by 1");
  });

  it("selects the fixture issue and renders representative detail content", async () => {
    await selectIssueListView("All", "all");
    const issueRow = await expectIssueVisible(FIXTURE_ISSUE_TITLE);
    const blockerRow = await expectIssueVisible(FIXTURE_BLOCKER_TITLE);

    const issueButton = await issueRow.$("button[data-issue-id]");
    const blockerButton = await blockerRow.$("button[data-issue-id]");
    const selectedIssueId = await issueButton.getAttribute("data-issue-id");
    const blockerId = await blockerButton.getAttribute("data-issue-id");

    if (!selectedIssueId || !blockerId) {
      throw new Error(
        "Expected fixture rows to expose dynamic data-issue-id values"
      );
    }

    await issueButton.click();

    let detailText = "";
    await browser.waitUntil(
      async () => {
        const detail = await browser.$('main[aria-label="Issue detail"]');
        if (!(await detail.isDisplayed())) {
          return false;
        }

        detailText = await detail.getText();
        return (
          detailText.includes(FIXTURE_ISSUE_TITLE) &&
          detailText.includes(selectedIssueId)
        );
      },
      {
        timeout: 30_000,
        timeoutMsg:
          "Selected Issue Detail did not render the fixture title and ID",
      }
    );

    expect(detailText).toContain("Description");
    expect(detailText).toContain(FIXTURE_DESCRIPTION_HEADING);
    expect(detailText).toContain(FIXTURE_DESCRIPTION_BULLET);
    expect(detailText).toContain(FIXTURE_DESCRIPTION_INLINE_CODE);
    expect(detailText).toContain("Comments");
    expect(detailText).toContain(FIXTURE_COMMENT_AUTHOR);
    expect(detailText).toContain(FIXTURE_COMMENT_TEXT);
    expect(detailText).toContain("Dependencies");
    expect(detailText).toContain("Blocked by");
    expect(detailText).toContain(blockerId);
  });

  it("shows the selected Beadwork workspace path in the sidebar", async () => {
    console.log(`[e2e:spec] asserting sidebar reports workspace: ${fixtureA}`);

    await expectCurrentWorkspace(fixtureA);
  });

  it("switches to the second fixture and preserves it after an invalid typed switch", async () => {
    const switched = await invokeTypedWorkspaceSwitch(fixtureB);
    if ("failure" in switched) {
      throw new Error(switched.failure);
    }
    expect(switched.issueData.allIssues).toHaveLength(0);
    await browser.refresh();

    const invalid = await invokeTypedWorkspaceSwitch(
      "/definitely-not-a-workspace"
    );
    expect("failure" in invalid).toBe(true);
    // After a typed validation failure the renderer surfaces inline
    // selector feedback and does not regress the committed Current. The
    // renderer-level Retry banner is reserved for load / store-save
    // failures; the Recovery panel for storeReadFailed is exercised in
    // `App.test.tsx`.
    await expectCurrentWorkspace(fixtureB);
  });

  it("retry_workspace_memory typed RPC returns B's state and snapshot for post-refresh rendering", async () => {
    // Desktop-boundary check for `TauRPC__retry_workspace_memory`. The
    // call exercises the typed boundary directly so it never relies on a
    // renderer control or writes the store file from the spec. The
    // storage-failure-driven `App.retryWorkspaceMemory` button is
    // covered by `App.workspace-recovery.test.tsx`; this test only
    // proves the typed RPC returns a fresh state + matching snapshot
    // and that the post-refresh startup read renders B again.
    const restored = await invokeWorkspaceMemoryRetry();
    if ("failure" in restored) {
      throw new Error(restored.failure);
    }
    expect(restored.state.currentWorkspace?.path).toContain(
      path.basename(fixtureB)
    );
    expect(restored.issueData?.workspacePath).toContain(
      path.basename(fixtureB)
    );

    await browser.refresh();
    await expectCurrentWorkspace(fixtureB);
    const emptyState = await browser.$("h2=No issues found");
    await emptyState.waitForExist({ timeout: 30_000 });
  });
});

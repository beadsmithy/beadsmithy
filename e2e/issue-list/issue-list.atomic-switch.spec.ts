/**
 * Real-desktop coverage for the atomic workspace-switch path (bsm-kia.4).
 *
 * Drives two distinguishable disposable Beadwork repositories through the
 * built Beadsmith debug binary:
 *   - Workspace A: populated fixture from `createIssueListWorkspace()` with
 *     the original `FIXTURE_*` titles and unique search tokens.
 *   - Workspace B: populated fixture from `createSecondIssueListWorkspace()`
 *     with the `FIXTURE_SECOND_*` markers.
 *
 * The e2e binary is launched with `BEADSMITH_E2E_COMMAND_DELAY_MS` so the
 * typed switch to B holds long enough for the renderer to surface a
 * Pending workspace state. The spec then asserts:
 *   - A's Issue Explorer snapshot remains visible (and the previously
 *     selected Issue Detail + local Issue Search query are preserved)
 *     while B is Pending.
 *   - Cancel drops the Pending request, A remains Current, and B's snapshot
 *     is never published.
 *   - Re-selecting B commits: B's snapshot replaces A's, the prior Issue
 *     Detail selection is cleared (Issue Explorer remounts), and the local
 *     Issue Search input is empty.
 *   - A subsequent invalid typed switch preserves B as Current.
 *
 * Uses the typed `TauRPC__switch_workspace` / `TauRPC__cancel_workspace`
 * transport because the native macOS directory dialog is not a reliable
 * WebDriver surface; the picker wiring is covered by the frontend unit
 * suite.
 */
import { browser, expect } from "@wdio/globals";

import {
  FIXTURE_DESCRIPTION_INLINE_CODE,
  FIXTURE_ISSUE_TITLE,
  FIXTURE_SECOND_ISSUE_TITLE,
  FIXTURE_SECOND_SEARCH_QUERY,
} from "./fixtures/workspace.ts";
import {
  expectIssueNotVisible,
  expectIssueVisible,
  issueRowSelector,
  invokeTypedWorkspaceSwitch,
  invokeWorkspaceState,
  searchInputSelector,
  startTypedWorkspaceSwitch,
} from "./helpers/rpc.ts";
import {
  expectCurrentWorkspace,
  selectIssueListView,
  WORKSPACE_INLINE_ERROR_SELECTOR,
} from "./helpers/sidebar.ts";

describe("Atomic workspace switch (WebDriver e2e): two disposable Beadwork repositories", () => {
  let workspaceA: string;
  let workspaceB: string;

  before(() => {
    const a = process.env.BEADSMITH_E2E_WORKSPACE_A;
    const b = process.env.BEADSMITH_E2E_WORKSPACE_B_SECOND;
    if (!a) {
      throw new Error("BEADSMITH_E2E_WORKSPACE_A is not set");
    }
    if (!b) {
      throw new Error("BEADSMITH_E2E_WORKSPACE_B_SECOND is not set");
    }
    workspaceA = a;
    workspaceB = b;
  });

  it("starts empty and seeds the populated Workspace A through typed workspace switch", async () => {
    const initial = await invokeWorkspaceState();
    expect(initial.currentWorkspace).toBeNull();

    const result = await invokeTypedWorkspaceSwitch(workspaceA);
    if ("failure" in result) {
      throw new Error(result.failure);
    }
    expect(
      result.issueData.allIssues.some(
        (issue) => issue.title === FIXTURE_ISSUE_TITLE
      )
    ).toBe(true);

    await browser.refresh();
  });

  it("preserves A's snapshot and Issue Detail/search while B is Pending, and Cancel keeps A", async () => {
    // Pick A's fixture issue and capture its title in Issue Detail.
    await selectIssueListView("All", "all");
    const fixtureRow = await expectIssueVisible(FIXTURE_ISSUE_TITLE);
    const fixtureButton = await fixtureRow.$("button[data-issue-id]");
    await fixtureButton.click();

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
          "Expected Issue Detail to render the selected Workspace A Issue",
      }
    );

    // Search for text in the selected Issue itself, so the selected Detail
    // remains visible while we prove the query survives Pending and clears
    // only on a committed switch.
    const searchInput = await browser.$(searchInputSelector);
    await searchInput.waitForExist({ timeout: 30_000 });
    await searchInput.setValue(FIXTURE_DESCRIPTION_INLINE_CODE);
    await expect(searchInput).toHaveValue(FIXTURE_DESCRIPTION_INLINE_CODE);

    // Trigger the typed switch to Workspace B without awaiting its worker so
    // the scenario-owned bw/git wrappers keep the Pending window observable.
    // The renderer must keep A's snapshot/Detail/Search visible until a
    // durable B commit actually arrives.
    await startTypedWorkspaceSwitch(workspaceB);

    // The typed Pending event must reach the renderer before the commit. Assert
    // the actual renderer control rather than issuing another Tauri IPC call:
    // native IPC calls from one renderer are serialized by the WebView,
    // whereas this DOM read remains available during the delayed worker.
    const pendingLabel = await browser.$("[data-pending-path]");
    await pendingLabel.waitForExist({
      timeout: 30_000,
      timeoutMsg:
        "Expected renderer to publish a Pending workspace B with Workspace A still current",
    });
    expect(await pendingLabel.getAttribute("data-pending-path")).toBe(
      workspaceB
    );

    // While Pending: the renderer itself reports B as Loading, while A's Issue
    // Detail and search query remain rendered. Re-query after the workspace
    // transition render so WebKit does not hold a stale element reference.
    const pendingDetail = await browser.$('main[aria-label="Issue detail"]');
    expect(await pendingDetail.getText()).toContain(FIXTURE_ISSUE_TITLE);
    const pendingSearch = await browser.$(searchInputSelector);
    expect(await pendingSearch.getValue()).toBe(
      FIXTURE_DESCRIPTION_INLINE_CODE
    );
    await expectIssueVisible(FIXTURE_ISSUE_TITLE);
    await expectIssueNotVisible(FIXTURE_SECOND_ISSUE_TITLE);
    await expectCurrentWorkspace(workspaceA);

    // Cancel through the actual renderer control. This exercises the real
    // `cancel_workspace` path instead of only asserting backend state.
    const cancelButton = await browser.$(
      "[data-testid='cancel-workspace-switch']"
    );
    await cancelButton.click();
    await pendingLabel.waitForExist({ reverse: true, timeout: 30_000 });

    // After Cancel: A's snapshot, Issue Detail, and Issue Search must be
    // preserved — B never published, and the renderer must not regress.
    await expectCurrentWorkspace(workspaceA);
    await selectIssueListView("All", "all");
    await expectIssueVisible(FIXTURE_ISSUE_TITLE);
    await expectIssueNotVisible(FIXTURE_SECOND_ISSUE_TITLE);
    const detailAfterCancel = await browser.$(
      'main[aria-label="Issue detail"]'
    );
    await browser.waitUntil(
      async () => {
        const text = await detailAfterCancel.getText();
        return text.includes(FIXTURE_ISSUE_TITLE);
      },
      {
        timeout: 30_000,
        timeoutMsg:
          "Expected Issue Detail to still belong to Workspace A after Cancel",
      }
    );
    const searchAfterCancel = await browser.$(searchInputSelector);
    await expect(searchAfterCancel).toHaveValue(
      FIXTURE_DESCRIPTION_INLINE_CODE
    );
  });

  it("commits B, clears prior Issue Detail and search across switch", async () => {
    // Keep a non-default view selected before the successful switch. The
    // IssueExplorer remount clears workspace-scoped search/detail state,
    // but `activeIssueListViewId` belongs to App and must survive the
    // confirmed commit.
    await selectIssueListView("Blocked", "blocked");

    // Second attempt to switch to B; this time let it commit.
    const result = await invokeTypedWorkspaceSwitch(workspaceB);
    if ("failure" in result) {
      throw new Error(result.failure);
    }
    expect(
      result.issueData.allIssues.some(
        (issue) => issue.title === FIXTURE_SECOND_ISSUE_TITLE
      )
    ).toBe(true);

    // B is now Current. A's issue, Issue Detail, and search query must all
    // be gone — the prior Issue Explorer remount on `workspaceKey` must
    // have cleared A's selection and search.
    await expectCurrentWorkspace(workspaceB);
    const activeBlockedView = await browser.$(
      'section[data-active-issue-list-view-id="blocked"]'
    );
    await activeBlockedView.waitForExist({
      timeout: 30_000,
      timeoutMsg:
        "Expected the non-default Blocked Issue List View to survive the Workspace B remount",
    });
    await expect(activeBlockedView).toBeDisplayed();
    await expectIssueNotVisible(FIXTURE_ISSUE_TITLE);
    await expectIssueVisible(FIXTURE_SECOND_ISSUE_TITLE);

    const emptyDetail = await browser.$("h2=No issue selected");
    await emptyDetail.waitForExist({
      timeout: 30_000,
      timeoutMsg:
        "Expected Issue Detail to clear the Workspace A selection after B commits",
    });
    await expect(emptyDetail).toBeDisplayed();

    const searchAfterCommit = await browser.$(searchInputSelector);
    await searchAfterCommit.waitForExist({ timeout: 30_000 });
    await expect(searchAfterCommit).toHaveValue("");

    // The unique B description token must surface when we re-issue a search
    // for it. This proves B's snapshot was actually published (not just
    // its path).
    await searchAfterCommit.setValue(FIXTURE_SECOND_SEARCH_QUERY);
    await browser.waitUntil(
      async () => {
        const row = await browser.$(
          issueRowSelector(FIXTURE_SECOND_ISSUE_TITLE)
        );
        return (await row.isExisting()) && (await row.isDisplayed());
      },
      {
        timeout: 30_000,
        timeoutMsg:
          "Expected Workspace B's unique description token to match the new Issue",
      }
    );
  });

  it("preserves B as Current when an invalid target is requested", async () => {
    const invalid = await invokeTypedWorkspaceSwitch(
      "/definitely-not-a-workspace"
    );
    expect("failure" in invalid).toBe(true);

    // Invalid targets remain inline selector feedback, not a retry banner.
    // This proves the real desktop renderer receives and presents the typed
    // validation failure while retaining B's committed identity/snapshot.
    const inlineValidationError = await browser.$(
      WORKSPACE_INLINE_ERROR_SELECTOR
    );
    await inlineValidationError.waitForExist({
      timeout: 30_000,
      timeoutMsg: "Expected inline invalid-workspace feedback in the selector",
    });
    expect(await inlineValidationError.getText()).toContain(
      "Could not validate this folder as a Beadwork workspace"
    );
    const retryBanner = await browser.$(
      "[data-testid='switch-failure-banner']"
    );
    expect(await retryBanner.isExisting()).toBe(false);

    // The renderer receives the typed failure transition but must preserve its
    // already committed B snapshot and Current Workspace.
    await expectCurrentWorkspace(workspaceB);
    await expectIssueVisible(FIXTURE_SECOND_ISSUE_TITLE);
    await expectIssueNotVisible(FIXTURE_ISSUE_TITLE);
  });
});

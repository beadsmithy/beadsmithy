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
  FIXTURE_ISSUE_TITLE,
  FIXTURE_SECOND_ISSUE_TITLE,
  FIXTURE_SECOND_SEARCH_QUERY,
  FIXTURE_SHARED_DESCRIPTION_A,
  FIXTURE_SHARED_ID,
  FIXTURE_SHARED_SEARCH_TOKEN_A,
  FIXTURE_SHARED_TITLE_A,
  FIXTURE_SHARED_TITLE_B,
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
import { parseHarnessEnvironment } from "./scripts/harness-inputs.ts";

const harnessInputs = parseHarnessEnvironment(process.env);
if (harnessInputs.scenario !== "atomic-switch") {
  throw new Error(
    "Atomic workspace-switch spec requires the atomic-switch scenario"
  );
}
const { fixtureA: workspaceA, fixtureBSecond: workspaceB } = harnessInputs;

/**
 * Read the wrapper delay the scenario launcher chose for this run. The
 * harness exposes `BEADSMITH_E2E_COMMAND_DELAY_MS` so the spec can wait
 * beyond the first cancelled worker's intentionally delayed completion
 * boundary.
 */
const readWrapperDelayMs = (): number => {
  const raw = process.env.BEADSMITH_E2E_COMMAND_DELAY_MS;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `BEADSMITH_E2E_COMMAND_DELAY_MS must be set to a non-negative number; got ${raw ?? "<unset>"}`
    );
  }
  return parsed;
};

describe("Atomic workspace switch (WebDriver e2e): two disposable Beadwork repositories", () => {
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
    // Fixture precondition: A exposes the shared-ID issue with the A title.
    // Workspace B exposes the same ID with a different title, proving the
    // cross-workspace interaction test has a deliberate collision.
    expect(
      result.issueData.allIssues.some(
        (issue) => issue.title === FIXTURE_SHARED_TITLE_A
      )
    ).toBe(true);

    // Renderer-state rehydration after the typed switch so the next test
    // asserts on the freshly committed Current Workspace DOM. This is
    // renderer rehydration, not lifecycle proof; restoration acceptance
    // belongs exclusively to the second-binary scenario.
    await browser.refresh();
  });

  it("preserves A's snapshot and Issue Detail/search while B is Pending, and Cancel keeps A", async () => {
    // Select the deliberately colliding shared-ID Issue so we can prove
    // selection/search context cannot leak across a committed switch.
    await selectIssueListView("All", "all");
    const sharedRow = await expectIssueVisible(FIXTURE_SHARED_TITLE_A);
    const sharedButton = await sharedRow.$("button[data-issue-id]");
    const sharedIssueId = await sharedButton.getAttribute("data-issue-id");
    if (sharedIssueId !== FIXTURE_SHARED_ID) {
      throw new Error(
        `Expected selected Issue to expose shared ID ${FIXTURE_SHARED_ID}; got ${sharedIssueId}`
      );
    }
    await sharedButton.click();

    const detail = await browser.$('main[aria-label="Issue detail"]');
    await browser.waitUntil(
      async () => {
        const text = await detail.getText();
        return (
          text.includes(FIXTURE_SHARED_TITLE_A) &&
          text.includes(FIXTURE_SHARED_DESCRIPTION_A) &&
          text.includes(FIXTURE_SHARED_ID)
        );
      },
      {
        timeout: 30_000,
        timeoutMsg:
          "Expected Issue Detail to render Workspace A's shared-ID Issue",
      }
    );

    // Search for an A-only token so the query is positive in A, meaningless
    // in B, and any carry-over would visibly empty B's list instead of
    // matching B's same-ID issue.
    const searchInput = await browser.$(searchInputSelector);
    await searchInput.waitForExist({ timeout: 30_000 });
    await searchInput.setValue(FIXTURE_SHARED_SEARCH_TOKEN_A);
    await expect(searchInput).toHaveValue(FIXTURE_SHARED_SEARCH_TOKEN_A);

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
    const pendingDetailText = await pendingDetail.getText();
    expect(pendingDetailText).toContain(FIXTURE_SHARED_TITLE_A);
    expect(pendingDetailText).toContain(FIXTURE_SHARED_ID);
    expect(pendingDetailText).not.toContain(FIXTURE_SHARED_TITLE_B);
    const pendingSearch = await browser.$(searchInputSelector);
    expect(await pendingSearch.getValue()).toBe(FIXTURE_SHARED_SEARCH_TOKEN_A);
    await expectIssueVisible(FIXTURE_SHARED_TITLE_A);
    await expectIssueNotVisible(FIXTURE_SECOND_ISSUE_TITLE);
    await expectCurrentWorkspace(workspaceA);

    // Cancel through the actual renderer control. This exercises the real
    // `cancel_workspace` path instead of only asserting backend state.
    const cancelClickedAt = Date.now();
    const cancelButton = await browser.$(
      "[data-testid='cancel-workspace-switch']"
    );
    await cancelButton.click();
    await pendingLabel.waitForExist({ reverse: true, timeout: 30_000 });

    // Deterministic late-cancel race wait. The scenario-owned bw/git
    // wrappers sleep for the configured delay before exec'ing the real
    // command. Cancellation has invalidated the request generation, so the
    // late worker must NOT publish even though its subprocess completes
    // well after Cancel. Wait beyond the wrapper delay so the desktop
    // boundary has a real opportunity to drop, accept, or wrongly publish
    // the cancelled result.
    const wrapperDelayMs = readWrapperDelayMs();
    await browser.waitUntil(
      () => Date.now() - cancelClickedAt >= wrapperDelayMs + 250,
      {
        timeout: wrapperDelayMs + 5000,
        timeoutMsg: `Expected ${wrapperDelayMs}ms beyond Cancel for late worker to complete`,
      }
    );

    // After Cancel + late-worker completion: A's snapshot, shared-ID Issue
    // Detail, and A-only search query must still belong to A — B never
    // published, and the renderer must not regress.
    await expectCurrentWorkspace(workspaceA);
    await selectIssueListView("All", "all");
    await expectIssueVisible(FIXTURE_SHARED_TITLE_A);
    await expectIssueNotVisible(FIXTURE_SECOND_ISSUE_TITLE);
    await expectIssueNotVisible(FIXTURE_SHARED_TITLE_B);
    const detailAfterCancel = await browser.$(
      'main[aria-label="Issue detail"]'
    );
    await browser.waitUntil(
      async () => {
        const text = await detailAfterCancel.getText();
        return (
          text.includes(FIXTURE_SHARED_TITLE_A) &&
          text.includes(FIXTURE_SHARED_ID) &&
          !text.includes(FIXTURE_SHARED_TITLE_B)
        );
      },
      {
        timeout: 30_000,
        timeoutMsg:
          "Expected Issue Detail to still belong to Workspace A after Cancel + late completion",
      }
    );
    const searchAfterCancel = await browser.$(searchInputSelector);
    await expect(searchAfterCancel).toHaveValue(FIXTURE_SHARED_SEARCH_TOKEN_A);
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
    expect(
      result.issueData.allIssues.some(
        (issue) => issue.title === FIXTURE_SHARED_TITLE_B
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
    await expectIssueNotVisible(FIXTURE_SHARED_TITLE_A);
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

    // B's same-ID Issue must not be implicitly selected after the commit:
    // even though Beadsmith now exposes the shared ID, Issue Detail must
    // still report the empty-selection state and Issue Explorer must show
    // the issue rows normally without any leftover A selection. The shared
    // Issue is priority-2 unblocked, so it surfaces in the All view (not
    // the Blocked view we deliberately preserved above).
    await selectIssueListView("All", "all");
    await expectIssueVisible(FIXTURE_SHARED_TITLE_B);
    const stillEmptyDetail = await browser.$("h2=No issue selected");
    await expect(stillEmptyDetail).toBeDisplayed();

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
    // A's shared-ID token must not match anything in B.
    await searchAfterCommit.setValue(FIXTURE_SHARED_SEARCH_TOKEN_A);
    await browser.waitUntil(
      async () => {
        const sharedRowAfter = await browser.$(
          issueRowSelector(FIXTURE_SHARED_TITLE_B)
        );
        const fixtureRowAfter = await browser.$(
          issueRowSelector(FIXTURE_SECOND_ISSUE_TITLE)
        );
        return (
          !(await sharedRowAfter.isExisting()) &&
          !(await fixtureRowAfter.isExisting())
        );
      },
      {
        timeout: 30_000,
        timeoutMsg:
          "Expected A's leaked search token to filter out every Workspace B Issue",
      }
    );
    await searchAfterCommit.clearValue();
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

    // The renderer receives the typed failure transition but must preserve
    // its already committed B path AND its B-only issue data. The shared
    // Issue is priority-2 unblocked, so it lives in the All view (not the
    // Blocked view that survived the remount).
    await expectCurrentWorkspace(workspaceB);
    await expectIssueVisible(FIXTURE_SECOND_ISSUE_TITLE);
    await selectIssueListView("All", "all");
    await expectIssueVisible(FIXTURE_SHARED_TITLE_B);
    await expectIssueNotVisible(FIXTURE_ISSUE_TITLE);
    await expectIssueNotVisible(FIXTURE_SHARED_TITLE_A);
  });
});

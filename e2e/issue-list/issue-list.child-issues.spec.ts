/**
 * Real-desktop coverage for the Child Issues acceptance path (bsm-nd7.4).
 *
 * Proves the assembled Beadsmith binary renders, orders, and navigates
 * through Beadwork Child Issues end to end:
 *
 *   - Selecting a parent whose `Issue` has structured `parent` data
 *     renders a `Child Issues` section immediately after `Dependencies`
 *     in `Issue Detail`, with rows in priority/creation order and a
 *     visible `id → status badge → title` field order.
 *   - Each Child Issue button's accessible name is
 *     `<id>: <title>. <status>` (the `bsm-nd7.3` contract).
 *   - Selecting an Issue with no children renders no Child Issues
 *     heading, list, or fallback copy inside `Issue Detail`.
 *   - Clicking a Child Issue button changes `Issue Detail` while the
 *     active `Issue List View` and the local `#issue-search` query
 *     are preserved. The selected child remains in `Issue Detail`
 *     after the active view's search results are replaced with a
 *     deterministic no-match query.
 *
 * The spec deliberately goes through the typed
 * `TauRPC__switch_workspace` boundary and the rendered DOM. It does
 * not seed Beadwork or change the workspace store from the test
 * process; the harness (`e2e/issue-list/scripts/run-scenario.ts`)
 * owns fixture creation, clean-up, and the scenario-owned store, and
 * the assertion against `data-active-issue-list-view-id` and
 * `#issue-search` proves the navigation actually preserves the
 * renderer state instead of just being a frontend test.
 */
import { browser, expect } from "@wdio/globals";

import {
  FIXTURE_CHILD_LONELY_DESCRIPTION,
  FIXTURE_CHILD_LONELY_ID,
  FIXTURE_CHILD_LONELY_TITLE,
  FIXTURE_CHILD_NO_MATCH_TOKEN,
  FIXTURE_CHILD_PARENT_1_ID,
  FIXTURE_CHILD_PARENT_1_TITLE,
  FIXTURE_CHILD_PARENT_2_ID,
  FIXTURE_CHILD_PARENT_2_TITLE,
  FIXTURE_CHILD_PARENT_3_ID,
  FIXTURE_CHILD_PARENT_3_TITLE,
  FIXTURE_CHILD_PARENT_ID,
  FIXTURE_CHILD_PARENT_TITLE,
} from "./fixtures/workspace.ts";
import {
  childIssueButtonSelector,
  childIssuesListSelector,
  expectIssueNotVisible,
  expectIssueVisible,
  issueRowSelector,
  invokeTypedWorkspaceSwitch,
  invokeWorkspaceState,
  searchInputSelector,
} from "./helpers/rpc.ts";
import {
  expectCurrentWorkspace,
  expectNoCurrentWorkspace,
  selectIssueListView,
} from "./helpers/sidebar.ts";
import { parseHarnessEnvironment } from "./scripts/harness-inputs.ts";

const { fixtureA } = parseHarnessEnvironment(process.env);

if (fixtureA.length === 0) {
  throw new Error(
    "BEADSMITH_E2E_WORKSPACE_A is not set. Run `pnpm e2e:issue-list:child-issues` instead of invoking wdio directly."
  );
}

/**
 * The hard-coded oracle for the Child Issues rendered order under
 * the production comparator (priority ascending, then `created`
 * ascending). The fixture exports the IDs and titles so the test
 * never re-encodes the production comparator.
 */
const EXPECTED_CHILD_ISSUES: readonly {
  readonly id: string;
  readonly status: "Closed" | "In Progress" | "Open";
  readonly title: string;
}[] = [
  {
    id: FIXTURE_CHILD_PARENT_1_ID,
    status: "Closed",
    title: FIXTURE_CHILD_PARENT_1_TITLE,
  },
  {
    id: FIXTURE_CHILD_PARENT_2_ID,
    status: "In Progress",
    title: FIXTURE_CHILD_PARENT_2_TITLE,
  },
  {
    id: FIXTURE_CHILD_PARENT_3_ID,
    status: "Open",
    title: FIXTURE_CHILD_PARENT_3_TITLE,
  },
];

/**
 * One semantic DOM read that returns the dense shape of each Child
 * Issue button in DOM order. The button's visible children are
 * `id`, `status`, then `title` -- the spec asserts this order with
 * the hard-coded oracle so the production comparator stays the only
 * source of truth for ordering.
 */
interface ChildIssueRow {
  ariaLabel: string;
  id: string;
  statusLabel: string;
  title: string;
}

const readChildIssueRows = (): ChildIssueRow[] => {
  const rows = browser.execute(() => {
    const list = document.querySelector('ul[aria-label="Child Issues"]');
    if (!list) {
      return [];
    }
    const buttons = [
      ...list.querySelectorAll<HTMLButtonElement>("button[aria-label]"),
    ];
    return buttons.map((button) => {
      const spans = button.querySelectorAll<HTMLSpanElement>("span");
      return {
        ariaLabel: button.getAttribute("aria-label") ?? "",
        id: (spans[0]?.textContent ?? "").trim(),
        statusLabel: (spans[1]?.textContent ?? "").trim(),
        title: (spans[2]?.textContent ?? "").trim(),
      };
    });
  });
  return rows as ChildIssueRow[];
};

/**
 * Read the rendered Child Issues section's surrounding heading
 * siblings so the test can assert that Child Issues is the
 * immediately-following section after Dependencies. The two
 * sections are detected by their `<h3>` text content rather than
 * a CSS-only selector because the heading text is the user-visible
 * contract.
 */
const readChildIssuesSectionPosition = (): {
  dependenciesFollowedByChildIssues: boolean;
} =>
  browser.execute(() => {
    const detail = document.querySelector('main[aria-label="Issue detail"]');
    if (!detail) {
      return { dependenciesFollowedByChildIssues: false };
    }
    const headings = [...detail.querySelectorAll<HTMLElement>("section h3")];
    const dependenciesIndex = headings.findIndex(
      (heading) => heading.textContent?.trim() === "Dependencies"
    );
    const childIssuesIndex = headings.findIndex(
      (heading) => heading.textContent?.trim() === "Child Issues"
    );
    return {
      dependenciesFollowedByChildIssues:
        dependenciesIndex !== -1 && childIssuesIndex === dependenciesIndex + 1,
    };
  });

/**
 * Clear the local Issue Search input and assert the cleared value.
 * Used at the top of every `it()` so the four blocks are independent
 * and no test's query leaks into the next.
 */
const clearSearchInput = async (): Promise<void> => {
  const searchInput = await browser.$(searchInputSelector);
  await searchInput.waitForExist({ timeout: 30_000 });
  await searchInput.clearValue();
  await expect(searchInput).toHaveValue("");
};

const waitForIssueDetailToInclude = async (
  title: string,
  id: string,
  timeoutMsg: string
): Promise<void> => {
  const detail = await browser.$('main[aria-label="Issue detail"]');
  await browser.waitUntil(
    async () => {
      const text = await detail.getText();
      return text.includes(title) && text.includes(id);
    },
    {
      timeout: 30_000,
      timeoutMsg,
    }
  );
};

const waitForReadySearchToShowOnlyLonely = async (): Promise<void> => {
  const readySection = await browser.$(
    'section[data-active-issue-list-view-id="ready"]'
  );
  await readySection.waitForExist({ timeout: 30_000 });
  await browser.waitUntil(
    async () => {
      const lonelyRow = await readySection.$(
        issueRowSelector(FIXTURE_CHILD_LONELY_TITLE)
      );
      const parentRowInReady = await readySection.$(
        issueRowSelector(FIXTURE_CHILD_PARENT_TITLE)
      );
      return (
        (await lonelyRow.isExisting()) &&
        (await lonelyRow.isDisplayed()) &&
        !(await parentRowInReady.isExisting())
      );
    },
    {
      timeout: 30_000,
      timeoutMsg:
        "Expected Ready + lonely-token search to surface only the lonely Issue",
    }
  );
};

const assertReadyViewAndQueryPreservedAfterClick = async (
  searchQuery: string
): Promise<void> => {
  const readySectionAfterClick = await browser.$(
    'section[data-active-issue-list-view-id="ready"]'
  );
  await readySectionAfterClick.waitForExist({ timeout: 30_000 });
  await expect(readySectionAfterClick).toBeDisplayed();

  const searchInputAfterClick = await browser.$(searchInputSelector);
  expect(await searchInputAfterClick.getValue()).toBe(searchQuery);

  const closedChildInReady = await readySectionAfterClick.$(
    issueRowSelector(FIXTURE_CHILD_PARENT_1_TITLE)
  );
  expect(await closedChildInReady.isExisting()).toBe(false);
};

const assertReadyViewAndQueryPreservedAfterNoMatch =
  async (): Promise<void> => {
    const noMatchQuery = FIXTURE_CHILD_NO_MATCH_TOKEN;
    const searchInput = await browser.$(searchInputSelector);
    await searchInput.setValue(noMatchQuery);
    await expect(searchInput).toHaveValue(noMatchQuery);

    const readyEmpty = await browser.$(
      'section[data-active-issue-list-view-id="ready"] [data-empty-reason="search-filtered-empty"]'
    );
    await readyEmpty.waitForExist({
      timeout: 30_000,
      timeoutMsg:
        "Expected Ready + no-match query to surface the search-filtered empty state",
    });

    const readySectionAfterNoMatch = await browser.$(
      'section[data-active-issue-list-view-id="ready"]'
    );
    await expect(readySectionAfterNoMatch).toBeDisplayed();

    expect(await searchInput.getValue()).toBe(noMatchQuery);

    const childDetailAfterNoMatch = await browser.$(
      'main[aria-label="Issue detail"]'
    );
    const childDetailText = await childDetailAfterNoMatch.getText();
    expect(childDetailText).toContain(FIXTURE_CHILD_PARENT_1_TITLE);
    expect(childDetailText).toContain(FIXTURE_CHILD_PARENT_1_ID);
    expect(childDetailText).toContain("Closed");
  };

interface SeededIssues {
  child1: { id: string; parent: string };
  child2: { id: string; parent: string };
  child3: { id: string; parent: string };
  lonely: { id: string };
  parent: { created: string; id: string; priority: number; status: string };
}

const indexIssuesById = (
  allIssues: readonly { id?: string }[]
): Map<string, { id?: string }> => {
  const byId = new Map<string, { id?: string }>();
  for (const issue of allIssues) {
    if (typeof issue.id === "string") {
      byId.set(issue.id, issue);
    }
  }
  return byId;
};

const assertChildIssueFixtureStructure = (issues: SeededIssues): void => {
  const { parent } = issues;
  expect(parent.id).toBeTruthy();
  expect(parent.priority).toBe(2);
  expect(parent.created).toBe("2026-01-10T09:00:00Z");
  expect(parent.status).toBe("closed");

  expect(issues.child1.id).toBeTruthy();
  expect(issues.child1.parent).toBe(parent.id);
  expect(issues.child2.id).toBeTruthy();
  expect(issues.child2.parent).toBe(parent.id);
  expect(issues.child3.id).toBeTruthy();
  expect(issues.child3.parent).toBe(parent.id);
  expect(issues.lonely.id).toBeTruthy();
};

const assertChildIssueFixtureStatuses = (
  byId: Map<
    string,
    {
      id?: string;
      parent?: string;
      priority?: number;
      created?: string;
      status?: string;
    }
  >
): void => {
  const child1 = byId.get(FIXTURE_CHILD_PARENT_1_ID);
  expect(child1?.priority).toBe(1);
  expect(child1?.created).toBe("2025-12-01T09:00:00Z");
  expect(child1?.status).toBe("closed");

  const child2 = byId.get(FIXTURE_CHILD_PARENT_2_ID);
  expect(child2?.priority).toBe(1);
  expect(child2?.created).toBe("2026-01-02T09:00:00Z");
  expect(child2?.status).toBe("in_progress");

  const child3 = byId.get(FIXTURE_CHILD_PARENT_3_ID);
  expect(child3?.priority).toBe(3);
  expect(child3?.created).toBe("2025-11-15T09:00:00Z");
  expect(child3?.status).toBe("open");

  const lonely = byId.get(FIXTURE_CHILD_LONELY_ID);
  expect(lonely?.parent).toBe("");
};

describe("Child Issues (WebDriver e2e): closed parent, ordered children, and view/search-preserving navigation", () => {
  it("starts empty and seeds the dedicated closed-parent fixture through the typed workspace switch", async () => {
    const initialState = await invokeWorkspaceState();
    expect(initialState.currentWorkspace).toBeNull();
    await expectNoCurrentWorkspace();

    const result = await invokeTypedWorkspaceSwitch(fixtureA);
    if ("failure" in result) {
      throw new Error(result.failure);
    }

    const { allIssues } = result.issueData;
    console.log(
      `[e2e:spec] typed workspace switch returned ${allIssues.length} issue(s)`
    );

    // The typed response proves the structured Issue data crossed the
    // real Rust / TauRPC boundary for the dedicated fixture. Each
    // explicit Issue must appear with its expected id, parent,
    // priority, created, and stored status.
    const byId = indexIssuesById(allIssues);

    const parent = byId.get(FIXTURE_CHILD_PARENT_ID);
    expect(
      parent,
      "parent Issue must be present in the typed payload"
    ).toBeDefined();

    assertChildIssueFixtureStructure({
      child1: {
        id: FIXTURE_CHILD_PARENT_1_ID,
        parent: parent?.id ?? "",
      },
      child2: {
        id: FIXTURE_CHILD_PARENT_2_ID,
        parent: parent?.id ?? "",
      },
      child3: {
        id: FIXTURE_CHILD_PARENT_3_ID,
        parent: parent?.id ?? "",
      },
      lonely: { id: FIXTURE_CHILD_LONELY_ID },
      parent: {
        created: parent?.created ?? "",
        id: parent?.id ?? "",
        priority: parent?.priority ?? 0,
        status: parent?.status ?? "",
      },
    });

    assertChildIssueFixtureStatuses(byId);

    // The direct typed transport changes backend state; reload so the
    // real frontend performs its normal Current Workspace startup read
    // before the DOM assertions.
    await browser.refresh();
  });

  it("renders the parent's Child Issues section after Dependencies in priority/creation order with id/status/title", async () => {
    await selectIssueListView("All", "all");
    await clearSearchInput();

    const parentRow = await expectIssueVisible(FIXTURE_CHILD_PARENT_TITLE);
    const parentButton = await parentRow.$("button[data-issue-id]");
    const parentIssueId = await parentButton.getAttribute("data-issue-id");
    expect(parentIssueId).toBe(FIXTURE_CHILD_PARENT_ID);
    await parentButton.click();

    const detail = await browser.$('main[aria-label="Issue detail"]');
    await browser.waitUntil(
      async () => {
        const text = await detail.getText();
        return (
          text.includes(FIXTURE_CHILD_PARENT_TITLE) &&
          text.includes(parentIssueId)
        );
      },
      {
        timeout: 30_000,
        timeoutMsg:
          "Expected Issue Detail to render the closed parent before asserting Child Issues",
      }
    );

    // The Child Issues section must mount inside Issue Detail before
    // the spec asserts its contents.
    const childList = await browser.$(childIssuesListSelector());
    await childList.waitForExist({
      timeout: 30_000,
      timeoutMsg: "Expected Child Issues <ul> to mount under the closed parent",
    });

    // The next section after Dependencies must be Child Issues; the
    // spec does not infer placement from text order across the whole
    // page.
    const position = await readChildIssuesSectionPosition();
    expect(position.dependenciesFollowedByChildIssues).toBe(true);

    const rows = await readChildIssueRows();
    expect(rows).toHaveLength(EXPECTED_CHILD_ISSUES.length);

    for (const [index, row] of rows.entries()) {
      const expected = EXPECTED_CHILD_ISSUES[index];
      expect(row.id).toBe(expected.id);
      expect(row.statusLabel).toBe(expected.status);
      expect(row.title).toBe(expected.title);
      expect(row.ariaLabel).toBe(
        `${expected.id}: ${expected.title}. ${expected.status}`
      );
    }
  });

  it("omits the Child Issues section for an Issue with no children", async () => {
    await selectIssueListView("All", "all");
    await clearSearchInput();

    const lonelyRow = await expectIssueVisible(FIXTURE_CHILD_LONELY_TITLE);
    const lonelyButton = await lonelyRow.$("button[data-issue-id]");
    const lonelyIssueId = await lonelyButton.getAttribute("data-issue-id");
    expect(lonelyIssueId).toBe(FIXTURE_CHILD_LONELY_ID);
    await lonelyButton.click();

    const detail = await browser.$('main[aria-label="Issue detail"]');
    await browser.waitUntil(
      async () => {
        const text = await detail.getText();
        return (
          text.includes(FIXTURE_CHILD_LONELY_TITLE) &&
          text.includes(lonelyIssueId)
        );
      },
      {
        timeout: 30_000,
        timeoutMsg:
          "Expected Issue Detail to render the lonely Issue before asserting the absent Child Issues section",
      }
    );

    const detailText = await detail.getText();
    expect(detailText).not.toContain("Child Issues");
    expect(detailText).not.toContain("No Child Issues");

    const childList = await browser.$(childIssuesListSelector());
    expect(await childList.isExisting()).toBe(false);
  });

  it("changes Issue Detail on Child Issue click while preserving the active Issue List View and search query", async () => {
    // Reset to All with an empty query, select the parent again, and
    // wait for its Child Issues list. The scenario already proved the
    // populated section in 4a; this block exercises the click path.
    await selectIssueListView("All", "all");
    await clearSearchInput();

    const parentRow = await expectIssueVisible(FIXTURE_CHILD_PARENT_TITLE);
    const parentButton = await parentRow.$("button[data-issue-id]");
    await parentButton.click();

    const childList = await browser.$(childIssuesListSelector());
    await childList.waitForExist({
      timeout: 30_000,
      timeoutMsg:
        "Expected Child Issues <ul> to mount under the closed parent before navigation",
    });

    // Switch to Ready. The closed parent does not appear in Ready
    // (status === "closed" is filtered out by `bw ready`); the parent
    // and its Child Issues section must remain in Issue Detail
    // because selection is resolved from `allIssues`.
    await selectIssueListView("Ready", "ready");
    await expectIssueNotVisible(FIXTURE_CHILD_PARENT_TITLE);

    await waitForIssueDetailToInclude(
      FIXTURE_CHILD_PARENT_TITLE,
      FIXTURE_CHILD_PARENT_ID,
      "Expected closed parent to remain in Issue Detail after switching to Ready"
    );

    // The lonely Issue has a unique description token, so a Ready
    // search for that token produces a deterministic non-empty Ready
    // result that excludes the closed P1 child (the closed child is
    // not in Ready at all because `bw ready` filters out closed
    // Issues). The pre-navigation query is therefore empty / shut
    // out of the click target, which is what the assertion below
    // depends on.
    const lonelySearchQuery = FIXTURE_CHILD_LONELY_DESCRIPTION;
    const searchInput = await browser.$(searchInputSelector);
    await searchInput.setValue(lonelySearchQuery);
    await expect(searchInput).toHaveValue(lonelySearchQuery);

    await waitForReadySearchToShowOnlyLonely();

    // The closed P1 child is the deterministic click target: it is
    // not in the active Ready+search result, but its Child Issue
    // button must still be present (selection is all-issues-backed).
    const closedChildButton = await browser.$(
      childIssueButtonSelector(
        FIXTURE_CHILD_PARENT_1_ID,
        FIXTURE_CHILD_PARENT_1_TITLE,
        "Closed"
      )
    );
    await closedChildButton.waitForExist({
      timeout: 30_000,
      timeoutMsg:
        "Expected closed Child Issue button to exist inside the Child Issues <ul>",
    });
    await closedChildButton.click();

    // Re-query Issue Detail after the click so the new render replaces
    // any stale WebKit element handle.
    await waitForIssueDetailToInclude(
      FIXTURE_CHILD_PARENT_1_TITLE,
      FIXTURE_CHILD_PARENT_1_ID,
      "Expected closed Child Issue to drive Issue Detail after the click"
    );

    // First half of the navigation criterion: the active Issue List
    // View and the local Issue Search query are unchanged, and the
    // closed child has no Issue List row in the current Ready/search
    // result.
    await assertReadyViewAndQueryPreservedAfterClick(lonelySearchQuery);

    // Second half of the navigation criterion: replace the Ready
    // query with a deterministic no-match token and confirm that the
    // exact same child is still rendered in Issue Detail while the
    // Issue List View is empty.
    await assertReadyViewAndQueryPreservedAfterNoMatch();
  });

  it("keeps the closed parent as the Current Workspace after the navigation sequence", async () => {
    // The desktop binary never left the closed-parent workspace
    // across the view/search navigation above; the sidebar must
    // therefore still report the parent's basename.
    await expectCurrentWorkspace(fixtureA);
  });
});

import { describe, expect, it } from "vitest";

import type { Issue } from "../rpc/bindings";
import {
  deriveIssueExplorerState,
  getActiveIssueListViewId,
  getActiveIssueListViewLabel,
  getIssueListEmptyReason,
  getIssueListEmptySupportingCopy,
  getIssueListEmptyTitle,
} from "./issue-explorer-state";
import type { IssueListEmptyReason } from "./issue-explorer-state";
import type { IssueExplorerLoadState } from "./issue-loader";

const buildIssue = (overrides: Partial<Issue> = {}): Issue => ({
  assignee: "",
  blockedBy: [],
  blocks: [],
  closeReason: "",
  closedAt: "",
  comments: [],
  created: "2026-07-05T08:00:00Z",
  deferUntil: "",
  description: "",
  due: "",
  id: "bsm-test",
  labels: [],
  parent: "",
  priority: 2,
  status: "open",
  title: "Test issue",
  type: "task",
  updatedAt: "2026-07-05T08:00:00Z",
  ...overrides,
});

type SuccessfulIssueExplorerLoadState = Extract<
  IssueExplorerLoadState,
  { status: "success" }
>;

const successState = (
  overrides: {
    allIssues?: Issue[];
    blockedIssues?: Issue[];
    readyIssues?: Issue[];
  } = {}
): SuccessfulIssueExplorerLoadState => ({
  allIssues: overrides.allIssues ?? [],
  blockedIssues: overrides.blockedIssues ?? [],
  readyIssues: overrides.readyIssues ?? [],
  status: "success",
  workspacePath: "/Users/dev/work/beads",
});

const ids = (issues: Issue[]): string[] => issues.map((issue) => issue.id);

describe("getActiveIssueListViewId", () => {
  it("defaults to 'all' when no active view is provided", () => {
    expect(getActiveIssueListViewId()).toBe("all");
  });

  it("returns the provided active view ID", () => {
    expect(getActiveIssueListViewId("blocked")).toBe("blocked");
  });
});

describe("getActiveIssueListViewLabel", () => {
  it("returns the configured label for a known view ID", () => {
    expect(getActiveIssueListViewLabel("all")).toBe("All");
    expect(getActiveIssueListViewLabel("ready")).toBe("Ready");
    expect(getActiveIssueListViewLabel("in_progress")).toBe("In Progress");
  });

  it("falls back to 'view' for an unconfigured view ID", () => {
    expect(getActiveIssueListViewLabel("unknown" as never)).toBe("view");
  });
});

describe("getIssueListEmptyReason", () => {
  it("returns null when there are visible issues", () => {
    expect(
      getIssueListEmptyReason({
        allIssuesCount: 1,
        baseIssueCount: 1,
        hasSearchQuery: false,
        visibleIssueCount: 1,
      })
    ).toBeNull();
  });

  it("returns true-empty when the workspace has no issues", () => {
    expect(
      getIssueListEmptyReason({
        allIssuesCount: 0,
        baseIssueCount: 0,
        hasSearchQuery: false,
        visibleIssueCount: 0,
      })
    ).toBe("true-empty");

    expect(
      getIssueListEmptyReason({
        allIssuesCount: 0,
        baseIssueCount: 0,
        hasSearchQuery: true,
        visibleIssueCount: 0,
      })
    ).toBe("true-empty");
  });

  it("returns base-empty when the active view is empty and there is no search query", () => {
    expect(
      getIssueListEmptyReason({
        allIssuesCount: 1,
        baseIssueCount: 0,
        hasSearchQuery: false,
        visibleIssueCount: 0,
      })
    ).toBe("base-empty");

    expect(
      getIssueListEmptyReason({
        allIssuesCount: 1,
        baseIssueCount: 1,
        hasSearchQuery: false,
        visibleIssueCount: 0,
      })
    ).toBe("base-empty");
  });

  it("returns search-filtered-empty when the view has base issues but the query matches none", () => {
    expect(
      getIssueListEmptyReason({
        allIssuesCount: 1,
        baseIssueCount: 1,
        hasSearchQuery: true,
        visibleIssueCount: 0,
      })
    ).toBe("search-filtered-empty");
  });
});

describe("empty state copy", () => {
  it("renders true-empty title and supporting copy", () => {
    expect(
      getIssueListEmptyTitle({ activeViewLabel: "All", reason: "true-empty" })
    ).toBe("No issues found");
    expect(
      getIssueListEmptySupportingCopy({
        activeViewLabel: "All",
        rawSearchQuery: "",
        reason: "true-empty",
      })
    ).toBe("Beadwork returned an empty issue list for this workspace.");
  });

  it("renders base-empty title and supporting copy", () => {
    expect(
      getIssueListEmptyTitle({ activeViewLabel: "Ready", reason: "base-empty" })
    ).toBe("No issues in Ready.");
    expect(
      getIssueListEmptySupportingCopy({
        activeViewLabel: "Ready",
        rawSearchQuery: "",
        reason: "base-empty",
      })
    ).toBe("The Ready Issue List View has no issues.");
  });

  it("renders search-filtered-empty title and supporting copy with the trimmed query", () => {
    expect(
      getIssueListEmptyTitle({
        activeViewLabel: "Closed",
        reason: "search-filtered-empty",
      })
    ).toBe("No matching issues");
    expect(
      getIssueListEmptySupportingCopy({
        activeViewLabel: "Closed",
        rawSearchQuery: "  migration  ",
        reason: "search-filtered-empty",
      })
    ).toBe('No issues in Closed match "migration".');
  });
});

describe("deriveIssueExplorerState", () => {
  it("normalizes the active view and exposes its label", () => {
    const state = deriveIssueExplorerState({
      activeIssueListViewId: "ready",
      issueState: successState(),
      searchQuery: "",
      selectedIssueId: null,
    });

    expect(state.activeViewId).toBe("ready");
    expect(state.activeViewLabel).toBe("Ready");
  });

  it("defaults the active view to All when not provided", () => {
    const state = deriveIssueExplorerState({
      issueState: successState(),
      searchQuery: "",
      selectedIssueId: null,
    });

    expect(state.activeViewId).toBe("all");
    expect(state.activeViewLabel).toBe("All");
  });

  it("disables search while loading or after a failure", () => {
    const loading = deriveIssueExplorerState({
      issueState: { status: "loading" },
      searchQuery: "",
      selectedIssueId: null,
    });

    const failure = deriveIssueExplorerState({
      issueState: {
        error: { kind: "command-failed", message: "bw failed" },
        status: "failure",
      },
      searchQuery: "",
      selectedIssueId: null,
    });

    expect(loading.isSearchDisabled).toBe(true);
    expect(failure.isSearchDisabled).toBe(true);
    expect(loading.emptyReason).toBeNull();
    expect(failure.emptyReason).toBeNull();
  });

  it("composes visible issues from the active view and search query", () => {
    const first = buildIssue({ id: "bsm-a", title: "Alpha issue" });
    const second = buildIssue({ id: "bsm-b", title: "Beta issue" });
    const state = successState({ allIssues: [first, second] });

    const derived = deriveIssueExplorerState({
      issueState: state,
      searchQuery: "alpha",
      selectedIssueId: null,
    });

    expect(ids(derived.baseVisibleIssues)).toEqual(["bsm-a", "bsm-b"]);
    expect(ids(derived.visibleIssues)).toEqual(["bsm-a"]);
    expect(derived.hasSearchQuery).toBe(true);
  });

  it("preserves the incoming issue order", () => {
    const second = buildIssue({ id: "bsm-b", title: "Search" });
    const first = buildIssue({ id: "bsm-a", title: "Search" });
    const state = successState({ allIssues: [second, first] });

    const derived = deriveIssueExplorerState({
      issueState: state,
      searchQuery: "search",
      selectedIssueId: null,
    });

    expect(ids(derived.visibleIssues)).toEqual(["bsm-b", "bsm-a"]);
  });

  it("uses command-backed Ready and Blocked collections", () => {
    const ready = buildIssue({ id: "bsm-ready", title: "Ready issue" });
    const blocked = buildIssue({
      blockedBy: ["bsm-blocker"],
      id: "bsm-blocked",
      title: "Blocked issue",
    });
    const state = successState({
      allIssues: [],
      blockedIssues: [blocked],
      readyIssues: [ready],
    });

    const readyDerived = deriveIssueExplorerState({
      activeIssueListViewId: "ready",
      issueState: state,
      searchQuery: "",
      selectedIssueId: null,
    });

    const blockedDerived = deriveIssueExplorerState({
      activeIssueListViewId: "blocked",
      issueState: state,
      searchQuery: "",
      selectedIssueId: null,
    });

    expect(ids(readyDerived.visibleIssues)).toEqual(["bsm-ready"]);
    expect(ids(blockedDerived.visibleIssues)).toEqual(["bsm-blocked"]);
  });

  it("selects an issue only when it is present in the visible collection", () => {
    const first = buildIssue({ id: "bsm-a" });
    const second = buildIssue({ id: "bsm-b" });
    const state = successState({ allIssues: [first, second] });

    const derived = deriveIssueExplorerState({
      issueState: state,
      searchQuery: "",
      selectedIssueId: "bsm-a",
    });

    expect(derived.selectedIssue).toBe(first);

    const missing = deriveIssueExplorerState({
      issueState: state,
      searchQuery: "",
      selectedIssueId: "bsm-missing",
    });

    expect(missing.selectedIssue).toBeNull();
  });

  it("returns null selected issue while loading or after a failure", () => {
    const loading = deriveIssueExplorerState({
      issueState: { status: "loading" },
      searchQuery: "",
      selectedIssueId: "bsm-a",
    });

    const failure = deriveIssueExplorerState({
      issueState: {
        error: { kind: "command-failed", message: "bw failed" },
        status: "failure",
      },
      searchQuery: "",
      selectedIssueId: "bsm-a",
    });

    expect(loading.selectedIssue).toBeNull();
    expect(failure.selectedIssue).toBeNull();
    expect(loading.visibleIssues).toEqual([]);
    expect(failure.visibleIssues).toEqual([]);
  });

  it("reports the correct empty reason for a true-empty workspace", () => {
    const derived = deriveIssueExplorerState({
      issueState: successState(),
      searchQuery: "",
      selectedIssueId: null,
    });

    expect(derived.emptyReason).toBe("true-empty");
    expect(
      getIssueListEmptyTitle({
        activeViewLabel: derived.activeViewLabel,
        reason: "true-empty",
      })
    ).toBe("No issues found");
  });

  it("reports base-empty for an empty Ready view with a non-empty All Issues", () => {
    const all = buildIssue({ id: "bsm-a" });
    const derived = deriveIssueExplorerState({
      activeIssueListViewId: "ready",
      issueState: successState({ allIssues: [all] }),
      searchQuery: "",
      selectedIssueId: null,
    });

    expect(derived.emptyReason).toBe("base-empty");
  });

  it("reports search-filtered-empty when the query removes all visible issues", () => {
    const issue = buildIssue({ id: "bsm-a", title: "Open issue" });
    const derived = deriveIssueExplorerState({
      issueState: successState({ allIssues: [issue] }),
      searchQuery: "closed",
      selectedIssueId: null,
    });

    const reason: IssueListEmptyReason = derived.emptyReason ?? "true-empty";

    expect(derived.emptyReason).toBe("search-filtered-empty");
    expect(
      getIssueListEmptySupportingCopy({
        activeViewLabel: derived.activeViewLabel,
        rawSearchQuery: "closed",
        reason,
      })
    ).toBe('No issues in All match "closed".');
  });
});

import { describe, expect, it } from "vitest";

import type { Issue } from "../rpc/bindings";
import type { IssueStatusViewId } from "./issue-list-view";
import {
  getIssueListViewCounts,
  getVisibleIssuesForListView,
  isAllIssuesBackedIssueListViewId,
  selectAllIssuesBackedIssueListViewIssues,
} from "./issue-list-view";
import type { IssueExplorerData, IssueExplorerLoadState } from "./issue-loader";

const issue = (overrides: Partial<Issue> = {}): Issue => ({
  assignee: "",
  blockedBy: [],
  blocks: [],
  closeReason: "",
  closedAt: "",
  comments: [],
  created: "2026-07-07T08:00:00Z",
  deferUntil: "",
  description: "",
  due: "",
  id: "bsm-dbh.3",
  labels: [],
  parent: "bsm-dbh",
  priority: 2,
  status: "open",
  title: "Render All and status Issue List Views from All Issues",
  type: "task",
  updatedAt: "2026-07-07T08:00:00Z",
  ...overrides,
});

const ids = (issues: Issue[]): string[] => issues.map((item) => item.id);

const data = (allIssues: Issue[]): IssueExplorerData => ({
  allIssues,
  blockedIssues: [],
  readyIssues: [],
  workspacePath: "/Users/dev/work/beads",
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

describe("selectAllIssuesBackedIssueListViewIssues", () => {
  it("returns every All Issue in original order for the All view", () => {
    const allIssues = [
      issue({ id: "bsm-closed", status: "closed" }),
      issue({ id: "bsm-unknown", status: "triaged" }),
      issue({ id: "bsm-open", status: "open" }),
    ];

    expect(
      ids(selectAllIssuesBackedIssueListViewIssues(data(allIssues), "all"))
    ).toEqual(["bsm-closed", "bsm-unknown", "bsm-open"]);
  });

  it("returns exact stored-status slices while preserving All Issues order", () => {
    const allIssues = [
      issue({ id: "bsm-progress-task", status: "in_progress", type: "task" }),
      issue({ id: "bsm-closed-epic", status: "closed", type: "epic" }),
      issue({ id: "bsm-open-epic", status: "open", type: "epic" }),
      issue({ id: "bsm-deferred-task", status: "deferred", type: "task" }),
      issue({ id: "bsm-open-task", status: "open", type: "task" }),
      issue({ id: "bsm-unknown", status: "triaged", type: "task" }),
      issue({ id: "bsm-closed-task", status: "closed", type: "task" }),
    ];
    const explorerData = data(allIssues);
    const expectedSlices: [IssueStatusViewId, string[]][] = [
      ["open", ["bsm-open-epic", "bsm-open-task"]],
      ["in_progress", ["bsm-progress-task"]],
      ["closed", ["bsm-closed-epic", "bsm-closed-task"]],
      ["deferred", ["bsm-deferred-task"]],
    ];

    for (const [viewId, expectedIds] of expectedSlices) {
      expect(
        ids(selectAllIssuesBackedIssueListViewIssues(explorerData, viewId))
      ).toEqual(expectedIds);
    }
  });

  it("keeps command-authored Ready and Blocked views outside the All-backed selector", () => {
    expect(isAllIssuesBackedIssueListViewId("all")).toBe(true);
    expect(isAllIssuesBackedIssueListViewId("open")).toBe(true);
    expect(isAllIssuesBackedIssueListViewId("in_progress")).toBe(true);
    expect(isAllIssuesBackedIssueListViewId("closed")).toBe(true);
    expect(isAllIssuesBackedIssueListViewId("deferred")).toBe(true);
    expect(isAllIssuesBackedIssueListViewId("ready")).toBe(false);
    expect(isAllIssuesBackedIssueListViewId("blocked")).toBe(false);
  });

  it("counts unknown-status Issues in All without adding them to supported status counts", () => {
    const allIssues = [
      issue({ id: "bsm-open", status: "open" }),
      issue({ id: "bsm-closed", status: "closed" }),
      issue({ id: "bsm-unknown", status: "triaged" }),
    ];

    expect(
      getIssueListViewCounts({
        ...data(allIssues),
        status: "success",
      })
    ).toMatchObject({
      all: 3,
      closed: 1,
      deferred: 0,
      in_progress: 0,
      open: 1,
    });
  });
});

describe("getVisibleIssuesForListView Ready view", () => {
  it("returns the preloaded Ready collection verbatim, not a local derivation from All Issues fields", () => {
    // A local "open and unblocked" approximation would exclude this issue: it
    // is in_progress and carries an unresolved blocker. The command-backed
    // Ready collection includes it anyway, so the view must surface it as-is.
    const readyIssue = issue({
      blockedBy: ["bsm-blocker"],
      id: "bsm-ready",
      status: "in_progress",
    });
    const allOnly = issue({ id: "bsm-all" });
    const state = successState({
      allIssues: [allOnly],
      readyIssues: [readyIssue],
    });

    expect(getVisibleIssuesForListView(state, "ready")).toBe(state.readyIssues);
    expect(ids(getVisibleIssuesForListView(state, "ready"))).toEqual([
      "bsm-ready",
    ]);
  });

  it("preserves bw ready output order even when All Issues is ordered differently", () => {
    const state = successState({
      allIssues: [
        issue({ id: "bsm-a" }),
        issue({ id: "bsm-b" }),
        issue({ id: "bsm-c" }),
      ],
      readyIssues: [issue({ id: "bsm-c" }), issue({ id: "bsm-a" })],
    });

    expect(ids(getVisibleIssuesForListView(state, "ready"))).toEqual([
      "bsm-c",
      "bsm-a",
    ]);
  });

  it("returns an empty array when the preloaded Ready collection is empty", () => {
    const state = successState({
      allIssues: [issue({ id: "bsm-all" })],
      readyIssues: [],
    });

    expect(getVisibleIssuesForListView(state, "ready")).toEqual([]);
  });

  it("returns an empty array while loading or after a load failure", () => {
    expect(getVisibleIssuesForListView({ status: "loading" }, "ready")).toEqual(
      []
    );
    expect(getVisibleIssuesForListView({ status: "loading" }, "all")).toEqual(
      []
    );
    expect(
      getVisibleIssuesForListView(
        {
          error: { kind: "commandFailed", message: "boom" },
          status: "failure",
        },
        "ready"
      )
    ).toEqual([]);
  });
});

describe("getIssueListViewCounts Ready count", () => {
  it("uses readyIssues.length for the Ready count, including zero", () => {
    const populated = successState({
      allIssues: [issue({ id: "bsm-a" })],
      readyIssues: [issue({ id: "bsm-r1" }), issue({ id: "bsm-r2" })],
    });
    expect(getIssueListViewCounts(populated)?.ready).toBe(2);

    const empty = successState({
      allIssues: [issue({ id: "bsm-a" }), issue({ id: "bsm-b" })],
      readyIssues: [],
    });
    expect(getIssueListViewCounts(empty)?.ready).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import type { Issue } from "../rpc/bindings";
import { getChildIssues } from "./issue-hierarchy";

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
  id: "bsm-child",
  labels: [],
  parent: "",
  priority: 2,
  status: "open",
  title: "Child",
  type: "task",
  updatedAt: "2026-07-05T08:00:00Z",
  ...overrides,
});

describe("getChildIssues", () => {
  it("returns every loaded Issue whose parent matches the selected Issue id", () => {
    const parent = buildIssue({ id: "bsm-parent", parent: "" });
    const firstChild = buildIssue({
      id: "bsm-parent.1",
      parent: "bsm-parent",
      status: "open",
      title: "First child",
    });
    const secondChild = buildIssue({
      id: "bsm-parent.2",
      parent: "bsm-parent",
      status: "in_progress",
      title: "Second child",
    });
    const unrelated = buildIssue({
      id: "bsm-other",
      parent: "bsm-other-parent",
      title: "Unrelated",
    });

    expect(
      getChildIssues([parent, firstChild, secondChild, unrelated], "bsm-parent")
    ).toEqual([firstChild, secondChild]);
  });

  it("does not return the selected parent Issue itself even when it is in the input list", () => {
    // In real Beadwork data, a parent Issue has its own `parent` field
    // either empty or pointing to a different Issue. Either way the
    // exact-match rule excludes it from the children of itself.
    const parentWithEmptyParent = buildIssue({
      id: "bsm-parent",
      parent: "",
      title: "Parent with empty parent field",
    });
    const parentPointingUpstream = buildIssue({
      id: "bsm-parent",
      parent: "bsm-grandparent",
      title: "Parent pointing to a grandparent",
    });
    const child = buildIssue({
      id: "bsm-parent.1",
      parent: "bsm-parent",
      title: "Real child",
    });

    expect(
      getChildIssues([parentWithEmptyParent, child], "bsm-parent")
    ).toEqual([child]);
    expect(
      getChildIssues([parentPointingUpstream, child], "bsm-parent")
    ).toEqual([child]);
  });

  it("preserves the incoming allIssues order for multiple children", () => {
    const later = buildIssue({
      id: "bsm-parent.2",
      parent: "bsm-parent",
      title: "Second by command order",
    });
    const earlier = buildIssue({
      id: "bsm-parent.1",
      parent: "bsm-parent",
      title: "First by command order",
    });
    const middle = buildIssue({
      id: "bsm-parent.1.5",
      parent: "bsm-parent",
      title: "Middle by command order",
    });

    expect(
      getChildIssues([later, earlier, middle], "bsm-parent").map((issue) => ({
        id: issue.id,
        title: issue.title,
      }))
    ).toEqual([
      { id: "bsm-parent.2", title: "Second by command order" },
      { id: "bsm-parent.1", title: "First by command order" },
      { id: "bsm-parent.1.5", title: "Middle by command order" },
    ]);
  });

  it("returns an empty array when no loaded Issue references the selected Issue", () => {
    const unrelated = buildIssue({
      id: "bsm-other",
      parent: "bsm-other-parent",
      title: "Unrelated",
    });

    expect(getChildIssues([unrelated], "bsm-missing")).toEqual([]);
  });

  it("returns an empty array for an empty allIssues collection", () => {
    expect(getChildIssues([], "bsm-parent")).toEqual([]);
  });

  it("does not mutate the supplied allIssues collection", () => {
    const parent = buildIssue({ id: "bsm-parent" });
    const firstChild = buildIssue({
      id: "bsm-parent.1",
      parent: "bsm-parent",
    });
    const unrelated = buildIssue({
      id: "bsm-other",
      parent: "bsm-other-parent",
    });
    const allIssues = [parent, firstChild, unrelated];
    const snapshot = allIssues.map((issue) => ({
      id: issue.id,
      parent: issue.parent,
    }));

    getChildIssues(allIssues, "bsm-parent");

    expect(
      allIssues.map((issue) => ({ id: issue.id, parent: issue.parent }))
    ).toEqual(snapshot);
  });

  it("matches the parent field exactly and ignores whitespace-padded or case-different values", () => {
    const exact = buildIssue({
      id: "bsm-parent.1",
      parent: "bsm-parent",
      title: "Exact match",
    });
    const padded = buildIssue({
      id: "bsm-parent.2",
      parent: " bsm-parent ",
      title: "Whitespace padded parent",
    });
    const uppercase = buildIssue({
      id: "bsm-parent.3",
      parent: "BSM-PARENT",
      title: "Uppercase parent",
    });

    expect(getChildIssues([exact, padded, uppercase], "bsm-parent")).toEqual([
      exact,
    ]);
  });

  it("matches when the parent field is empty and the selected Issue id is empty", () => {
    const root = buildIssue({
      id: "",
      parent: "",
      title: "Empty-id root",
    });
    const other = buildIssue({
      id: "bsm-named",
      parent: "",
      title: "Named Issue with empty parent",
    });

    expect(getChildIssues([root, other], "")).toEqual([root, other]);
  });
});

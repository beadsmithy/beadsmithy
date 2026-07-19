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

  it("orders matching children by numeric priority ascending, then by created ascending", () => {
    // Three children with distinct priorities and distinct `created`
    // timestamps so neither key ties. The newer P0 must come before
    // the older P4, and the P1 must sit between them. Priority wins
    // even when the older entry's id sorts first.
    const olderP4 = buildIssue({
      created: "2026-01-01T00:00:00Z",
      id: "bsm-p4-old",
      parent: "bsm-parent",
      priority: 4,
      title: "Older P4",
    });
    const olderP0 = buildIssue({
      created: "2026-01-02T00:00:00Z",
      id: "bsm-p0-old",
      parent: "bsm-parent",
      priority: 0,
      title: "Older P0",
    });
    const newerP0 = buildIssue({
      created: "2026-06-15T12:00:00Z",
      id: "bsm-p0-new",
      parent: "bsm-parent",
      priority: 0,
      title: "Newer P0",
    });
    const olderP1 = buildIssue({
      created: "2026-01-03T00:00:00Z",
      id: "bsm-p1",
      parent: "bsm-parent",
      priority: 1,
      title: "P1",
    });

    expect(
      getChildIssues([olderP4, olderP0, newerP0, olderP1], "bsm-parent").map(
        (issue) => ({ id: issue.id, priority: issue.priority })
      )
    ).toEqual([
      { id: "bsm-p0-old", priority: 0 },
      { id: "bsm-p0-new", priority: 0 },
      { id: "bsm-p1", priority: 1 },
      { id: "bsm-p4-old", priority: 4 },
    ]);
  });

  it("orders same-priority children by created ascending (oldest first)", () => {
    // Priority ties should be broken by `created` string ascending.
    // The two RFC3339 timestamps here differ lexicographically in the
    // same direction they differ chronologically, mirroring Beadwork.
    const newerSamePriority = buildIssue({
      created: "2026-07-10T00:00:00Z",
      id: "bsm-newer",
      parent: "bsm-parent",
      priority: 2,
      title: "Newer P2",
    });
    const olderSamePriority = buildIssue({
      created: "2026-07-01T00:00:00Z",
      id: "bsm-older",
      parent: "bsm-parent",
      priority: 2,
      title: "Older P2",
    });
    const middleSamePriority = buildIssue({
      created: "2026-07-05T00:00:00Z",
      id: "bsm-middle",
      parent: "bsm-parent",
      priority: 2,
      title: "Middle P2",
    });

    expect(
      getChildIssues(
        [newerSamePriority, olderSamePriority, middleSamePriority],
        "bsm-parent"
      ).map((issue) => issue.id)
    ).toEqual(["bsm-older", "bsm-middle", "bsm-newer"]);
  });

  it("retains the incoming order for children with identical priority and created", () => {
    // The runtime's stable sort preserves input order for tied entries.
    // The ordering contract intentionally has no third key.
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

  it("orders priorities numerically rather than lexicographically on the label", () => {
    // "P2" sorts before "P10" lexicographically, but priority 10 has a
    // larger numeric value than priority 2 and so must come after it.
    // Beadwork's slice never exposes priority as a string label here;
    // we still need to be sure we are not sorting on the rendered
    // `P0`/`P1`/... labels in any code path that shares this function.
    const p10 = buildIssue({
      created: "2026-07-01T00:00:00Z",
      id: "bsm-p10",
      parent: "bsm-parent",
      priority: 10,
      title: "P10",
    });
    const p2 = buildIssue({
      created: "2026-07-02T00:00:00Z",
      id: "bsm-p2",
      parent: "bsm-parent",
      priority: 2,
      title: "P2",
    });

    expect(
      getChildIssues([p10, p2], "bsm-parent").map((issue) => issue.id)
    ).toEqual(["bsm-p2", "bsm-p10"]);
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

  it("preserves the incoming allIssues order in the caller's collection after derivation", () => {
    // Even when derived children are reordered by priority and date,
    // the original `allIssues` slice passed in by the Issue Explorer
    // must still appear in its incoming order — the derived collection
    // is derived, not the input.
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
    const unrelated = buildIssue({
      id: "bsm-other",
      parent: "bsm-other-parent",
      title: "Unrelated",
    });
    const allIssues = [unrelated, later, earlier];

    getChildIssues(allIssues, "bsm-parent");

    expect(allIssues.map((issue) => issue.id)).toEqual([
      "bsm-other",
      "bsm-parent.2",
      "bsm-parent.1",
    ]);
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

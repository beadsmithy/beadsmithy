import { describe, expect, it } from "vitest";

import type { Issue } from "../rpc/bindings";
import { buildFocusedIssueGraph } from "./issue-graph";

const issue = (overrides: Partial<Issue> = {}): Issue => ({
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
  id: "bsm-1",
  labels: [],
  parent: "",
  priority: 2,
  status: "open",
  title: "Issue",
  type: "task",
  updatedAt: "2026-07-05T08:00:00Z",
  ...overrides,
});

describe(buildFocusedIssueGraph, () => {
  it("seeds current work and adds each direct parent once", () => {
    const graph = buildFocusedIssueGraph({
      allIssues: [
        issue({ id: "bsm-parent", status: "closed", title: "Parent" }),
        issue({ id: "bsm-parent.2", parent: "bsm-parent", title: "Second" }),
        issue({ id: "bsm-parent.1", parent: "bsm-parent", title: "First" }),
        issue({ id: "bsm-done", status: "closed" }),
      ],
      selectedIssueId: null,
    });

    expect(graph.seedIds).toStrictEqual(["bsm-parent.1", "bsm-parent.2"]);
    expect(graph.nodes.map((node) => node.id)).toStrictEqual([
      "bsm-parent",
      "bsm-parent.1",
      "bsm-parent.2",
    ]);
    expect(graph.edges).toStrictEqual([
      {
        id: "parent:bsm-parent->bsm-parent.1",
        kind: "parent",
        source: "bsm-parent",
        target: "bsm-parent.1",
      },
      {
        id: "parent:bsm-parent->bsm-parent.2",
        kind: "parent",
        source: "bsm-parent",
        target: "bsm-parent.2",
      },
    ]);
  });

  it("includes a selected closed Issue as a seed without inferring dotted parents", () => {
    const graph = buildFocusedIssueGraph({
      allIssues: [
        issue({ id: "bsm-closed", status: "closed" }),
        issue({ id: "bsm-closed.1", status: "closed" }),
        issue({ id: "bsm-open", parent: "bsm-missing" }),
      ],
      selectedIssueId: "bsm-closed",
    });

    expect(graph.seedIds).toStrictEqual(["bsm-closed", "bsm-open"]);
    expect(graph.nodes.map((node) => node.id)).toStrictEqual([
      "bsm-closed",
      "bsm-open",
    ]);
    expect(graph.edges).toStrictEqual([]);
  });

  it("is deterministic when the snapshot order changes", () => {
    const first = [
      issue({ id: "bsm-root", status: "closed" }),
      issue({ id: "bsm-root.2", parent: "bsm-root" }),
      issue({ id: "bsm-root.1", parent: "bsm-root" }),
    ];
    const second = [first[2], first[1], first[0]];

    expect(
      buildFocusedIssueGraph({
        allIssues: first,
        selectedIssueId: null,
      })
    ).toStrictEqual(
      buildFocusedIssueGraph({
        allIssues: second,
        selectedIssueId: null,
      })
    );
  });

  it("adds direct blockers once and keeps blocker direction separate from parent layout", () => {
    const graph = buildFocusedIssueGraph({
      allIssues: [
        issue({ blockedBy: ["bsm-blocker", "bsm-blocker"], id: "bsm-child" }),
        issue({ blocks: ["bsm-child"], id: "bsm-blocker", status: "closed" }),
        issue({ blocks: ["bsm-child"], id: "bsm-unrelated", status: "closed" }),
      ],
      selectedIssueId: null,
    });

    expect(graph.edges).toContainEqual({
      id: "blocker:bsm-blocker->bsm-child",
      kind: "blocker",
      source: "bsm-blocker",
      target: "bsm-child",
    });
    expect(graph.edges).toHaveLength(1);
  });

  it("reports missing parent and blocker endpoints as one structured collection", () => {
    const graph = buildFocusedIssueGraph({
      allIssues: [
        issue({
          blockedBy: ["bsm-absent", "bsm-absent"],
          id: "bsm-child",
          parent: "bsm-parent-absent",
        }),
      ],
      selectedIssueId: null,
    });

    expect(graph.anomalies).toStrictEqual([
      {
        issueId: "bsm-child",
        kind: "missing-blocker",
        referencedIssueId: "bsm-absent",
      },
      {
        issueId: "bsm-child",
        kind: "missing-parent",
        referencedIssueId: "bsm-parent-absent",
      },
    ]);
  });
});

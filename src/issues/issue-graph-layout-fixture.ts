import type { Issue } from "../rpc/bindings";
import { buildFocusedIssueGraph } from "./issue-graph";

const fixtureIssue = (overrides: Partial<Issue> = {}): Issue => ({
  assignee: "",
  blockedBy: [],
  blocks: [],
  closeReason: "",
  closedAt: "",
  comments: [],
  created: "2026-09-18T08:00:00Z",
  deferUntil: "",
  description: "",
  due: "",
  id: "bsm-fixture",
  labels: [],
  parent: "",
  priority: 2,
  status: "open",
  title: "Graph layout fixture",
  type: "task",
  updatedAt: "2026-09-18T08:00:00Z",
  ...overrides,
});

export const createIssueGraphLayoutFixture = () =>
  buildFocusedIssueGraph({
    allIssues: [
      fixtureIssue({
        id: "bsm-fixture-a",
        status: "closed",
        title: "Parent tree A",
      }),
      fixtureIssue({
        blockedBy: ["bsm-fixture-b.1", "bsm-fixture-c.1"],
        id: "bsm-fixture-a.1",
        parent: "bsm-fixture-a",
        title: "A child with cross-tree blockers",
      }),
      fixtureIssue({
        blockedBy: ["bsm-fixture-a.3", "bsm-fixture-b.1", "bsm-fixture-a.3"],
        id: "bsm-fixture-a.2",
        parent: "bsm-fixture-a",
        title: "A child with a duplicate sibling blocker",
      }),
      fixtureIssue({
        blockedBy: ["bsm-fixture-missing"],
        id: "bsm-fixture-a.3",
        parent: "bsm-fixture-a",
        title: "A child with a missing endpoint",
      }),
      fixtureIssue({
        id: "bsm-fixture-b",
        status: "closed",
        title: "Parent tree B",
      }),
      fixtureIssue({
        blockedBy: ["bsm-fixture-a.2"],
        id: "bsm-fixture-b.1",
        parent: "bsm-fixture-b",
        title: "B child forming a blocker cycle",
      }),
      fixtureIssue({
        blockedBy: ["bsm-fixture-b.closed"],
        id: "bsm-fixture-b.2",
        parent: "bsm-fixture-b",
        title: "B child with a closed blocker",
      }),
      fixtureIssue({
        id: "bsm-fixture-b.closed",
        status: "closed",
        title: "Closed blocker",
      }),
      fixtureIssue({
        blockedBy: ["bsm-fixture-a.3"],
        id: "bsm-fixture-c.1",
        title: "Disconnected root with cross-tree blocker",
      }),
      fixtureIssue({
        id: "bsm-fixture-c.2",
        title: "Disconnected sibling",
      }),
      fixtureIssue({
        id: "bsm-fixture-d",
        title: "Disconnected component",
      }),
    ],
    selectedIssueId: null,
  });

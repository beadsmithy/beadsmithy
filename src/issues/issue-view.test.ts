import { describe, expect, it } from "vitest";

import type { Issue } from "../rpc/bindings";
import { toIssueViewModel } from "./issue-view";

const issue = (overrides: Partial<Issue> = {}): Issue => ({
  assignee: "",
  blockedBy: [],
  blocks: [],
  closeReason: "",
  closedAt: "",
  comments: [],
  created: "2026-06-29T08:00:00Z",
  deferUntil: "",
  description: "",
  due: "",
  id: "bsm-mq4.4",
  labels: ["ready-for-agent"],
  parent: "bsm-mq4",
  priority: 2,
  status: "open",
  title: "Render real Issue rows in the issue explorer",
  type: "task",
  updatedAt: "2026-06-29T08:00:00Z",
  ...overrides,
});

describe("toIssueViewModel", () => {
  it("exposes dense row metadata for issues", () => {
    expect(
      toIssueViewModel(issue({ blockedBy: ["bsm-tes"], blocks: ["bsm-mq4.5"] }))
    ).toMatchObject({
      badgeTone: "open",
      dependencyLabel: "blocked by 1 · blocks 1",
      id: "bsm-mq4.4",
      labels: ["ready-for-agent"],
      metadataLabel: "Open, P2, Task, blocked by 1 · blocks 1",
      priorityLabel: "P2",
      statusLabel: "Open",
      title: "Render real Issue rows in the issue explorer",
      tone: "blocked",
      typeLabel: "Task",
    });
  });

  it("handles missing display text without rendering broken labels", () => {
    expect(
      toIssueViewModel(
        issue({
          id: " ",
          labels: ["", "agent"],
          status: "in_progress",
          title: "",
          type: "",
        })
      )
    ).toMatchObject({
      badgeTone: "inProgress",
      id: "unknown",
      labels: ["agent"],
      metadataLabel: "In Progress, P2, Issue",
      statusLabel: "In Progress",
      title: "Untitled issue",
      tone: "inProgress",
      typeLabel: "Issue",
    });
  });
});

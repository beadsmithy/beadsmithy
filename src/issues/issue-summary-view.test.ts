import { describe, expect, it } from "vitest";

import type { IssueSummary } from "../rpc/bindings";
import { toIssueSummaryViewModel } from "./issue-summary-view";

const issue = (overrides: Partial<IssueSummary> = {}): IssueSummary => ({
  assignee: "",
  blockedBy: [],
  blocks: [],
  closedAt: "",
  created: "2026-06-29T08:00:00Z",
  deferUntil: "",
  due: "",
  id: "bsm-mq4.4",
  labels: ["ready-for-agent"],
  parent: "bsm-mq4",
  priority: 2,
  status: "open",
  title: "Render real IssueSummary rows in the issue explorer",
  type: "task",
  updatedAt: "2026-06-29T08:00:00Z",
  ...overrides,
});

describe("toIssueSummaryViewModel", () => {
  it("exposes dense row metadata for issue summaries", () => {
    expect(
      toIssueSummaryViewModel(
        issue({ blockedBy: ["bsm-tes"], blocks: ["bsm-mq4.5"] })
      )
    ).toMatchObject({
      dependencyLabel: "blocked by 1 · blocks 1",
      id: "bsm-mq4.4",
      labels: ["ready-for-agent"],
      metadataLabel: "Open, P2, Task, blocked by 1 · blocks 1",
      priorityLabel: "P2",
      statusLabel: "Open",
      title: "Render real IssueSummary rows in the issue explorer",
      tone: "blocked",
      typeLabel: "Task",
    });
  });

  it("handles missing display text without rendering broken labels", () => {
    expect(
      toIssueSummaryViewModel(
        issue({
          id: " ",
          labels: ["", "agent"],
          status: "in_progress",
          title: "",
          type: "",
        })
      )
    ).toMatchObject({
      id: "unknown",
      labels: ["agent"],
      metadataLabel: "In progress, P2, Issue",
      statusLabel: "In progress",
      title: "Untitled issue",
      tone: "inProgress",
      typeLabel: "Issue",
    });
  });
});

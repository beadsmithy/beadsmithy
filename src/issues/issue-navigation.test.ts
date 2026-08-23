import { describe, expect, it } from "vitest";

import type { Issue } from "../rpc/bindings";
import type { IssueExplorerLoadState } from "./issue-loader";
import {
  isIssueInListView,
  parseIssueExplorerRoute,
  selectIssueForView,
  serializeIssueExplorerRoute,
} from "./issue-navigation";

const issue = (id: string, status = "open"): Issue => ({
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
  id,
  labels: [],
  parent: "",
  priority: 2,
  status,
  title: id,
  type: "task",
  updatedAt: "2026-07-05T08:00:00Z",
});

const state = (
  allIssues: Issue[]
): Extract<IssueExplorerLoadState, { status: "success" }> => ({
  allIssues,
  blockedIssues: [],
  readyIssues: [],
  status: "success",
  workspaceGeneration: 1,
  workspacePath: "/workspace",
});

describe("issue navigation route contract", () => {
  it("round-trips the default route without query parameters", () => {
    const route = parseIssueExplorerRoute("/issues");

    expect(route).toEqual({ issueId: null, search: "", viewId: "all" });
    expect(serializeIssueExplorerRoute(route)).toBe("/issues");
  });

  it("round-trips encoded Issue IDs, views, and raw search", () => {
    const route = {
      issueId: "bsm/issue 1",
      search: "title & status",
      viewId: "in_progress" as const,
    };

    expect(parseIssueExplorerRoute(serializeIssueExplorerRoute(route))).toEqual(
      route
    );
  });

  it("falls back to All for unknown or malformed view values", () => {
    expect(parseIssueExplorerRoute("/issues?view=not-a-view").viewId).toBe(
      "all"
    );
    expect(parseIssueExplorerRoute("/issues?view=%E0%A4%A").viewId).toBe("all");
  });

  it("does not mistake a missing Issue route for a selected route", () => {
    expect(parseIssueExplorerRoute("/issues/")).toEqual({
      issueId: null,
      search: "",
      viewId: "all",
    });
  });

  it("clears a selected Issue when the destination view excludes it", () => {
    const explorerState = state([
      issue("bsm-open"),
      issue("bsm-closed", "closed"),
    ]);

    expect(isIssueInListView(explorerState, "closed", "bsm-open")).toBe(false);
    expect(selectIssueForView(explorerState, "closed", "bsm-open")).toBeNull();
    expect(selectIssueForView(explorerState, "closed", "bsm-closed")).toBe(
      "bsm-closed"
    );
  });
});

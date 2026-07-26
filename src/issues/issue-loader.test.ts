import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type {
  Issue,
  IssueListErrorKind,
  LoadIssueExplorerDataResponse,
} from "../rpc/bindings";
import {
  ISSUE_EXPLORER_LOADING_STATE,
  IssueTransport,
  loadIssueExplorerState,
} from "./issue-loader";

class IssueRpcError extends Error {
  readonly kind: IssueListErrorKind;

  constructor(kind: IssueListErrorKind, message: string) {
    super(message);
    this.name = "IssueRpcError";
    this.kind = kind;
  }
}

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
  id: "bsm-mq4.3",
  labels: ["ready-for-agent"],
  parent: "bsm-mq4",
  priority: 2,
  status: "open",
  title: "Add Effect service for loading issues",
  type: "task",
  updatedAt: "2026-06-29T08:00:00Z",
  ...overrides,
});

const loadWithResponse = (response: LoadIssueExplorerDataResponse) =>
  Effect.runPromise(
    Effect.provideService(loadIssueExplorerState, IssueTransport, {
      loadIssueExplorerData: () => Promise.resolve(response),
    })
  );

describe("loadIssueExplorerState", () => {
  it("exposes a loading state for React consumers before the request resolves", () => {
    expect(ISSUE_EXPLORER_LOADING_STATE).toEqual({ status: "loading" });
  });

  it("maps combined RPC results to a success state with workspace path", async () => {
    const allIssue = issue({ id: "bsm-all", title: "All issue" });
    const readyIssue = issue({ id: "bsm-ready", title: "Ready issue" });
    const blockedIssue = issue({ id: "bsm-blocked", title: "Blocked issue" });

    await expect(
      loadWithResponse({
        allIssues: [allIssue],
        blockedIssues: [blockedIssue],
        readyIssues: [readyIssue],
        workspaceGeneration: 4,
        workspacePath: "/Users/dev/work/portal",
      })
    ).resolves.toEqual({
      allIssues: [allIssue],
      blockedIssues: [blockedIssue],
      readyIssues: [readyIssue],
      status: "success",
      workspaceGeneration: 4,
      workspacePath: "/Users/dev/work/portal",
    });
  });

  it("maps empty RPC arrays to a success state", async () => {
    await expect(
      loadWithResponse({
        allIssues: [],
        blockedIssues: [],
        readyIssues: [],
        workspaceGeneration: 0,
        workspacePath: "/Users/dev/work/empty",
      })
    ).resolves.toEqual({
      allIssues: [],
      blockedIssues: [],
      readyIssues: [],
      status: "success",
      workspaceGeneration: 0,
      workspacePath: "/Users/dev/work/empty",
    });
  });

  it("preserves Ready and Blocked arrays without deriving them from All Issues", async () => {
    const allIssue = issue({ id: "bsm-all", title: "All issue" });
    const readyIssue = issue({ id: "bsm-ready", title: "Ready issue" });
    const blockedIssue = issue({ id: "bsm-blocked", title: "Blocked issue" });

    const state = await loadWithResponse({
      allIssues: [allIssue],
      blockedIssues: [blockedIssue],
      readyIssues: [readyIssue],
      workspaceGeneration: 1,
      workspacePath: "/Users/dev/work/portal",
    });

    expect(state).toMatchObject({
      allIssues: [allIssue],
      blockedIssues: [blockedIssue],
      readyIssues: [readyIssue],
      status: "success",
    });
  });

  it("maps backend read failures to an error state instead of empty collections", async () => {
    const state = await Effect.runPromise(
      Effect.provideService(loadIssueExplorerState, IssueTransport, {
        loadIssueExplorerData: () =>
          Promise.reject(
            new IssueRpcError(
              "notBeadworkWorkspace",
              "The current directory is not a Beadwork workspace."
            )
          ),
      })
    );

    expect(state).toEqual({
      error: {
        kind: "notBeadworkWorkspace",
        message: "The current directory is not a Beadwork workspace.",
      },
      status: "failure",
    });
    expect(state.status).not.toBe("success");
  });
});

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type {
  IssueListErrorKind,
  Issue,
  ListIssuesResponse,
} from "../rpc/bindings";
import {
  IssueTransport,
  ISSUE_LOADING_STATE,
  loadIssueState,
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

const loadWithResponse = (response: ListIssuesResponse) =>
  Effect.runPromise(
    Effect.provideService(loadIssueState, IssueTransport, {
      listIssues: () => Promise.resolve(response),
    })
  );

describe("loadIssueState", () => {
  it("exposes a loading state for React consumers before the request resolves", () => {
    expect(ISSUE_LOADING_STATE).toEqual({ status: "loading" });
  });

  it("maps non-empty RPC results to a success state with workspace path", async () => {
    await expect(
      loadWithResponse({
        issues: [issue()],
        workspacePath: "/Users/dev/work/portal",
      })
    ).resolves.toEqual({
      issues: [issue()],
      status: "success",
      workspacePath: "/Users/dev/work/portal",
    });
  });

  it("maps empty RPC results to an explicit empty state", async () => {
    await expect(
      loadWithResponse({
        issues: [],
        workspacePath: "/Users/dev/work/empty",
      })
    ).resolves.toEqual({
      issues: [],
      status: "empty",
      workspacePath: "/Users/dev/work/empty",
    });
  });

  it("maps backend read failures to an error state instead of an empty list", async () => {
    const state = await Effect.runPromise(
      Effect.provideService(loadIssueState, IssueTransport, {
        listIssues: () =>
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
    expect(state.status).not.toBe("empty");
  });
});

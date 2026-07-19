import { describe, expect, it } from "vitest";

import type { IssueExplorerLoadState } from "../issues/issue-loader";
import type {
  Issue,
  LoadIssueExplorerDataResponse,
  Workspace,
  WorkspaceError,
  WorkspaceState,
} from "../rpc/bindings";
import {
  applyIssueExplorerRefresh,
  applyStartupIssueLoad,
  applyWorkspaceTransition,
  CLEARED_WORKSPACE_REMOUNT_KEY,
  INITIAL_WORKSPACE_REMOUNT_KEY,
  INITIAL_WORKSPACE_TRANSITION_GATE_STATE,
} from "./transition-gate";
import type { WorkspaceTransitionGateState } from "./transition-gate";

const workspace = (
  path: string,
  availability: Workspace["availability"] = "available"
): Workspace => ({ availability, path });

const workspaceState = (
  overrides: Partial<WorkspaceState> = {}
): WorkspaceState => ({
  catalog: [],
  currentWorkspace: null,
  error: null,
  generation: 0,
  pendingWorkspace: null,
  retryWorkspace: null,
  version: 1,
  ...overrides,
});

const snapshot = (
  path: string,
  overrides: Partial<LoadIssueExplorerDataResponse> = {}
): LoadIssueExplorerDataResponse => ({
  allIssues: [],
  blockedIssues: [],
  readyIssues: [],
  workspaceGeneration: 0,
  workspacePath: path,
  ...overrides,
});

const retryableError: WorkspaceError = {
  kind: "loadFailed",
  message: "Snapshot bytes could not be loaded",
  retryable: true,
};

const inlineError: WorkspaceError = {
  kind: "validationFailed",
  message: "Not a Beadwork workspace",
  retryable: true,
};

const initialGate = (
  overrides: Partial<WorkspaceTransitionGateState> = {}
): WorkspaceTransitionGateState => ({
  ...INITIAL_WORKSPACE_TRANSITION_GATE_STATE,
  ...overrides,
});

const buildIssue = (overrides: Partial<Issue> = {}): Issue => ({
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
  id: "bsm-fixture",
  labels: [],
  parent: "",
  priority: 2,
  status: "open",
  title: "fixture",
  type: "task",
  updatedAt: "2026-07-07T08:00:00Z",
  ...overrides,
});

describe("applyWorkspaceTransition", () => {
  it("admits a Pending transition while retaining the existing snapshot", () => {
    const gate = initialGate({ confirmedWorkspacePath: "/work/a" });
    const payload = {
      issueData: null,
      state: workspaceState({
        currentWorkspace: workspace("/work/a"),
        generation: 2,
        pendingWorkspace: workspace("/work/b"),
      }),
    };

    const result = applyWorkspaceTransition(gate, payload, null);

    expect(result.decision).toEqual({ kind: "acceptStateRetainSnapshot" });
    expect(result.next).toEqual(
      initialGate({
        acceptedGeneration: 2,
        confirmedWorkspacePath: "/work/a",
      })
    );
  });

  it("commits a matching snapshot and advances the remount key", () => {
    const gate = initialGate({
      acceptedGeneration: 2,
      confirmedWorkspacePath: "/work/a",
    });
    const matchingSnapshot = snapshot("/work/b");
    const payload = {
      issueData: matchingSnapshot,
      state: workspaceState({
        currentWorkspace: workspace("/work/b"),
        generation: 3,
      }),
    };

    const result = applyWorkspaceTransition(gate, payload, null);

    expect(result.decision).toEqual({
      kind: "commitSnapshot",
      remountKey: "/work/b",
      snapshot: matchingSnapshot,
    });
    expect(result.next).toEqual(
      initialGate({
        acceptedGeneration: 3,
        committedGeneration: 3,
        confirmedWorkspaceGeneration: 0,
        confirmedWorkspacePath: "/work/b",
      })
    );
  });

  it("admits Pending before a matching success, then commits the snapshot", () => {
    const gate = initialGate({ confirmedWorkspacePath: "/work/a" });

    const pending = applyWorkspaceTransition(
      gate,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: workspace("/work/a"),
          generation: 2,
          pendingWorkspace: workspace("/work/b"),
        }),
      },
      null
    );
    expect(pending.decision).toEqual({ kind: "acceptStateRetainSnapshot" });
    expect(pending.next.confirmedWorkspacePath).toBe("/work/a");

    const matchingSnapshot = snapshot("/work/b");
    const commit = applyWorkspaceTransition(
      pending.next,
      {
        issueData: matchingSnapshot,
        state: workspaceState({
          currentWorkspace: workspace("/work/b"),
          generation: 2,
        }),
      },
      2
    );
    expect(commit.decision).toEqual({
      kind: "commitSnapshot",
      remountKey: "/work/b",
      snapshot: matchingSnapshot,
    });
    expect(commit.next.confirmedWorkspacePath).toBe("/work/b");
    expect(commit.next.committedGeneration).toBe(2);
  });

  it("ignores a delayed same-generation Pending after a committed success", () => {
    // The committed-success guard fires before the failure-terminal
    // guard: a same-generation Pending whose Current still points at
    // the previous workspace must also be ignored after commit.
    const committed = initialGate({
      acceptedGeneration: 2,
      committedGeneration: 2,
      confirmedWorkspacePath: "/work/b",
    });

    const latePendingCurrentNull = applyWorkspaceTransition(
      committed,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: null,
          generation: 2,
          pendingWorkspace: workspace("/work/b"),
        }),
      },
      null
    );
    expect(latePendingCurrentNull.decision).toEqual({ kind: "ignore" });
    expect(latePendingCurrentNull.next).toEqual(committed);

    const latePendingCurrentA = applyWorkspaceTransition(
      committed,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: workspace("/work/a"),
          generation: 2,
          pendingWorkspace: workspace("/work/b"),
        }),
      },
      null
    );
    expect(latePendingCurrentA.decision).toEqual({ kind: "ignore" });
    expect(latePendingCurrentA.next).toEqual(committed);
  });

  it("ignores an older-generation transition without advancing any marker", () => {
    const gate = initialGate({
      acceptedGeneration: 3,
      confirmedWorkspacePath: "/work/a",
    });
    const result = applyWorkspaceTransition(
      gate,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: workspace("/work/a"),
          generation: 2,
          pendingWorkspace: workspace("/work/b"),
        }),
      },
      null
    );

    expect(result.decision).toEqual({ kind: "ignore" });
    expect(result.next).toEqual(gate);
  });

  it("ignores a direct RPC response whose generation does not match the expected one", () => {
    const gate = initialGate({
      acceptedGeneration: 2,
      confirmedWorkspacePath: "/work/a",
    });
    const result = applyWorkspaceTransition(
      gate,
      {
        issueData: snapshot("/work/c"),
        state: workspaceState({
          currentWorkspace: workspace("/work/c"),
          generation: 4,
        }),
      },
      3
    );

    expect(result.decision).toEqual({ kind: "ignore" });
    expect(result.next).toEqual(gate);
  });

  it("admits a Pending cancellation while retaining the existing snapshot", () => {
    // A genuine Pending cancellation carries no Issue Explorer
    // snapshot: the prior workspace's issue list must remain rendered.
    const gate = initialGate({
      acceptedGeneration: 3,
      committedGeneration: 3,
      confirmedWorkspacePath: "/work/b",
    });
    const result = applyWorkspaceTransition(
      gate,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: workspace("/work/a"),
          generation: 4,
          pendingWorkspace: null,
        }),
      },
      null
    );

    expect(result.decision).toEqual({ kind: "acceptStateRetainSnapshot" });
    expect(result.next).toEqual(
      initialGate({
        acceptedGeneration: 4,
        committedGeneration: 3,
        confirmedWorkspacePath: "/work/b",
      })
    );
  });

  it("ignores the superseded worker result for a newer selection", () => {
    // Selecting C after selecting B should commit C and reject the
    // late B result that arrives with an older accepted generation.
    const afterB = initialGate({
      acceptedGeneration: 2,
      committedGeneration: 2,
      confirmedWorkspacePath: "/work/b",
    });
    const afterCSelection = applyWorkspaceTransition(
      afterB,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: workspace("/work/b"),
          generation: 3,
          pendingWorkspace: workspace("/work/c"),
        }),
      },
      null
    );
    expect(afterCSelection.decision.kind).toBe("acceptStateRetainSnapshot");

    const lateBResult = applyWorkspaceTransition(
      afterCSelection.next,
      {
        issueData: snapshot("/work/b"),
        state: workspaceState({
          currentWorkspace: workspace("/work/b"),
          generation: 2,
        }),
      },
      2
    );
    expect(lateBResult.decision).toEqual({ kind: "ignore" });
    expect(lateBResult.next).toEqual(afterCSelection.next);
  });

  it("admits a retryable failure and ignores a delayed same-generation Pending replay", () => {
    const gate = initialGate({
      acceptedGeneration: 2,
      confirmedWorkspacePath: "/work/a",
    });

    const failure = applyWorkspaceTransition(
      gate,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: workspace("/work/a"),
          error: retryableError,
          generation: 3,
          retryWorkspace: workspace("/work/b"),
        }),
      },
      null
    );
    expect(failure.decision).toEqual({ kind: "acceptStateRetainSnapshot" });
    expect(failure.next.terminalGeneration).toBe(3);
    expect(failure.next.confirmedWorkspacePath).toBe("/work/a");

    const latePending = applyWorkspaceTransition(
      failure.next,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: workspace("/work/a"),
          error: null,
          generation: 3,
          pendingWorkspace: workspace("/work/b"),
          retryWorkspace: null,
        }),
      },
      null
    );
    expect(latePending.decision).toEqual({ kind: "ignore" });
    expect(latePending.next).toEqual(failure.next);
  });

  it("admits a non-retryable failure with no retry target and ignores a delayed same-generation Pending replay", () => {
    const gate = initialGate({
      acceptedGeneration: 2,
      confirmedWorkspacePath: "/work/a",
    });

    const failure = applyWorkspaceTransition(
      gate,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: workspace("/work/a"),
          error: inlineError,
          generation: 3,
        }),
      },
      null
    );
    expect(failure.decision).toEqual({ kind: "acceptStateRetainSnapshot" });
    expect(failure.next.terminalGeneration).toBe(3);

    const latePending = applyWorkspaceTransition(
      failure.next,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: workspace("/work/a"),
          generation: 3,
          pendingWorkspace: workspace("/work/b"),
        }),
      },
      null
    );
    expect(latePending.decision).toEqual({ kind: "ignore" });
    expect(latePending.next).toEqual(failure.next);
  });

  it("does not advance the terminal marker for a non-retryable failure with a retry target", () => {
    // A non-retryable error that retains a retry target leaves the
    // user a manual retry path; the renderer must not block a delayed
    // same-generation Pending in that case.
    const gate = initialGate({
      acceptedGeneration: 2,
      confirmedWorkspacePath: "/work/a",
    });

    const failure = applyWorkspaceTransition(
      gate,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: workspace("/work/a"),
          error: inlineError,
          generation: 3,
          retryWorkspace: workspace("/work/b"),
        }),
      },
      null
    );
    expect(failure.next.terminalGeneration).toBe(
      INITIAL_WORKSPACE_TRANSITION_GATE_STATE.terminalGeneration
    );

    const pendingReplay = applyWorkspaceTransition(
      failure.next,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: workspace("/work/a"),
          generation: 3,
          pendingWorkspace: workspace("/work/b"),
        }),
      },
      null
    );
    expect(pendingReplay.decision).toEqual({
      kind: "acceptStateRetainSnapshot",
    });
  });

  it("commits a matching snapshot delivered through a cancel-after-commit response", () => {
    // The backend packages the matching Issue Explorer snapshot with
    // the cancel response so the renderer can commit through the same
    // path it uses for a direct switch_workspace response.
    const gate = initialGate({
      acceptedGeneration: 1,
      confirmedWorkspacePath: "/work/a",
    });
    const matchingSnapshot = snapshot("/work/b");

    const result = applyWorkspaceTransition(
      gate,
      {
        issueData: matchingSnapshot,
        state: workspaceState({
          currentWorkspace: workspace("/work/b"),
          generation: 2,
        }),
      },
      null
    );

    expect(result.decision).toEqual({
      kind: "commitSnapshot",
      remountKey: "/work/b",
      snapshot: matchingSnapshot,
    });
    expect(result.next.committedGeneration).toBe(2);
    expect(result.next.confirmedWorkspacePath).toBe("/work/b");
  });

  it("commits a matching snapshot delivered through a retry_workspace_memory response", () => {
    const gate = initialGate({ acceptedGeneration: 1 });
    const matchingSnapshot = snapshot("/work/restored");

    const result = applyWorkspaceTransition(
      gate,
      {
        issueData: matchingSnapshot,
        state: workspaceState({
          currentWorkspace: workspace("/work/restored"),
          generation: 2,
        }),
      },
      null
    );

    expect(result.decision).toEqual({
      kind: "commitSnapshot",
      remountKey: "/work/restored",
      snapshot: matchingSnapshot,
    });
    expect(result.next.confirmedWorkspacePath).toBe("/work/restored");
  });

  it("clears the confirmed snapshot when Current Workspace is removed", () => {
    const gate = initialGate({
      acceptedGeneration: 3,
      committedGeneration: 3,
      confirmedWorkspacePath: "/work/current",
    });

    const result = applyWorkspaceTransition(
      gate,
      {
        issueData: null,
        state: workspaceState({
          catalog: [workspace("/work/other")],
          currentWorkspace: null,
          generation: 4,
        }),
      },
      null
    );

    expect(result.decision).toEqual({
      kind: "clearSnapshot",
      remountKey: CLEARED_WORKSPACE_REMOUNT_KEY,
    });
    expect(result.next.confirmedWorkspacePath).toBeNull();
  });

  it("treats a duplicate clear as non-destructive", () => {
    const afterFirstClear = initialGate({
      acceptedGeneration: 4,
      committedGeneration: 3,
    });

    const duplicate = applyWorkspaceTransition(
      afterFirstClear,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: null,
          generation: 5,
        }),
      },
      null
    );

    expect(duplicate.decision).toEqual({
      kind: "acceptStateRetainSnapshot",
    });
    expect(duplicate.next).toEqual({
      acceptedGeneration: 5,
      acceptedRefreshRevision: null,
      committedGeneration: 3,
      confirmedWorkspaceGeneration: null,
      confirmedWorkspacePath: null,
      terminalGeneration: -1,
    });
  });

  it("admits a remove_workspace refresh that has neither a snapshot nor a confirmed path", () => {
    // The user was already in the chooser (no confirmed snapshot);
    // a remove request that targets a catalog entry that is not
    // Current must still update workspace state but leave the chooser
    // presentation alone.
    const gate = initialGate({ acceptedGeneration: 1 });

    const result = applyWorkspaceTransition(
      gate,
      {
        issueData: null,
        state: workspaceState({
          catalog: [workspace("/work/other")],
          generation: 2,
        }),
      },
      null
    );

    expect(result.decision).toEqual({ kind: "acceptStateRetainSnapshot" });
    expect(result.next.confirmedWorkspacePath).toBeNull();
  });

  it("does not commit a snapshot whose path does not match the Current Workspace", () => {
    // The gate only publishes a matching snapshot. A response whose
    // snapshot and Current point at different paths is treated as a
    // refresh: state is admitted, the prior snapshot is retained.
    const gate = initialGate({
      acceptedGeneration: 1,
      confirmedWorkspacePath: "/work/a",
    });

    const result = applyWorkspaceTransition(
      gate,
      {
        issueData: snapshot("/work/c"),
        state: workspaceState({
          currentWorkspace: workspace("/work/b"),
          generation: 2,
        }),
      },
      null
    );

    expect(result.decision).toEqual({ kind: "acceptStateRetainSnapshot" });
    expect(result.next.confirmedWorkspacePath).toBe("/work/a");
  });
});

describe("applyStartupIssueLoad", () => {
  it("ignores a successful startup load superseded by a later committed switch", () => {
    const gate = initialGate({
      acceptedGeneration: 3,
      committedGeneration: 4,
      confirmedWorkspacePath: "/work/b",
    });
    const load: IssueExplorerLoadState = {
      allIssues: [],
      blockedIssues: [],
      readyIssues: [],
      status: "success",
      workspaceGeneration: 1,
      workspacePath: "/work/a",
    };

    const result = applyStartupIssueLoad(gate, load, 2);

    expect(result.decision).toEqual({ kind: "ignore" });
    expect(result.next).toEqual(gate);
  });

  it("ignores a failed startup load superseded by a later committed switch", () => {
    const gate = initialGate({
      acceptedGeneration: 3,
      committedGeneration: 4,
      confirmedWorkspacePath: "/work/b",
    });
    const load: IssueExplorerLoadState = {
      error: { kind: "unknown", message: "Beadsmith could not load issues." },
      status: "failure",
    };

    const result = applyStartupIssueLoad(gate, load, 2);

    expect(result.decision).toEqual({ kind: "ignore" });
    expect(result.next).toEqual(gate);
  });

  it("commits a non-superseded successful startup load and records the confirmed path", () => {
    const gate = initialGate();
    const load: IssueExplorerLoadState = {
      allIssues: [],
      blockedIssues: [],
      readyIssues: [],
      status: "success",
      workspaceGeneration: 1,
      workspacePath: "/work/a",
    };

    const result = applyStartupIssueLoad(gate, load, -1);

    expect(result.decision).toEqual({
      kind: "commitSnapshot",
      remountKey: "/work/a",
      snapshot: load,
    });
    expect(result.next.confirmedWorkspacePath).toBe("/work/a");
  });

  it("commits a non-superseded failed startup load without recording a confirmed path", () => {
    const gate = initialGate();
    const load: IssueExplorerLoadState = {
      error: { kind: "unknown", message: "Beadsmith could not load issues." },
      status: "failure",
    };

    const result = applyStartupIssueLoad(gate, load, -1);

    expect(result.decision).toEqual({
      kind: "commitSnapshot",
      remountKey: INITIAL_WORKSPACE_REMOUNT_KEY,
      snapshot: load,
    });
    expect(result.next.confirmedWorkspacePath).toBeNull();
  });
});

describe("INITIAL_WORKSPACE_TRANSITION_GATE_STATE", () => {
  it("starts the admitted markers below the lowest possible backend generation", () => {
    expect(INITIAL_WORKSPACE_TRANSITION_GATE_STATE).toEqual({
      acceptedGeneration: 0,
      acceptedRefreshRevision: null,
      committedGeneration: -1,
      confirmedWorkspaceGeneration: null,
      confirmedWorkspacePath: null,
      terminalGeneration: -1,
    });
  });
});

const refreshSnapshot = (
  path: string,
  generation: number,
  overrides: Partial<LoadIssueExplorerDataResponse> = {}
): LoadIssueExplorerDataResponse => ({
  allIssues: [],
  blockedIssues: [],
  readyIssues: [],
  workspaceGeneration: generation,
  workspacePath: path,
  ...overrides,
});

const refreshPayload = (overrides: {
  issueData?: LoadIssueExplorerDataResponse;
  observedRefSha?: string;
  refreshRevision?: number;
  workspacePath?: string;
  workspaceSelectionGeneration?: number;
}) => ({
  issueData:
    overrides.issueData ??
    refreshSnapshot(
      overrides.workspacePath ?? "/work/a",
      overrides.workspaceSelectionGeneration ?? 1
    ),
  observedRefSha: overrides.observedRefSha ?? "abc123",
  refreshRevision: overrides.refreshRevision ?? 1,
  workspacePath: overrides.workspacePath ?? "/work/a",
  workspaceSelectionGeneration: overrides.workspaceSelectionGeneration ?? 1,
});

describe("applyIssueExplorerRefresh", () => {
  it("ignores a refresh when the gate has no confirmed snapshot identity", () => {
    const gate = initialGate();
    const result = applyIssueExplorerRefresh(gate, refreshPayload({}));
    expect(result.decision).toEqual({ kind: "ignore" });
    expect(result.next).toEqual(gate);
  });

  it("admits a matching newer refresh and advances the accepted revision", () => {
    const gate = initialGate({
      acceptedGeneration: 1,
      committedGeneration: 1,
      confirmedWorkspaceGeneration: 1,
      confirmedWorkspacePath: "/work/a",
    });
    const newIssue = buildIssue({ id: "bsm-new", title: "New issue" });
    const result = applyIssueExplorerRefresh(gate, {
      ...refreshPayload({
        refreshRevision: 5,
      }),
      issueData: refreshSnapshot("/work/a", 1, {
        allIssues: [newIssue],
      }),
    });

    expect(result.decision).toEqual({
      kind: "commitRefreshSnapshot",
      snapshot: refreshSnapshot("/work/a", 1, { allIssues: [newIssue] }),
    });
    expect(result.next.acceptedRefreshRevision).toBe(5);
    // Identity markers are untouched: the snapshot is the same workspace.
    expect(result.next.confirmedWorkspacePath).toBe("/work/a");
    expect(result.next.confirmedWorkspaceGeneration).toBe(1);
    expect(result.next.committedGeneration).toBe(1);
  });

  it("ignores an equal revision", () => {
    const gate = initialGate({
      committedGeneration: 1,
      confirmedWorkspaceGeneration: 1,
      confirmedWorkspacePath: "/work/a",
    });
    const result = applyIssueExplorerRefresh(gate, {
      ...refreshPayload({ refreshRevision: 4 }),
      issueData: refreshSnapshot("/work/a", 1, {
        allIssues: [buildIssue({ id: "old", title: "old" })],
      }),
    });
    // First admit: revision 4
    expect(result.decision.kind).toBe("commitRefreshSnapshot");
    expect(result.next.acceptedRefreshRevision).toBe(4);

    // Equal revision must not regress.
    const replay = applyIssueExplorerRefresh(result.next, {
      ...refreshPayload({ refreshRevision: 4 }),
      issueData: refreshSnapshot("/work/a", 1, {
        allIssues: [buildIssue({ id: "stale", title: "stale" })],
      }),
    });
    expect(replay.decision).toEqual({ kind: "ignore" });
    expect(replay.next).toEqual(result.next);
  });

  it("ignores an older revision", () => {
    const gate = initialGate({
      committedGeneration: 1,
      confirmedWorkspaceGeneration: 1,
      confirmedWorkspacePath: "/work/a",
    });
    const newer = applyIssueExplorerRefresh(gate, {
      ...refreshPayload({ refreshRevision: 10 }),
      issueData: refreshSnapshot("/work/a", 1),
    });
    expect(newer.next.acceptedRefreshRevision).toBe(10);

    const older = applyIssueExplorerRefresh(newer.next, {
      ...refreshPayload({ refreshRevision: 9 }),
      issueData: refreshSnapshot("/work/a", 1, {
        allIssues: [buildIssue({ id: "stale", title: "stale" })],
      }),
    });
    expect(older.decision).toEqual({ kind: "ignore" });
    expect(older.next).toEqual(newer.next);
  });

  it("rejects a refresh for a different workspace path", () => {
    const gate = initialGate({
      committedGeneration: 1,
      confirmedWorkspaceGeneration: 1,
      confirmedWorkspacePath: "/work/a",
    });
    const result = applyIssueExplorerRefresh(gate, {
      ...refreshPayload({ workspacePath: "/work/b" }),
      issueData: refreshSnapshot("/work/b", 1),
    });
    expect(result.decision).toEqual({ kind: "ignore" });
    expect(result.next).toEqual(gate);
  });

  it("rejects a refresh for a different selection generation", () => {
    const gate = initialGate({
      committedGeneration: 2,
      confirmedWorkspaceGeneration: 2,
      confirmedWorkspacePath: "/work/a",
    });
    const result = applyIssueExplorerRefresh(gate, {
      ...refreshPayload({
        refreshRevision: 5,
        workspaceSelectionGeneration: 1,
      }),
      issueData: refreshSnapshot("/work/a", 1),
    });
    expect(result.decision).toEqual({ kind: "ignore" });
    expect(result.next).toEqual(gate);
  });

  it("rejects a refresh whose nested snapshot identity disagrees with the outer envelope", () => {
    const gate = initialGate({
      committedGeneration: 1,
      confirmedWorkspaceGeneration: 1,
      confirmedWorkspacePath: "/work/a",
    });
    const result = applyIssueExplorerRefresh(gate, {
      ...refreshPayload({}),
      issueData: refreshSnapshot("/work/b", 1),
    });
    expect(result.decision).toEqual({ kind: "ignore" });
    expect(result.next).toEqual(gate);
  });

  it("a newer event followed by a late older event cannot regress state", () => {
    const gate = initialGate({
      committedGeneration: 1,
      confirmedWorkspaceGeneration: 1,
      confirmedWorkspacePath: "/work/a",
    });
    const newSnapshot = refreshSnapshot("/work/a", 1, {
      allIssues: [buildIssue({ id: "newest", title: "newest" })],
    });
    const newer = applyIssueExplorerRefresh(gate, {
      ...refreshPayload({ refreshRevision: 20 }),
      issueData: newSnapshot,
    });
    expect(newer.decision.kind).toBe("commitRefreshSnapshot");
    expect(newer.next.acceptedRefreshRevision).toBe(20);

    // Late older event arrives after a newer one was admitted.
    const lateOlder = applyIssueExplorerRefresh(newer.next, {
      ...refreshPayload({ refreshRevision: 19 }),
      issueData: refreshSnapshot("/work/a", 1, {
        allIssues: [buildIssue({ id: "stale", title: "stale" })],
      }),
    });
    expect(lateOlder.decision).toEqual({ kind: "ignore" });
    expect(lateOlder.next).toEqual(newer.next);
  });

  it("committing a new workspace snapshot resets the refresh admission marker", () => {
    const gate = initialGate({
      acceptedRefreshRevision: 5,
      committedGeneration: 2,
      confirmedWorkspaceGeneration: 1,
      confirmedWorkspacePath: "/work/a",
    });
    const result = applyWorkspaceTransition(
      gate,
      {
        issueData: refreshSnapshot("/work/b", 2),
        state: workspaceState({
          currentWorkspace: workspace("/work/b"),
          generation: 3,
        }),
      },
      null
    );

    expect(result.decision.kind).toBe("commitSnapshot");
    expect(result.next.confirmedWorkspacePath).toBe("/work/b");
    expect(result.next.confirmedWorkspaceGeneration).toBe(2);
    expect(result.next.acceptedRefreshRevision).toBeNull();
  });

  it("a Pending transition retains the rendered identity, then succeeds into B without reset", () => {
    // Pending transitions must not clear the confirmed identity so a
    // refresh event for the still-current A is not silently dropped
    // during the switch attempt.
    const gate = initialGate({
      acceptedRefreshRevision: 5,
      committedGeneration: 2,
      confirmedWorkspaceGeneration: 2,
      confirmedWorkspacePath: "/work/a",
    });
    const pending = applyWorkspaceTransition(
      gate,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: workspace("/work/a"),
          generation: 3,
          pendingWorkspace: workspace("/work/b"),
        }),
      },
      null
    );
    expect(pending.decision.kind).toBe("acceptStateRetainSnapshot");
    expect(pending.next.confirmedWorkspacePath).toBe("/work/a");
    expect(pending.next.confirmedWorkspaceGeneration).toBe(2);
    expect(pending.next.acceptedRefreshRevision).toBe(5);
  });

  it("clearing Current clears the refresh identity", () => {
    const gate = initialGate({
      acceptedRefreshRevision: 5,
      committedGeneration: 3,
      confirmedWorkspaceGeneration: 2,
      confirmedWorkspacePath: "/work/a",
    });
    const result = applyWorkspaceTransition(
      gate,
      {
        issueData: null,
        state: workspaceState({
          currentWorkspace: null,
          generation: 4,
        }),
      },
      null
    );

    expect(result.decision.kind).toBe("clearSnapshot");
    expect(result.next.confirmedWorkspacePath).toBeNull();
    expect(result.next.confirmedWorkspaceGeneration).toBeNull();
    expect(result.next.acceptedRefreshRevision).toBeNull();
  });
});

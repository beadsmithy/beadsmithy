import { describe, expect, it } from "vitest";

import type { IssueExplorerLoadState } from "../issues/issue-loader";
import type {
  LoadIssueExplorerDataResponse,
  Workspace,
  WorkspaceError,
  WorkspaceState,
} from "../rpc/bindings";
import {
  applyStartupIssueLoad,
  applyWorkspaceTransition,
  CLEARED_WORKSPACE_REMOTE_KEY,
  INITIAL_WORKSPACE_REMOTE_KEY,
  INITIAL_WORKSPACE_TRANSITION_GATE_STATE,
} from "./transition-gate";

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

const initialGate = () => ({ ...INITIAL_WORKSPACE_TRANSITION_GATE_STATE });

describe("applyWorkspaceTransition", () => {
  it("admits a Pending transition while retaining the existing snapshot", () => {
    const gate = {
      ...initialGate(),
      confirmedWorkspacePath: "/work/a",
    };
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
    expect(result.next).toEqual({
      acceptedGeneration: 2,
      committedGeneration: -1,
      confirmedWorkspacePath: "/work/a",
      terminalGeneration: -1,
    });
  });

  it("commits a matching snapshot and advances the remount key", () => {
    const gate = {
      ...initialGate(),
      acceptedGeneration: 2,
      confirmedWorkspacePath: "/work/a",
    };
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
    expect(result.next).toEqual({
      acceptedGeneration: 3,
      committedGeneration: 3,
      confirmedWorkspacePath: "/work/b",
      terminalGeneration: -1,
    });
  });

  it("admits Pending before a matching success, then commits the snapshot", () => {
    const gate = {
      ...initialGate(),
      confirmedWorkspacePath: "/work/a",
    };

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
    const committed = {
      acceptedGeneration: 2,
      committedGeneration: 2,
      confirmedWorkspacePath: "/work/b",
      terminalGeneration: -1,
    };

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
    const gate = {
      acceptedGeneration: 3,
      committedGeneration: -1,
      confirmedWorkspacePath: "/work/a",
      terminalGeneration: -1,
    };
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
    const gate = {
      acceptedGeneration: 2,
      committedGeneration: -1,
      confirmedWorkspacePath: "/work/a",
      terminalGeneration: -1,
    };
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
    const gate = {
      acceptedGeneration: 3,
      committedGeneration: 3,
      confirmedWorkspacePath: "/work/b",
      terminalGeneration: -1,
    };
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
    expect(result.next).toEqual({
      acceptedGeneration: 4,
      committedGeneration: 3,
      confirmedWorkspacePath: "/work/b",
      terminalGeneration: -1,
    });
  });

  it("ignores the superseded worker result for a newer selection", () => {
    // Selecting C after selecting B should commit C and reject the
    // late B result that arrives with an older accepted generation.
    const afterB = {
      acceptedGeneration: 2,
      committedGeneration: 2,
      confirmedWorkspacePath: "/work/b",
      terminalGeneration: -1,
    };
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
    const gate = {
      acceptedGeneration: 2,
      committedGeneration: -1,
      confirmedWorkspacePath: "/work/a",
      terminalGeneration: -1,
    };

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
    const gate = {
      acceptedGeneration: 2,
      committedGeneration: -1,
      confirmedWorkspacePath: "/work/a",
      terminalGeneration: -1,
    };

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
    const gate = {
      acceptedGeneration: 2,
      committedGeneration: -1,
      confirmedWorkspacePath: "/work/a",
      terminalGeneration: -1,
    };

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
    expect(failure.next.terminalGeneration).toBe(-1);

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
    const gate = {
      acceptedGeneration: 1,
      committedGeneration: -1,
      confirmedWorkspacePath: "/work/a",
      terminalGeneration: -1,
    };
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
    const gate = {
      acceptedGeneration: 1,
      committedGeneration: -1,
      confirmedWorkspacePath: null,
      terminalGeneration: -1,
    };
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
    const gate = {
      acceptedGeneration: 3,
      committedGeneration: 3,
      confirmedWorkspacePath: "/work/current",
      terminalGeneration: -1,
    };

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
      remountKey: CLEARED_WORKSPACE_REMOTE_KEY,
    });
    expect(result.next.confirmedWorkspacePath).toBeNull();
  });

  it("treats a duplicate clear as non-destructive", () => {
    const afterFirstClear = {
      acceptedGeneration: 4,
      committedGeneration: 3,
      confirmedWorkspacePath: null,
      terminalGeneration: -1,
    };

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
      committedGeneration: 3,
      confirmedWorkspacePath: null,
      terminalGeneration: -1,
    });
  });

  it("admits a remove_workspace refresh that has neither a snapshot nor a confirmed path", () => {
    // The user was already in the chooser (no confirmed snapshot);
    // a remove request that targets a catalog entry that is not
    // Current must still update workspace state but leave the chooser
    // presentation alone.
    const gate = {
      acceptedGeneration: 1,
      committedGeneration: -1,
      confirmedWorkspacePath: null,
      terminalGeneration: -1,
    };

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
    const gate = {
      acceptedGeneration: 1,
      committedGeneration: -1,
      confirmedWorkspacePath: "/work/a",
      terminalGeneration: -1,
    };

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
    const gate = {
      acceptedGeneration: 3,
      committedGeneration: 4,
      confirmedWorkspacePath: "/work/b",
      terminalGeneration: -1,
    };
    const load: IssueExplorerLoadState = {
      allIssues: [],
      blockedIssues: [],
      readyIssues: [],
      status: "success",
      workspacePath: "/work/a",
    };

    const result = applyStartupIssueLoad(gate, load, 2);

    expect(result.decision).toEqual({ kind: "ignore" });
    expect(result.next).toEqual(gate);
  });

  it("ignores a failed startup load superseded by a later committed switch", () => {
    const gate = {
      acceptedGeneration: 3,
      committedGeneration: 4,
      confirmedWorkspacePath: "/work/b",
      terminalGeneration: -1,
    };
    const load: IssueExplorerLoadState = {
      error: { kind: "unknown", message: "Beadsmith could not load issues." },
      status: "failure",
    };

    const result = applyStartupIssueLoad(gate, load, 2);

    expect(result.decision).toEqual({ kind: "ignore" });
    expect(result.next).toEqual(gate);
  });

  it("commits a non-superseded successful startup load and records the confirmed path", () => {
    const gate = {
      acceptedGeneration: 0,
      committedGeneration: -1,
      confirmedWorkspacePath: null,
      terminalGeneration: -1,
    };
    const load: IssueExplorerLoadState = {
      allIssues: [],
      blockedIssues: [],
      readyIssues: [],
      status: "success",
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
      remountKey: INITIAL_WORKSPACE_REMOTE_KEY,
      snapshot: load,
    });
    expect(result.next.confirmedWorkspacePath).toBeNull();
  });

  it("uses the initial remount key when a successful startup load reports no workspace path", () => {
    // The backend's initial-load response always carries a workspace
    // path; the empty-string branch keeps the gate well-defined if
    // that contract changes for a no-workspace startup state.
    const gate = initialGate();
    const load: IssueExplorerLoadState = {
      allIssues: [],
      blockedIssues: [],
      readyIssues: [],
      status: "success",
      workspacePath: "",
    };

    const result = applyStartupIssueLoad(gate, load, -1);

    expect(result.decision).toMatchObject({
      kind: "commitSnapshot",
      remountKey: INITIAL_WORKSPACE_REMOTE_KEY,
    });
    expect(result.next.confirmedWorkspacePath).toBe("");
  });
});

describe("INITIAL_WORKSPACE_TRANSITION_GATE_STATE", () => {
  it("starts the admitted markers below the lowest possible backend generation", () => {
    expect(INITIAL_WORKSPACE_TRANSITION_GATE_STATE).toEqual({
      acceptedGeneration: 0,
      committedGeneration: -1,
      confirmedWorkspacePath: null,
      terminalGeneration: -1,
    });
  });
});

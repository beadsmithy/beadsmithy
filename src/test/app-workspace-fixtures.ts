import type { IssueExplorerLoadState } from "../issues/issue-loader";
import type { Issue, WorkspaceState } from "../rpc/bindings";

export interface WorkspaceTransitionEvent {
  payload: {
    issueData: unknown;
    state: WorkspaceState;
  };
}

export type WorkspaceTransitionListener = (
  event: WorkspaceTransitionEvent
) => void;

export const buildIssue = (overrides: Partial<Issue> = {}): Issue => ({
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
  id: "bsm-dbh.2",
  labels: [],
  parent: "bsm-dbh",
  priority: 2,
  status: "open",
  title: "Model Issue List Views",
  type: "task",
  updatedAt: "2026-07-07T08:00:00Z",
  ...overrides,
});

export const successState = (overrides: {
  allIssues?: Issue[];
  readyIssues?: Issue[];
  blockedIssues?: Issue[];
  workspacePath?: string;
}): IssueExplorerLoadState => ({
  allIssues: overrides.allIssues ?? [],
  blockedIssues: overrides.blockedIssues ?? [],
  readyIssues: overrides.readyIssues ?? [],
  status: "success",
  workspacePath: overrides.workspacePath ?? "/Users/dev/work/beads",
});

export const failureState: IssueExplorerLoadState = {
  error: { kind: "commandFailed", message: "Could not list issues." },
  status: "failure",
};

export const workspace = (
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

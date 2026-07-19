import type { IssueExplorerLoadState } from "../issues/issue-loader";
import type {
  Issue,
  LoadIssueExplorerDataResponse,
  WorkspaceState,
} from "../rpc/bindings";

export interface WorkspaceTransitionEvent {
  payload: {
    issueData: unknown;
    state: WorkspaceState;
  };
}

export type WorkspaceTransitionListener = (
  event: WorkspaceTransitionEvent
) => void;

export interface IssueExplorerRefreshEvent {
  payload: {
    issueData: LoadIssueExplorerDataResponse;
    observedRefSha: string;
    refreshRevision: number;
    workspacePath: string;
    workspaceSelectionGeneration: number;
  };
}

export type IssueExplorerRefreshListener = (
  event: IssueExplorerRefreshEvent
) => void;

export interface WorkspaceListenerSet {
  transition?: WorkspaceTransitionListener;
  refresh?: IssueExplorerRefreshListener;
}

/**
 * Build a Tauri `listen` mock implementation that captures both the
 * Workspace-transition and Issue Explorer refresh listeners by event
 * name. Tests dispatch each payload type through the matching captured
 * callback. Mirrors the production App.tsx subscription order:
 * Workspace-transition is registered first, refresh second.
 */
type ListenHandler = (event: { payload: unknown }) => void;
type ListenImplementation = (
  eventName: string,
  callback: ListenHandler
) => Promise<() => void>;

export const createBothListenersMock = (): {
  listeners: WorkspaceListenerSet;
  implementation: ListenImplementation;
} => {
  const listeners: WorkspaceListenerSet = {};
  // The Tauri `listen` mock intentionally accepts a callback to mirror
  // the production API shape; the callback is stored on the listener
  // record for tests to dispatch payloads through later.
  const implementation: ListenImplementation =
    /* eslint-disable-next-line promise/prefer-await-to-callbacks */
    /* oxlint-disable-next-line promise/prefer-await-to-callbacks */
    (eventName, callback): Promise<() => void> => {
      if (eventName === "workspace-transition") {
        listeners.transition = callback as WorkspaceTransitionListener;
      } else if (eventName === "beadwork://issue-explorer-state-changed") {
        listeners.refresh = callback as IssueExplorerRefreshListener;
      }
      return Promise.resolve((): void => {
        // mock unlisten no-op
      });
    };
  return { implementation, listeners };
};

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
  workspaceGeneration?: number;
  workspacePath?: string;
}): IssueExplorerLoadState => ({
  allIssues: overrides.allIssues ?? [],
  blockedIssues: overrides.blockedIssues ?? [],
  readyIssues: overrides.readyIssues ?? [],
  status: "success",
  workspaceGeneration: overrides.workspaceGeneration ?? 1,
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

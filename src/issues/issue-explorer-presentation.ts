import type { RefreshHealth } from "../refresh-health";
import type { WorkspaceState } from "../rpc/bindings";
import {
  INITIAL_WORKSPACE_REMOUNT_KEY,
  INITIAL_WORKSPACE_TRANSITION_GATE_STATE,
} from "../workspaces/transition-gate";
import type { IssueExplorerLoadState } from "./issue-loader";

const NO_WORKSPACE_ERROR_STATE: IssueExplorerLoadState = {
  error: {
    kind: "noWorkspace",
    message: "Select a workspace to load issues.",
  },
  status: "failure",
};

export const INITIAL_LOAD_FAILURE_STATE: IssueExplorerLoadState = {
  error: {
    kind: "unknown",
    message: "Beadsmith could not load issues.",
  },
  status: "failure",
};

export interface IssueExplorerPresentation {
  readonly confirmedWorkspacePath: string | null;
  readonly dismissedSwitchErrorGeneration: number | null;
  readonly issueState: IssueExplorerLoadState;
  readonly refreshHealth: RefreshHealth | null;
  readonly workspaceKey: string;
  readonly workspaceState: WorkspaceState | null;
}

export type IssueExplorerPresentationUpdate =
  Partial<IssueExplorerPresentation>;

export type PublishIssueExplorerPresentation = (
  update: IssueExplorerPresentationUpdate
) => void;

export const INITIAL_ISSUE_EXPLORER_PRESENTATION: IssueExplorerPresentation = {
  confirmedWorkspacePath:
    INITIAL_WORKSPACE_TRANSITION_GATE_STATE.confirmedWorkspacePath,
  dismissedSwitchErrorGeneration: null,
  issueState: {
    status: "loading",
  },
  refreshHealth: null,
  workspaceKey: INITIAL_WORKSPACE_REMOUNT_KEY,
  workspaceState: null,
};

export const noWorkspacePresentation = (
  workspaceKey: string
): IssueExplorerPresentationUpdate => ({
  issueState: NO_WORKSPACE_ERROR_STATE,
  workspaceKey,
});

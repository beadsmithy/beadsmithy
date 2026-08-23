import type {
  LoadIssueExplorerDataResponse,
  WorkspaceState,
} from "../rpc/bindings";
import type { WorkspaceTransitionDecision } from "./transition-gate";

export interface WorkspaceTransition {
  issueData: LoadIssueExplorerDataResponse | null;
  state: WorkspaceState;
}

export type ApplyWorkspaceTransition = (
  transition: WorkspaceTransition,
  expectedGeneration: number | null
) => WorkspaceTransitionDecision;

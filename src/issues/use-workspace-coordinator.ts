import { open } from "@tauri-apps/plugin-dialog";
import type { MutableRefObject } from "react";
import { useCallback } from "react";

import { pickerDefaultPath } from "../components/WorkspaceSelector";
import { createTauRPCProxy } from "../rpc/bindings";
import type {
  LoadIssueExplorerDataResponse,
  WorkspaceState,
} from "../rpc/bindings";
import type { WorkspaceTransitionGateState } from "../workspaces/transition-gate";
import type { IssueExplorerLoadState } from "./issue-loader";

interface WorkspaceTransition {
  issueData: LoadIssueExplorerDataResponse | null;
  state: WorkspaceState;
}

type ApplyTransition = (
  transition: WorkspaceTransition,
  expectedGeneration: number | null
) => unknown;

const NO_WORKSPACE_ERROR_STATE: IssueExplorerLoadState = {
  error: {
    kind: "noWorkspace",
    message: "Select a workspace to load issues.",
  },
  status: "failure",
};

const applyNoWorkspacePresentation = (
  setIssueState: (state: IssueExplorerLoadState) => void,
  setWorkspaceKey: (key: string) => void
): void => {
  setIssueState(NO_WORKSPACE_ERROR_STATE);
  setWorkspaceKey("/__reset__");
};

export interface WorkspaceCoordinatorOptions {
  applyTransition: ApplyTransition;
  manualWorkspaceSwitchRef: MutableRefObject<boolean>;
  setDismissedSwitchErrorGeneration: (generation: number | null) => void;
  setIssueState: (state: IssueExplorerLoadState) => void;
  setWorkspaceKey: (key: string) => void;
  transitionGateRef: MutableRefObject<WorkspaceTransitionGateState>;
  workspaceState: WorkspaceState | null;
}

export interface WorkspaceCoordinatorResult {
  refreshWorkspaceState: () => Promise<void>;
  workspaceHandlers: {
    onCancel: (() => void) | undefined;
    onChoose: () => void;
    onDismissSwitchError: () => void;
    onRemove: (path: string) => void;
    onResetMemory: () => void;
    onRetryLastSwitch: (() => void) | undefined;
    onRetryMemory: () => void;
    onSelect: (path: string) => void;
  };
}

export const useWorkspaceCoordinator = ({
  applyTransition,
  manualWorkspaceSwitchRef,
  setDismissedSwitchErrorGeneration,
  setIssueState,
  setWorkspaceKey,
  transitionGateRef,
  workspaceState,
}: WorkspaceCoordinatorOptions): WorkspaceCoordinatorResult => {
  const refreshWorkspaceState = useCallback(async () => {
    try {
      const next = await createTauRPCProxy().workspace_state();
      applyTransition({ issueData: null, state: next }, null);
    } catch {
      // No typed state is available if the transport itself is unavailable.
    }
  }, [applyTransition]);

  const selectWorkspace = async (path: string): Promise<void> => {
    manualWorkspaceSwitchRef.current = true;
    const expectedGeneration = transitionGateRef.current.acceptedGeneration + 1;
    setDismissedSwitchErrorGeneration(null);
    try {
      const response = await createTauRPCProxy().switch_workspace(path);
      applyTransition(
        { issueData: response.issueData, state: response.state },
        expectedGeneration
      );
    } catch {
      await refreshWorkspaceState();
    }
  };

  const chooseWorkspace = async (): Promise<void> => {
    try {
      const selection = await open({
        defaultPath: pickerDefaultPath(workspaceState) ?? undefined,
        directory: true,
        multiple: false,
      });
      if (typeof selection === "string") {
        await selectWorkspace(selection);
      }
    } catch {
      await refreshWorkspaceState();
    }
  };

  const removeWorkspace = async (path: string): Promise<void> => {
    try {
      const state = await createTauRPCProxy().remove_workspace(path);
      applyTransition({ issueData: null, state }, null);
    } catch {
      await refreshWorkspaceState();
    }
  };

  const retryWorkspaceMemory = async (): Promise<void> => {
    try {
      const response = await createTauRPCProxy().retry_workspace_memory();
      applyTransition(
        { issueData: response.issueData, state: response.state },
        null
      );
    } catch {
      await refreshWorkspaceState();
    }
  };

  const resetWorkspaceMemory = async (): Promise<void> => {
    try {
      const state = await createTauRPCProxy().reset_workspace_memory();
      applyTransition({ issueData: null, state }, null);
      applyNoWorkspacePresentation(setIssueState, setWorkspaceKey);
    } catch {
      await refreshWorkspaceState();
    }
  };

  const cancelWorkspace = async (): Promise<void> => {
    try {
      const response = await createTauRPCProxy().cancel_workspace();
      applyTransition(
        { issueData: response.issueData, state: response.state },
        null
      );
    } catch {
      await refreshWorkspaceState();
    }
  };

  const retryLastSwitch = async (): Promise<void> => {
    const retryPath = workspaceState?.retryWorkspace?.path;
    if (retryPath !== null && retryPath !== undefined && retryPath !== "") {
      await selectWorkspace(retryPath);
    }
  };

  const dismissSwitchError = (): void => {
    setDismissedSwitchErrorGeneration(workspaceState?.generation ?? null);
  };

  return {
    refreshWorkspaceState,
    workspaceHandlers: {
      onCancel:
        workspaceState?.pendingWorkspace === null ||
        workspaceState?.pendingWorkspace === undefined
          ? undefined
          : () => void cancelWorkspace(),
      onChoose: () => void chooseWorkspace(),
      onDismissSwitchError: dismissSwitchError,
      onRemove: (path: string) => void removeWorkspace(path),
      onResetMemory: () => void resetWorkspaceMemory(),
      onRetryLastSwitch:
        workspaceState?.retryWorkspace === null ||
        workspaceState?.retryWorkspace === undefined
          ? undefined
          : () => void retryLastSwitch(),
      onRetryMemory: () => void retryWorkspaceMemory(),
      onSelect: (path: string) => void selectWorkspace(path),
    },
  };
};

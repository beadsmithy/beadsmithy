import { open } from "@tauri-apps/plugin-dialog";
import type { MutableRefObject } from "react";
import { useCallback, useMemo } from "react";

import { pickerDefaultPath } from "../components/WorkspaceSelector";
import type { WorkspaceState } from "../rpc/bindings";
import type { ApplyWorkspaceTransition } from "../workspaces/transition-contract";
import type { WorkspaceTransitionGateState } from "../workspaces/transition-gate";
import {
  cancelWorkspace as cancelWorkspaceEffect,
  createTauRpcWorkspaceService,
  readWorkspaceState,
  removeWorkspace as removeWorkspaceEffect,
  resetWorkspaceMemory as resetWorkspaceMemoryEffect,
  retryWorkspaceMemory as retryWorkspaceMemoryEffect,
  runWorkspaceEffect,
  switchWorkspace,
} from "../workspaces/workspace-service";
import type { WorkspaceServiceClient } from "../workspaces/workspace-service";
import type { IssueExplorerLoadState } from "./issue-loader";
import {
  beginNavigationIntent,
  finishNavigationIntent,
  isCurrentNavigationIntent,
} from "./navigation-intent";
import type { NavigationIntentRef } from "./navigation-intent";

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
  applyTransition: ApplyWorkspaceTransition;
  manualWorkspaceSwitchRef: MutableRefObject<boolean>;
  navigationIntentRef: NavigationIntentRef;
  setDismissedSwitchErrorGeneration: (generation: number | null) => void;
  setIssueState: (state: IssueExplorerLoadState) => void;
  setWorkspaceKey: (key: string) => void;
  transitionGateRef: MutableRefObject<WorkspaceTransitionGateState>;
  workspaceService?: WorkspaceServiceClient;
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
  navigationIntentRef,
  setDismissedSwitchErrorGeneration,
  setIssueState,
  setWorkspaceKey,
  transitionGateRef,
  workspaceService: injectedWorkspaceService,
  workspaceState,
}: WorkspaceCoordinatorOptions): WorkspaceCoordinatorResult => {
  const workspaceService = useMemo(
    () => injectedWorkspaceService ?? createTauRpcWorkspaceService(),
    [injectedWorkspaceService]
  );

  const refreshWorkspaceState = useCallback(async () => {
    const result = await runWorkspaceEffect(
      readWorkspaceState,
      workspaceService
    );
    if (!result.ok) {
      return;
    }
    applyTransition({ issueData: null, state: result.value }, null);
  }, [applyTransition, workspaceService]);

  const selectWorkspace = async (path: string): Promise<void> => {
    manualWorkspaceSwitchRef.current = true;
    const expectedGeneration = transitionGateRef.current.acceptedGeneration + 1;
    const intentGeneration = beginNavigationIntent(navigationIntentRef, path);
    setDismissedSwitchErrorGeneration(null);
    const result = await runWorkspaceEffect(
      switchWorkspace(path),
      workspaceService
    );
    if (!result.ok) {
      if (isCurrentNavigationIntent(navigationIntentRef, intentGeneration)) {
        finishNavigationIntent(navigationIntentRef, intentGeneration);
        await refreshWorkspaceState();
      }
      return;
    }
    if (!isCurrentNavigationIntent(navigationIntentRef, intentGeneration)) {
      return;
    }
    applyTransition(
      { issueData: result.value.issueData, state: result.value.state },
      expectedGeneration
    );
    finishNavigationIntent(navigationIntentRef, intentGeneration);
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

  const removeSelectedWorkspace = async (path: string): Promise<void> => {
    const result = await runWorkspaceEffect(
      removeWorkspaceEffect(path),
      workspaceService
    );
    if (!result.ok) {
      await refreshWorkspaceState();
      return;
    }
    applyTransition({ issueData: null, state: result.value }, null);
  };

  const retryMemory = async (): Promise<void> => {
    const result = await runWorkspaceEffect(
      retryWorkspaceMemoryEffect,
      workspaceService
    );
    if (!result.ok) {
      await refreshWorkspaceState();
      return;
    }
    applyTransition(
      { issueData: result.value.issueData, state: result.value.state },
      null
    );
  };

  const resetMemory = async (): Promise<void> => {
    const result = await runWorkspaceEffect(
      resetWorkspaceMemoryEffect,
      workspaceService
    );
    if (!result.ok) {
      await refreshWorkspaceState();
      return;
    }
    applyTransition({ issueData: null, state: result.value }, null);
    applyNoWorkspacePresentation(setIssueState, setWorkspaceKey);
  };

  const cancelPendingWorkspace = async (): Promise<void> => {
    const result = await runWorkspaceEffect(
      cancelWorkspaceEffect,
      workspaceService
    );
    if (!result.ok) {
      await refreshWorkspaceState();
      return;
    }
    applyTransition(
      { issueData: result.value.issueData, state: result.value.state },
      null
    );
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
          : () => void cancelPendingWorkspace(),
      onChoose: () => void chooseWorkspace(),
      onDismissSwitchError: dismissSwitchError,
      onRemove: (path: string) => void removeSelectedWorkspace(path),
      onResetMemory: () => void resetMemory(),
      onRetryLastSwitch:
        workspaceState?.retryWorkspace === null ||
        workspaceState?.retryWorkspace === undefined
          ? undefined
          : () => void retryLastSwitch(),
      onRetryMemory: () => void retryMemory(),
      onSelect: (path: string) => void selectWorkspace(path),
    },
  };
};

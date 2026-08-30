import { open } from "@tauri-apps/plugin-dialog";
import type { Effect as EffectType } from "effect";
import type { MutableRefObject } from "react";
import { useCallback, useRef } from "react";

import { pickerDefaultPath } from "../components/WorkspaceSelector";
import { useExternalLifecycle } from "../lib/use-external-lifecycle";
import type { WorkspaceState } from "../rpc/bindings";
import type { ApplyWorkspaceTransition } from "../workspaces/transition-contract";
import type { WorkspaceTransitionGateState } from "../workspaces/transition-gate";
import {
  cancelWorkspaceSelection,
  interruptWorkspaceProgram,
  observeWorkspaceProgram,
  readWorkspaceState,
  removeWorkspace,
  resetWorkspaceMemory,
  retryWorkspaceMemory,
  selectWorkspace,
  startWorkspaceProgram,
  useWorkspaceServiceLayer,
} from "../workspaces/workspace-service";
import type {
  WorkspaceProgramFiber,
  WorkspaceService,
  WorkspaceServiceFailure,
} from "../workspaces/workspace-service";
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

const ignoreWorkspaceFailure = (_error: WorkspaceServiceFailure): void => {
  // The existing workspace snapshot remains the authoritative presentation.
};

export interface WorkspaceCoordinatorOptions {
  applyTransition: ApplyWorkspaceTransition;
  manualWorkspaceSwitchRef: MutableRefObject<boolean>;
  navigationIntentRef: NavigationIntentRef;
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
  navigationIntentRef,
  setDismissedSwitchErrorGeneration,
  setIssueState,
  setWorkspaceKey,
  transitionGateRef,
  workspaceState,
}: WorkspaceCoordinatorOptions): WorkspaceCoordinatorResult => {
  const workspaceServiceLayer = useWorkspaceServiceLayer();
  const activeProgramsRef = useRef<Set<WorkspaceProgramFiber>>(new Set());

  const stopActivePrograms = useCallback(() => {
    for (const fiber of activeProgramsRef.current) {
      interruptWorkspaceProgram(fiber);
    }
    activeProgramsRef.current.clear();
  }, []);

  const runProgram = useCallback(
    <A>(
      program: EffectType.Effect<A, WorkspaceServiceFailure, WorkspaceService>,
      onFailure: (error: WorkspaceServiceFailure) => void | Promise<void>,
      onSuccess: (value: A) => void | Promise<void>,
      supersedeActive = true
    ): Promise<void> => {
      if (supersedeActive) {
        stopActivePrograms();
      }
      const fiber = startWorkspaceProgram(program, workspaceServiceLayer);
      activeProgramsRef.current.add(fiber);
      return observeWorkspaceProgram(
        fiber,
        async (error) => {
          activeProgramsRef.current.delete(fiber);
          await onFailure(error);
        },
        async (value) => {
          activeProgramsRef.current.delete(fiber);
          await onSuccess(value);
        }
      );
    },
    [stopActivePrograms, workspaceServiceLayer]
  );

  const refreshWorkspaceState = useCallback(
    (): Promise<void> =>
      runProgram(readWorkspaceState, ignoreWorkspaceFailure, (state) => {
        applyTransition({ issueData: null, state }, null);
      }),
    [applyTransition, runProgram]
  );

  const selectWorkspacePath = async (path: string): Promise<void> => {
    manualWorkspaceSwitchRef.current = true;
    const expectedGeneration = transitionGateRef.current.acceptedGeneration + 1;
    const intentGeneration = beginNavigationIntent(navigationIntentRef, path);
    setDismissedSwitchErrorGeneration(null);
    try {
      await runProgram(
        selectWorkspace(path),
        async () => {
          if (
            isCurrentNavigationIntent(navigationIntentRef, intentGeneration)
          ) {
            finishNavigationIntent(navigationIntentRef, intentGeneration);
            await refreshWorkspaceState();
          }
        },
        (result) => {
          if (
            !isCurrentNavigationIntent(navigationIntentRef, intentGeneration)
          ) {
            return;
          }
          applyTransition(
            { issueData: result.issueData, state: result.state },
            expectedGeneration
          );
          finishNavigationIntent(navigationIntentRef, intentGeneration);
        }
      );
    } catch {
      // Workspace service failures are handled by runProgram; this protects
      // the navigation handler from unexpected callback failures.
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
        await selectWorkspacePath(selection);
      }
    } catch {
      await refreshWorkspaceState();
    }
  };

  const removeSelectedWorkspace = async (path: string): Promise<void> => {
    try {
      await runProgram(
        removeWorkspace(path),
        async () => {
          await refreshWorkspaceState();
        },
        (state) => {
          applyTransition({ issueData: null, state }, null);
        }
      );
    } catch {
      // Workspace service failures are handled by runProgram; this protects
      // the event handler from unexpected callback failures.
    }
  };

  const retryMemory = async (): Promise<void> => {
    try {
      await runProgram(
        retryWorkspaceMemory,
        async () => {
          await refreshWorkspaceState();
        },
        (result) => {
          applyTransition(
            { issueData: result.issueData, state: result.state },
            null
          );
        }
      );
    } catch {
      // Workspace service failures are handled by runProgram; this protects
      // the event handler from unexpected callback failures.
    }
  };

  const resetMemory = async (): Promise<void> => {
    try {
      await runProgram(
        resetWorkspaceMemory,
        async () => {
          await refreshWorkspaceState();
        },
        (state) => {
          applyTransition({ issueData: null, state }, null);
          applyNoWorkspacePresentation(setIssueState, setWorkspaceKey);
        }
      );
    } catch {
      // Workspace service failures are handled by runProgram; this protects
      // the event handler from unexpected callback failures.
    }
  };

  const cancelPendingWorkspace = async (): Promise<void> => {
    try {
      await runProgram(
        cancelWorkspaceSelection,
        async () => {
          await refreshWorkspaceState();
        },
        (result) => {
          applyTransition(
            { issueData: result.issueData, state: result.state },
            null
          );
        },
        false
      );
    } catch {
      // Workspace service failures are handled by runProgram; this protects
      // the event handler from unexpected callback failures.
    }
  };

  const retryLastSwitch = async (): Promise<void> => {
    const retryPath = workspaceState?.retryWorkspace?.path;
    if (retryPath !== null && retryPath !== undefined && retryPath !== "") {
      await selectWorkspacePath(retryPath);
    }
  };

  const dismissSwitchError = (): void => {
    setDismissedSwitchErrorGeneration(workspaceState?.generation ?? null);
  };

  // The active Fiber is intentionally interrupted on unmount, not merely
  // ignored after completion. This also prevents an interrupted navigation
  // from committing after a StrictMode lifecycle teardown.
  useExternalLifecycle(
    () => () => {
      stopActivePrograms();
    },
    [stopActivePrograms]
  );

  return {
    refreshWorkspaceState,
    workspaceHandlers: {
      onCancel:
        workspaceState?.pendingWorkspace === null ||
        workspaceState?.pendingWorkspace === undefined
          ? undefined
          : async () => {
              await cancelPendingWorkspace();
            },
      onChoose: async () => {
        await chooseWorkspace();
      },
      onDismissSwitchError: dismissSwitchError,
      onRemove: async (path: string) => {
        await removeSelectedWorkspace(path);
      },
      onResetMemory: async () => {
        await resetMemory();
      },
      onRetryLastSwitch:
        workspaceState?.retryWorkspace === null ||
        workspaceState?.retryWorkspace === undefined
          ? undefined
          : async () => {
              await retryLastSwitch();
            },
      onRetryMemory: async () => {
        await retryMemory();
      },
      onSelect: async (path: string) => {
        await selectWorkspacePath(path);
      },
    },
  };
};

import { useRef } from "react";
import type { MutableRefObject } from "react";

import { useExternalLifecycle } from "../lib/use-external-lifecycle";
import type { ApplyWorkspaceTransition } from "../workspaces/transition-contract";
import {
  interruptWorkspaceProgram,
  observeWorkspaceProgram,
  startWorkspaceProgram,
  switchDuringHistoryTraversal,
  useWorkspaceServiceLayer,
} from "../workspaces/workspace-service";
import type { WorkspaceProgramFiber } from "../workspaces/workspace-service";
import type { IssueExplorerLoadState } from "./issue-loader";
import type { IssueExplorerRouteState } from "./issue-navigation";
import type { IssueNavigationEntry } from "./issue-navigation-coordinator";
import { readIssueNavigationEntry } from "./issue-navigation-coordinator";
import {
  beginNavigationIntent,
  finishNavigationIntent,
  isCurrentNavigationIntent,
} from "./navigation-intent";
import type { NavigationIntentRef } from "./navigation-intent";

export interface IssueWorkspaceTraversalOptions {
  applyTransition: ApplyWorkspaceTransition;
  confirmedWorkspacePath: string | null;
  currentNavigationEntry: IssueNavigationEntry | null;
  currentNavigationIndex: number;
  issueState: IssueExplorerLoadState;
  manualWorkspaceSwitchRef: MutableRefObject<boolean>;
  navigationIntentRef: NavigationIntentRef;
  navigateIssueRoute: (
    route: IssueExplorerRouteState,
    replace: boolean,
    workspacePath?: string | null
  ) => void;
  setDeepLinkError: (message: string) => void;
}

export const useIssueWorkspaceTraversal = ({
  applyTransition,
  confirmedWorkspacePath,
  currentNavigationEntry,
  currentNavigationIndex,
  issueState,
  manualWorkspaceSwitchRef,
  navigationIntentRef,
  navigateIssueRoute,
  setDeepLinkError,
}: IssueWorkspaceTraversalOptions): void => {
  const workspaceServiceLayer = useWorkspaceServiceLayer();
  const workspaceTraversalRef = useRef<string | null>(null);
  const lastNavigationIndexRef = useRef(0);
  const activeProgramRef = useRef<WorkspaceProgramFiber | null>(null);

  useExternalLifecycle(() => {
    const { index, workspacePath } = currentNavigationEntry ?? {};
    if (
      issueState.status !== "success" ||
      !manualWorkspaceSwitchRef.current ||
      confirmedWorkspacePath !== issueState.workspacePath ||
      workspacePath === issueState.workspacePath
    ) {
      return;
    }
    if (
      workspacePath !== null &&
      workspacePath !== undefined &&
      index !== undefined
    ) {
      workspaceTraversalRef.current = `${index}:${workspacePath}`;
    }
    manualWorkspaceSwitchRef.current = false;
    navigateIssueRoute(
      { issueId: null, search: "", viewId: "all" },
      true,
      issueState.workspacePath
    );
  }, [
    confirmedWorkspacePath,
    currentNavigationEntry,
    issueState,
    manualWorkspaceSwitchRef,
    navigateIssueRoute,
  ]);

  useExternalLifecycle(() => {
    const target = currentNavigationEntry;
    if (
      target === null ||
      target.workspacePath === null ||
      issueState.status !== "success" ||
      target.workspacePath === issueState.workspacePath
    ) {
      return;
    }
    const traversalKey = `${target.index}:${target.workspacePath}`;
    if (workspaceTraversalRef.current === traversalKey) {
      return;
    }
    const previousFiber = activeProgramRef.current;
    activeProgramRef.current = null;
    if (previousFiber !== null) {
      interruptWorkspaceProgram(previousFiber);
    }
    workspaceTraversalRef.current = traversalKey;
    const intentGeneration = beginNavigationIntent(
      navigationIntentRef,
      target.workspacePath
    );
    const returnIndex = lastNavigationIndexRef.current;
    const targetWorkspacePath = target.workspacePath;
    const fiber = startWorkspaceProgram(
      switchDuringHistoryTraversal(targetWorkspacePath),
      workspaceServiceLayer
    );
    activeProgramRef.current = fiber;
    void observeWorkspaceProgram(
      fiber,
      () => {
        if (activeProgramRef.current === fiber) {
          activeProgramRef.current = null;
        }
        if (
          !isCurrentNavigationIntent(navigationIntentRef, intentGeneration) ||
          workspaceTraversalRef.current !== traversalKey
        ) {
          return;
        }
        workspaceTraversalRef.current = null;
        finishNavigationIntent(navigationIntentRef, intentGeneration);
        setDeepLinkError(
          "Could not restore the Workspace from navigation history."
        );
        const delta = returnIndex - target.index;
        if (delta !== 0) {
          window.history.go(delta);
        }
      },
      (switched) => {
        if (activeProgramRef.current === fiber) {
          activeProgramRef.current = null;
        }
        const current = readIssueNavigationEntry(window.history.state);
        if (
          !isCurrentNavigationIntent(navigationIntentRef, intentGeneration) ||
          workspaceTraversalRef.current !== traversalKey ||
          current?.index !== target.index
        ) {
          return;
        }
        manualWorkspaceSwitchRef.current = false;
        applyTransition(
          {
            issueData: switched.issueData,
            state: switched.state,
          },
          null
        );
        workspaceTraversalRef.current = null;
        finishNavigationIntent(navigationIntentRef, intentGeneration);
      }
    );
  }, [
    applyTransition,
    currentNavigationEntry,
    issueState,
    manualWorkspaceSwitchRef,
    navigationIntentRef,
    setDeepLinkError,
    workspaceServiceLayer,
  ]);

  useExternalLifecycle(() => {
    lastNavigationIndexRef.current = currentNavigationIndex;
  }, [currentNavigationIndex]);

  useExternalLifecycle(
    () => () => {
      const fiber = activeProgramRef.current;
      activeProgramRef.current = null;
      if (fiber !== null) {
        interruptWorkspaceProgram(fiber);
      }
    },
    []
  );
};

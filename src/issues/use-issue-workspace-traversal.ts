import { useMemo, useRef } from "react";
import type { MutableRefObject } from "react";

import { useExternalLifecycle } from "../lib/use-external-lifecycle";
import type { ApplyWorkspaceTransition } from "../workspaces/transition-contract";
import {
  createTauRpcWorkspaceService,
  runWorkspaceEffect,
  switchWorkspace,
} from "../workspaces/workspace-service";
import type { WorkspaceServiceClient } from "../workspaces/workspace-service";
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
  workspaceService?: WorkspaceServiceClient;
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
  workspaceService: injectedWorkspaceService,
}: IssueWorkspaceTraversalOptions): void => {
  const workspaceService = useMemo(
    () => injectedWorkspaceService ?? createTauRpcWorkspaceService(),
    [injectedWorkspaceService]
  );
  const workspaceTraversalRef = useRef<string | null>(null);
  const lastNavigationIndexRef = useRef(0);

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
    workspaceTraversalRef.current = traversalKey;
    const intentGeneration = beginNavigationIntent(
      navigationIntentRef,
      target.workspacePath
    );
    const returnIndex = lastNavigationIndexRef.current;
    const targetWorkspacePath = target.workspacePath;
    void (async () => {
      const switchedResult = await runWorkspaceEffect(
        switchWorkspace(targetWorkspacePath),
        workspaceService
      );
      const current = readIssueNavigationEntry(window.history.state);
      if (
        !switchedResult.ok ||
        !isCurrentNavigationIntent(navigationIntentRef, intentGeneration) ||
        workspaceTraversalRef.current !== traversalKey ||
        current?.index !== target.index
      ) {
        if (
          !switchedResult.ok &&
          isCurrentNavigationIntent(navigationIntentRef, intentGeneration) &&
          workspaceTraversalRef.current === traversalKey
        ) {
          workspaceTraversalRef.current = null;
          finishNavigationIntent(navigationIntentRef, intentGeneration);
          setDeepLinkError(
            "Could not restore the Workspace from navigation history."
          );
          const delta = returnIndex - target.index;
          if (delta !== 0) {
            window.history.go(delta);
          }
        }
        return;
      }
      manualWorkspaceSwitchRef.current = false;
      applyTransition(
        {
          issueData: switchedResult.value.issueData,
          state: switchedResult.value.state,
        },
        null
      );
      workspaceTraversalRef.current = null;
      finishNavigationIntent(navigationIntentRef, intentGeneration);
    })();
  }, [
    applyTransition,
    currentNavigationEntry,
    issueState,
    manualWorkspaceSwitchRef,
    navigationIntentRef,
    setDeepLinkError,
    workspaceService,
  ]);

  useExternalLifecycle(() => {
    lastNavigationIndexRef.current = currentNavigationIndex;
  }, [currentNavigationIndex]);
};

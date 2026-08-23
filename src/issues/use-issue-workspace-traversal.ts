import { useRef } from "react";
import type { MutableRefObject } from "react";

import { useExternalLifecycle } from "../lib/use-external-lifecycle";
import { createTauRPCProxy } from "../rpc/bindings";
import type {
  LoadIssueExplorerDataResponse,
  WorkspaceState,
} from "../rpc/bindings";
import type { IssueExplorerLoadState } from "./issue-loader";
import type { IssueExplorerRouteState } from "./issue-navigation";
import type { IssueNavigationEntry } from "./issue-navigation-coordinator";
import { readIssueNavigationEntry } from "./issue-navigation-coordinator";

interface WorkspaceTransition {
  issueData: LoadIssueExplorerDataResponse | null;
  state: WorkspaceState;
}

type ApplyTransition = (
  transition: WorkspaceTransition,
  expectedGeneration: number | null
) => unknown;

export interface IssueWorkspaceTraversalOptions {
  applyTransition: ApplyTransition;
  confirmedWorkspacePath: string | null;
  currentNavigationEntry: IssueNavigationEntry | null;
  currentNavigationIndex: number;
  issueState: IssueExplorerLoadState;
  manualWorkspaceSwitchRef: MutableRefObject<boolean>;
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
  navigateIssueRoute,
  setDeepLinkError,
}: IssueWorkspaceTraversalOptions): void => {
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
    const returnIndex = lastNavigationIndexRef.current;
    const targetWorkspacePath = target.workspacePath;
    void (async () => {
      try {
        const switched =
          await createTauRPCProxy().switch_workspace(targetWorkspacePath);
        const current = readIssueNavigationEntry(window.history.state);
        if (current?.index !== target.index) {
          return;
        }
        manualWorkspaceSwitchRef.current = false;
        applyTransition(
          { issueData: switched.issueData, state: switched.state },
          null
        );
      } catch {
        if (workspaceTraversalRef.current === traversalKey) {
          workspaceTraversalRef.current = null;
        }
        setDeepLinkError(
          "Could not restore the Workspace from navigation history."
        );
        const delta = returnIndex - target.index;
        if (delta !== 0) {
          window.history.go(delta);
        }
      }
    })();
  }, [
    applyTransition,
    currentNavigationEntry,
    issueState,
    manualWorkspaceSwitchRef,
    setDeepLinkError,
  ]);

  useExternalLifecycle(() => {
    lastNavigationIndexRef.current = currentNavigationIndex;
  }, [currentNavigationIndex]);
};

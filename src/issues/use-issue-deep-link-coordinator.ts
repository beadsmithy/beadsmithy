import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useCallback, useRef, useState } from "react";

import { useExternalLifecycle } from "../lib/use-external-lifecycle";
import type { WorkspaceState } from "../rpc/bindings";
import type { ApplyWorkspaceTransition } from "../workspaces/transition-contract";
import {
  interruptWorkspaceProgram,
  observeWorkspaceProgram,
  resolveAndOpenIssueLocation,
  startWorkspaceProgram,
  useWorkspaceServiceLayer,
} from "../workspaces/workspace-service";
import type { WorkspaceProgramFiber } from "../workspaces/workspace-service";
import type { IssueExplorerLoadState } from "./issue-loader";
import { parseIssueLocationUri } from "./issue-location-uri";
import { isIssueInListView } from "./issue-navigation";
import type { IssueExplorerRouteState } from "./issue-navigation";
import {
  beginNavigationIntent,
  finishNavigationIntent,
  isCurrentNavigationIntent,
} from "./navigation-intent";
import type { NavigationIntentRef } from "./navigation-intent";

const readCurrentWorkspacePath = (
  issueState: IssueExplorerLoadState,
  workspaceState: WorkspaceState
): string | null =>
  issueState.status === "success"
    ? issueState.workspacePath
    : (workspaceState.currentWorkspace?.path ?? null);

const reportWorkspaceResolutionFailure = (
  setDeepLinkError: (message: string) => void,
  isCurrent: boolean
): void => {
  if (isCurrent) {
    setDeepLinkError("Could not open link: Workspace resolution failed.");
  }
};

export interface IssueDeepLinkCoordinatorOptions {
  applyTransition: ApplyWorkspaceTransition;
  explorerRoute: IssueExplorerRouteState;
  issueState: IssueExplorerLoadState;
  navigateIssueRoute: (
    route: IssueExplorerRouteState,
    replace: boolean,
    workspacePath?: string | null
  ) => void;
  navigationIntentRef: NavigationIntentRef;
  workspaceState: WorkspaceState | null;
}

export interface IssueDeepLinkCoordinatorResult {
  deepLinkError: string | null;
  dismissDeepLinkError: () => void;
  setDeepLinkError: (message: string) => void;
}

export const useIssueDeepLinkCoordinator = ({
  applyTransition,
  explorerRoute,
  issueState,
  navigateIssueRoute,
  navigationIntentRef,
  workspaceState,
}: IssueDeepLinkCoordinatorOptions): IssueDeepLinkCoordinatorResult => {
  const workspaceServiceLayer = useWorkspaceServiceLayer();
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);
  const pendingDeepLinkRef = useRef<{
    startup: boolean;
    url: string;
  } | null>(null);
  const deepLinkHandlerRef = useRef<(url: string, startup: boolean) => void>(
    () => 0
  );
  const deepLinkProcessorRef = useRef<() => void>(() => 0);
  const activeProgramRef = useRef<WorkspaceProgramFiber | null>(null);

  const stopActiveProgram = useCallback(() => {
    const fiber = activeProgramRef.current;
    activeProgramRef.current = null;
    if (fiber !== null) {
      interruptWorkspaceProgram(fiber);
    }
  }, []);

  const handleDeepLinkUrl = useCallback(
    (url: string, startup: boolean): void => {
      const parsed = parseIssueLocationUri(url);
      if (!parsed.ok) {
        setDeepLinkError(`Could not open link (${parsed.error}).`);
        return;
      }
      stopActiveProgram();
      const requestGeneration = beginNavigationIntent(
        navigationIntentRef,
        parsed.value.workspacePath
      );
      if (workspaceState === null || workspaceState.pendingWorkspace !== null) {
        pendingDeepLinkRef.current = { startup, url };
        return;
      }

      const deepLinkWorkspacePath = readCurrentWorkspacePath(
        issueState,
        workspaceState
      );
      if (parsed.value.workspacePath === deepLinkWorkspacePath) {
        if (issueState.status !== "success") {
          pendingDeepLinkRef.current = { startup, url };
          return;
        }
        const targetIsVisible = isIssueInListView(
          issueState,
          explorerRoute.viewId,
          parsed.value.issueId
        );
        navigateIssueRoute(
          targetIsVisible
            ? { ...explorerRoute, issueId: parsed.value.issueId }
            : { issueId: parsed.value.issueId, search: "", viewId: "all" },
          startup
        );
        setDeepLinkError(null);
        finishNavigationIntent(navigationIntentRef, requestGeneration);
        return;
      }

      const fiber = startWorkspaceProgram(
        resolveAndOpenIssueLocation(
          parsed.value.workspacePath,
          deepLinkWorkspacePath,
          (resolution) =>
            confirm(
              `Do you want to ${
                resolution.known
                  ? "open this remembered Workspace"
                  : "add and open this Workspace"
              } at ${resolution.workspace.path} and open Issue ${parsed.value.issueId}?`,
              { title: "Open Issue Location" }
            )
        ),
        workspaceServiceLayer
      );
      activeProgramRef.current = fiber;
      void observeWorkspaceProgram(
        fiber,
        () => {
          if (activeProgramRef.current === fiber) {
            activeProgramRef.current = null;
          }
          reportWorkspaceResolutionFailure(
            setDeepLinkError,
            isCurrentNavigationIntent(navigationIntentRef, requestGeneration)
          );
          finishNavigationIntent(navigationIntentRef, requestGeneration);
        },
        (result) => {
          if (activeProgramRef.current === fiber) {
            activeProgramRef.current = null;
          }
          if (
            !isCurrentNavigationIntent(navigationIntentRef, requestGeneration)
          ) {
            return;
          }
          if (result.kind === "cancelled") {
            finishNavigationIntent(navigationIntentRef, requestGeneration);
            return;
          }
          if (result.kind === "already-current") {
            const targetIsVisible =
              issueState.status === "success" &&
              isIssueInListView(
                issueState,
                explorerRoute.viewId,
                parsed.value.issueId
              );
            navigateIssueRoute(
              targetIsVisible
                ? { ...explorerRoute, issueId: parsed.value.issueId }
                : { issueId: parsed.value.issueId, search: "", viewId: "all" },
              startup,
              result.resolution.workspace.path
            );
            setDeepLinkError(null);
            finishNavigationIntent(navigationIntentRef, requestGeneration);
            return;
          }
          const { switched } = result;
          if (switched === null) {
            return;
          }
          applyTransition(
            { issueData: switched.issueData, state: switched.state },
            null
          );
          navigateIssueRoute(
            { issueId: parsed.value.issueId, search: "", viewId: "all" },
            startup,
            switched.issueData.workspacePath
          );
          setDeepLinkError(null);
          finishNavigationIntent(navigationIntentRef, requestGeneration);
        }
      );
    },
    [
      applyTransition,
      explorerRoute,
      issueState,
      navigateIssueRoute,
      navigationIntentRef,
      setDeepLinkError,
      stopActiveProgram,
      workspaceServiceLayer,
      workspaceState,
    ]
  );

  useExternalLifecycle(() => {
    deepLinkHandlerRef.current = (url, startup) => {
      handleDeepLinkUrl(url, startup);
    };
    deepLinkProcessorRef.current = () => {
      const pending = pendingDeepLinkRef.current;
      if (
        pending === null ||
        workspaceState === null ||
        workspaceState.pendingWorkspace !== null
      ) {
        return;
      }
      pendingDeepLinkRef.current = null;
      deepLinkHandlerRef.current(pending.url, pending.startup);
    };
  }, [handleDeepLinkUrl, workspaceState]);

  useExternalLifecycle(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await onOpenUrl((urls) => {
          const url = urls.at(-1);
          if (url !== undefined) {
            void getCurrentWindow().unminimize();
            void getCurrentWindow().setFocus();
            pendingDeepLinkRef.current = { startup: false, url };
            deepLinkProcessorRef.current();
          }
        });
        const urls = await getCurrent();
        const url = urls?.at(-1);
        if (!disposed && url !== undefined) {
          pendingDeepLinkRef.current = { startup: true, url };
          deepLinkProcessorRef.current();
        }
      } catch {
        // Deep-link delivery is unavailable in renderer-only environments.
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useExternalLifecycle(() => {
    deepLinkProcessorRef.current();
  }, [issueState.status, workspaceState?.pendingWorkspace]);

  useExternalLifecycle(
    () => () => {
      stopActiveProgram();
    },
    [stopActiveProgram]
  );

  return {
    deepLinkError,
    dismissDeepLinkError: () => setDeepLinkError(null),
    setDeepLinkError,
  };
};

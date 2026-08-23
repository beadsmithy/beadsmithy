import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useCallback, useRef, useState } from "react";

import { useExternalLifecycle } from "../lib/use-external-lifecycle";
import { createTauRPCProxy } from "../rpc/bindings";
import type {
  LoadIssueExplorerDataResponse,
  WorkspaceState,
} from "../rpc/bindings";
import type { IssueExplorerLoadState } from "./issue-loader";
import { parseIssueLocationUri } from "./issue-location-uri";
import { isIssueInListView } from "./issue-navigation";
import type { IssueExplorerRouteState } from "./issue-navigation";

interface WorkspaceTransition {
  issueData: LoadIssueExplorerDataResponse | null;
  state: WorkspaceState;
}

type ApplyTransition = (
  transition: WorkspaceTransition,
  expectedGeneration: number | null
) => unknown;

const readCurrentWorkspacePath = (
  issueState: IssueExplorerLoadState,
  workspaceState: WorkspaceState
): string | null =>
  issueState.status === "success"
    ? issueState.workspacePath
    : (workspaceState.currentWorkspace?.path ?? null);

export interface IssueDeepLinkCoordinatorOptions {
  applyTransition: ApplyTransition;
  explorerRoute: IssueExplorerRouteState;
  issueState: IssueExplorerLoadState;
  navigateIssueRoute: (
    route: IssueExplorerRouteState,
    replace: boolean,
    workspacePath?: string | null
  ) => void;
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
  workspaceState,
}: IssueDeepLinkCoordinatorOptions): IssueDeepLinkCoordinatorResult => {
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);
  const pendingDeepLinkRef = useRef<{
    startup: boolean;
    url: string;
  } | null>(null);
  const deepLinkHandlerRef = useRef<(url: string, startup: boolean) => void>(
    () => 0
  );
  const deepLinkProcessorRef = useRef<() => void>(() => 0);
  const deepLinkRequestGenerationRef = useRef(0);

  const handleDeepLinkUrl = useCallback(
    async (url: string, startup: boolean): Promise<void> => {
      const parsed = parseIssueLocationUri(url);
      if (!parsed.ok) {
        setDeepLinkError(`Could not open link (${parsed.error}).`);
        return;
      }
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
        return;
      }

      deepLinkRequestGenerationRef.current += 1;
      const requestGeneration = deepLinkRequestGenerationRef.current;
      try {
        const resolution = await createTauRPCProxy().resolve_workspace(
          parsed.value.workspacePath
        );
        if (requestGeneration !== deepLinkRequestGenerationRef.current) {
          return;
        }
        const resolvedCurrentPath = readCurrentWorkspacePath(
          issueState,
          workspaceState
        );
        if (resolution.workspace.path === resolvedCurrentPath) {
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
            resolution.workspace.path
          );
          setDeepLinkError(null);
          return;
        }
        const action = resolution.known
          ? "open this remembered Workspace"
          : "add and open this Workspace";
        const accepted = await confirm(
          `Do you want to ${action} at ${resolution.workspace.path} and open Issue ${parsed.value.issueId}?`,
          { title: "Open Issue Location" }
        );
        if (
          !accepted ||
          requestGeneration !== deepLinkRequestGenerationRef.current
        ) {
          return;
        }
        const switched = await createTauRPCProxy().switch_workspace(
          parsed.value.workspacePath
        );
        if (requestGeneration !== deepLinkRequestGenerationRef.current) {
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
      } catch {
        if (requestGeneration === deepLinkRequestGenerationRef.current) {
          setDeepLinkError("Could not open link: Workspace resolution failed.");
        }
      }
    },
    [
      applyTransition,
      explorerRoute,
      issueState,
      navigateIssueRoute,
      workspaceState,
    ]
  );

  useExternalLifecycle(() => {
    deepLinkHandlerRef.current = (url, startup) => {
      void handleDeepLinkUrl(url, startup);
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

  return {
    deepLinkError,
    dismissDeepLinkError: () => setDeepLinkError(null),
    setDeepLinkError,
  };
};

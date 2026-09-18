import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useRef, useState } from "react";

import { useExternalLifecycle } from "../lib/use-external-lifecycle";
import { isIssueExplorerRefreshEvent } from "../refresh-health";
import type {
  IssueExplorerRefreshEvent,
  IssueExplorerRefreshHealthEvent,
  IssueExplorerRefreshSnapshotEvent,
  RefreshHealth,
} from "../refresh-health";
import type { WorkspaceState } from "../rpc/bindings";
import type { WorkspaceTransition } from "../workspaces/transition-contract";
import {
  applyIssueExplorerHealthRefresh,
  applyIssueExplorerRefresh,
  applyStartupIssueLoad,
  applyWorkspaceTransition,
  INITIAL_WORKSPACE_TRANSITION_GATE_STATE,
} from "../workspaces/transition-gate";
import type {
  WorkspaceStartupDecision,
  WorkspaceTransitionDecision,
  WorkspaceTransitionGateState,
} from "../workspaces/transition-gate";
import {
  INITIAL_ISSUE_EXPLORER_PRESENTATION,
  INITIAL_LOAD_FAILURE_STATE,
  noWorkspacePresentation,
} from "./issue-explorer-presentation";
import type {
  IssueExplorerPresentation,
  IssueExplorerPresentationUpdate,
  PublishIssueExplorerPresentation,
} from "./issue-explorer-presentation";
import type { IssueListViewId } from "./issue-list-view";
import {
  ISSUE_EXPLORER_LOADING_STATE,
  loadIssueExplorerStateFromTauRpc,
} from "./issue-loader";
import type { IssueExplorerLoadState } from "./issue-loader";
import {
  createIssueExplorerRoute,
  isIssueGraphRoute,
  isIssueInListView,
  isIssueListRoute,
  selectIssueForView,
} from "./issue-navigation";
import type { IssueExplorerRouteState } from "./issue-navigation";
import type { IssueNavigationEntry } from "./issue-navigation-coordinator";
import {
  finishNavigationIntent,
  INITIAL_NAVIGATION_INTENT,
  transitionMatchesNavigationIntent,
} from "./navigation-intent";
import { useIssueDeepLinkCoordinator } from "./use-issue-deep-link-coordinator";
import { useIssueNavigationCoordinator } from "./use-issue-navigation-coordinator";
import { useIssueWorkspaceTraversal } from "./use-issue-workspace-traversal";
import { useWorkspaceCoordinator } from "./use-workspace-coordinator";
import type { WorkspaceCoordinatorResult } from "./use-workspace-coordinator";

const WORKSPACE_TRANSITION_EVENT = "workspace-transition";
const ISSUE_EXPLORER_REFRESH_EVENT = "beadwork://issue-explorer-state-changed";
const DEFERRED_REFRESH_REPLAY_LIMIT = 2;

type Navigate = (
  path: string,
  options?: { replace?: boolean; state?: unknown }
) => void;

const transitionPresentation = (
  decision: WorkspaceTransitionDecision
): IssueExplorerPresentationUpdate => {
  switch (decision.kind) {
    case "ignore":
    case "acceptStateRetainSnapshot": {
      return {};
    }
    case "clearSnapshot": {
      return noWorkspacePresentation(decision.remountKey);
    }
    case "commitSnapshot": {
      return {
        issueState: { ...decision.snapshot, status: "success" },
        workspaceKey: decision.remountKey,
      };
    }
    default: {
      return {};
    }
  }
};

const startupPresentation = (
  decision: WorkspaceStartupDecision
): IssueExplorerPresentationUpdate => {
  switch (decision.kind) {
    case "ignore": {
      return {};
    }
    case "commitSnapshot": {
      return {
        issueState: decision.snapshot,
        workspaceKey: decision.remountKey,
      };
    }
    default: {
      return {};
    }
  }
};

/**
 * Apply a `beadwork://issue-explorer-state-changed` event through the
 * pure transition-gate decision. Deferred Snapshot and Health variants
 * are kept in independent slots until the matching Workspace transition
 * is admitted.
 */
const applyRefreshDecision = (
  payload: IssueExplorerRefreshEvent,
  gateRef: { current: WorkspaceTransitionGateState },
  deferredSnapshotRef: {
    current: IssueExplorerRefreshSnapshotEvent | null;
  },
  deferredHealthRef: {
    current: IssueExplorerRefreshHealthEvent | null;
  },
  publishPresentation: PublishIssueExplorerPresentation
): void => {
  if (!isIssueExplorerRefreshEvent(payload)) {
    return;
  }
  if (payload.eventType === "snapshot") {
    const { decision, next } = applyIssueExplorerRefresh(
      gateRef.current,
      payload
    );
    switch (decision.kind) {
      case "ignore": {
        return;
      }
      case "defer": {
        if (
          deferredSnapshotRef.current === null ||
          deferredSnapshotRef.current.refreshRevision <= payload.refreshRevision
        ) {
          deferredSnapshotRef.current = payload;
        }
        return;
      }
      case "commitRefreshSnapshot": {
        gateRef.current = next;
        publishPresentation({
          issueState: { ...decision.snapshot, status: "success" },
        });
        return;
      }
      default: {
        return;
      }
    }
  }

  const healthPayload: IssueExplorerRefreshHealthEvent = payload;
  const { decision, next } = applyIssueExplorerHealthRefresh(
    gateRef.current,
    healthPayload
  );
  switch (decision.kind) {
    case "ignore": {
      return;
    }
    case "defer": {
      if (
        deferredHealthRef.current === null ||
        deferredHealthRef.current.refreshRevision <=
          healthPayload.refreshRevision
      ) {
        deferredHealthRef.current = healthPayload;
      }
      return;
    }
    case "commitRefreshHealth": {
      gateRef.current = next;
      publishPresentation({ refreshHealth: decision.health });
      break;
    }
    default: {
      break;
    }
  }
};

export interface IssueExplorerCoordinatorOptions {
  currentHistoryState: unknown;
  isSettingsRoute: boolean;
  issueRoute: IssueExplorerRouteState;
  navigate: Navigate;
}

export interface IssueExplorerCoordinatorResult {
  explorer: {
    onGraphSelect: () => void;
    onIssueListViewSelect: (viewId: IssueListViewId) => void;
    onIssueReferenceSelect: (issueId: string) => void;
    onIssueSearchChange: (search: string) => void;
    onIssueSelect: (issueId: string) => void;
    presentedIssueState: IssueExplorerLoadState;
    refreshHealth: RefreshHealth | null;
    route: IssueExplorerRouteState;
    sidebarDisabled: boolean;
    workspaceKey: string;
  };
  navigation: {
    handleBackNavigation: () => void;
    nextNavigationEntry: IssueNavigationEntry | null;
    previousNavigationEntry: IssueNavigationEntry | null;
  };
  notice: {
    deepLinkError: string | null;
    dismissDeepLinkError: () => void;
  };
  workspace: {
    dismissedSwitchErrorGeneration: number | null;
    handlers: WorkspaceCoordinatorResult["workspaceHandlers"];
    state: WorkspaceState | null;
  };
}

export const useIssueExplorerCoordinator = ({
  currentHistoryState,
  isSettingsRoute,
  issueRoute,
  navigate,
}: IssueExplorerCoordinatorOptions): IssueExplorerCoordinatorResult => {
  const [presentation, setPresentation] = useState<IssueExplorerPresentation>(
    INITIAL_ISSUE_EXPLORER_PRESENTATION
  );
  const publishPresentation = useCallback(
    (update: IssueExplorerPresentationUpdate): void => {
      setPresentation((current) => ({ ...current, ...update }));
    },
    []
  );
  const {
    confirmedWorkspacePath,
    dismissedSwitchErrorGeneration,
    issueState,
    refreshHealth,
    workspaceKey,
    workspaceState,
  } = presentation;
  const currentWorkspacePath =
    issueState.status === "success" ? issueState.workspacePath : null;
  const {
    currentNavigationEntry,
    currentNavigationIndex,
    explorerRoute,
    handleBackNavigation,
    navigateIssueRoute,
    nextNavigationEntry,
    previousNavigationEntry,
  } = useIssueNavigationCoordinator({
    currentHistoryState,
    currentWorkspacePath,
    isSettingsRoute,
    issueRoute,
    navigate,
  });
  const manualWorkspaceSwitchRef = useRef(false);
  const navigationIntentRef = useRef(INITIAL_NAVIGATION_INTENT);
  const transitionGateRef = useRef<WorkspaceTransitionGateState>(
    INITIAL_WORKSPACE_TRANSITION_GATE_STATE
  );
  /**
   * Per-variant deferred buffer for refresh events whose selection
   * generation is newer than the gate's confirmed generation. Snapshot
   * and Health use separate slots so delivery order cannot drop either
   * variant while a Workspace transition is still being admitted.
   */
  const deferredSnapshotRef = useRef<IssueExplorerRefreshSnapshotEvent | null>(
    null
  );
  const deferredHealthRef = useRef<IssueExplorerRefreshHealthEvent | null>(
    null
  );
  const applyDeferredRefresh = useCallback((): boolean => {
    // Replay the Snapshot first so its confirmed identity is available
    // before a deferred Health event runs through the gate.
    let applied = false;
    for (
      let replayAttempt = 0;
      replayAttempt < DEFERRED_REFRESH_REPLAY_LIMIT;
      replayAttempt += 1
    ) {
      let progressed = false;
      const deferredSnapshot = deferredSnapshotRef.current;
      if (deferredSnapshot !== null) {
        deferredSnapshotRef.current = null;
        const { decision, next } = applyIssueExplorerRefresh(
          transitionGateRef.current,
          deferredSnapshot
        );
        if (decision.kind === "commitRefreshSnapshot") {
          transitionGateRef.current = next;
          publishPresentation({
            issueState: { ...decision.snapshot, status: "success" },
          });
          applied = true;
          progressed = true;
        } else if (decision.kind === "defer") {
          deferredSnapshotRef.current = decision.payload;
        } else {
          progressed = true;
        }
      }

      const deferredHealth = deferredHealthRef.current;
      if (deferredHealth !== null) {
        deferredHealthRef.current = null;
        const { decision, next } = applyIssueExplorerHealthRefresh(
          transitionGateRef.current,
          deferredHealth
        );
        if (decision.kind === "commitRefreshHealth") {
          transitionGateRef.current = next;
          publishPresentation({ refreshHealth: decision.health });
          applied = true;
          progressed = true;
        } else if (decision.kind === "defer") {
          deferredHealthRef.current = decision.payload;
        } else {
          progressed = true;
        }
      }
      if (!progressed) {
        break;
      }
    }
    return applied;
  }, [publishPresentation]);

  const applyTransition = useCallback(
    (
      transition: WorkspaceTransition,
      expectedGeneration: number | null
    ): WorkspaceTransitionDecision => {
      const { decision, next } = applyWorkspaceTransition(
        transitionGateRef.current,
        transition,
        expectedGeneration
      );
      transitionGateRef.current = next;

      if (decision.kind === "ignore") {
        return decision;
      }

      // The gate computes the complete admitted identity and health state.
      // Publish those values with the matching Workspace snapshot so React
      // never renders a mixed Workspace/snapshot pair.
      publishPresentation({
        confirmedWorkspacePath: next.confirmedWorkspacePath,
        refreshHealth: next.refreshHealth,
        workspaceState: transition.state,
        ...transitionPresentation(decision),
      });
      applyDeferredRefresh();
      return decision;
    },
    [applyDeferredRefresh, publishPresentation]
  );

  const { refreshWorkspaceState, workspaceHandlers } = useWorkspaceCoordinator({
    applyTransition,
    manualWorkspaceSwitchRef,
    navigationIntentRef,
    publishPresentation,
    transitionGateRef,
    workspaceState,
  });

  const { deepLinkError, dismissDeepLinkError, setDeepLinkError } =
    useIssueDeepLinkCoordinator({
      applyTransition,
      explorerRoute,
      issueState,
      navigateIssueRoute,
      navigationIntentRef,
      workspaceState,
    });

  useIssueWorkspaceTraversal({
    applyTransition,
    confirmedWorkspacePath,
    currentNavigationEntry,
    currentNavigationIndex,
    issueState,
    manualWorkspaceSwitchRef,
    navigateIssueRoute,
    navigationIntentRef,
    setDeepLinkError,
  });

  const handleIssueListViewSelect = useCallback(
    (viewId: IssueListViewId) => {
      const selectedIssueId = selectIssueForView(
        issueState,
        viewId,
        explorerRoute.issueId
      );
      const nextRoute = {
        ...createIssueExplorerRoute(null, new URLSearchParams()),
        issueId: selectedIssueId,
        viewId,
      };
      if (
        isIssueListRoute(explorerRoute) &&
        nextRoute.viewId === explorerRoute.viewId &&
        nextRoute.issueId === explorerRoute.issueId
      ) {
        if (isSettingsRoute) {
          navigateIssueRoute(explorerRoute, true);
        }
        return;
      }
      navigateIssueRoute(nextRoute, false);
    },
    [explorerRoute, isSettingsRoute, issueState, navigateIssueRoute]
  );

  const handleGraphSelect = useCallback(() => {
    const nextRoute = {
      issueId: explorerRoute.issueId,
      kind: "graph" as const,
      scope: "focused" as const,
    };
    if (
      isIssueGraphRoute(explorerRoute) &&
      explorerRoute.scope === nextRoute.scope
    ) {
      if (isSettingsRoute) {
        navigateIssueRoute(explorerRoute, true);
      }
      return;
    }
    navigateIssueRoute(nextRoute, false);
  }, [explorerRoute, isSettingsRoute, navigateIssueRoute]);

  const handleIssueSelect = useCallback(
    (issueId: string) => {
      if (
        !isIssueListRoute(explorerRoute) ||
        explorerRoute.issueId === issueId
      ) {
        return;
      }
      navigateIssueRoute({ ...explorerRoute, issueId }, false);
    },
    [explorerRoute, navigateIssueRoute]
  );

  const handleIssueSearchChange = useCallback(
    (search: string) => {
      if (!isIssueListRoute(explorerRoute)) {
        return;
      }
      navigateIssueRoute({ ...explorerRoute, search }, true);
    },
    [explorerRoute, navigateIssueRoute]
  );

  const handleIssueReferenceSelect = useCallback(
    (issueId: string) => {
      if (
        !isIssueListRoute(explorerRoute) ||
        explorerRoute.issueId === issueId
      ) {
        return;
      }
      const targetIsVisible = isIssueInListView(
        issueState,
        explorerRoute.viewId,
        issueId
      );
      navigateIssueRoute(
        targetIsVisible
          ? { ...explorerRoute, issueId }
          : { issueId, search: "", viewId: "all" },
        false
      );
    },
    [explorerRoute, issueState, navigateIssueRoute]
  );

  // Pending keeps the last successful snapshot underneath the loading
  // presentation. Cancelling a switch can therefore reveal the exact
  // Issue List/search/detail state that was visible before the attempt.
  const presentedIssueState: IssueExplorerLoadState =
    workspaceState?.pendingWorkspace === null ||
    workspaceState?.pendingWorkspace === undefined
      ? issueState
      : ISSUE_EXPLORER_LOADING_STATE;
  const sidebarDisabled = presentedIssueState.status !== "success";

  useExternalLifecycle(() => {
    let disposed = false;
    let unlistenTransition: UnlistenFn | undefined;
    let unlistenRefresh: UnlistenFn | undefined;

    // Register both listeners before dispatching the startup snapshot
    // read. Otherwise an event racing the first poll could be lost.
    const registerListeners = async () => {
      const transitionListener = await listen<WorkspaceTransition>(
        WORKSPACE_TRANSITION_EVENT,
        (event) => {
          const { currentWorkspace, pendingWorkspace } = event.payload.state;
          const intentGeneration = navigationIntentRef.current.generation;
          if (
            !transitionMatchesNavigationIntent(
              navigationIntentRef,
              currentWorkspace?.path ?? null,
              pendingWorkspace?.path ?? null
            )
          ) {
            return;
          }
          applyTransition(event.payload, null);
          if (
            currentWorkspace?.path === navigationIntentRef.current.workspacePath
          ) {
            finishNavigationIntent(navigationIntentRef, intentGeneration);
          }
        }
      );
      if (disposed) {
        transitionListener();
      } else {
        unlistenTransition = transitionListener;
      }

      const refreshListener = await listen<IssueExplorerRefreshEvent>(
        ISSUE_EXPLORER_REFRESH_EVENT,
        (event) => {
          applyRefreshDecision(
            event.payload,
            transitionGateRef,
            deferredSnapshotRef,
            deferredHealthRef,
            publishPresentation
          );
        }
      );
      if (disposed) {
        refreshListener();
      } else {
        unlistenRefresh = refreshListener;
      }
    };

    const dispatchStartupLoad = () => {
      const dispatchedAtCommittedGeneration =
        transitionGateRef.current.committedGeneration;
      void (async () => {
        try {
          const initial = await loadIssueExplorerStateFromTauRpc();
          if (
            initial.status === "success" &&
            transitionGateRef.current.confirmedWorkspacePath !== null &&
            initial.workspacePath !==
              transitionGateRef.current.confirmedWorkspacePath
          ) {
            return;
          }
          const { decision, next } = applyStartupIssueLoad(
            transitionGateRef.current,
            initial,
            dispatchedAtCommittedGeneration
          );
          transitionGateRef.current = next;
          if (decision.kind === "ignore") {
            return;
          }
          publishPresentation({
            confirmedWorkspacePath: next.confirmedWorkspacePath,
            ...startupPresentation(decision),
          });
          applyDeferredRefresh();
        } catch {
          const { decision, next } = applyStartupIssueLoad(
            transitionGateRef.current,
            INITIAL_LOAD_FAILURE_STATE,
            dispatchedAtCommittedGeneration
          );
          transitionGateRef.current = next;
          if (decision.kind === "ignore") {
            return;
          }
          publishPresentation({
            confirmedWorkspacePath: next.confirmedWorkspacePath,
            ...startupPresentation(decision),
          });
        }
      })();
      void refreshWorkspaceState();
    };

    void (async () => {
      // Registration failure must not strand the renderer on loading.
      try {
        await registerListeners();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("beadsmith: failed to register refresh listeners", error);
      }
      if (disposed) {
        return;
      }
      dispatchStartupLoad();
    })();

    return () => {
      disposed = true;
      unlistenTransition?.();
      unlistenRefresh?.();
    };
  }, [applyTransition, publishPresentation, refreshWorkspaceState]);

  return {
    explorer: {
      onGraphSelect: handleGraphSelect,
      onIssueListViewSelect: handleIssueListViewSelect,
      onIssueReferenceSelect: handleIssueReferenceSelect,
      onIssueSearchChange: handleIssueSearchChange,
      onIssueSelect: handleIssueSelect,
      presentedIssueState,
      refreshHealth,
      route: explorerRoute,
      sidebarDisabled,
      workspaceKey,
    },
    navigation: {
      handleBackNavigation,
      nextNavigationEntry,
      previousNavigationEntry,
    },
    notice: {
      deepLinkError,
      dismissDeepLinkError,
    },
    workspace: {
      dismissedSwitchErrorGeneration,
      handlers: workspaceHandlers,
      state: workspaceState,
    },
  };
};

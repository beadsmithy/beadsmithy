import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useRef, useState } from "react";

import "./App.css";
import { Sidebar } from "./components/Sidebar";
import { Titlebar } from "./components/Titlebar";
import { pickerDefaultPath } from "./components/WorkspaceSelector";
import { DEFAULT_ISSUE_LIST_VIEW_ID } from "./issues/issue-list-view";
import type { IssueListViewId } from "./issues/issue-list-view";
import {
  ISSUE_EXPLORER_LOADING_STATE,
  loadIssueExplorerStateFromTauRpc,
} from "./issues/issue-loader";
import type { IssueExplorerLoadState } from "./issues/issue-loader";
import { IssueExplorer } from "./issues/IssueExplorer";
import { useExternalLifecycle } from "./lib/use-external-lifecycle";
import { createTauRPCProxy } from "./rpc/bindings";
import type {
  LoadIssueExplorerDataResponse,
  WorkspaceState,
} from "./rpc/bindings";
import {
  isIssueExplorerRefreshEvent,
  type IssueExplorerRefreshEvent,
  type IssueExplorerRefreshHealthEvent,
} from "./refresh-health";
import { useAppSettings } from "./settings/app-settings";
import { SettingsPage } from "./settings/SettingsPage";
import {
  applyIssueExplorerHealthRefresh,
  applyIssueExplorerRefresh,
  applyStartupIssueLoad,
  applyWorkspaceTransition,
  clearRefreshHealth,
  INITIAL_WORKSPACE_REMOUNT_KEY,
  INITIAL_WORKSPACE_TRANSITION_GATE_STATE,
} from "./workspaces/transition-gate";
import type {
  WorkspaceTransitionDecision,
  WorkspaceTransitionGateState,
} from "./workspaces/transition-gate";

const WORKSPACE_TRANSITION_EVENT = "workspace-transition";
const ISSUE_EXPLORER_REFRESH_EVENT = "beadwork://issue-explorer-state-changed";

interface WorkspaceTransition {
  issueData: LoadIssueExplorerDataResponse | null;
  state: WorkspaceState;
}

type AppDestination = "issueExplorer" | "settings";

const NO_WORKSPACE_ERROR_STATE: IssueExplorerLoadState = {
  error: {
    kind: "noWorkspace",
    message: "Select a workspace to load issues.",
  },
  status: "failure",
};

const INITIAL_LOAD_FAILURE_STATE: IssueExplorerLoadState = {
  error: {
    kind: "unknown",
    message: "Beadsmith could not load issues.",
  },
  status: "failure",
};

const applyNoWorkspacePresentation = (
  remountKey: string,
  setIssueState: (state: IssueExplorerLoadState) => void,
  setWorkspaceKey: (key: string) => void
): void => {
  setIssueState(NO_WORKSPACE_ERROR_STATE);
  setWorkspaceKey(remountKey);
};

const applyTransitionDecision = (
  decision: WorkspaceTransitionDecision,
  setIssueState: (state: IssueExplorerLoadState) => void,
  setWorkspaceKey: (key: string) => void
): void => {
  if (
    decision.kind === "ignore" ||
    decision.kind === "acceptStateRetainSnapshot"
  ) {
    return;
  }
  if (decision.kind === "clearSnapshot") {
    applyNoWorkspacePresentation(
      decision.remountKey,
      setIssueState,
      setWorkspaceKey
    );
    return;
  }
  setIssueState({ ...decision.snapshot, status: "success" });
  setWorkspaceKey(decision.remountKey);
};

/**
 * Apply a `beadwork://issue-explorer-state-changed` event through the
 * pure [`applyIssueExplorerRefresh`] decision. On admission the existing
 * Issue Explorer snapshot is replaced with the new one in place: the
 * outer remount key, active view, search query, and selected Issue are
 * left untouched because the underlying Workspace identity is unchanged.
 * A deferred payload is buffered into the single-slot
 * `deferredRefreshRef` so it can be replayed after the matching
 * `workspace-transition` admits the new selection. A rejected event is
 * silently dropped.
 *
 * The tagged-union event carries either a Snapshot variant (replaces
 * the issue state) or a Health variant (replaces the refresh health
 * state and renders the banner). Both variants share the same identity
 * triple; the gate tracks independent accepted revisions for each so
 * delivery order does not affect correctness.
 */
const applyRefreshDecision = (
  payload: IssueExplorerRefreshEvent,
  gateRef: { current: WorkspaceTransitionGateState },
  deferredRefreshRef: {
    current: IssueExplorerRefreshEvent | null;
  },
  setIssueState: (state: IssueExplorerLoadState) => void,
  setRefreshHealth: (health: {
    readonly refProbe: import("./refresh-health").RefreshFailure | null;
    readonly loader: import("./refresh-health").RefreshFailure | null;
  } | null) => void
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
      case "ignore":
        return;
      case "defer":
        if (
          deferredRefreshRef.current === null ||
          isNewerGeneration(
            deferredRefreshRef.current,
            payload
          )
        ) {
          deferredRefreshRef.current = payload;
        }
        return;
      case "commitRefreshSnapshot":
        gateRef.current = next;
        setIssueState({ ...decision.snapshot, status: "success" });
        return;
    }
    return;
  }
  // Health variant
  const healthPayload: IssueExplorerRefreshHealthEvent = payload;
  const { decision, next } = applyIssueExplorerHealthRefresh(
    gateRef.current,
    healthPayload
  );
  switch (decision.kind) {
    case "ignore":
      return;
    case "defer":
      if (
        deferredRefreshRef.current === null ||
        isNewerGeneration(deferredRefreshRef.current, healthPayload)
      ) {
        deferredRefreshRef.current = healthPayload;
      }
      return;
    case "commitRefreshHealth":
      gateRef.current = next;
      setRefreshHealth(decision.health);
      return;
  }
};

const isNewerGeneration = (
  existing: IssueExplorerRefreshEvent,
  candidate: IssueExplorerRefreshEvent
): boolean =>
  existing.workspaceSelectionGeneration <=
  candidate.workspaceSelectionGeneration;

export default function App() {
  const [issueState, setIssueState] = useState<IssueExplorerLoadState>(
    ISSUE_EXPLORER_LOADING_STATE
  );
  const [activeIssueListViewId, setActiveIssueListViewId] =
    useState<IssueListViewId>(DEFAULT_ISSUE_LIST_VIEW_ID);
  const [appDestination, setAppDestination] =
    useState<AppDestination>("issueExplorer");
  const settings = useAppSettings();
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState | null>(
    null
  );
  const [workspaceKey, setWorkspaceKey] = useState<string>(
    INITIAL_WORKSPACE_TRANSITION_GATE_STATE.confirmedWorkspacePath ??
      INITIAL_WORKSPACE_REMOUNT_KEY
  );
  const [refreshHealth, setRefreshHealthState] = useState<{
    readonly refProbe: import("./refresh-health").RefreshFailure | null;
    readonly loader: import("./refresh-health").RefreshFailure | null;
  } | null>(null);
  const transitionGateRef = useRef<WorkspaceTransitionGateState>(
    INITIAL_WORKSPACE_TRANSITION_GATE_STATE
  );
  /**
   * Single-slot buffer for one `beadwork://issue-explorer-state-changed`
   * event whose selection generation is newer than the gate's confirmed
   * generation. The slot is replayed after every admitted Workspace
   * transition or successful startup snapshot. `bsm-wj1.2` closed the
   * backend event-ordering race by keeping only the newest payload per
   * identity; a newer generation replaces the slot, an older generation
   * is dropped.
   *
   * The buffer is a tagged union: it carries either a Snapshot or a
   * Health variant. `bsm-wj1.3` extended the buffer to dispatch both
   * variants through the appropriate gate decision.
   */
  const deferredRefreshRef = useRef<IssueExplorerRefreshEvent | null>(null);
  const [dismissedSwitchErrorGeneration, setDismissedSwitchErrorGeneration] =
    useState<number | null>(null);

  const setRefreshHealth = useCallback(
    (
      health: {
        readonly refProbe: import("./refresh-health").RefreshFailure | null;
        readonly loader: import("./refresh-health").RefreshFailure | null;
      } | null
    ) => {
      setRefreshHealthState(health);
    },
    []
  );

  const handleIssueListViewSelect = useCallback((viewId: IssueListViewId) => {
    setActiveIssueListViewId(viewId);
    setAppDestination("issueExplorer");
  }, []);

  const applyDeferredRefresh = useCallback((): boolean => {
    const deferred = deferredRefreshRef.current;
    if (deferred === null) {
      return false;
    }
    deferredRefreshRef.current = null;
    if (deferred.eventType === "snapshot") {
      const { decision, next } = applyIssueExplorerRefresh(
        transitionGateRef.current,
        deferred
      );
      if (decision.kind === "commitRefreshSnapshot") {
        transitionGateRef.current = next;
        setIssueState({ ...decision.snapshot, status: "success" });
        return true;
      }
      if (decision.kind === "ignore") {
        return false;
      }
      // `defer`: gate has not yet admitted the matching transition;
      // put the payload back into the slot.
      deferredRefreshRef.current = decision.payload;
      return false;
    }
    // Health variant
    const { decision, next } = applyIssueExplorerHealthRefresh(
      transitionGateRef.current,
      deferred
    );
    if (decision.kind === "commitRefreshHealth") {
      transitionGateRef.current = next;
      setRefreshHealth(decision.health);
      return true;
    }
    if (decision.kind === "ignore") {
      return false;
    }
    deferredRefreshRef.current = decision.payload;
    return false;
  }, [setRefreshHealth]);

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
      const isClearSnapshot = decision.kind === "clearSnapshot";
      transitionGateRef.current = next;

      if (decision.kind === "ignore") {
        return decision;
      }

      // A confirmed path change / chooser transition must clear the
      // renderer's refresh health so the prior Workspace's banner
      // cannot linger behind the chooser.
      if (isClearSnapshot) {
        transitionGateRef.current = clearRefreshHealth(
          transitionGateRef.current
        );
        setRefreshHealth(null);
      }

      setWorkspaceState(transition.state);
      applyTransitionDecision(decision, setIssueState, setWorkspaceKey);
      applyDeferredRefresh();
      return decision;
    },
    [applyDeferredRefresh, setRefreshHealth]
  );

  // `presentedIssueState` masks the successful Issue Explorer
  // snapshot with the established loading presentation while a
  // Workspace switch is Pending, so the renderer's view of the new
  // selection reflects the in-flight commit rather than A's prior
  // Issue List. The successful `issueState` and `workspaceKey` are
  // preserved through Pending so a Cancel reveals A's search and
  // Issue Detail exactly as they were before the switch attempt.
  // Pending also wins over the no-Current chooser so a no-Current
  // → B selection shows loading instead of the chooser.
  const presentedIssueState: IssueExplorerLoadState =
    workspaceState?.pendingWorkspace == null
      ? issueState
      : ISSUE_EXPLORER_LOADING_STATE;
  const sidebarDisabled = presentedIssueState.status !== "success";

  const refreshWorkspaceState = useCallback(async () => {
    try {
      const next = await createTauRPCProxy().workspace_state();
      applyTransition({ issueData: null, state: next }, null);
    } catch {
      // No typed state is available if the transport itself is unavailable.
    }
  }, [applyTransition]);

  useExternalLifecycle(() => {
    let disposed = false;
    let unlistenTransition: UnlistenFn | undefined;
    let unlistenRefresh: UnlistenFn | undefined;

    // Subscription-first: register both listeners before dispatching the
    // startup snapshot read. Otherwise an emitted event that races the
    // first poll would be lost forever — the renderer can only admit
    // refreshes for the snapshot it has confirmed, and the only safe way
    // to ensure the listener is alive when the first event lands is to
    // await its registration before triggering the initial load.
    const registerListeners = async () => {
      const transitionListener = await listen<WorkspaceTransition>(
        WORKSPACE_TRANSITION_EVENT,
        (event) => {
          applyTransition(event.payload, null);
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
            deferredRefreshRef,
            setIssueState,
            setRefreshHealth
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
          const { decision, next } = applyStartupIssueLoad(
            transitionGateRef.current,
            initial,
            dispatchedAtCommittedGeneration
          );
          transitionGateRef.current = next;
          if (decision.kind === "ignore") {
            return;
          }
          setIssueState(decision.snapshot);
          setWorkspaceKey(decision.remountKey);
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
          setIssueState(decision.snapshot);
        }
      })();
      void refreshWorkspaceState();
    };

    void (async () => {
      // Subscription-first: register both listeners before dispatching
      // the startup snapshot read. The startup load is guarded with a
      // try/catch so a listener registration failure does not strand
      // the renderer on the loading presentation forever — the
      // existing initial-load behavior is preserved even when one of
      // the `listen` calls rejects.
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
  }, [applyTransition, refreshWorkspaceState]);

  const selectWorkspace = async (path: string) => {
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

  const chooseWorkspace = async () => {
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

  const removeWorkspace = async (path: string) => {
    try {
      const state = await createTauRPCProxy().remove_workspace(path);
      applyTransition({ issueData: null, state }, null);
    } catch {
      await refreshWorkspaceState();
    }
  };

  const retryWorkspaceMemory = async () => {
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

  const resetWorkspaceMemory = async () => {
    try {
      const state = await createTauRPCProxy().reset_workspace_memory();
      applyTransition({ issueData: null, state }, null);
      applyNoWorkspacePresentation(
        "/__reset__",
        setIssueState,
        setWorkspaceKey
      );
    } catch {
      await refreshWorkspaceState();
    }
  };

  const cancelWorkspace = async () => {
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

  const retryLastSwitch = async () => {
    const retryPath = workspaceState?.retryWorkspace?.path;
    if (retryPath !== null && retryPath !== undefined && retryPath !== "") {
      await selectWorkspace(retryPath);
    }
  };

  const dismissSwitchError = () => {
    setDismissedSwitchErrorGeneration(workspaceState?.generation ?? null);
  };

  const workspaceHandlers = {
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
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background font-primary text-text-main antialiased">
      <Titlebar
        onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
        sidebarCollapsed={sidebarCollapsed}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeIssueListViewId={activeIssueListViewId}
          appDestination={appDestination}
          collapsed={sidebarCollapsed}
          disabled={sidebarDisabled}
          dismissedSwitchErrorGeneration={dismissedSwitchErrorGeneration}
          issueState={presentedIssueState}
          onCollapseToggle={setSidebarCollapsed}
          onIssueListViewSelect={handleIssueListViewSelect}
          onSettingsClick={() => setAppDestination("settings")}
          workspaceHandlers={workspaceHandlers}
          workspaceState={workspaceState}
        />

        <div className="relative flex flex-1">
          <div
            key={workspaceKey}
            aria-hidden={appDestination === "settings" ? true : undefined}
            className={`flex flex-1 ${
              appDestination === "settings" ? "invisible" : ""
            }`}
            inert={appDestination === "settings" ? true : undefined}
          >
            {workspaceState !== null &&
            workspaceState.currentWorkspace === null &&
            workspaceState.pendingWorkspace === null ? (
              <main
                aria-label="Choose a workspace"
                className="flex flex-1 items-center justify-center bg-background p-8 text-center"
              >
                <div>
                  <h1 className="text-lg font-semibold text-primary">
                    Choose a workspace
                  </h1>
                  <p className="mt-2 text-sm text-muted">
                    Select a Beadwork repository to load its issue views.
                  </p>
                  <button
                    className="mt-4 rounded border border-border-main px-3 py-2 text-sm hover:bg-white/5"
                    onClick={() => void chooseWorkspace()}
                    type="button"
                  >
                    Choose folder
                  </button>
                </div>
              </main>
            ) : (
              <IssueExplorer
                activeIssueListViewId={activeIssueListViewId}
                issueState={presentedIssueState}
                markdownFontSizePx={settings.state.appliedFontSizePx}
                onIssueListViewChange={setActiveIssueListViewId}
                refreshHealth={refreshHealth}
              />
            )}
          </div>
          {appDestination === "settings" ? (
            <SettingsPage
              className="absolute inset-0 z-10"
              onDraftChange={settings.setDraft}
              onReset={settings.reset}
              onRetry={settings.retry}
              state={settings.state}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

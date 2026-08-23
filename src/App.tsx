import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { useCallback, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";

import "./App.css";
import { Sidebar } from "./components/Sidebar";
import { Titlebar } from "./components/Titlebar";
import { pickerDefaultPath } from "./components/WorkspaceSelector";
import type { IssueListViewId } from "./issues/issue-list-view";
import {
  ISSUE_EXPLORER_LOADING_STATE,
  loadIssueExplorerStateFromTauRpc,
} from "./issues/issue-loader";
import type { IssueExplorerLoadState } from "./issues/issue-loader";
import { parseIssueLocationUri } from "./issues/issue-location-uri";
import {
  isIssueInListView,
  parseIssueExplorerRoute,
  selectIssueForView,
  serializeIssueExplorerRoute,
} from "./issues/issue-navigation";
import {
  createIssueNavigationEntry,
  createIssueNavigationLedger,
  issueNavigationDestinationLabel,
  readIssueNavigationEntry,
  recordIssueNavigationEntry,
  truncateForwardIssueNavigationEntries,
  writeIssueNavigationState,
} from "./issues/issue-navigation-coordinator";
import { IssueExplorer } from "./issues/IssueExplorer";
import { useExternalLifecycle } from "./lib/use-external-lifecycle";
import { isIssueExplorerRefreshEvent } from "./refresh-health";
import type {
  IssueExplorerRefreshEvent,
  IssueExplorerRefreshHealthEvent,
  IssueExplorerRefreshSnapshotEvent,
  RefreshHealth,
} from "./refresh-health";
import { createTauRPCProxy } from "./rpc/bindings";
import type {
  LoadIssueExplorerDataResponse,
  WorkspaceState,
} from "./rpc/bindings";
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
 * A deferred payload is buffered into the per-variant deferred slots
 * so it can be replayed after the matching `workspace-transition` admits
 * the new selection. A rejected event is silently dropped.
 *
 * The tagged-union event carries either a Snapshot variant (replaces
 * the issue state) or a Health variant (replaces the refresh health
 * state and renders the banner). Both variants share the same identity
 * triple; the gate tracks independent accepted revisions for each so
 * delivery order does not affect correctness.
 *
 * The buffer is split into two slots (one per variant) because a single
 * slot would lose one variant when both a Snapshot and a Health event
 * are pending for the same not-yet-admitted identity (e.g. during the
 * Pending phase of a Workspace switch or before the startup snapshot
 * commits the initial identity).
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
  setIssueState: (state: IssueExplorerLoadState) => void,
  setRefreshHealth: (health: RefreshHealth | null) => void
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
          deferredSnapshotRef.current === null ||
          deferredSnapshotRef.current.refreshRevision <= payload.refreshRevision
        ) {
          deferredSnapshotRef.current = payload;
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
        deferredHealthRef.current === null ||
        deferredHealthRef.current.refreshRevision <=
          healthPayload.refreshRevision
      ) {
        deferredHealthRef.current = healthPayload;
      }
      return;
    case "commitRefreshHealth":
      gateRef.current = next;
      setRefreshHealth(decision.health);
      return;
  }
};

export default function App() {
  const [issueState, setIssueState] = useState<IssueExplorerLoadState>(
    ISSUE_EXPLORER_LOADING_STATE
  );
  const [location, navigate] = useLocation();
  const locationSearch = useSearch();
  const fullLocation =
    locationSearch.length > 0 ? `${location}?${locationSearch}` : location;
  const issueRoute = parseIssueExplorerRoute(fullLocation);
  const isSettingsRoute = location === "/settings";
  const underlyingIssueRouteRef = useRef(issueRoute);
  if (!isSettingsRoute) {
    underlyingIssueRouteRef.current = issueRoute;
  }
  const explorerRoute = isSettingsRoute
    ? underlyingIssueRouteRef.current
    : issueRoute;
  const appDestination: AppDestination = isSettingsRoute
    ? "settings"
    : "issueExplorer";
  const settings = useAppSettings();
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState | null>(
    null
  );
  const [workspaceKey, setWorkspaceKey] = useState<string>(
    INITIAL_WORKSPACE_TRANSITION_GATE_STATE.confirmedWorkspacePath ??
      INITIAL_WORKSPACE_REMOUNT_KEY
  );
  const [refreshHealth, setRefreshHealth] = useState<RefreshHealth | null>(
    null
  );
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);
  const pendingDeepLinkRef = useRef<{
    startup: boolean;
    url: string;
  } | null>(null);
  const deepLinkHandlerRef = useRef<(url: string, startup: boolean) => void>(
    () => undefined
  );
  const deepLinkProcessorRef = useRef<() => void>(() => undefined);
  const deepLinkRequestGenerationRef = useRef(0);
  const transitionGateRef = useRef<WorkspaceTransitionGateState>(
    INITIAL_WORKSPACE_TRANSITION_GATE_STATE
  );
  const navigationLedgerRef = useRef(createIssueNavigationLedger());
  const currentNavigationEntry = readIssueNavigationEntry(window.history.state);
  const currentNavigationIndex = currentNavigationEntry?.index ?? 0;
  const currentWorkspacePath =
    issueState.status === "success" ? issueState.workspacePath : null;
  /**
   * Per-variant deferred buffer for `beadwork://issue-explorer-state-changed`
   * events whose selection generation is newer than the gate's confirmed
   * generation. The slots are replayed after every admitted Workspace
   * transition or successful startup snapshot. `bsm-wj1.2` closed the
   * backend event-ordering race by keeping only the newest payload per
   * identity; a newer generation replaces the slot, an older generation
   * is dropped.
   *
   * The buffer is split into two slots — one for Snapshot, one for
   * Health — so a not-yet-admitted Snapshot and a not-yet-admitted
   * Health event for the same identity can both be retained until the
   * gate admits the matching transition. `bsm-wj1.3` introduced the
   * Health variant; before the split, a single slot would silently
   * drop one variant when both were deferred for the same identity.
   */
  const deferredSnapshotRef = useRef<IssueExplorerRefreshSnapshotEvent | null>(
    null
  );
  const deferredHealthRef = useRef<IssueExplorerRefreshHealthEvent | null>(
    null
  );
  const [dismissedSwitchErrorGeneration, setDismissedSwitchErrorGeneration] =
    useState<number | null>(null);

  const navigateIssueRoute = useCallback(
    (
      route: typeof issueRoute,
      replace: boolean,
      workspacePath = currentWorkspacePath
    ): void => {
      const current = readIssueNavigationEntry(window.history.state);
      const index = replace
        ? (current?.index ?? 0)
        : (current?.index ?? -1) + 1;
      const entry = createIssueNavigationEntry(route, workspacePath, index);
      if (!replace) {
        truncateForwardIssueNavigationEntries(
          navigationLedgerRef.current,
          index - 1
        );
      }
      recordIssueNavigationEntry(navigationLedgerRef.current, entry);
      navigate(serializeIssueExplorerRoute(route), {
        replace,
        state: writeIssueNavigationState(window.history.state, entry),
      });
    },
    [currentWorkspacePath, navigate]
  );

  useExternalLifecycle(() => {
    const entry =
      currentNavigationEntry ??
      createIssueNavigationEntry(issueRoute, currentWorkspacePath, 0);
    recordIssueNavigationEntry(navigationLedgerRef.current, entry);
    if (currentNavigationEntry === null) {
      window.history.replaceState(
        writeIssueNavigationState(window.history.state, entry),
        "",
        serializeIssueExplorerRoute(issueRoute)
      );
    }
  }, [currentNavigationEntry, currentWorkspacePath, issueRoute]);

  useExternalLifecycle(() => {
    const confirmedWorkspacePath =
      transitionGateRef.current.confirmedWorkspacePath;
    const currentHistoryEntry = readIssueNavigationEntry(window.history.state);
    if (
      issueState.status === "success" &&
      confirmedWorkspacePath === issueState.workspacePath &&
      currentHistoryEntry?.workspacePath !== issueState.workspacePath
    ) {
      navigateIssueRoute(
        {
          issueId: null,
          search: "",
          viewId: "all",
        },
        true,
        issueState.workspacePath
      );
    }
  }, [currentNavigationEntry, issueState, navigateIssueRoute]);

  const handleIssueListViewSelect = useCallback(
    (viewId: IssueListViewId) => {
      const selectedIssueId = selectIssueForView(
        issueState,
        viewId,
        explorerRoute.issueId
      );
      const nextRoute = {
        ...explorerRoute,
        issueId: selectedIssueId,
        viewId,
      };
      if (
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

  const handleIssueSelect = useCallback(
    (issueId: string) => {
      if (explorerRoute.issueId === issueId) {
        return;
      }
      navigateIssueRoute({ ...explorerRoute, issueId }, false);
    },
    [explorerRoute, navigateIssueRoute]
  );

  const handleIssueSearchChange = useCallback(
    (search: string) => {
      navigateIssueRoute({ ...explorerRoute, search }, true);
    },
    [explorerRoute, navigateIssueRoute]
  );

  const handleDeepLinkUrl = useCallback(
    async (url: string, startup: boolean): Promise<void> => {
      const parsed = parseIssueLocationUri(url);
      if (!parsed.ok) {
        setDeepLinkError(`Could not open link (${parsed.error}).`);
        return;
      }
      if (
        workspaceState === null ||
        (workspaceState.pendingWorkspace !== null &&
          workspaceState.pendingWorkspace !== undefined)
      ) {
        pendingDeepLinkRef.current = { startup, url };
        return;
      }

      const currentWorkspacePath =
        issueState.status === "success" ? issueState.workspacePath : null;
      if (parsed.value.workspacePath === currentWorkspacePath) {
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

      const requestGeneration = ++deepLinkRequestGenerationRef.current;
      try {
        const resolution = await createTauRPCProxy().resolve_workspace(
          parsed.value.workspacePath
        );
        if (requestGeneration !== deepLinkRequestGenerationRef.current) {
          return;
        }
        const resolvedCurrentPath =
          issueState.status === "success" ? issueState.workspacePath : null;
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
          `Do you want to ${action} and open Issue ${parsed.value.issueId}?`,
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
    [explorerRoute, issueState, navigateIssueRoute, workspaceState]
  );

  deepLinkHandlerRef.current = (url, startup) => {
    void handleDeepLinkUrl(url, startup);
  };
  deepLinkProcessorRef.current = () => {
    const pending = pendingDeepLinkRef.current;
    if (
      pending === null ||
      workspaceState === null ||
      (workspaceState.pendingWorkspace !== null &&
        workspaceState.pendingWorkspace !== undefined)
    ) {
      return;
    }
    pendingDeepLinkRef.current = null;
    deepLinkHandlerRef.current(pending.url, pending.startup);
  };

  useExternalLifecycle(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
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

  const handleIssueReferenceSelect = useCallback(
    (issueId: string) => {
      if (explorerRoute.issueId === issueId) {
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

  const previousNavigationEntry =
    navigationLedgerRef.current.entries.get(currentNavigationIndex - 1) ?? null;
  const nextNavigationEntry =
    navigationLedgerRef.current.entries.get(currentNavigationIndex + 1) ?? null;

  useExternalLifecycle(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (isEditableTarget) {
        return;
      }

      const isMac = navigator.platform.toLowerCase().includes("mac");
      const usesBackShortcut = isMac
        ? event.metaKey && event.key === "["
        : event.altKey && event.key === "ArrowLeft";
      const usesForwardShortcut = isMac
        ? event.metaKey && event.key === "]"
        : event.altKey && event.key === "ArrowRight";
      if (!usesBackShortcut && !usesForwardShortcut) {
        return;
      }

      event.preventDefault();
      if (usesBackShortcut && previousNavigationEntry !== null) {
        window.history.back();
      } else if (usesForwardShortcut && nextNavigationEntry !== null) {
        window.history.forward();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nextNavigationEntry, previousNavigationEntry]);

  const applyDeferredRefresh = useCallback((): boolean => {
    // Replay the deferred Snapshot first so the gate's confirmed
    // identity is committed before the Health event runs through the
    // gate (Health admission requires a confirmed identity). Loop
    // until both slots drain — committing a Snapshot may open the
    // gate for a previously-deferred Health event.
    let applied = false;
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const deferredSnapshot = deferredSnapshotRef.current;
      if (deferredSnapshot !== null) {
        deferredSnapshotRef.current = null;
        const { decision, next } = applyIssueExplorerRefresh(
          transitionGateRef.current,
          deferredSnapshot
        );
        if (decision.kind === "commitRefreshSnapshot") {
          transitionGateRef.current = next;
          setIssueState({ ...decision.snapshot, status: "success" });
          applied = true;
          continue;
        }
        if (decision.kind === "ignore") {
          continue;
        }
        deferredSnapshotRef.current = decision.payload;
        continue;
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
          setRefreshHealth(decision.health);
          applied = true;
          continue;
        }
        if (decision.kind === "ignore") {
          continue;
        }
        deferredHealthRef.current = decision.payload;
        continue;
      }
      break;
    }
    return applied;
  }, []);

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
    [applyDeferredRefresh]
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
            deferredSnapshotRef,
            deferredHealthRef,
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
        backDisabled={previousNavigationEntry === null}
        backLabel={issueNavigationDestinationLabel(previousNavigationEntry)}
        forwardDisabled={nextNavigationEntry === null}
        forwardLabel={issueNavigationDestinationLabel(nextNavigationEntry)}
        onBack={() => {
          if (isSettingsRoute && currentNavigationIndex === 0) {
            navigateIssueRoute(explorerRoute, true);
            return;
          }
          window.history.back();
        }}
        onForward={() => window.history.forward()}
        onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
        sidebarCollapsed={sidebarCollapsed}
      />
      {deepLinkError !== null ? (
        <div
          aria-live="assertive"
          className="flex items-center gap-3 border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-red-200"
          role="alert"
        >
          <span className="flex-1">{deepLinkError}</span>
          <button
            aria-label="Dismiss deep-link error"
            className="rounded px-2 py-1 text-xs text-text-main hover:bg-white/10"
            onClick={() => setDeepLinkError(null)}
            type="button"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeIssueListViewId={explorerRoute.viewId}
          appDestination={appDestination}
          collapsed={sidebarCollapsed}
          disabled={sidebarDisabled}
          dismissedSwitchErrorGeneration={dismissedSwitchErrorGeneration}
          issueState={presentedIssueState}
          onCollapseToggle={setSidebarCollapsed}
          onIssueListViewSelect={handleIssueListViewSelect}
          onSettingsClick={() => {
            underlyingIssueRouteRef.current = explorerRoute;
            navigate("/settings", {
              replace: true,
              state: window.history.state,
            });
          }}
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
                activeIssueListViewId={explorerRoute.viewId}
                issueState={presentedIssueState}
                markdownFontSizePx={settings.state.appliedFontSizePx}
                onIssueSearchChange={handleIssueSearchChange}
                onIssueSelect={handleIssueSelect}
                onIssueReferenceSelect={handleIssueReferenceSelect}
                route={explorerRoute}
                refreshHealth={refreshHealth}
                titleOverride={isSettingsRoute ? "Settings · Beadsmithy" : null}
                focusRouteChanges={!isSettingsRoute}
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

import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Circle,
  CircleSlash,
  Clock,
  Folder,
  Inbox,
  PlayCircle,
  Settings as SettingsIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import "./App.css";
import {
  WorkspaceSelector,
  pickerDefaultPath,
} from "./components/WorkspaceSelector";
import {
  DEFAULT_ISSUE_LIST_VIEW_ID,
  formatIssueCountLabel,
  getIssueListViewCounts,
  ISSUE_LIST_VIEW_DEFINITIONS,
} from "./issues/issue-list-view";
import type {
  IssueListViewDefinition,
  IssueListViewId,
} from "./issues/issue-list-view";
import {
  ISSUE_EXPLORER_LOADING_STATE,
  loadIssueExplorerStateFromTauRpc,
} from "./issues/issue-loader";
import type { IssueExplorerLoadState } from "./issues/issue-loader";
import { IssueExplorer } from "./issues/IssueExplorer";
import { createTauRPCProxy } from "./rpc/bindings";
import type {
  LoadIssueExplorerDataResponse,
  WorkspaceState,
} from "./rpc/bindings";
import { useAppSettings } from "./settings/app-settings";
import { SettingsPage } from "./settings/SettingsPage";
import {
  applyStartupIssueLoad,
  applyWorkspaceTransition,
  INITIAL_WORKSPACE_TRANSITION_GATE_STATE,
} from "./workspaces/transition-gate";
import type {
  WorkspaceTransitionDecision,
  WorkspaceTransitionGateState,
} from "./workspaces/transition-gate";

const WORKSPACE_TRANSITION_EVENT = "workspace-transition";

interface WorkspaceTransition {
  issueData: LoadIssueExplorerDataResponse | null;
  state: WorkspaceState;
}

const ISSUE_LIST_VIEW_ICONS: Record<IssueListViewId, LucideIcon> = {
  all: Inbox,
  blocked: CircleSlash,
  closed: CheckCircle2,
  deferred: Clock,
  in_progress: PlayCircle,
  open: Circle,
  ready: CheckCircle2,
};

type AppDestination = "issueExplorer" | "settings";

const SidebarSettingsButton = ({
  current,
  onClick,
}: {
  current: boolean;
  onClick: () => void;
}) => (
  <button
    aria-current={current ? "page" : undefined}
    aria-label="Settings"
    className={`flex w-full items-center rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-white/5 hover:text-text-main ${
      current ? "bg-white/5 text-primary" : "text-muted"
    }`}
    onClick={onClick}
    type="button"
  >
    <SettingsIcon className="mr-2 size-4" />
    <span>Settings</span>
  </button>
);

const SidebarNavButton = ({
  count,
  current,
  disabled,
  item,
  onSelect,
}: {
  count: number | null;
  current: boolean;
  disabled: boolean;
  item: IssueListViewDefinition;
  onSelect: (viewId: IssueListViewId) => void;
}) => {
  const Icon = ISSUE_LIST_VIEW_ICONS[item.id];
  const countLabel = count === null ? null : formatIssueCountLabel(count);

  return (
    <button
      aria-current={current ? "true" : undefined}
      aria-label={
        countLabel === null ? item.label : `${item.label}, ${countLabel}`
      }
      className={`flex w-full items-center rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-white/5 hover:text-text-main hover:disabled:bg-transparent hover:disabled:text-muted ${
        current ? "bg-white/5 text-primary" : "text-muted"
      }`}
      disabled={disabled}
      onClick={() => {
        onSelect(item.id);
      }}
      type="button"
    >
      <Icon className="mr-2 size-4" />
      <span>{item.label}</span>
      {count === null ? null : (
        <span className="ml-auto font-mono text-[11px] text-muted tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
};

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

/**
 * Apply the gate's decision to the renderer's React state. The gate is
 * the only source of admission truth; this helper translates the
 * discriminated decision into the small set of React effects App owns.
 *
 * `commitSnapshot` and `clearSnapshot` both remount the Issue Explorer
 * by changing the `workspaceKey`. `acceptStateRetainSnapshot` leaves the
 * explorer subtree untouched so its workspace-scoped search and
 * selected Issue survive the admission.
 */
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
    setIssueState(NO_WORKSPACE_ERROR_STATE);
    setWorkspaceKey(decision.remountKey);
    return;
  }
  // decision.kind === "commitSnapshot"
  // The gate guarantees `decision.snapshot` is non-null and matches
  // the Current Workspace path when this decision is returned.
  setIssueState({ ...decision.snapshot, status: "success" });
  setWorkspaceKey(decision.remountKey);
};

export default function App() {
  const [issueState, setIssueState] = useState<IssueExplorerLoadState>(
    ISSUE_EXPLORER_LOADING_STATE
  );
  const [activeIssueListViewId, setActiveIssueListViewId] =
    useState<IssueListViewId>(DEFAULT_ISSUE_LIST_VIEW_ID);
  const [appDestination, setAppDestination] =
    useState<AppDestination>("issueExplorer");
  const settings = useAppSettings();
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState | null>(
    null
  );
  // The remount key for the Issue Explorer subtree. It changes only on
  // a confirmed Current commit (or its removal) so the prior
  // Workspace's selected Issue and Issue Search are cleared before the
  // new snapshot is interactive. The active Issue List View lives here
  // in App and survives the remount.
  const [workspaceKey, setWorkspaceKey] = useState<string>(
    INITIAL_WORKSPACE_TRANSITION_GATE_STATE.confirmedWorkspacePath ??
      "/__initial__"
  );
  // Renderer transition state. The gate owns every lifecycle marker
  // previously held by `acceptedGenerationRef`, `committedGenerationRef`,
  // `terminalGenerationRef`, `confirmedWorkspacePathRef`, and
  // `initialLoadCommittedGenerationRef`. The ref avoids stale callback
  // closures while events and RPC completions race.
  const transitionGateRef = useRef<WorkspaceTransitionGateState>(
    INITIAL_WORKSPACE_TRANSITION_GATE_STATE
  );
  // Local banner dismissal is keyed to its request generation. A
  // harmless refresh preserves it, while a new selection/error
  // automatically re-shows the Retry banner without mutating backend
  // state.
  const [dismissedSwitchErrorGeneration, setDismissedSwitchErrorGeneration] =
    useState<number | null>(null);
  const handleIssueListViewSelect = useCallback((viewId: IssueListViewId) => {
    setActiveIssueListViewId(viewId);
    setAppDestination("issueExplorer");
  }, []);
  const issueListViewCounts = getIssueListViewCounts(issueState);
  const sidebarDisabled = issueState.status !== "success";
  const viewItems = ISSUE_LIST_VIEW_DEFINITIONS.filter(
    (item) => item.group === "views"
  );
  const statusItems = ISSUE_LIST_VIEW_DEFINITIONS.filter(
    (item) => item.group === "status"
  );

  // Apply a backend transition payload through the same handler as the
  // typed RPC response. The gate returns the next renderer state and a
  // discriminated decision; App translates the decision into the
  // React effects (workspace state, issue state, remount key).
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

      setWorkspaceState(transition.state);
      applyTransitionDecision(decision, setIssueState, setWorkspaceKey);
      return decision;
    },
    []
  );

  const refreshWorkspaceState = useCallback(async () => {
    try {
      const next = await createTauRPCProxy().workspace_state();
      applyTransition({ issueData: null, state: next }, null);
    } catch {
      // No typed state is available if the transport itself is unavailable.
    }
  }, [applyTransition]);

  useEffect(() => {
    // Capture committed-success generation at dispatch time so the
    // startup helper can detect a later committed switch without
    // consulting any ref the caller owns.
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
  }, [refreshWorkspaceState]);

  // Subscribe to backend transition events. The renderer uses the same
  // generation-guarded handler as the typed RPC response so a stale
  // event can never overwrite a newer state.
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void (async () => {
      const listener = await listen<WorkspaceTransition>(
        WORKSPACE_TRANSITION_EVENT,
        (event) => {
          applyTransition(event.payload, null);
        }
      );
      if (disposed) {
        listener();
      } else {
        unlisten = listener;
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [applyTransition]);

  const selectWorkspace = async (path: string) => {
    const expectedGeneration = transitionGateRef.current.acceptedGeneration + 1;
    setDismissedSwitchErrorGeneration(null);
    try {
      const response = await createTauRPCProxy().switch_workspace(path);
      // Discard a late response: a newer selection or a Cancel has
      // already superseded this request. Backend also rejects stale
      // results, so the snapshot was never published; dropping here
      // keeps the UI aligned.
      applyTransition(
        { issueData: response.issueData, state: response.state },
        expectedGeneration
      );
    } catch {
      // Preserve the old issueState entirely — a failed switch must
      // not overwrite the prior Workspace's snapshot. Refresh typed
      // workspace state so the inline validation error or banner
      // reappears.
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
      // The retry-memory response carries the restored snapshot when
      // the remembered Current Workspace was successfully restored;
      // pass it through the same gate so the renderer updates the
      // Issue Explorer in lockstep with the typed state.
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
      // The gate's `clearSnapshot` decision already publishes the
      // no-workspace error and remounts the explorer when a snapshot
      // was previously confirmed. Reset without a confirmed snapshot
      // (the storage-failure recovery path) returns
      // `acceptStateRetainSnapshot`; we then force the chooser
      // presentation manually so the recovery panel is replaced by a
      // known good no-workspace UI.
      const decision = applyTransition({ issueData: null, state }, null);
      if (decision.kind === "acceptStateRetainSnapshot") {
        setIssueState(NO_WORKSPACE_ERROR_STATE);
        setWorkspaceKey("/__reset__");
      }
    } catch {
      await refreshWorkspaceState();
    }
  };

  const cancelWorkspace = async () => {
    try {
      // The typed response carries the matching Issue Explorer
      // snapshot when the cancel races after a durable
      // commit-before-success-publication. Pairing the snapshot with
      // the new state here lets the gate apply both atomically; a
      // real Pending cancellation deliberately returns `issueData:
      // null` so the prior workspace's issue list stays untouched.
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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background font-primary text-text-main antialiased">
      {/* Left Sidebar */}
      <nav className="flex w-60 shrink-0 flex-col border-r border-border-main bg-surface">
        <div className="flex h-12 items-center px-4 text-[14px] font-semibold">
          <Folder className="mr-2 size-4 text-accent" />
          <span>Beadwork</span>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          <div className="px-4 py-2 font-mono text-[10px] tracking-wider text-muted uppercase">
            Views
          </div>
          <div className="px-2">
            {viewItems.map((item) => (
              <SidebarNavButton
                count={issueListViewCounts?.[item.id] ?? null}
                current={
                  appDestination === "issueExplorer" &&
                  item.id === activeIssueListViewId
                }
                disabled={sidebarDisabled}
                item={item}
                key={item.id}
                onSelect={handleIssueListViewSelect}
              />
            ))}
          </div>

          <div className="px-4 py-2 pt-6 font-mono text-[10px] tracking-wider text-muted uppercase">
            Status
          </div>
          <div className="px-2">
            {statusItems.map((item) => (
              <SidebarNavButton
                count={issueListViewCounts?.[item.id] ?? null}
                current={
                  appDestination === "issueExplorer" &&
                  item.id === activeIssueListViewId
                }
                disabled={sidebarDisabled}
                item={item}
                key={item.id}
                onSelect={handleIssueListViewSelect}
              />
            ))}
          </div>
        </div>

        <div className="border-t border-border-main p-2">
          <SidebarSettingsButton
            current={appDestination === "settings"}
            onClick={() => setAppDestination("settings")}
          />
        </div>

        <WorkspaceSelector
          onCancel={
            workspaceState?.pendingWorkspace === null ||
            workspaceState?.pendingWorkspace === undefined
              ? undefined
              : () => void cancelWorkspace()
          }
          onChoose={() => void chooseWorkspace()}
          onDismissSwitchError={dismissSwitchError}
          onRemove={(path) => void removeWorkspace(path)}
          onResetMemory={() => void resetWorkspaceMemory()}
          onRetryLastSwitch={
            workspaceState?.retryWorkspace === null ||
            workspaceState?.retryWorkspace === undefined
              ? undefined
              : () => void retryLastSwitch()
          }
          onRetryMemory={() => void retryWorkspaceMemory()}
          onSelect={(path) => void selectWorkspace(path)}
          state={workspaceState}
          switchErrorDismissed={
            dismissedSwitchErrorGeneration === workspaceState?.generation
          }
        />
      </nav>

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
          workspaceState.currentWorkspace === null ? (
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
              issueState={issueState}
              markdownFontSizePx={settings.state.appliedFontSizePx}
              onIssueListViewChange={setActiveIssueListViewId}
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
  );
}

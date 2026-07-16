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
import { isRetryableSwitchFailureKind } from "./workspace-switch-failure";

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

const INITIAL_WORKSPACE_KEY = "/__initial__";

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
  // The remount key for the Issue Explorer subtree. It changes only on a
  // confirmed Current commit so the prior Workspace's selected Issue and
  // Issue Search are cleared before the new snapshot is interactive. The
  // active Issue List View lives here in App and survives the remount.
  const [workspaceKey, setWorkspaceKey] = useState<string>(
    INITIAL_WORKSPACE_KEY
  );
  // Generation guard for stale responses and transition events. A ref avoids
  // stale callback closures while events and RPC completions race.
  const acceptedGenerationRef = useRef(0);
  // Highest generation that has produced a committed success on the renderer
  // side. Once a generation has been promoted to Current with its Issue
  // Explorer snapshot, that generation is terminal: a delayed same-generation
  // Pending event must not be allowed to roll the workspace state back to
  // "pending=B, current=null" while the Issue Explorer still shows B's data.
  // `acceptedGenerationRef` alone only rejects strictly older generations,
  // so without this marker a late Pending for the same generation could
  // overwrite an already accepted commit. Use `<=` so the committed
  // generation itself and anything older are dropped.
  const committedGenerationRef = useRef(-1);
  // Highest generation that has produced an accepted switch failure.
  // Same-generation Pending events at or below this generation are silently
  // rejected so an out-of-order Pending transition cannot overwrite either
  // the retry banner or an inline validation error. Initial value `-1` means
  // no switch failure has been accepted yet.
  const terminalGenerationRef = useRef(-1);
  // Tracks the confirmed snapshot currently rendered by Issue Explorer. It
  // lets a remove-current transition replace that snapshot with the chooser
  // state without clearing A during Pending/failure for B.
  const confirmedWorkspacePathRef = useRef<string | null>(null);
  // Committed-success generation captured at the moment the initial issue-load
  // RPC is dispatched. A regular initial workspace-state refresh may advance
  // `acceptedGenerationRef` before the initial snapshot returns, but it has
  // not published a new snapshot. Only a later committed success supersedes
  // the initial load and must prevent it from overwriting the newer snapshot.
  const initialLoadCommittedGenerationRef = useRef(-1);
  // Local banner dismissal is keyed to its request generation. A harmless
  // refresh preserves it, while a new selection/error automatically re-shows
  // the Retry banner without mutating backend state.
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

  // Apply a backend transition payload through the same handler as the typed
  // RPC response. Stale payloads (older than the most recently accepted
  // generation) are silently dropped. On a committed success we also
  // promote the Issue Explorer snapshot and remount key so the prior
  // Workspace's selected Issue and search are cleared before the new
  // snapshot is interactive.
  const applyTransition = useCallback(
    (
      transition: WorkspaceTransition,
      expectedGeneration: number | null
    ): boolean => {
      // Committed-success terminal guard: once a generation has produced a
      // typed success, that generation is terminal. Any later transition at
      // or below it — including a delayed same-generation Pending event
      // emitted before the backend observed the commit — is silently
      // dropped. Without this, a late Pending transition would call
      // `setWorkspaceState(pending=B, current=null)` while the committed
      // Issue Explorer snapshot remained on B, producing a mixed state.
      if (transition.state.generation <= committedGenerationRef.current) {
        return false;
      }
      if (
        (expectedGeneration !== null &&
          transition.state.generation !== expectedGeneration) ||
        transition.state.generation < acceptedGenerationRef.current
      ) {
        return false;
      }
      // Failed-switch terminal guard: once a typed failure has been accepted
      // for a generation, same-generation Pending transitions at or below it
      // are silently dropped. This keeps both the retry banner and inline
      // validation feedback from being overwritten by stale Pending events.
      if (
        transition.state.pendingWorkspace !== null &&
        transition.state.generation <= terminalGenerationRef.current
      ) {
        return false;
      }

      acceptedGenerationRef.current = transition.state.generation;
      setWorkspaceState(transition.state);

      const { issueData } = transition;
      const currentPath = transition.state.currentWorkspace?.path ?? null;
      if (issueData !== null && issueData.workspacePath === currentPath) {
        confirmedWorkspacePathRef.current = currentPath;
        setIssueState({ ...issueData, status: "success" });
        setWorkspaceKey(issueData.workspacePath);
        // Promote this generation to terminal so any subsequent event for it
        // (e.g., a delayed Pending) cannot regress the committed state.
        committedGenerationRef.current = transition.state.generation;
      } else if (
        currentPath === null &&
        confirmedWorkspacePathRef.current !== null
      ) {
        confirmedWorkspacePathRef.current = null;
        setIssueState({
          error: {
            kind: "noWorkspace",
            message: "Select a workspace to load issues.",
          },
          status: "failure",
        });
        setWorkspaceKey("/__removed__");
      }
      if (
        transition.state.pendingWorkspace === null &&
        (isRetryableSwitchFailureKind(transition.state.error?.kind) ||
          (transition.state.error !== null &&
            transition.state.retryWorkspace === null))
      ) {
        terminalGenerationRef.current = transition.state.generation;
      }
      return true;
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
    // Capture committed success at dispatch time. A later committed switch,
    // unlike an ordinary startup state refresh, has a newer snapshot and
    // must supersede the initial load's snapshot.
    initialLoadCommittedGenerationRef.current = committedGenerationRef.current;
    void (async () => {
      try {
        const initial = await loadIssueExplorerStateFromTauRpc();
        const dispatchedAt = initialLoadCommittedGenerationRef.current;
        const superseded = committedGenerationRef.current > dispatchedAt;
        if (superseded) {
          // A switch committed while the initial load was in flight. The
          // committed-success guard will keep the new snapshot; the
          // initial load's snapshot would otherwise overwrite it.
          return;
        }
        setIssueState(initial);
        if (initial.status === "success") {
          confirmedWorkspacePathRef.current = initial.workspacePath;
          setWorkspaceKey(initial.workspacePath || INITIAL_WORKSPACE_KEY);
        }
      } catch {
        const dispatchedAt = initialLoadCommittedGenerationRef.current;
        const superseded = committedGenerationRef.current > dispatchedAt;
        if (superseded) {
          return;
        }
        setIssueState({
          error: {
            kind: "unknown",
            message: "Beadsmith could not load issues.",
          },
          status: "failure",
        });
      }
    })();
    void refreshWorkspaceState();
  }, [refreshWorkspaceState]);

  // Subscribe to backend transition events. The renderer uses the same
  // generation-guarded handler as the typed RPC response so a stale event
  // can never overwrite a newer state.
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
    const expectedGeneration = acceptedGenerationRef.current + 1;
    setDismissedSwitchErrorGeneration(null);
    try {
      const response = await createTauRPCProxy().switch_workspace(path);
      // Discard a late response: a newer selection or a Cancel has already
      // superseded this request. Backend also rejects stale results, so the
      // snapshot was never published; dropping here keeps the UI aligned.
      applyTransition(
        { issueData: response.issueData, state: response.state },
        expectedGeneration
      );
    } catch {
      // Preserve the old issueState entirely — a failed switch must not
      // overwrite the prior Workspace's snapshot. Refresh typed workspace
      // state so the inline validation error or banner reappears.
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
      // The retry-memory response carries the restored snapshot when the
      // remembered Current Workspace was successfully restored; pass it
      // through the same generation-guarded handler so the renderer
      // updates the Issue Explorer in lockstep with the typed state.
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
      setIssueState({
        error: {
          kind: "noWorkspace",
          message: "Select a workspace to load issues.",
        },
        status: "failure",
      });
      setWorkspaceKey("/__reset__");
    } catch {
      await refreshWorkspaceState();
    }
  };

  const cancelWorkspace = async () => {
    try {
      // The typed response carries the matching Issue Explorer snapshot
      // when the cancel races after a durable commit-before-success-
      // publication. Pairing the snapshot with the new state here lets
      // `applyTransition` apply both atomically; a real Pending
      // cancellation deliberately returns `issueData: null` so the prior
      // workspace's issue list stays untouched.
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

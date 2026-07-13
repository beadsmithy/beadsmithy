import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Circle,
  CircleSlash,
  Clock,
  Folder,
  Inbox,
  PlayCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

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
import type { WorkspaceState } from "./rpc/bindings";

const ISSUE_LIST_VIEW_ICONS: Record<IssueListViewId, LucideIcon> = {
  all: Inbox,
  blocked: CircleSlash,
  closed: CheckCircle2,
  deferred: Clock,
  in_progress: PlayCircle,
  open: Circle,
  ready: CheckCircle2,
};

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
        if (!current) {
          onSelect(item.id);
        }
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

export default function App() {
  const [issueState, setIssueState] = useState<IssueExplorerLoadState>(
    ISSUE_EXPLORER_LOADING_STATE
  );
  const [activeIssueListViewId, setActiveIssueListViewId] =
    useState<IssueListViewId>(DEFAULT_ISSUE_LIST_VIEW_ID);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState | null>(
    null
  );
  const issueListViewCounts = getIssueListViewCounts(issueState);
  const sidebarDisabled = issueState.status !== "success";
  const viewItems = ISSUE_LIST_VIEW_DEFINITIONS.filter(
    (item) => item.group === "views"
  );
  const statusItems = ISSUE_LIST_VIEW_DEFINITIONS.filter(
    (item) => item.group === "status"
  );

  useEffect(() => {
    void (async () => {
      setIssueState(await loadIssueExplorerStateFromTauRpc());
    })();
    void (async () => {
      try {
        setWorkspaceState(await createTauRPCProxy().workspace_state());
      } catch {
        // The issue loader reports backend availability; keep selector neutral
        // until its typed state is available.
      }
    })();
  }, []);

  const selectWorkspace = async (path: string) => {
    try {
      const response = await createTauRPCProxy().switch_workspace(path);
      setWorkspaceState(response.state);
      setIssueState({ ...response.issueData, status: "success" });
    } catch {
      setWorkspaceState(await createTauRPCProxy().workspace_state());
    }
  };

  const chooseWorkspace = async () => {
    const selection = await open({
      defaultPath: pickerDefaultPath(workspaceState) ?? undefined,
      directory: true,
      multiple: false,
    });
    if (typeof selection === "string") {
      await selectWorkspace(selection);
    }
  };

  const removeWorkspace = async (path: string) => {
    const removingCurrent = workspaceState?.currentWorkspace?.path === path;
    const state = await createTauRPCProxy().remove_workspace(path);
    setWorkspaceState(state);
    if (removingCurrent) {
      setIssueState({
        error: {
          kind: "noWorkspace",
          message: "Select a workspace to load issues.",
        },
        status: "failure",
      });
    }
  };

  const retryWorkspaceMemory = async () => {
    setWorkspaceState(await createTauRPCProxy().retry_workspace_memory());
  };

  const resetWorkspaceMemory = async () => {
    const state = await createTauRPCProxy().reset_workspace_memory();
    setWorkspaceState(state);
    setIssueState({
      error: {
        kind: "noWorkspace",
        message: "Select a workspace to load issues.",
      },
      status: "failure",
    });
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
                current={item.id === activeIssueListViewId}
                disabled={sidebarDisabled}
                item={item}
                key={item.id}
                onSelect={setActiveIssueListViewId}
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
                current={item.id === activeIssueListViewId}
                disabled={sidebarDisabled}
                item={item}
                key={item.id}
                onSelect={setActiveIssueListViewId}
              />
            ))}
          </div>
        </div>

        <WorkspaceSelector
          onChoose={() => void chooseWorkspace()}
          onRemove={(path) => void removeWorkspace(path)}
          onResetMemory={() => void resetWorkspaceMemory()}
          onRetryMemory={() => void retryWorkspaceMemory()}
          onSelect={(path) => void selectWorkspace(path)}
          state={workspaceState}
        />
      </nav>

      {workspaceState !== null && workspaceState.currentWorkspace === null ? (
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
          onIssueListViewChange={setActiveIssueListViewId}
        />
      )}
    </div>
  );
}

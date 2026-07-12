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
import { WorkspaceSwitcherPrototype } from "./workspace-switcher.prototype";

const ISSUE_LIST_VIEW_ICONS: Record<IssueListViewId, LucideIcon> = {
  all: Inbox,
  blocked: CircleSlash,
  closed: CheckCircle2,
  deferred: Clock,
  in_progress: PlayCircle,
  open: Circle,
  ready: CheckCircle2,
};

const workspaceTextFor = (state: IssueExplorerLoadState): string => {
  if (state.status === "success") {
    return state.workspacePath;
  }

  if (state.status === "failure") {
    return "Unavailable";
  }

  return "Loading workspace…";
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
  const isWorkspaceSwitcherPrototype =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("prototype") ===
      "workspace-switcher";
  const [issueState, setIssueState] = useState<IssueExplorerLoadState>(
    ISSUE_EXPLORER_LOADING_STATE
  );
  const [activeIssueListViewId, setActiveIssueListViewId] =
    useState<IssueListViewId>(DEFAULT_ISSUE_LIST_VIEW_ID);
  const workspacePath = workspaceTextFor(issueState);
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
  }, []);

  if (isWorkspaceSwitcherPrototype) {
    return <WorkspaceSwitcherPrototype />;
  }

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

        <div className="border-t border-border-main p-4">
          <div className="mb-1 flex items-center justify-between font-mono text-[10px] tracking-wider text-muted uppercase">
            <span>Current Workspace</span>
            <span className="opacity-50" aria-hidden="true">
              ⇄
            </span>
          </div>
          <div
            className="truncate font-mono text-xs text-text-main"
            title={workspacePath}
          >
            {workspacePath}
          </div>
        </div>
      </nav>

      <IssueExplorer
        activeIssueListViewId={activeIssueListViewId}
        issueState={issueState}
        onIssueListViewChange={setActiveIssueListViewId}
      />
    </div>
  );
}

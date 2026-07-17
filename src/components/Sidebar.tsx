import {
  CheckCircle2,
  Circle,
  CircleSlash,
  Clock,
  Folder,
  Inbox,
  PanelLeftClose,
  PlayCircle,
  Settings as SettingsIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";

import {
  formatIssueCountLabel,
  getIssueListViewCounts,
  ISSUE_LIST_VIEW_DEFINITIONS,
} from "../issues/issue-list-view";
import type {
  IssueListViewDefinition,
  IssueListViewId,
} from "../issues/issue-list-view";
import type { IssueExplorerLoadState } from "../issues/issue-loader";
import type { WorkspaceState } from "../rpc/bindings";
import { WorkspaceSelector } from "./WorkspaceSelector";

type AppDestination = "issueExplorer" | "settings";

const ISSUE_LIST_VIEW_ICONS: Record<IssueListViewId, LucideIcon> = {
  all: Inbox,
  blocked: CircleSlash,
  closed: CheckCircle2,
  deferred: Clock,
  in_progress: PlayCircle,
  open: Circle,
  ready: CheckCircle2,
};

const SidebarSettingsButton = ({
  collapsed,
  current,
  onClick,
}: {
  collapsed: boolean;
  current: boolean;
  onClick: () => void;
}) => (
  <button
    aria-current={current ? "page" : undefined}
    aria-label="Settings"
    className={`flex w-full items-center rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-white/5 hover:text-text-main ${
      collapsed ? "justify-center" : ""
    } ${current ? "bg-white/5 text-primary" : "text-muted"}`}
    onClick={onClick}
    title="Settings"
    type="button"
  >
    <SettingsIcon className={collapsed ? "size-4" : "mr-2 size-4"} />
    {collapsed ? null : <span>Settings</span>}
  </button>
);

const SidebarNavButton = ({
  collapsed,
  count,
  current,
  disabled,
  item,
  onSelect,
}: {
  collapsed: boolean;
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
        collapsed ? "justify-center" : ""
      } ${current ? "bg-white/5 text-primary" : "text-muted"}`}
      disabled={disabled}
      onClick={() => {
        onSelect(item.id);
      }}
      title={collapsed ? item.label : undefined}
      type="button"
    >
      <Icon className={collapsed ? "size-4" : "mr-2 size-4"} />
      {collapsed ? null : (
        <>
          <span>{item.label}</span>
          {count === null ? null : (
            <span className="ml-auto font-mono text-[11px] text-muted tabular-nums">
              {count}
            </span>
          )}
        </>
      )}
    </button>
  );
};

interface SidebarProps {
  activeIssueListViewId: IssueListViewId;
  appDestination: AppDestination;
  collapsed: boolean;
  disabled: boolean;
  dismissedSwitchErrorGeneration: number | null;
  issueState: IssueExplorerLoadState;
  onCollapseToggle: (collapsed: boolean) => void;
  onIssueListViewSelect: (viewId: IssueListViewId) => void;
  onSettingsClick: () => void;
  workspaceHandlers: Omit<
    ComponentProps<typeof WorkspaceSelector>,
    "state" | "switchErrorDismissed"
  >;
  workspaceState: WorkspaceState | null;
}

export const Sidebar = ({
  activeIssueListViewId,
  appDestination,
  collapsed,
  disabled,
  dismissedSwitchErrorGeneration,
  issueState,
  onCollapseToggle,
  onIssueListViewSelect,
  onSettingsClick,
  workspaceHandlers,
  workspaceState,
}: SidebarProps) => {
  const issueListViewCounts = getIssueListViewCounts(issueState);
  const viewItems = ISSUE_LIST_VIEW_DEFINITIONS.filter(
    (item) => item.group === "views"
  );
  const statusItems = ISSUE_LIST_VIEW_DEFINITIONS.filter(
    (item) => item.group === "status"
  );

  return (
    <nav
      className={`flex shrink-0 flex-col border-r border-border-main bg-surface ${
        collapsed ? "w-14" : "w-60"
      }`}
    >
      <div
        className={`flex h-12 items-center font-semibold ${
          collapsed ? "justify-center px-0" : "px-4 text-[14px]"
        }`}
      >
        {collapsed ? (
          <button
            aria-label="Expand sidebar"
            className="flex size-8 items-center justify-center rounded text-muted transition-colors hover:bg-white/5 hover:text-text-main"
            onClick={() => onCollapseToggle(false)}
            type="button"
          >
            <Folder className="size-4 text-accent" />
          </button>
        ) : (
          <>
            <Folder className="mr-2 size-4 text-accent" />
            <span className="flex-1">Beadwork</span>
            <button
              aria-label="Collapse sidebar"
              className="flex size-8 items-center justify-center rounded text-muted transition-colors hover:bg-white/5 hover:text-text-main"
              onClick={() => onCollapseToggle(true)}
              type="button"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {collapsed ? null : (
          <div className="px-4 py-2 font-mono text-[10px] tracking-wider text-muted uppercase">
            Views
          </div>
        )}
        <div className="px-2">
          {viewItems.map((item) => (
            <SidebarNavButton
              collapsed={collapsed}
              count={issueListViewCounts?.[item.id] ?? null}
              current={
                appDestination === "issueExplorer" &&
                item.id === activeIssueListViewId
              }
              disabled={disabled}
              item={item}
              key={item.id}
              onSelect={onIssueListViewSelect}
            />
          ))}
        </div>

        {collapsed ? null : (
          <div className="px-4 py-2 pt-6 font-mono text-[10px] tracking-wider text-muted uppercase">
            Status
          </div>
        )}
        <div className="px-2">
          {statusItems.map((item) => (
            <SidebarNavButton
              collapsed={collapsed}
              count={issueListViewCounts?.[item.id] ?? null}
              current={
                appDestination === "issueExplorer" &&
                item.id === activeIssueListViewId
              }
              disabled={disabled}
              item={item}
              key={item.id}
              onSelect={onIssueListViewSelect}
            />
          ))}
        </div>
      </div>

      <div
        className={`border-t border-border-main ${collapsed ? "p-1" : "p-2"}`}
      >
        <SidebarSettingsButton
          collapsed={collapsed}
          current={appDestination === "settings"}
          onClick={onSettingsClick}
        />
      </div>

      {collapsed ? null : (
        <WorkspaceSelector
          {...workspaceHandlers}
          state={workspaceState}
          switchErrorDismissed={
            dismissedSwitchErrorGeneration === workspaceState?.generation
          }
        />
      )}
    </nav>
  );
};

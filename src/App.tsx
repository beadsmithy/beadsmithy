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
  ISSUE_LOADING_STATE,
  loadIssueStateFromTauRpc,
} from "./issues/issue-loader";
import type { IssueLoadState } from "./issues/issue-loader";
import { IssueExplorer } from "./issues/IssueExplorer";

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  current?: boolean;
}

const VIEW_ITEMS: NavItem[] = [
  { current: true, icon: Inbox, id: "all", label: "All" },
  { icon: CheckCircle2, id: "ready", label: "Ready" },
  { icon: CircleSlash, id: "blocked", label: "Blocked" },
];

const STATE_ITEMS: NavItem[] = [
  { icon: Circle, id: "open", label: "Open" },
  { icon: PlayCircle, id: "in-progress", label: "In-Progress" },
  { icon: CheckCircle2, id: "closed", label: "Closed" },
  { icon: Clock, id: "deferred", label: "Deferred" },
];

const workspaceTextFor = (state: IssueLoadState): string => {
  if (state.status === "success" || state.status === "empty") {
    return state.workspacePath;
  }

  if (state.status === "failure") {
    return "Unavailable";
  }

  return "Loading workspace…";
};

const SidebarNavButton = ({ label, icon: Icon, current }: NavItem) => (
  <button
    aria-current={current ? "true" : undefined}
    className={`flex w-full items-center rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-white/5 hover:text-text-main hover:disabled:bg-transparent hover:disabled:text-muted ${
      current ? "bg-white/5 text-primary" : "text-muted"
    }`}
    disabled
  >
    <Icon className="mr-2 size-4" />
    {label}
  </button>
);

export default function App() {
  const [issueState, setIssueState] =
    useState<IssueLoadState>(ISSUE_LOADING_STATE);
  const workspacePath = workspaceTextFor(issueState);

  useEffect(() => {
    void (async () => {
      setIssueState(await loadIssueStateFromTauRpc());
    })();
  }, []);

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
            {VIEW_ITEMS.map((item) => (
              <SidebarNavButton key={item.id} {...item} />
            ))}
          </div>

          <div className="px-4 py-2 pt-6 font-mono text-[10px] tracking-wider text-muted uppercase">
            States
          </div>
          <div className="px-2">
            {STATE_ITEMS.map((item) => (
              <SidebarNavButton key={item.id} {...item} />
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

      <IssueExplorer issueState={issueState} />
    </div>
  );
}

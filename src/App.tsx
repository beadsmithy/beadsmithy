import {
  CheckCircle2,
  Circle,
  CircleSlash,
  Clock,
  FileText,
  Folder,
  Inbox,
  PlayCircle,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import "./App.css";

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

type IssueStatus = "blocked" | "open" | "ready";

const STATUS_DOT_CLASSES: Record<IssueStatus, string> = {
  blocked: "bg-danger",
  open: "border border-muted",
  ready: "bg-success",
};

const STATUS_LABELS: Record<IssueStatus, string> = {
  blocked: "Blocked",
  open: "Open",
  ready: "Ready",
};

interface MockIssue {
  id: string;
  title: string;
  status: IssueStatus;
}

const MOCK_ISSUES: MockIssue[] = [
  {
    id: "APP-101",
    status: "blocked",
    title: "Update authentication flow with new tokens",
  },
  { id: "APP-102", status: "ready", title: "Refactor dashboard grid layout" },
  {
    id: "APP-103",
    status: "open",
    title: "Implement skeleton loaders for lists",
  },
  { id: "SYS-042", status: "ready", title: "Migrate local database schema" },
];

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

const IssueRow = ({ id, title, status }: MockIssue) => (
  <button className="w-full border-b border-border-main p-3 text-left" disabled>
    <div className="mb-1 flex items-center gap-2">
      <div
        aria-hidden="true"
        className={`size-1.5 rounded-full ${STATUS_DOT_CLASSES[status]}`}
      />
      <span className="sr-only">{STATUS_LABELS[status]}</span>
      <span className="font-mono text-[12px] text-muted">{id}</span>
    </div>
    <div className="truncate text-[13px] font-medium text-text-main">
      {title}
    </div>
  </button>
);

export default function App() {
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
            <span>Current Directory</span>
            <span className="opacity-50">⇄</span>
          </div>
          <div
            className="truncate font-mono text-xs text-text-main"
            title="/Users/dev/work/portal"
          >
            /Users/dev/work/portal
          </div>
        </div>
      </nav>

      {/* Middle Pane: Issue List */}
      <section className="flex w-[320px] shrink-0 flex-col border-r border-border-main bg-background">
        <div className="flex h-14 items-center border-b border-border-main p-2">
          <div className="relative w-full">
            <label className="sr-only" htmlFor="issue-search">
              Search issues
            </label>
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              className="w-full rounded-md border border-border-main bg-surface py-1.5 pr-12 pl-9 text-sm text-text-main placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-50"
              disabled
              id="issue-search"
              placeholder="Search issues..."
              type="text"
            />
            <div className="absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border-main px-1.5 py-0.5 font-mono text-[10px] text-muted">
              Cmd+F
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Static Mock Items */}
          {MOCK_ISSUES.map((issue) => (
            <IssueRow key={issue.id} {...issue} />
          ))}
        </div>
      </section>

      {/* Right Pane: Issue Detail (Empty State) */}
      <main className="flex flex-1 flex-col items-center justify-center bg-background p-8">
        <div className="mb-6 flex size-16 items-center justify-center rounded-2xl border border-border-main bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <FileText className="size-8 text-muted" strokeWidth={1.5} />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-primary">
          No issue selected
        </h2>
        <p className="max-w-sm text-center text-sm text-muted">
          Select an issue from the list to view its details, or use{" "}
          <span className="mx-1 inline-flex items-center justify-center rounded border border-border-main bg-surface px-1.5 py-0.5 font-mono text-[10px]">
            Cmd+K
          </span>{" "}
          to find something specific.
        </p>
      </main>
    </div>
  );
}

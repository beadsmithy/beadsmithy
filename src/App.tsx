import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleSlash,
  Clock,
  FileText,
  Folder,
  Inbox,
  LoaderCircle,
  PlayCircle,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import "./App.css";
import {
  ISSUE_SUMMARY_LOADING_STATE,
  loadIssueSummaryStateFromTauRpc,
} from "./issues/issue-summary-loader";
import type { IssueSummaryLoadState } from "./issues/issue-summary-loader";
import { toIssueSummaryViewModel } from "./issues/issue-summary-view";
import type { IssueTone } from "./issues/issue-summary-view";
import type { IssueSummary } from "./rpc/bindings";

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

const TONE_DOT_CLASSES: Record<IssueTone, string> = {
  blocked: "bg-danger",
  closed: "bg-success",
  deferred: "border border-muted bg-surface",
  inProgress: "bg-accent",
  open: "border border-muted bg-background",
};

const TONE_BADGE_CLASSES: Record<IssueTone, string> = {
  blocked: "border-danger/30 bg-danger/10 text-red-200",
  closed: "border-success/30 bg-success/10 text-emerald-200",
  deferred: "border-border-main bg-surface text-muted",
  inProgress: "border-accent/40 bg-accent/10 text-indigo-200",
  open: "border-border-main bg-surface text-text-main",
};

const MAX_VISIBLE_LABELS = 3;

const workspaceTextFor = (state: IssueSummaryLoadState): string => {
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

const IssueRow = ({ issue }: { issue: IssueSummary }) => {
  const view = toIssueSummaryViewModel(issue);

  return (
    <article
      aria-label={`${view.id}: ${view.title}. ${view.metadataLabel}`}
      className="border-b border-border-main p-3"
    >
      <div className="mb-1.5 flex min-w-0 items-center gap-2">
        <div
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full ${TONE_DOT_CLASSES[view.tone]}`}
        />
        <span className="shrink-0 font-mono text-[12px] text-muted">
          {view.id}
        </span>
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10px] ${TONE_BADGE_CLASSES[view.tone]}`}
        >
          {view.statusLabel}
        </span>
      </div>
      <h3 className="truncate text-[13px] font-medium text-text-main">
        {view.title}
      </h3>
      <div className="mt-2 flex min-w-0 items-center gap-1.5 overflow-hidden font-mono text-[10px] text-muted">
        <span className="shrink-0 rounded border border-border-main px-1 py-0.5">
          {view.priorityLabel}
        </span>
        <span className="shrink-0 rounded border border-border-main px-1 py-0.5">
          {view.typeLabel}
        </span>
        {view.dependencyLabel.length > 0 ? (
          <span className="truncate rounded border border-border-main px-1 py-0.5">
            {view.dependencyLabel}
          </span>
        ) : null}
      </div>
      {view.labels.length > 0 ? (
        <div
          className="mt-2 flex min-w-0 gap-1 overflow-hidden"
          aria-label="Labels"
        >
          {view.labels.slice(0, MAX_VISIBLE_LABELS).map((label) => (
            <span
              className="truncate rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted"
              key={label}
            >
              {label}
            </span>
          ))}
          {view.labels.length > MAX_VISIBLE_LABELS ? (
            <span className="shrink-0 font-mono text-[10px] text-muted">
              +{view.labels.length - MAX_VISIBLE_LABELS}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
};

const IssueListContent = ({ state }: { state: IssueSummaryLoadState }) => {
  if (state.status === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-muted">
        <LoaderCircle className="mb-3 size-5 animate-spin text-accent" />
        <p className="font-medium text-text-main">Loading issues</p>
        <p className="mt-1 text-xs">Reading Beadwork issue summaries…</p>
      </div>
    );
  }

  if (state.status === "failure") {
    return (
      <div className="p-4" role="alert">
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-red-200">
            <AlertTriangle className="size-4" />
            Could not load issues
          </div>
          <p className="text-xs leading-5 text-text-main">
            {state.error.message}
          </p>
          <p className="mt-2 font-mono text-[10px] text-muted">
            {state.error.kind}
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "empty") {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-muted">
        <Inbox className="mb-3 size-6 text-muted" />
        <p className="font-medium text-text-main">No issues found</p>
        <p className="mt-1 text-xs">
          Beadwork returned an empty issue list for this workspace.
        </p>
      </div>
    );
  }

  return (
    <ul aria-label="Issues">
      {state.issues.map((issue) => (
        <li key={issue.id}>
          <IssueRow issue={issue} />
        </li>
      ))}
    </ul>
  );
};

export default function App() {
  const [issueState, setIssueState] = useState<IssueSummaryLoadState>(
    ISSUE_SUMMARY_LOADING_STATE
  );
  const workspacePath = workspaceTextFor(issueState);

  useEffect(() => {
    void (async () => {
      setIssueState(await loadIssueSummaryStateFromTauRpc());
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
          <IssueListContent state={issueState} />
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
          Issue details are not implemented in this slice. Search and filters
          are visible for orientation only.
        </p>
      </main>
    </div>
  );
}

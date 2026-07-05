import {
  AlertTriangle,
  FileText,
  Inbox,
  LoaderCircle,
  Search,
} from "lucide-react";
import { useState } from "react";

import type { Issue } from "../rpc/bindings";
import type { IssueLoadState } from "./issue-loader";
import { toIssueViewModel } from "./issue-view";
import type { IssueTone } from "./issue-view";

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

const SELECTED_ROW_CLASSES = "bg-surface";

const IssueRow = ({
  issue,
  isSelected,
  onSelect,
}: {
  issue: Issue;
  isSelected: boolean;
  onSelect: (issueId: string) => void;
}) => {
  const view = toIssueViewModel(issue);
  const rowContainerClassName = isSelected
    ? `border-b border-border-main ${SELECTED_ROW_CLASSES}`
    : "border-b border-border-main";

  return (
    <li>
      <article
        aria-label={`${view.id}: ${view.title}. ${view.metadataLabel}`}
        className={rowContainerClassName}
      >
        <button
          aria-current={isSelected ? "true" : undefined}
          aria-label={`${view.id}: ${view.title}. ${view.metadataLabel}`}
          className="block w-full cursor-pointer p-3 text-left transition-colors hover:bg-white/5 focus:bg-white/5 focus:outline-none"
          data-issue-id={issue.id}
          data-selected={isSelected ? "true" : "false"}
          onClick={() => onSelect(issue.id)}
          type="button"
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
              className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10px] ${TONE_BADGE_CLASSES[view.badgeTone]}`}
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
              aria-label="Labels"
              className="mt-2 flex min-w-0 gap-1 overflow-hidden"
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
        </button>
      </article>
    </li>
  );
};

const IssueListContent = ({
  state,
  selectedIssueId,
  onSelect,
}: {
  state: IssueLoadState;
  selectedIssueId: string | null;
  onSelect: (issueId: string) => void;
}) => {
  if (state.status === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-muted">
        <LoaderCircle className="mb-3 size-5 animate-spin text-accent" />
        <p className="font-medium text-text-main">Loading issues</p>
        <p className="mt-1 text-xs">Reading Beadwork issues…</p>
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
        <IssueRow
          issue={issue}
          isSelected={issue.id === selectedIssueId}
          key={issue.id}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
};

const IssueDetailEmpty = () => (
  <main
    aria-label="Issue detail"
    className="flex flex-1 flex-col items-center justify-center bg-background p-8"
  >
    <div className="mb-6 flex size-16 items-center justify-center rounded-2xl border border-border-main bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <FileText className="size-8 text-muted" strokeWidth={1.5} />
    </div>
    <h2 className="mb-2 text-xl font-semibold text-primary">
      No issue selected
    </h2>
    <p className="max-w-sm text-center text-sm text-muted">
      Select an issue from the list to see its details.
    </p>
  </main>
);

const IssueDetailContent = ({ issue }: { issue: Issue }) => {
  const view = toIssueViewModel(issue);

  return (
    <main
      aria-label="Issue detail"
      className="flex flex-1 flex-col gap-6 overflow-y-auto bg-background p-8"
    >
      <header>
        <span
          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-xs ${TONE_BADGE_CLASSES[view.badgeTone]}`}
        >
          {view.statusLabel}
        </span>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-2xl leading-tight font-semibold text-primary">
            {view.title}
          </h2>
          <span className="font-mono text-xs text-muted">{view.id}</span>
        </div>
      </header>
      <dl className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <dt className="font-mono text-[10px] tracking-wider text-muted uppercase">
            Priority
          </dt>
          <dd className="rounded border border-border-main px-2 py-0.5 font-mono text-xs text-text-main">
            {view.priorityLabel}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="font-mono text-[10px] tracking-wider text-muted uppercase">
            Type
          </dt>
          <dd className="rounded border border-border-main px-2 py-0.5 font-mono text-xs text-text-main">
            {view.typeLabel}
          </dd>
        </div>
      </dl>
      {view.labels.length > 0 ? (
        <section>
          <h3 className="font-mono text-[10px] tracking-wider text-muted uppercase">
            Labels
          </h3>
          <ul className="mt-2 flex flex-wrap gap-1">
            {view.labels.map((label) => (
              <li
                className="rounded bg-white/5 px-2 py-0.5 font-mono text-[11px] text-muted"
                key={label}
              >
                {label}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
};

const IssueDetailPane = ({ selectedIssue }: { selectedIssue: Issue | null }) =>
  selectedIssue === null ? (
    <IssueDetailEmpty />
  ) : (
    <IssueDetailContent issue={selectedIssue} />
  );

export const IssueExplorer = ({
  issueState,
}: {
  issueState: IssueLoadState;
}) => {
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  const selectedIssue: Issue | null =
    issueState.status === "success"
      ? (issueState.issues.find((issue) => issue.id === selectedIssueId) ??
        null)
      : null;

  const handleSelect = (issueId: string) => {
    setSelectedIssueId(issueId);
  };

  return (
    <>
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
          <IssueListContent
            onSelect={handleSelect}
            selectedIssueId={selectedIssueId}
            state={issueState}
          />
        </div>
      </section>
      <IssueDetailPane selectedIssue={selectedIssue} />
    </>
  );
};

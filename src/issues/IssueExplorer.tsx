import {
  AlertTriangle,
  Circle,
  CircleCheck,
  CircleSlash,
  Clock,
  FileText,
  Inbox,
  LoaderCircle,
  PlayCircle,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { ExternalLinkOpener } from "../components/external-link-opener";
import { openExternalLink as defaultOpenExternalLink } from "../components/external-link-opener";
import { MarkdownContent } from "../components/MarkdownContent";
import type { Issue, IssueComment } from "../rpc/bindings";
import {
  deriveIssueExplorerState,
  getIssueListEmptySupportingCopy,
  getIssueListEmptyTitle,
} from "./issue-explorer-state";
import type { IssueListEmptyReason } from "./issue-explorer-state";
import { getChildIssues } from "./issue-hierarchy";
import type { IssueListViewId } from "./issue-list-view";
import type { IssueExplorerLoadState } from "./issue-loader";
import { toIssueViewModel } from "./issue-view";
import type { IssueTone } from "./issue-view";

const EMPTY_CHILD_ISSUES: Issue[] = [];

const ISSUE_TONE_ICONS: Record<IssueTone, LucideIcon> = {
  blocked: CircleSlash,
  closed: CircleCheck,
  deferred: Clock,
  inProgress: PlayCircle,
  open: Circle,
};

const ISSUE_TONE_ICON_CLASSES: Record<IssueTone, string> = {
  blocked: "text-danger",
  closed: "text-muted opacity-60",
  deferred: "text-muted",
  inProgress: "text-accent",
  open: "text-muted",
};

const TONE_BADGE_CLASSES: Record<IssueTone, string> = {
  blocked: "border-danger/30 bg-danger/10 text-red-200",
  closed: "border-border-main bg-surface text-muted",
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
  const ToneIcon = ISSUE_TONE_ICONS[view.tone];
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
            <ToneIcon
              aria-hidden="true"
              className={`size-4 shrink-0 ${ISSUE_TONE_ICON_CLASSES[view.tone]}`}
            />
            <span className="shrink-0 font-mono text-[12px] text-muted">
              {view.id}
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

const IssueListEmptyState = ({
  activeViewLabel,
  rawSearchQuery,
  reason,
}: {
  activeViewLabel: string;
  rawSearchQuery: string;
  reason: IssueListEmptyReason;
}) => (
  <div
    className="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-muted"
    data-empty-reason={reason}
  >
    <Inbox className="mb-3 size-6 text-muted" />
    <h2 className="font-medium text-text-main">
      {getIssueListEmptyTitle({ activeViewLabel, reason })}
    </h2>
    <p className="mt-1 text-xs">
      {getIssueListEmptySupportingCopy({
        activeViewLabel,
        rawSearchQuery,
        reason,
      })}
    </p>
  </div>
);

const IssueListContent = ({
  activeViewLabel,
  emptyReason,
  onSelect,
  rawSearchQuery,
  selectedIssueId,
  state,
  visibleIssues,
}: {
  activeViewLabel: string;
  emptyReason: IssueListEmptyReason | null;
  onSelect: (issueId: string) => void;
  rawSearchQuery: string;
  selectedIssueId: string | null;
  state: IssueExplorerLoadState;
  visibleIssues: Issue[];
}) => {
  if (state.status === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-muted">
        <LoaderCircle className="mb-3 size-5 animate-spin text-accent" />
        <p className="font-medium text-text-main">Loading issue views</p>
        <p className="mt-1 text-xs">
          Reading All, Ready, and Blocked views from Beadwork…
        </p>
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

  if (visibleIssues.length === 0 && emptyReason !== null) {
    return (
      <IssueListEmptyState
        activeViewLabel={activeViewLabel}
        rawSearchQuery={rawSearchQuery}
        reason={emptyReason}
      />
    );
  }

  return (
    <ul aria-label="Issues">
      {visibleIssues.map((issue) => (
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

const IssueDetailDescriptionEmpty = () => (
  <div
    aria-label="No description"
    className="mt-2 flex items-center gap-3 rounded-lg border border-border-main bg-surface p-4"
    role="note"
  >
    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border-main bg-background shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <FileText className="size-5 text-muted" strokeWidth={1.5} />
    </div>
    <div>
      <p className="text-sm font-medium text-text-main">No description</p>
      <p className="text-xs text-muted">
        This issue doesn&apos;t have a description yet.
      </p>
    </div>
  </div>
);

const IssueCommentCard = ({
  comment,
  markdownFontSizePx,
  openExternalLink,
}: {
  comment: IssueComment;
  markdownFontSizePx?: number;
  openExternalLink: ExternalLinkOpener;
}) => {
  const hasAuthor = comment.author.trim().length > 0;

  return (
    <li className="rounded-lg border border-border-main bg-surface p-4">
      <article className="flex flex-col gap-3">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <time className="font-mono text-xs text-muted">
            {comment.timestamp}
          </time>
          {hasAuthor ? (
            <span className="font-mono text-xs text-text-main">
              {comment.author}
            </span>
          ) : null}
        </header>
        <MarkdownContent
          ariaLabel="Comment"
          fontSizePx={markdownFontSizePx}
          markdown={comment.text}
          openExternalLink={openExternalLink}
        />
      </article>
    </li>
  );
};

const DependencyChip = ({ id }: { id: string }) => (
  <span className="rounded border border-border-main px-2 py-0.5 font-mono text-xs text-text-main">
    {id}
  </span>
);

const DependencyRow = ({
  emptyText,
  ids,
  label,
}: {
  emptyText: string;
  ids: string[];
  label: string;
}) => (
  <div className="flex flex-col gap-1">
    <dt className="font-mono text-[10px] tracking-wider text-muted uppercase">
      {label}
    </dt>
    <dd className="flex flex-wrap gap-1">
      {ids.length > 0 ? (
        ids.map((id) => <DependencyChip id={id} key={id} />)
      ) : (
        <span className="font-mono text-xs text-muted">{emptyText}</span>
      )}
    </dd>
  </div>
);

const MetadataRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1">
    <dt className="font-mono text-[10px] tracking-wider text-muted uppercase">
      {label}
    </dt>
    <dd className="rounded border border-border-main px-2 py-0.5 font-mono text-xs text-text-main">
      {value}
    </dd>
  </div>
);

const ChildIssueRow = ({ issue }: { issue: Issue }) => {
  const view = toIssueViewModel(issue);

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-border-main bg-surface px-2 py-1.5">
      <span className="font-mono text-xs text-text-main">{view.id}</span>
      <span
        className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10px] ${TONE_BADGE_CLASSES[view.badgeTone]}`}
      >
        {view.statusLabel}
      </span>
      <span className="text-sm text-text-main">{view.title}</span>
    </li>
  );
};

const ChildIssuesSection = ({ childIssues }: { childIssues: Issue[] }) => (
  <section>
    <h3 className="font-mono text-[10px] tracking-wider text-muted uppercase">
      Child Issues
    </h3>
    <ul aria-label="Child Issues" className="mt-2 flex flex-col gap-1">
      {childIssues.map((childIssue) => (
        <ChildIssueRow issue={childIssue} key={childIssue.id} />
      ))}
    </ul>
  </section>
);

const IssueDetailContent = ({
  childIssues,
  issue,
  markdownFontSizePx,
  openExternalLink,
}: {
  childIssues: Issue[];
  issue: Issue;
  markdownFontSizePx?: number;
  openExternalLink: ExternalLinkOpener;
}) => {
  const view = toIssueViewModel(issue);
  const hasDescription = issue.description.trim().length > 0;
  const hasComments = issue.comments.length > 0;
  const hasParent = issue.parent.trim().length > 0;

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
        {hasParent ? (
          <dl className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3">
            <MetadataRow label="Parent" value={issue.parent} />
          </dl>
        ) : null}
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
      <section>
        <h3 className="font-mono text-[10px] tracking-wider text-muted uppercase">
          Description
        </h3>
        {hasDescription ? (
          <div className="mt-2">
            <MarkdownContent
              ariaLabel="Issue description"
              fontSizePx={markdownFontSizePx}
              markdown={issue.description}
              openExternalLink={openExternalLink}
            />
          </div>
        ) : (
          <IssueDetailDescriptionEmpty />
        )}
      </section>
      <section>
        <h3 className="font-mono text-[10px] tracking-wider text-muted uppercase">
          Dependencies
        </h3>
        <div className="mt-2 rounded-lg border border-border-main bg-surface p-4">
          <dl className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <DependencyRow
              emptyText="No blockers"
              ids={issue.blockedBy}
              label="Blocked by"
            />
            <DependencyRow
              emptyText="Not blocking anything"
              ids={issue.blocks}
              label="Blocking"
            />
          </dl>
        </div>
      </section>
      {childIssues.length > 0 ? (
        <ChildIssuesSection childIssues={childIssues} />
      ) : null}
      <section>
        <h3 className="font-mono text-[10px] tracking-wider text-muted uppercase">
          Other metadata
        </h3>
        <dl className="mt-2 flex flex-wrap items-start gap-x-6 gap-y-3">
          {issue.assignee.trim().length > 0 ? (
            <MetadataRow label="Assignee" value={issue.assignee} />
          ) : null}
          <MetadataRow label="Created" value={issue.created} />
          <MetadataRow label="Updated" value={issue.updatedAt} />
          {issue.due.trim().length > 0 ? (
            <MetadataRow label="Due" value={issue.due} />
          ) : null}
          {issue.deferUntil.trim().length > 0 ? (
            <MetadataRow label="Deferred until" value={issue.deferUntil} />
          ) : null}
          {issue.closedAt.trim().length > 0 ? (
            <MetadataRow label="Closed at" value={issue.closedAt} />
          ) : null}
          {issue.closeReason.trim().length > 0 ? (
            <MetadataRow label="Close reason" value={issue.closeReason} />
          ) : null}
        </dl>
      </section>
      {hasComments ? (
        <section>
          <h3 className="font-mono text-[10px] tracking-wider text-muted uppercase">
            Comments
          </h3>
          <ul className="mt-2 flex flex-col gap-3">
            {issue.comments.map((comment) => (
              <IssueCommentCard
                comment={comment}
                key={`${comment.timestamp}-${comment.author}-${comment.text}`}
                markdownFontSizePx={markdownFontSizePx}
                openExternalLink={openExternalLink}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
};

const IssueDetailPane = ({
  childIssues,
  selectedIssue,
  markdownFontSizePx,
  openExternalLink,
}: {
  childIssues: Issue[];
  selectedIssue: Issue | null;
  markdownFontSizePx?: number;
  openExternalLink: ExternalLinkOpener;
}) =>
  selectedIssue === null ? (
    <IssueDetailEmpty />
  ) : (
    <IssueDetailContent
      childIssues={childIssues}
      issue={selectedIssue}
      markdownFontSizePx={markdownFontSizePx}
      openExternalLink={openExternalLink}
    />
  );

export const IssueExplorer = ({
  activeIssueListViewId,
  issueState,
  markdownFontSizePx,
  onIssueListViewChange,
  openExternalLink = defaultOpenExternalLink,
}: {
  activeIssueListViewId?: IssueListViewId;
  issueState: IssueExplorerLoadState;
  markdownFontSizePx?: number;
  onIssueListViewChange?: (viewId: IssueListViewId) => void;
  openExternalLink?: ExternalLinkOpener;
}) => {
  void onIssueListViewChange;
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  const derivedState = useMemo(
    () =>
      deriveIssueExplorerState({
        activeIssueListViewId,
        issueState,
        searchQuery,
        selectedIssueId,
      }),
    [activeIssueListViewId, issueState, searchQuery, selectedIssueId]
  );

  const {
    activeViewId,
    activeViewLabel,
    emptyReason,
    isSearchDisabled,
    selectedIssue,
    visibleIssues,
  } = derivedState;

  // Derive Child Issues from the successful explorer's complete `allIssues`
  // collection by matching the Beadwork `parent` field. This deliberately
  // does not change list selection, the active Issue List View, or
  // selection-clearing semantics. The selected Issue's ID is the lookup
  // key only; candidates come exclusively from `allIssues` regardless of
  // which view or search is active.
  const childIssues = useMemo<Issue[]>(() => {
    if (issueState.status !== "success" || selectedIssue === null) {
      return EMPTY_CHILD_ISSUES;
    }

    return getChildIssues(issueState.allIssues, selectedIssue.id);
  }, [issueState, selectedIssue]);

  // Reset the Issue List scroll position to the top when the active
  // Issue List View changes. Search changes intentionally do not reset
  // scroll; only view changes do. We accomplish this by remounting the
  // scroll container per active view (keyed by `activeViewId`), which
  // avoids any post-render imperative synchronization.
  const issueListScrollContainerKey = activeViewId;

  // Clear the selected Issue ID when it is no longer visible after a
  // view or search change. The cleared state is not auto-restored if a
  // later view/search change makes the Issue visible again.
  if (
    selectedIssueId !== null &&
    !visibleIssues.some((issue) => issue.id === selectedIssueId)
  ) {
    setSelectedIssueId(null);
  }

  const handleSelect = (issueId: string) => {
    setSelectedIssueId(issueId);
  };

  return (
    <>
      <section
        className="flex w-[320px] shrink-0 flex-col border-r border-border-main bg-background"
        data-active-issue-list-view-id={activeViewId}
      >
        <div className="flex h-14 items-center border-b border-border-main p-2">
          <div className="relative w-full">
            <label className="sr-only" htmlFor="issue-search">
              Search issues
            </label>
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              className="w-full rounded-md border border-border-main bg-surface py-1.5 pr-12 pl-9 text-sm text-text-main placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-50"
              disabled={isSearchDisabled}
              id="issue-search"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search issues..."
              type="text"
              value={searchQuery}
            />
            <div className="absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border-main px-1.5 py-0.5 font-mono text-[10px] text-muted">
              Cmd+F
            </div>
          </div>
        </div>
        <div
          className="flex-1 overflow-y-auto"
          data-issue-list-scroll-container
          key={issueListScrollContainerKey}
        >
          <IssueListContent
            activeViewLabel={activeViewLabel}
            emptyReason={emptyReason}
            onSelect={handleSelect}
            rawSearchQuery={searchQuery}
            selectedIssueId={selectedIssueId}
            state={issueState}
            visibleIssues={visibleIssues}
          />
        </div>
      </section>
      <IssueDetailPane
        childIssues={childIssues}
        markdownFontSizePx={markdownFontSizePx}
        openExternalLink={openExternalLink}
        selectedIssue={selectedIssue}
      />
    </>
  );
};

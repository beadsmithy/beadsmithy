import {
  AlertTriangle,
  Circle,
  CircleCheck,
  CircleSlash,
  Check,
  Clock,
  Copy,
  FileText,
  Inbox,
  LoaderCircle,
  PlayCircle,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MouseEvent, RefObject } from "react";
import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";

import type { ExternalLinkOpener } from "../components/external-link-opener";
import { openExternalLink as defaultOpenExternalLink } from "../components/external-link-opener";
import { MarkdownContent } from "../components/MarkdownContent";
import { useExternalLifecycle } from "../lib/use-external-lifecycle";
import type { RefreshFailure, RefreshHealth } from "../refresh-health";
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
import { generateIssueLocationUri } from "./issue-location-uri";
import { serializeIssueExplorerRoute } from "./issue-navigation";
import type { IssueExplorerRouteState } from "./issue-navigation";
import { toIssueViewModel } from "./issue-view";
import type { IssueTone } from "./issue-view";
import {
  RefreshFailureBanner,
  selectBannerFailure,
} from "./RefreshFailureBanner";

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

const isUnmodifiedPrimaryClick = (
  event: MouseEvent<HTMLAnchorElement>
): boolean =>
  event.button === 0 &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.shiftKey;

const IssueRow = ({
  issue,
  isSelected,
  issueMap,
  onSelect,
  route,
}: {
  issue: Issue;
  isSelected: boolean;
  issueMap: Record<string, Issue>;
  onSelect?: (issueId: string) => void;
  route: IssueExplorerRouteState;
}) => {
  const view = toIssueViewModel(issue, issueMap);
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
        <Link
          aria-current={isSelected ? "true" : undefined}
          aria-label={`${view.id}: ${view.title}. ${view.metadataLabel}`}
          className="block w-full cursor-pointer p-3 text-left transition-colors hover:bg-white/5 focus:bg-white/5 focus:outline-none"
          data-issue-id={issue.id}
          data-selected={isSelected ? "true" : "false"}
          href={serializeIssueExplorerRoute({ ...route, issueId: issue.id })}
          onClick={(event) => {
            if (onSelect !== undefined && isUnmodifiedPrimaryClick(event)) {
              event.preventDefault();
              onSelect(issue.id);
            }
          }}
        >
          <div className="mb-1.5 flex min-w-0 items-center gap-2">
            <ToneIcon
              aria-hidden="true"
              className={`size-4 shrink-0 ${ISSUE_TONE_ICON_CLASSES[view.tone]}`}
            />
            <span className="text-muted shrink-0 font-mono text-[12px]">
              {view.id}
            </span>
          </div>
          <h3 className="text-text-main truncate text-[13px] font-medium">
            {view.title}
          </h3>
          <div className="text-muted mt-2 flex min-w-0 items-center gap-1.5 overflow-hidden font-mono text-[10px]">
            <span className="border-border-main shrink-0 rounded border px-1 py-0.5">
              {view.priorityLabel}
            </span>
            <span className="border-border-main shrink-0 rounded border px-1 py-0.5">
              {view.typeLabel}
            </span>
            {view.dependencyLabel.length > 0 ? (
              <span className="border-border-main truncate rounded border px-1 py-0.5">
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
                  className="text-muted truncate rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px]"
                  key={label}
                >
                  {label}
                </span>
              ))}
              {view.labels.length > MAX_VISIBLE_LABELS ? (
                <span className="text-muted shrink-0 font-mono text-[10px]">
                  +{view.labels.length - MAX_VISIBLE_LABELS}
                </span>
              ) : null}
            </div>
          ) : null}
        </Link>
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
    className="text-muted flex h-full flex-col items-center justify-center p-6 text-center text-sm"
    data-empty-reason={reason}
  >
    <Inbox className="text-muted mb-3 size-6" />
    <h2 className="text-text-main font-medium">
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
  issueMap,
  onSelect,
  rawSearchQuery,
  route,
  selectedIssueId,
  state,
  visibleIssues,
}: {
  activeViewLabel: string;
  emptyReason: IssueListEmptyReason | null;
  issueMap: Record<string, Issue>;
  onSelect?: (issueId: string) => void;
  rawSearchQuery: string;
  route: IssueExplorerRouteState;
  selectedIssueId: string | null;
  state: IssueExplorerLoadState;
  visibleIssues: Issue[];
}) => {
  if (state.status === "loading") {
    return (
      <div className="text-muted flex h-full flex-col items-center justify-center p-6 text-center text-sm">
        <LoaderCircle className="text-accent mb-3 size-5 animate-spin" />
        <p className="text-text-main font-medium">Loading issue views</p>
        <p className="mt-1 text-xs">
          Reading All, Ready, and Blocked views from Beadwork…
        </p>
      </div>
    );
  }

  if (state.status === "failure") {
    return (
      <div className="p-4" role="alert">
        <div className="border-danger/40 bg-danger/10 rounded-lg border p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-red-200">
            <AlertTriangle className="size-4" />
            Could not load issues
          </div>
          <p className="text-text-main text-xs leading-5">
            {state.error.message}
          </p>
          <p className="text-muted mt-2 font-mono text-[10px]">
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
          issueMap={issueMap}
          key={issue.id}
          onSelect={onSelect}
          route={route}
        />
      ))}
    </ul>
  );
};

const IssueDetailNotFound = ({
  issueId,
  titleRef,
}: {
  issueId: string;
  titleRef: RefObject<HTMLHeadingElement | null>;
}) => (
  <main
    aria-label="Issue detail"
    className="bg-background flex flex-1 flex-col items-center justify-center p-8"
  >
    <div className="border-danger/40 bg-danger/10 mb-6 flex size-16 items-center justify-center rounded-2xl border shadow-[inset_0_1px_0_var(--color-surface-highlight)]">
      <AlertTriangle className="text-danger size-8" strokeWidth={1.5} />
    </div>
    <h2
      className="text-primary mb-2 text-xl font-semibold"
      ref={titleRef}
      tabIndex={-1}
    >
      Issue not found
    </h2>
    <p className="text-muted max-w-sm text-center text-sm">
      Beadwork does not contain Issue{" "}
      <span className="font-mono">{issueId}</span> in this Workspace.
    </p>
  </main>
);

const IssueDetailEmpty = ({
  titleRef,
}: {
  titleRef: RefObject<HTMLHeadingElement | null>;
}) => (
  <main
    aria-label="Issue detail"
    className="bg-background flex flex-1 flex-col items-center justify-center p-8"
  >
    <div className="border-border-main bg-surface mb-6 flex size-16 items-center justify-center rounded-2xl border shadow-[inset_0_1px_0_var(--color-surface-highlight)]">
      <FileText className="text-muted size-8" strokeWidth={1.5} />
    </div>
    <h2
      className="text-primary mb-2 text-xl font-semibold"
      ref={titleRef}
      tabIndex={-1}
    >
      No issue selected
    </h2>
    <p className="text-muted max-w-sm text-center text-sm">
      Select an issue from the list to see its details.
    </p>
  </main>
);

const IssueDetailDescriptionEmpty = () => (
  <div
    aria-label="No description"
    className="border-border-main bg-surface mt-2 flex items-center gap-3 rounded-lg border p-4"
    role="note"
  >
    <div className="border-border-main bg-background flex size-10 shrink-0 items-center justify-center rounded-xl border shadow-[inset_0_1px_0_var(--color-surface-highlight)]">
      <FileText className="text-muted size-5" strokeWidth={1.5} />
    </div>
    <div>
      <p className="text-text-main text-sm font-medium">No description</p>
      <p className="text-muted text-xs">
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
    <li className="border-border-main bg-surface rounded-lg border p-4">
      <article className="flex flex-col gap-3">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <time className="text-muted font-mono text-xs">
            {comment.timestamp}
          </time>
          {hasAuthor ? (
            <span className="text-text-main font-mono text-xs">
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

const IssueReferenceLink = ({
  id,
  onSelect,
  route,
}: {
  id: string;
  onSelect?: (issueId: string) => void;
  route: IssueExplorerRouteState;
}) => (
  <Link
    aria-label={`Open Issue ${id}`}
    className="text-text-main decoration-border-main hover:text-primary font-mono text-xs underline underline-offset-2"
    data-reference-issue-id={id}
    href={serializeIssueExplorerRoute({ ...route, issueId: id })}
    onClick={(event) => {
      if (onSelect !== undefined && isUnmodifiedPrimaryClick(event)) {
        event.preventDefault();
        onSelect(id);
      }
    }}
  >
    {id}
  </Link>
);

const DependencyChip = ({
  id,
  onSelect,
  route,
}: {
  id: string;
  onSelect?: (issueId: string) => void;
  route: IssueExplorerRouteState;
}) => (
  <span className="border-border-main text-text-main rounded border px-2 py-0.5 font-mono text-xs">
    <IssueReferenceLink id={id} onSelect={onSelect} route={route} />
  </span>
);

const DependencyRow = ({
  emptyText,
  ids,
  label,
  onSelect,
  route,
}: {
  emptyText: string;
  ids: string[];
  label: string;
  onSelect?: (issueId: string) => void;
  route: IssueExplorerRouteState;
}) => (
  <div className="flex flex-col gap-1">
    <dt className="text-muted font-mono text-[10px] tracking-wider uppercase">
      {label}
    </dt>
    <dd className="flex flex-wrap gap-1">
      {ids.length > 0 ? (
        ids.map((id) => (
          <DependencyChip id={id} key={id} onSelect={onSelect} route={route} />
        ))
      ) : (
        <span className="text-muted font-mono text-xs">{emptyText}</span>
      )}
    </dd>
  </div>
);

const MetadataRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1">
    <dt className="text-muted font-mono text-[10px] tracking-wider uppercase">
      {label}
    </dt>
    <dd className="border-border-main text-text-main rounded border px-2 py-0.5 font-mono text-xs">
      {value}
    </dd>
  </div>
);

const ChildIssueRow = ({
  issue,
  issueMap,
  onSelect,
  onUserDrivenSelect,
  route,
}: {
  issue: Issue;
  issueMap: Record<string, Issue>;
  onSelect: (issueId: string) => void;
  onUserDrivenSelect: () => void;
  route: IssueExplorerRouteState;
}) => {
  const view = toIssueViewModel(issue, issueMap);

  return (
    <li>
      <Link
        aria-label={`${view.id}: ${view.title}. ${view.statusLabel}`}
        className="border-border-main bg-surface flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded border px-2 py-1.5 text-left transition-colors hover:bg-white/5 focus:bg-white/5 focus:outline-none"
        data-child-issue-id={issue.id}
        href={serializeIssueExplorerRoute({ ...route, issueId: issue.id })}
        onClick={(event) => {
          if (!isUnmodifiedPrimaryClick(event)) {
            return;
          }
          event.preventDefault();
          onUserDrivenSelect();
          onSelect(issue.id);
        }}
      >
        <span className="text-text-main font-mono text-xs">{view.id}</span>
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10px] ${TONE_BADGE_CLASSES[view.badgeTone]}`}
        >
          {view.statusLabel}
        </span>
        <span className="text-text-main text-sm">{view.title}</span>
      </Link>
    </li>
  );
};

const ChildIssuesSection = ({
  childIssues,
  issueMap,
  onSelect,
  onUserDrivenSelect,
  route,
}: {
  childIssues: Issue[];
  issueMap: Record<string, Issue>;
  onSelect: (issueId: string) => void;
  onUserDrivenSelect: () => void;
  route: IssueExplorerRouteState;
}) => (
  <section>
    <h3 className="text-muted font-mono text-[10px] tracking-wider uppercase">
      Child Issues
    </h3>
    <ul aria-label="Child Issues" className="mt-2 flex flex-col gap-1">
      {childIssues.map((childIssue) => (
        <ChildIssueRow
          issue={childIssue}
          issueMap={issueMap}
          key={childIssue.id}
          onSelect={onSelect}
          onUserDrivenSelect={onUserDrivenSelect}
          route={route}
        />
      ))}
    </ul>
  </section>
);

const IssueDetailContent = ({
  childIssues,
  issue,
  issueMap,
  markdownFontSizePx,
  onSelect,
  route,
  onUserDrivenSelect,
  openExternalLink,
  titleRef,
  onCopyDeepLink,
  copySucceeded,
}: {
  childIssues: Issue[];
  issue: Issue;
  issueMap: Record<string, Issue>;
  route: IssueExplorerRouteState;
  markdownFontSizePx?: number;
  onSelect: (issueId: string) => void;
  onUserDrivenSelect: () => void;
  openExternalLink: ExternalLinkOpener;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onCopyDeepLink?: () => void;
  copySucceeded: boolean;
}) => {
  const view = toIssueViewModel(issue, issueMap);
  const hasDescription = issue.description.trim().length > 0;
  const hasComments = issue.comments.length > 0;
  const hasParent = issue.parent.trim().length > 0;

  return (
    <main
      aria-label="Issue detail"
      aria-live="polite"
      className="bg-background flex flex-1 flex-col gap-6 overflow-y-auto p-8"
    >
      <header className="relative">
        {onCopyDeepLink === undefined ? null : (
          <button
            aria-label={copySucceeded ? "Copied deep link" : "Copy deep link"}
            className="border-border-main text-muted hover:text-text-main absolute top-0 right-0 flex size-8 items-center justify-center rounded border transition-colors hover:bg-white/5"
            onClick={onCopyDeepLink}
            title={copySucceeded ? "Copied!" : "Copy deep link"}
            type="button"
          >
            {copySucceeded ? (
              <Check aria-hidden="true" className="text-accent size-4" />
            ) : (
              <Copy aria-hidden="true" className="size-4" />
            )}
          </button>
        )}
        <span
          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-xs ${TONE_BADGE_CLASSES[view.badgeTone]}`}
        >
          {view.statusLabel}
        </span>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2
            className="text-primary text-2xl leading-tight font-semibold"
            ref={titleRef}
            tabIndex={-1}
          >
            {view.title}
          </h2>
          <span className="text-muted font-mono text-xs">{view.id}</span>
        </div>
        {hasParent ? (
          <dl className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3">
            <div className="flex flex-col gap-1">
              <dt className="text-muted font-mono text-[10px] tracking-wider uppercase">
                Parent
              </dt>
              <dd className="border-border-main rounded border px-2 py-0.5">
                <IssueReferenceLink
                  id={issue.parent}
                  onSelect={onSelect}
                  route={route}
                />
              </dd>
            </div>
          </dl>
        ) : null}
      </header>
      <dl className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <dt className="text-muted font-mono text-[10px] tracking-wider uppercase">
            Priority
          </dt>
          <dd className="border-border-main text-text-main rounded border px-2 py-0.5 font-mono text-xs">
            {view.priorityLabel}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted font-mono text-[10px] tracking-wider uppercase">
            Type
          </dt>
          <dd className="border-border-main text-text-main rounded border px-2 py-0.5 font-mono text-xs">
            {view.typeLabel}
          </dd>
        </div>
      </dl>
      {view.labels.length > 0 ? (
        <section>
          <h3 className="text-muted font-mono text-[10px] tracking-wider uppercase">
            Labels
          </h3>
          <ul className="mt-2 flex flex-wrap gap-1">
            {view.labels.map((label) => (
              <li
                className="text-muted rounded bg-white/5 px-2 py-0.5 font-mono text-[11px]"
                key={label}
              >
                {label}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h3 className="text-muted font-mono text-[10px] tracking-wider uppercase">
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
        <h3 className="text-muted font-mono text-[10px] tracking-wider uppercase">
          Dependencies
        </h3>
        <div className="border-border-main bg-surface mt-2 rounded-lg border p-4">
          <dl className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <DependencyRow
              emptyText="No blockers"
              ids={issue.blockedBy}
              label="Blocked by"
              onSelect={onSelect}
              route={route}
            />
            <DependencyRow
              emptyText="Not blocking anything"
              ids={issue.blocks}
              label="Blocking"
              onSelect={onSelect}
              route={route}
            />
          </dl>
        </div>
      </section>
      {childIssues.length > 0 ? (
        <ChildIssuesSection
          childIssues={childIssues}
          issueMap={issueMap}
          onSelect={onSelect}
          route={route}
          onUserDrivenSelect={onUserDrivenSelect}
        />
      ) : null}
      <section>
        <h3 className="text-muted font-mono text-[10px] tracking-wider uppercase">
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
          <h3 className="text-muted font-mono text-[10px] tracking-wider uppercase">
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
  issueMap,
  selectedIssue,
  missingIssueId,
  route,
  markdownFontSizePx,
  onSelect,
  onUserDrivenSelect,
  openExternalLink,
  titleRef,
  onCopyDeepLink,
  copySucceeded,
}: {
  childIssues: Issue[];
  issueMap: Record<string, Issue>;
  selectedIssue: Issue | null;
  missingIssueId: string | null;
  route: IssueExplorerRouteState;
  markdownFontSizePx?: number;
  onSelect: (issueId: string) => void;
  onUserDrivenSelect: () => void;
  openExternalLink: ExternalLinkOpener;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onCopyDeepLink?: () => void;
  copySucceeded: boolean;
}) => {
  if (selectedIssue === null && missingIssueId !== null) {
    return <IssueDetailNotFound issueId={missingIssueId} titleRef={titleRef} />;
  }

  if (selectedIssue === null) {
    return <IssueDetailEmpty titleRef={titleRef} />;
  }

  return (
    <IssueDetailContent
      childIssues={childIssues}
      issue={selectedIssue}
      issueMap={issueMap}
      route={route}
      markdownFontSizePx={markdownFontSizePx}
      onSelect={onSelect}
      onUserDrivenSelect={onUserDrivenSelect}
      openExternalLink={openExternalLink}
      titleRef={titleRef}
      onCopyDeepLink={onCopyDeepLink}
      copySucceeded={copySucceeded}
    />
  );
};

export const IssueExplorer = ({
  activeIssueListViewId,
  issueState,
  route,
  titleOverride,
  focusRouteChanges,
  markdownFontSizePx,
  onIssueSearchChange,
  onIssueSelect,
  onIssueReferenceSelect,
  openExternalLink = defaultOpenExternalLink,
  refreshHealth,
}: {
  activeIssueListViewId?: IssueListViewId;
  issueState: IssueExplorerLoadState;
  route?: IssueExplorerRouteState;
  titleOverride?: string | null;
  focusRouteChanges?: boolean;
  markdownFontSizePx?: number;
  onIssueListViewChange?: (viewId: IssueListViewId) => void;
  onIssueSearchChange?: (search: string) => void;
  onIssueSelect?: (issueId: string) => void;
  onIssueReferenceSelect?: (issueId: string) => void;
  openExternalLink?: ExternalLinkOpener;
  refreshHealth?: RefreshHealth | null;
}) => {
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const [localSelectedIssueId, setLocalSelectedIssueId] = useState<
    string | null
  >(null);
  const isRouteControlled = route !== undefined;
  const activeRoute: IssueExplorerRouteState = route ?? {
    issueId: localSelectedIssueId,
    search: localSearchQuery,
    viewId: activeIssueListViewId ?? "all",
  };
  const searchQuery = isRouteControlled ? activeRoute.search : localSearchQuery;
  const selectedIssueId = isRouteControlled
    ? activeRoute.issueId
    : localSelectedIssueId;
  const childIssueSelectionRef = useRef(false);
  const [copySucceeded, setCopySucceeded] = useState(false);
  const routeFocusInitializedRef = useRef(false);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const workspaceIdentity =
    issueState.status === "success" ? issueState.workspacePath : null;

  useExternalLifecycle(() => {
    if (!childIssueSelectionRef.current) {
      return;
    }

    detailHeadingRef.current?.focus({ preventScroll: true });
    childIssueSelectionRef.current = false;
  }, [selectedIssueId]);

  useExternalLifecycle(() => {
    if (focusRouteChanges && !routeFocusInitializedRef.current) {
      routeFocusInitializedRef.current = true;
      return;
    }
    if (focusRouteChanges) {
      detailHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [
    activeRoute.issueId,
    activeRoute.viewId,
    focusRouteChanges,
    workspaceIdentity,
  ]);

  useExternalLifecycle(() => {
    if (titleOverride !== undefined && titleOverride !== null) {
      document.title = titleOverride;
      return;
    }

    const selectedIssue =
      issueState.status === "success" && selectedIssueId !== null
        ? issueState.allIssues.find((issue) => issue.id === selectedIssueId)
        : undefined;
    let title = "Beadsmithy";
    if (activeRoute.issueId !== null && selectedIssue === undefined) {
      title = "Issue not found · Beadsmithy";
    } else if (selectedIssue !== undefined) {
      title = `${selectedIssue.id} — ${selectedIssue.title} · Beadsmithy`;
    }
    document.title = title;
  }, [activeRoute.issueId, issueState, selectedIssueId, titleOverride]);

  const derivedState = useMemo(
    () =>
      deriveIssueExplorerState({
        activeIssueListViewId: activeRoute.viewId,
        issueState,
        searchQuery,
        selectedIssueId,
      }),
    [activeRoute.viewId, issueState, searchQuery, selectedIssueId]
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
  // collection by matching the Beadwork `parent` field. The selected Issue
  // is resolved from `allIssues` (see `issue-explorer-state`), so the
  // children shown here are consistent with whichever Issue is currently
  // in Issue Detail — including Issues that the active view or search
  // query is hiding. The `childIssues` derivation itself is unchanged.
  const childIssues = useMemo<Issue[]>(() => {
    if (issueState.status !== "success" || selectedIssue === null) {
      return EMPTY_CHILD_ISSUES;
    }

    return getChildIssues(issueState.allIssues, selectedIssue.id);
  }, [issueState, selectedIssue]);

  const issueMap = useMemo<Record<string, Issue>>(() => {
    if (issueState.status !== "success") {
      return {};
    }

    return Object.fromEntries(
      issueState.allIssues.map((issue) => [issue.id, issue])
    );
  }, [issueState]);

  // Reset the Issue List scroll position to the top when the active
  // Issue List View changes. Search changes intentionally do not reset
  // scroll; only view changes do. We accomplish this by remounting the
  // scroll container per active view (keyed by `activeViewId`), which
  // avoids any post-render imperative synchronization.
  const issueListScrollContainerKey = activeViewId;

  const handleSelect = (issueId: string) => {
    if (onIssueSelect !== undefined) {
      onIssueSelect(issueId);
      return;
    }
    setLocalSelectedIssueId(issueId);
  };

  const handleSearchChange = (search: string) => {
    if (onIssueSearchChange !== undefined) {
      onIssueSearchChange(search);
      return;
    }
    setLocalSearchQuery(search);
  };

  const handleCopyDeepLink = async (): Promise<void> => {
    if (issueState.status !== "success" || activeRoute.issueId === null) {
      return;
    }
    const result = generateIssueLocationUri({
      issueId: activeRoute.issueId,
      workspacePath: issueState.workspacePath,
    });
    if (!result.ok || navigator.clipboard === undefined) {
      return;
    }
    try {
      await navigator.clipboard.writeText(result.value);
      setCopySucceeded(true);
      window.setTimeout(() => setCopySucceeded(false), 1500);
    } catch {
      setCopySucceeded(false);
    }
  };

  const handleUserDrivenChildIssueSelect = () => {
    childIssueSelectionRef.current = true;
  };

  const handleIssueReferenceSelect = (issueId: string) => {
    if (onIssueReferenceSelect !== undefined) {
      onIssueReferenceSelect(issueId);
      return;
    }
    handleSelect(issueId);
  };

  // Select the highest-priority failure slot for the banner copy.
  // The banner is rendered above the search header and list scroll
  // container as a non-scrolling sibling.
  const bannerFailure: RefreshFailure | null = refreshHealth
    ? selectBannerFailure(refreshHealth)
    : null;

  return (
    <>
      <section
        className="border-border-main bg-background flex w-[320px] shrink-0 flex-col border-r"
        data-active-issue-list-view-id={activeViewId}
      >
        <RefreshFailureBanner failure={bannerFailure} />
        <div className="border-border-main flex h-14 items-center border-b p-2">
          <div className="relative w-full">
            <label className="sr-only" htmlFor="issue-search">
              Search issues
            </label>
            <Search className="text-muted absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              className="border-border-main bg-surface text-text-main placeholder:text-muted focus:border-accent w-full rounded-md border py-1.5 pr-12 pl-9 text-sm focus:outline-none disabled:opacity-50"
              disabled={isSearchDisabled}
              id="issue-search"
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="Search issues..."
              type="text"
              value={searchQuery}
            />
            <div className="border-border-main text-muted absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1.5 py-0.5 font-mono text-[10px]">
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
            issueMap={issueMap}
            onSelect={handleSelect}
            rawSearchQuery={searchQuery}
            route={activeRoute}
            selectedIssueId={selectedIssueId}
            state={issueState}
            visibleIssues={visibleIssues}
          />
        </div>
      </section>
      <IssueDetailPane
        key={serializeIssueExplorerRoute(activeRoute)}
        childIssues={childIssues}
        issueMap={issueMap}
        route={activeRoute}
        markdownFontSizePx={markdownFontSizePx}
        onSelect={handleIssueReferenceSelect}
        onUserDrivenSelect={handleUserDrivenChildIssueSelect}
        openExternalLink={openExternalLink}
        selectedIssue={selectedIssue}
        onCopyDeepLink={
          selectedIssue === null
            ? undefined
            : () => {
                handleCopyDeepLink();
              }
        }
        copySucceeded={copySucceeded}
        missingIssueId={
          issueState.status === "success" &&
          activeRoute.issueId !== null &&
          selectedIssue === null
            ? activeRoute.issueId
            : null
        }
        titleRef={detailHeadingRef}
      />
    </>
  );
};

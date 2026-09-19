import { AlertTriangle, Check, Copy, FileText } from "lucide-react";
import type { MouseEvent, RefObject } from "react";
import { Link } from "wouter";

import type { ExternalLinkOpener } from "../components/external-link-opener";
import { MarkdownContent } from "../components/MarkdownContent";
import type { Issue, IssueComment } from "../rpc/bindings";
import { toIssueViewModel } from "./issue-view";
import type { IssueTone } from "./issue-view";

const TONE_BADGE_CLASSES: Record<IssueTone, string> = {
  blocked: "border-danger/30 bg-danger/10 text-red-200",
  closed: "border-border-main bg-surface text-muted",
  deferred: "border-border-main bg-surface text-muted",
  inProgress: "border-accent/40 bg-accent/10 text-indigo-200",
  open: "border-border-main bg-surface text-text-main",
};

const isUnmodifiedPrimaryClick = (
  event: MouseEvent<HTMLAnchorElement>
): boolean =>
  event.button === 0 &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.shiftKey;

export interface IssueDetailNavigation {
  hrefForIssue: (issueId: string) => string;
  onSelectIssue?: (issueId: string) => void;
}

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
  navigation,
}: {
  id: string;
  navigation: IssueDetailNavigation;
}) => (
  <Link
    aria-label={`Open Issue ${id}`}
    className="text-text-main decoration-border-main hover:text-primary font-mono text-xs underline underline-offset-2"
    data-reference-issue-id={id}
    href={navigation.hrefForIssue(id)}
    onClick={(event) => {
      if (
        navigation.onSelectIssue !== undefined &&
        isUnmodifiedPrimaryClick(event)
      ) {
        event.preventDefault();
        navigation.onSelectIssue(id);
      }
    }}
  >
    {id}
  </Link>
);

const DependencyChip = ({
  id,
  navigation,
}: {
  id: string;
  navigation: IssueDetailNavigation;
}) => (
  <span className="border-border-main text-text-main rounded border px-2 py-0.5 font-mono text-xs">
    <IssueReferenceLink id={id} navigation={navigation} />
  </span>
);

const DependencyRow = ({
  emptyText,
  ids,
  label,
  navigation,
}: {
  emptyText: string;
  ids: string[];
  label: string;
  navigation: IssueDetailNavigation;
}) => (
  <div className="flex flex-col gap-1">
    <dt className="text-muted font-mono text-[10px] tracking-wider uppercase">
      {label}
    </dt>
    <dd className="flex flex-wrap gap-1">
      {ids.length > 0 ? (
        ids.map((id) => (
          <DependencyChip id={id} key={id} navigation={navigation} />
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
  navigation,
  onUserDrivenSelect,
}: {
  issue: Issue;
  issueMap: Record<string, Issue>;
  navigation: IssueDetailNavigation;
  onUserDrivenSelect?: () => void;
}) => {
  const view = toIssueViewModel(issue, issueMap);

  return (
    <li>
      <Link
        aria-label={`${view.id}: ${view.title}. ${view.statusLabel}`}
        className="border-border-main bg-surface flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded border px-2 py-1.5 text-left transition-colors hover:bg-white/5 focus:bg-white/5 focus:outline-none"
        data-child-issue-id={issue.id}
        href={navigation.hrefForIssue(issue.id)}
        onClick={(event) => {
          if (
            navigation.onSelectIssue === undefined ||
            !isUnmodifiedPrimaryClick(event)
          ) {
            return;
          }
          event.preventDefault();
          onUserDrivenSelect?.();
          navigation.onSelectIssue(issue.id);
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
  navigation,
  onUserDrivenSelect,
}: {
  childIssues: Issue[];
  issueMap: Record<string, Issue>;
  navigation: IssueDetailNavigation;
  onUserDrivenSelect?: () => void;
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
          navigation={navigation}
          onUserDrivenSelect={onUserDrivenSelect}
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
  navigation,
  onUserDrivenSelect,
  openExternalLink,
  titleRef,
  onCopyDeepLink,
  copySucceeded,
}: {
  childIssues: Issue[];
  issue: Issue;
  issueMap: Record<string, Issue>;
  markdownFontSizePx?: number;
  navigation: IssueDetailNavigation;
  onUserDrivenSelect?: () => void;
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
                <IssueReferenceLink id={issue.parent} navigation={navigation} />
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
              navigation={navigation}
            />
            <DependencyRow
              emptyText="Not blocking anything"
              ids={issue.blocks}
              label="Blocking"
              navigation={navigation}
            />
          </dl>
        </div>
      </section>
      {childIssues.length > 0 ? (
        <ChildIssuesSection
          childIssues={childIssues}
          issueMap={issueMap}
          navigation={navigation}
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

export interface IssueDetailPaneProps {
  childIssues: Issue[];
  issueMap: Record<string, Issue>;
  selectedIssue: Issue | null;
  missingIssueId: string | null;
  navigation: IssueDetailNavigation;
  markdownFontSizePx?: number;
  onUserDrivenSelect?: () => void;
  openExternalLink: ExternalLinkOpener;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onCopyDeepLink?: () => void;
  copySucceeded?: boolean;
}

export const IssueDetailPane = ({
  childIssues,
  issueMap,
  selectedIssue,
  missingIssueId,
  navigation,
  markdownFontSizePx,
  onUserDrivenSelect,
  openExternalLink,
  titleRef,
  onCopyDeepLink,
  copySucceeded = false,
}: IssueDetailPaneProps) => {
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
      markdownFontSizePx={markdownFontSizePx}
      navigation={navigation}
      onUserDrivenSelect={onUserDrivenSelect}
      openExternalLink={openExternalLink}
      titleRef={titleRef}
      onCopyDeepLink={onCopyDeepLink}
      copySucceeded={copySucceeded}
    />
  );
};

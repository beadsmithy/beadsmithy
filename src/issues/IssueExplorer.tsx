import {
  AlertTriangle,
  Circle,
  CircleCheck,
  CircleSlash,
  Clock,
  Inbox,
  LoaderCircle,
  PlayCircle,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";

import type { ExternalLinkOpener } from "../components/external-link-opener";
import { openExternalLink as defaultOpenExternalLink } from "../components/external-link-opener";
import { useExternalLifecycle } from "../lib/use-external-lifecycle";
import type { RefreshFailure, RefreshHealth } from "../refresh-health";
import type { Issue } from "../rpc/bindings";
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
import type { IssueListRouteState } from "./issue-navigation";
import { toIssueViewModel } from "./issue-view";
import type { IssueTone } from "./issue-view";
import { IssueDetailPane as ReusableIssueDetailPane } from "./IssueDetail";
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
  route: IssueListRouteState;
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
  route: IssueListRouteState;
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
  route?: IssueListRouteState;
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
  const activeRoute: IssueListRouteState = route ?? {
    issueId: localSelectedIssueId,
    kind: "list",
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
      <ReusableIssueDetailPane
        key={serializeIssueExplorerRoute(activeRoute)}
        childIssues={childIssues}
        issueMap={issueMap}
        navigation={{
          hrefForIssue: (issueId) =>
            serializeIssueExplorerRoute({ ...activeRoute, issueId }),
          onSelectIssue: handleIssueReferenceSelect,
        }}
        markdownFontSizePx={markdownFontSizePx}
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

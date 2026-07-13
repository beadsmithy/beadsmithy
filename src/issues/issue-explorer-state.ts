import type { Issue } from "../rpc/bindings";
import {
  DEFAULT_ISSUE_LIST_VIEW_ID,
  getVisibleIssuesForListView,
  ISSUE_LIST_VIEW_DEFINITIONS,
} from "./issue-list-view";
import type { IssueListViewId } from "./issue-list-view";
import type { IssueExplorerLoadState } from "./issue-loader";
import { filterIssuesBySearchQuery } from "./issue-search";

export type IssueListEmptyReason =
  | "true-empty"
  | "base-empty"
  | "search-filtered-empty";

const ISSUE_LIST_VIEW_LABEL_BY_ID = new Map(
  ISSUE_LIST_VIEW_DEFINITIONS.map((definition) => [
    definition.id,
    definition.label,
  ])
);

export const getActiveIssueListViewId = (
  activeIssueListViewId?: IssueListViewId
): IssueListViewId => activeIssueListViewId ?? DEFAULT_ISSUE_LIST_VIEW_ID;

export const getActiveIssueListViewLabel = (viewId: IssueListViewId): string =>
  ISSUE_LIST_VIEW_LABEL_BY_ID.get(viewId) ?? "view";

interface GetIssueListEmptyReasonInput {
  allIssuesCount: number;
  baseIssueCount: number;
  hasSearchQuery: boolean;
  visibleIssueCount: number;
}

export const getIssueListEmptyReason = ({
  allIssuesCount,
  baseIssueCount,
  hasSearchQuery,
  visibleIssueCount,
}: GetIssueListEmptyReasonInput): IssueListEmptyReason | null => {
  if (visibleIssueCount > 0) {
    return null;
  }

  if (allIssuesCount === 0) {
    return "true-empty";
  }

  if (baseIssueCount === 0 || !hasSearchQuery) {
    return "base-empty";
  }

  return "search-filtered-empty";
};

interface GetIssueListEmptyTitleInput {
  activeViewLabel: string;
  reason: IssueListEmptyReason;
}

export const getIssueListEmptyTitle = ({
  activeViewLabel,
  reason,
}: GetIssueListEmptyTitleInput): string => {
  if (reason === "search-filtered-empty") {
    return "No matching issues";
  }

  if (reason === "base-empty") {
    return `No issues in ${activeViewLabel}.`;
  }

  return "No issues found";
};

interface GetIssueListEmptySupportingCopyInput {
  activeViewLabel: string;
  rawSearchQuery: string;
  reason: IssueListEmptyReason;
}

export const getIssueListEmptySupportingCopy = ({
  activeViewLabel,
  rawSearchQuery,
  reason,
}: GetIssueListEmptySupportingCopyInput): string => {
  if (reason === "true-empty") {
    return "Beadwork returned an empty issue list for this workspace.";
  }

  if (reason === "search-filtered-empty") {
    const trimmedQuery = rawSearchQuery.trim();
    return `No issues in ${activeViewLabel} match "${trimmedQuery}".`;
  }

  return `The ${activeViewLabel} Issue List View has no issues.`;
};

export interface IssueExplorerDerivedState {
  activeViewId: IssueListViewId;
  activeViewLabel: string;
  baseVisibleIssues: Issue[];
  emptyReason: IssueListEmptyReason | null;
  hasSearchQuery: boolean;
  isSearchDisabled: boolean;
  selectedIssue: Issue | null;
  visibleIssues: Issue[];
}

interface DeriveIssueExplorerStateInput {
  activeIssueListViewId?: IssueListViewId;
  issueState: IssueExplorerLoadState;
  searchQuery: string;
  selectedIssueId: string | null;
}

export const deriveIssueExplorerState = ({
  activeIssueListViewId,
  issueState,
  searchQuery,
  selectedIssueId,
}: DeriveIssueExplorerStateInput): IssueExplorerDerivedState => {
  const activeViewId = getActiveIssueListViewId(activeIssueListViewId);
  const activeViewLabel = getActiveIssueListViewLabel(activeViewId);
  const baseVisibleIssues = getVisibleIssuesForListView(
    issueState,
    activeViewId
  );
  const visibleIssues = filterIssuesBySearchQuery(
    baseVisibleIssues,
    searchQuery
  );
  const hasSearchQuery = searchQuery.trim().length > 0;
  const isSearchDisabled = issueState.status !== "success";

  const emptyReason: IssueListEmptyReason | null =
    issueState.status === "success"
      ? getIssueListEmptyReason({
          allIssuesCount: issueState.allIssues.length,
          baseIssueCount: baseVisibleIssues.length,
          hasSearchQuery,
          visibleIssueCount: visibleIssues.length,
        })
      : null;

  const selectedIssue: Issue | null =
    issueState.status === "success"
      ? (visibleIssues.find((issue) => issue.id === selectedIssueId) ?? null)
      : null;

  return {
    activeViewId,
    activeViewLabel,
    baseVisibleIssues,
    emptyReason,
    hasSearchQuery,
    isSearchDisabled,
    selectedIssue,
    visibleIssues,
  };
};

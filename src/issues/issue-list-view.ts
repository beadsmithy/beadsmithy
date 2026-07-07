import type { Issue } from "../rpc/bindings";
import type { IssueExplorerData, IssueExplorerLoadState } from "./issue-loader";

export type IssueStatusViewId = "open" | "in_progress" | "closed" | "deferred";

export type AllIssuesBackedIssueListViewId = "all" | IssueStatusViewId;

export type IssueListViewId =
  | AllIssuesBackedIssueListViewId
  | "ready"
  | "blocked";

export type IssueListViewGroup = "views" | "status";

export interface IssueListViewDefinition {
  id: IssueListViewId;
  label: string;
  group: IssueListViewGroup;
}

export type IssueListViewCounts = Record<IssueListViewId, number>;

export const DEFAULT_ISSUE_LIST_VIEW_ID: IssueListViewId = "all";

export const ISSUE_LIST_VIEW_DEFINITIONS: IssueListViewDefinition[] = [
  { group: "views", id: "all", label: "All" },
  { group: "views", id: "ready", label: "Ready" },
  { group: "views", id: "blocked", label: "Blocked" },
  { group: "status", id: "open", label: "Open" },
  { group: "status", id: "in_progress", label: "In Progress" },
  { group: "status", id: "closed", label: "Closed" },
  { group: "status", id: "deferred", label: "Deferred" },
];

const ALL_ISSUES_BACKED_VIEW_IDS = [
  "all",
  "open",
  "in_progress",
  "closed",
  "deferred",
] as const satisfies readonly AllIssuesBackedIssueListViewId[];

export const isAllIssuesBackedIssueListViewId = (
  viewId: IssueListViewId
): viewId is AllIssuesBackedIssueListViewId =>
  (ALL_ISSUES_BACKED_VIEW_IDS as readonly IssueListViewId[]).includes(viewId);

const countIssuesWithStatus = (
  issues: Issue[],
  status: IssueStatusViewId
): number => issues.filter((issue) => issue.status === status).length;

export const selectAllIssuesBackedIssueListViewIssues = (
  data: IssueExplorerData,
  viewId: AllIssuesBackedIssueListViewId
): Issue[] => {
  if (viewId === "all") {
    return data.allIssues;
  }

  return data.allIssues.filter((issue) => issue.status === viewId);
};

export const getVisibleIssuesForListView = (
  state: IssueExplorerLoadState,
  viewId: IssueListViewId
): Issue[] => {
  if (state.status !== "success") {
    return [];
  }

  if (isAllIssuesBackedIssueListViewId(viewId)) {
    return selectAllIssuesBackedIssueListViewIssues(state, viewId);
  }

  if (viewId === "blocked") {
    return state.blockedIssues;
  }

  // Ready command-backed rendering belongs to its own slice. Preserve the
  // existing All Issues rendering for Ready until that branch lands on main.
  return state.allIssues;
};

export const getIssueListViewCounts = (
  state: IssueExplorerLoadState
): IssueListViewCounts | null => {
  if (state.status !== "success") {
    return null;
  }

  return {
    all: state.allIssues.length,
    blocked: state.blockedIssues.length,
    closed: countIssuesWithStatus(state.allIssues, "closed"),
    deferred: countIssuesWithStatus(state.allIssues, "deferred"),
    in_progress: countIssuesWithStatus(state.allIssues, "in_progress"),
    open: countIssuesWithStatus(state.allIssues, "open"),
    ready: state.readyIssues.length,
  };
};

export const formatIssueCountLabel = (count: number): string =>
  `${count} ${count === 1 ? "issue" : "issues"}`;

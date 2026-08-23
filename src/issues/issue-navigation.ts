import type { Issue } from "../rpc/bindings";
import {
  DEFAULT_ISSUE_LIST_VIEW_ID,
  getVisibleIssuesForListView,
  ISSUE_LIST_VIEW_DEFINITIONS,
} from "./issue-list-view";
import type { IssueListViewId } from "./issue-list-view";
import type { IssueExplorerLoadState } from "./issue-loader";

export interface IssueExplorerRouteState {
  issueId: string | null;
  search: string;
  viewId: IssueListViewId;
}

export const isIssueListViewId = (value: string): value is IssueListViewId =>
  ISSUE_LIST_VIEW_DEFINITIONS.some((definition) => definition.id === value);

export const normalizeIssueListViewId = (
  value: string | null
): IssueListViewId =>
  value !== null && isIssueListViewId(value)
    ? value
    : DEFAULT_ISSUE_LIST_VIEW_ID;

const decodeIssueId = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const createIssueExplorerRoute = (
  issueId: string | null,
  searchParams: URLSearchParams
): IssueExplorerRouteState => ({
  issueId,
  search: searchParams.get("search") ?? "",
  viewId: normalizeIssueListViewId(searchParams.get("view")),
});

export const parseIssueExplorerRoute = (
  location: string
): IssueExplorerRouteState => {
  const [rawPath, rawSearch = ""] = location.split("?", 2);
  const path = rawPath.replace(/\/+$/u, "") || "/";
  const issuePathMatch = /^\/issues\/(?<issueId>.+)$/u.exec(path);
  const issueId = issuePathMatch?.groups?.issueId
    ? decodeIssueId(issuePathMatch.groups.issueId)
    : null;
  const params = new URLSearchParams(rawSearch);

  return createIssueExplorerRoute(issueId, params);
};

export const serializeIssueExplorerRoute = (
  route: IssueExplorerRouteState
): string => {
  const path = route.issueId
    ? `/issues/${encodeURIComponent(route.issueId)}`
    : "/issues";
  const params = new URLSearchParams();

  if (route.viewId !== DEFAULT_ISSUE_LIST_VIEW_ID) {
    params.set("view", route.viewId);
  }
  if (route.search.length > 0) {
    params.set("search", route.search);
  }

  const query = params.toString();
  return query.length > 0 ? `${path}?${query}` : path;
};

export const isIssueInListView = (
  state: IssueExplorerLoadState,
  viewId: IssueListViewId,
  issueId: string
): boolean =>
  getVisibleIssuesForListView(state, viewId).some(
    (issue: Issue) => issue.id === issueId
  );

export const selectIssueForView = (
  state: IssueExplorerLoadState,
  viewId: IssueListViewId,
  issueId: string | null
): string | null =>
  issueId !== null && isIssueInListView(state, viewId, issueId)
    ? issueId
    : null;

export const routeFromLocation = (location: string): IssueExplorerRouteState =>
  parseIssueExplorerRoute(location);

import type { Issue } from "../rpc/bindings";
import {
  DEFAULT_ISSUE_LIST_VIEW_ID,
  getVisibleIssuesForListView,
  ISSUE_LIST_VIEW_DEFINITIONS,
} from "./issue-list-view";
import type { IssueListViewId } from "./issue-list-view";
import type { IssueExplorerLoadState } from "./issue-loader";

export type IssueGraphScope = "focused" | "all";

export interface IssueListRouteState {
  kind?: "list";
  issueId: string | null;
  search: string;
  viewId: IssueListViewId;
}

export interface IssueGraphRouteState {
  kind: "graph";
  issueId: string | null;
  scope: IssueGraphScope;
  search?: never;
  viewId?: never;
}

export type IssueExplorerRouteState =
  | IssueListRouteState
  | IssueGraphRouteState;

export const isIssueListRoute = (
  route: IssueExplorerRouteState
): route is IssueListRouteState => route.kind !== "graph";

export const isIssueGraphRoute = (
  route: IssueExplorerRouteState
): route is IssueGraphRouteState => route.kind === "graph";

export const isIssueGraphScope = (value: unknown): value is IssueGraphScope =>
  value === "focused" || value === "all";

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
): IssueListRouteState => ({
  issueId,
  kind: "list",
  search: searchParams.get("search") ?? "",
  viewId: normalizeIssueListViewId(searchParams.get("view")),
});

export const createIssueGraphRoute = (
  issueId: string | null,
  searchParams: URLSearchParams
): IssueGraphRouteState => ({
  issueId,
  kind: "graph",
  scope: searchParams.get("scope") === "all" ? "all" : ("focused" as const),
});

export const parseIssueExplorerRoute = (
  location: string
): IssueExplorerRouteState => {
  const [rawPath, rawSearch = ""] = location.split("?", 2);
  const path = rawPath.replace(/\/+$/u, "") || "/";
  const params = new URLSearchParams(rawSearch);
  const graphPathMatch = /^\/graph(?:\/(?<issueId>.+))?$/u.exec(path);
  if (graphPathMatch !== null) {
    const issueId = graphPathMatch.groups?.issueId
      ? decodeIssueId(graphPathMatch.groups.issueId)
      : params.get("issue");
    return createIssueGraphRoute(issueId, params);
  }

  const issuePathMatch = /^\/issues\/(?<issueId>.+)$/u.exec(path);
  const issueId = issuePathMatch?.groups?.issueId
    ? decodeIssueId(issuePathMatch.groups.issueId)
    : null;

  return createIssueExplorerRoute(issueId, params);
};

export const serializeIssueExplorerRoute = (
  route: IssueExplorerRouteState
): string => {
  if (isIssueGraphRoute(route)) {
    const params = new URLSearchParams();
    if (route.scope !== "focused") {
      params.set("scope", route.scope);
    }
    if (route.issueId !== null) {
      params.set("issue", route.issueId);
    }
    const query = params.toString();
    return query.length > 0 ? `/graph?${query}` : "/graph";
  }

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

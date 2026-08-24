import type { IssueExplorerRouteState } from "./issue-navigation";
import {
  isIssueListViewId,
  serializeIssueExplorerRoute,
} from "./issue-navigation";

export interface IssueNavigationEntry extends IssueExplorerRouteState {
  index: number;
  workspacePath: string | null;
}

export interface IssueNavigationHistoryState {
  beadsmithNavigation?: IssueNavigationEntry;
}

export interface IssueNavigationLedger {
  entries: Map<number, IssueNavigationEntry>;
}

export const createIssueNavigationLedger = (): IssueNavigationLedger => ({
  entries: new Map(),
});

export const createIssueNavigationEntry = (
  route: IssueExplorerRouteState,
  workspacePath: string | null,
  index: number
): IssueNavigationEntry => ({
  ...route,
  index,
  workspacePath,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const readIssueNavigationEntry = (
  state: unknown
): IssueNavigationEntry | null => {
  if (!isRecord(state) || !isRecord(state.beadsmithNavigation)) {
    return null;
  }

  const navigation = state.beadsmithNavigation;
  const { index, workspacePath, issueId, search, viewId } = navigation;
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    (typeof workspacePath !== "string" && workspacePath !== null) ||
    (typeof issueId !== "string" && issueId !== null) ||
    typeof search !== "string" ||
    typeof viewId !== "string" ||
    !isIssueListViewId(viewId)
  ) {
    return null;
  }

  return { index, issueId, search, viewId, workspacePath };
};

export const writeIssueNavigationState = (
  state: unknown,
  entry: IssueNavigationEntry
): IssueNavigationHistoryState => ({
  ...(typeof state === "object" && state !== null ? state : {}),
  beadsmithNavigation: entry,
});

export const recordIssueNavigationEntry = (
  ledger: IssueNavigationLedger,
  entry: IssueNavigationEntry
): void => {
  ledger.entries.set(entry.index, entry);
};

export const truncateForwardIssueNavigationEntries = (
  ledger: IssueNavigationLedger,
  index: number
): void => {
  for (const entryIndex of ledger.entries.keys()) {
    if (entryIndex > index) {
      ledger.entries.delete(entryIndex);
    }
  }
};

export const nextIssueNavigationIndex = (
  current: IssueNavigationEntry | null
): number => (current === null ? 0 : current.index + 1);

export const issueNavigationDestinationLabel = (
  entry: IssueNavigationEntry | null
): string | null => {
  if (entry === null) {
    return null;
  }

  if (entry.issueId !== null) {
    return entry.issueId;
  }

  return entry.viewId === "all" ? "All Issues" : `${entry.viewId} Issues`;
};

export const issueNavigationHref = (entry: IssueNavigationEntry): string =>
  serializeIssueExplorerRoute(entry);

import { useCallback, useRef } from "react";

import { useExternalLifecycle } from "../lib/use-external-lifecycle";
import type { IssueExplorerRouteState } from "./issue-navigation";
import { serializeIssueExplorerRoute } from "./issue-navigation";
import {
  createIssueNavigationEntry,
  createIssueNavigationLedger,
  issueNavigationDestinationLabel,
  readIssueNavigationEntry,
  recordIssueNavigationEntry,
  truncateForwardIssueNavigationEntries,
  writeIssueNavigationState,
} from "./issue-navigation-coordinator";
import type {
  IssueNavigationEntry,
  IssueNavigationLedger,
} from "./issue-navigation-coordinator";

interface NavigationOptions {
  replace?: boolean;
  state?: unknown;
}

type Navigate = (path: string, options?: NavigationOptions) => void;

export interface IssueNavigationCoordinatorOptions {
  currentHistoryState: unknown;
  currentWorkspacePath: string | null;
  isSettingsRoute: boolean;
  issueRoute: IssueExplorerRouteState;
  navigate: Navigate;
}

export interface IssueNavigationCoordinatorResult {
  currentNavigationEntry: IssueNavigationEntry | null;
  currentNavigationIndex: number;
  explorerRoute: IssueExplorerRouteState;
  handleBackNavigation: () => void;
  navigateIssueRoute: (
    route: IssueExplorerRouteState,
    replace: boolean,
    workspacePath?: string | null
  ) => void;
  nextNavigationEntry: IssueNavigationEntry | null;
  previousNavigationEntry: IssueNavigationEntry | null;
}

export const useIssueNavigationCoordinator = ({
  currentHistoryState,
  currentWorkspacePath,
  isSettingsRoute,
  issueRoute,
  navigate,
}: IssueNavigationCoordinatorOptions): IssueNavigationCoordinatorResult => {
  const underlyingIssueRouteRef = useRef(issueRoute);
  useExternalLifecycle(() => {
    if (!isSettingsRoute) {
      underlyingIssueRouteRef.current = issueRoute;
    }
  }, [isSettingsRoute, issueRoute]);

  const explorerRoute = isSettingsRoute
    ? underlyingIssueRouteRef.current
    : issueRoute;
  const navigationLedgerRef = useRef<IssueNavigationLedger | null>(null);
  if (navigationLedgerRef.current === null) {
    navigationLedgerRef.current = createIssueNavigationLedger();
  }
  const navigationLedger = navigationLedgerRef.current;
  const currentNavigationEntry = readIssueNavigationEntry(currentHistoryState);
  const currentNavigationIndex = currentNavigationEntry?.index ?? 0;

  const navigateIssueRoute = useCallback(
    (
      route: IssueExplorerRouteState,
      replace: boolean,
      workspacePath = currentWorkspacePath
    ): void => {
      let current = readIssueNavigationEntry(currentHistoryState);
      let navigationReplace = replace;
      if (isSettingsRoute) {
        const underlyingEntry = createIssueNavigationEntry(
          explorerRoute,
          current?.workspacePath ?? currentWorkspacePath,
          current?.index ?? 0
        );
        recordIssueNavigationEntry(navigationLedger, underlyingEntry);
        current = underlyingEntry;
        // Settings occupies the current browser entry. Replace it with the
        // destination so the underlying Issue remains a ledger-only entry.
        navigationReplace = true;
      }

      const index = navigationReplace
        ? (current?.index ?? 0)
        : (current?.index ?? -1) + 1;
      const entry = createIssueNavigationEntry(route, workspacePath, index);
      if (!navigationReplace) {
        truncateForwardIssueNavigationEntries(navigationLedger, index - 1);
      }
      recordIssueNavigationEntry(navigationLedger, entry);
      navigate(serializeIssueExplorerRoute(route), {
        replace: navigationReplace,
        state: writeIssueNavigationState(currentHistoryState, entry),
      });
    },
    [
      currentHistoryState,
      currentWorkspacePath,
      explorerRoute,
      isSettingsRoute,
      navigate,
      navigationLedger,
    ]
  );

  useExternalLifecycle(() => {
    const entry =
      currentNavigationEntry ??
      createIssueNavigationEntry(issueRoute, currentWorkspacePath, 0);
    const authoritativeEntry =
      currentNavigationEntry !== null &&
      currentNavigationEntry.workspacePath === null &&
      currentWorkspacePath !== null
        ? createIssueNavigationEntry(
            currentNavigationEntry,
            currentWorkspacePath,
            currentNavigationEntry.index
          )
        : entry;
    recordIssueNavigationEntry(navigationLedger, authoritativeEntry);
    if (
      currentNavigationEntry === null ||
      authoritativeEntry !== currentNavigationEntry
    ) {
      navigate(serializeIssueExplorerRoute(authoritativeEntry), {
        replace: true,
        state: writeIssueNavigationState(
          currentHistoryState,
          authoritativeEntry
        ),
      });
    }
  }, [
    currentHistoryState,
    currentNavigationEntry,
    currentWorkspacePath,
    issueRoute,
    navigate,
    navigationLedger,
  ]);

  const previousNavigationEntry =
    navigationLedger.entries.get(currentNavigationIndex - 1) ?? null;
  const nextNavigationEntry =
    navigationLedger.entries.get(currentNavigationIndex + 1) ?? null;
  const handleBackNavigation = useCallback(() => {
    if (isSettingsRoute) {
      navigateIssueRoute(explorerRoute, true);
      window.history.back();
      return;
    }
    if (previousNavigationEntry !== null) {
      window.history.back();
    }
  }, [
    explorerRoute,
    isSettingsRoute,
    navigateIssueRoute,
    previousNavigationEntry,
  ]);

  useExternalLifecycle(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const { target } = event;
      const isEditableTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (isEditableTarget) {
        return;
      }

      const isMac = navigator.platform.toLowerCase().includes("mac");
      const usesBackShortcut = isMac
        ? event.metaKey && event.key === "["
        : event.altKey && event.key === "ArrowLeft";
      const usesForwardShortcut = isMac
        ? event.metaKey && event.key === "]"
        : event.altKey && event.key === "ArrowRight";
      if (!usesBackShortcut && !usesForwardShortcut) {
        return;
      }

      event.preventDefault();
      if (
        usesBackShortcut &&
        (isSettingsRoute || previousNavigationEntry !== null)
      ) {
        handleBackNavigation();
      } else if (usesForwardShortcut && nextNavigationEntry !== null) {
        window.history.forward();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleBackNavigation,
    isSettingsRoute,
    nextNavigationEntry,
    previousNavigationEntry,
  ]);

  return {
    currentNavigationEntry,
    currentNavigationIndex,
    explorerRoute,
    handleBackNavigation,
    navigateIssueRoute,
    nextNavigationEntry,
    previousNavigationEntry,
  };
};

export { issueNavigationDestinationLabel };

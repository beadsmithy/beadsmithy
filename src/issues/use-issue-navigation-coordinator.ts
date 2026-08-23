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
import type { IssueNavigationEntry } from "./issue-navigation-coordinator";

interface NavigationOptions {
  replace?: boolean;
  state?: unknown;
}

type Navigate = (path: string, options?: NavigationOptions) => void;

export interface IssueNavigationCoordinatorOptions {
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
  const navigationLedgerRef = useRef(createIssueNavigationLedger());
  const currentNavigationEntry = readIssueNavigationEntry(window.history.state);
  const currentNavigationIndex = currentNavigationEntry?.index ?? 0;

  const navigateIssueRoute = useCallback(
    (
      route: IssueExplorerRouteState,
      replace: boolean,
      workspacePath = currentWorkspacePath
    ): void => {
      let current = readIssueNavigationEntry(window.history.state);
      if (isSettingsRoute) {
        const underlyingEntry = createIssueNavigationEntry(
          explorerRoute,
          current?.workspacePath ?? currentWorkspacePath,
          current?.index ?? 0
        );
        recordIssueNavigationEntry(
          navigationLedgerRef.current,
          underlyingEntry
        );
        window.history.replaceState(
          writeIssueNavigationState(window.history.state, underlyingEntry),
          "",
          serializeIssueExplorerRoute(explorerRoute)
        );
        current = underlyingEntry;
      }

      const index = replace
        ? (current?.index ?? 0)
        : (current?.index ?? -1) + 1;
      const entry = createIssueNavigationEntry(route, workspacePath, index);
      if (!replace) {
        truncateForwardIssueNavigationEntries(
          navigationLedgerRef.current,
          index - 1
        );
      }
      recordIssueNavigationEntry(navigationLedgerRef.current, entry);
      navigate(serializeIssueExplorerRoute(route), {
        replace,
        state: writeIssueNavigationState(window.history.state, entry),
      });
    },
    [currentWorkspacePath, explorerRoute, isSettingsRoute, navigate]
  );

  useExternalLifecycle(() => {
    const entry =
      currentNavigationEntry ??
      createIssueNavigationEntry(issueRoute, currentWorkspacePath, 0);
    recordIssueNavigationEntry(navigationLedgerRef.current, entry);
    if (currentNavigationEntry === null) {
      window.history.replaceState(
        writeIssueNavigationState(window.history.state, entry),
        "",
        serializeIssueExplorerRoute(issueRoute)
      );
    }
  }, [currentNavigationEntry, currentWorkspacePath, issueRoute]);

  const previousNavigationEntry =
    navigationLedgerRef.current.entries.get(currentNavigationIndex - 1) ?? null;
  const nextNavigationEntry =
    navigationLedgerRef.current.entries.get(currentNavigationIndex + 1) ?? null;
  const handleBackNavigation = useCallback(() => {
    if (isSettingsRoute) {
      navigateIssueRoute(explorerRoute, true);
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

import { useState } from "react";
import { Route, Switch, useLocation, useRoute, useSearchParams } from "wouter";
import { useHistoryState } from "wouter/use-browser-location";

import "./App.css";
import { Sidebar } from "./components/Sidebar";
import { Titlebar } from "./components/Titlebar";
import {
  createIssueExplorerRoute,
  isIssueListViewId,
  serializeIssueExplorerRoute,
} from "./issues/issue-navigation";
import { issueNavigationDestinationLabel } from "./issues/issue-navigation-coordinator";
import { IssueExplorer } from "./issues/IssueExplorer";
import { useIssueExplorerCoordinator } from "./issues/use-issue-explorer-coordinator";
import { useExternalLifecycle } from "./lib/use-external-lifecycle";
import { useAppSettings } from "./settings/app-settings";
import { SettingsPage } from "./settings/SettingsPage";

type AppDestination = "issueExplorer" | "settings";

const App = () => {
  const [location, navigate] = useLocation();
  const currentHistoryState = useHistoryState<unknown>();
  const [settingsMatch] = useRoute("/settings");
  const [issueDetailMatch, issueDetailParams] = useRoute<{
    issueId?: string;
  }>("/issues/:issueId");
  const [searchParams] = useSearchParams();
  const issueRoute = createIssueExplorerRoute(
    issueDetailMatch ? (issueDetailParams.issueId ?? null) : null,
    searchParams
  );
  const isSettingsRoute = settingsMatch;
  const rawViewParam = searchParams.get("view");
  useExternalLifecycle(() => {
    if (rawViewParam !== null && !isIssueListViewId(rawViewParam)) {
      navigate(serializeIssueExplorerRoute(issueRoute), {
        replace: true,
        state: currentHistoryState,
      });
    }
  }, [currentHistoryState, issueRoute, navigate, rawViewParam]);

  const {
    explorer: {
      onIssueListViewSelect,
      onIssueReferenceSelect,
      onIssueSearchChange,
      onIssueSelect,
      presentedIssueState,
      refreshHealth,
      route: explorerRoute,
      sidebarDisabled,
      workspaceKey,
    },
    navigation: {
      handleBackNavigation,
      nextNavigationEntry,
      previousNavigationEntry,
    },
    notice: { deepLinkError, dismissDeepLinkError },
    workspace: {
      dismissedSwitchErrorGeneration,
      handlers: workspaceHandlers,
      state: workspaceState,
    },
  } = useIssueExplorerCoordinator({
    currentHistoryState,
    isSettingsRoute,
    issueRoute,
    navigate,
  });

  const appDestination: AppDestination = isSettingsRoute
    ? "settings"
    : "issueExplorer";
  const settings = useAppSettings();
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

  const backDisabled = isSettingsRoute
    ? false
    : previousNavigationEntry === null;
  const issueExplorerView = (
    <IssueExplorer
      activeIssueListViewId={explorerRoute.viewId}
      focusRouteChanges={!isSettingsRoute}
      issueState={presentedIssueState}
      markdownFontSizePx={settings.state.appliedFontSizePx}
      onIssueReferenceSelect={onIssueReferenceSelect}
      onIssueSearchChange={onIssueSearchChange}
      onIssueSelect={onIssueSelect}
      refreshHealth={refreshHealth}
      route={explorerRoute}
      titleOverride={isSettingsRoute ? "Settings · Beadsmithy" : null}
    />
  );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background font-primary text-text-main antialiased">
      <Titlebar
        backDisabled={backDisabled}
        backLabel={issueNavigationDestinationLabel(previousNavigationEntry)}
        forwardDisabled={nextNavigationEntry === null}
        forwardLabel={issueNavigationDestinationLabel(nextNavigationEntry)}
        onBack={handleBackNavigation}
        onForward={() => window.history.forward()}
        onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
        sidebarCollapsed={sidebarCollapsed}
      />
      {deepLinkError === null ? null : (
        <div
          aria-live="assertive"
          className="flex items-center gap-3 border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-red-200"
          role="alert"
        >
          <span className="flex-1">{deepLinkError}</span>
          <button
            aria-label="Dismiss deep-link error"
            className="rounded px-2 py-1 text-xs text-text-main hover:bg-white/10"
            onClick={dismissDeepLinkError}
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeIssueListViewId={explorerRoute.viewId}
          appDestination={appDestination}
          collapsed={sidebarCollapsed}
          disabled={sidebarDisabled}
          dismissedSwitchErrorGeneration={dismissedSwitchErrorGeneration}
          issueState={presentedIssueState}
          onCollapseToggle={setSidebarCollapsed}
          onIssueListViewSelect={onIssueListViewSelect}
          onSettingsClick={() => {
            navigate("/settings", {
              replace: true,
              state: currentHistoryState,
            });
          }}
          workspaceHandlers={workspaceHandlers}
          workspaceState={workspaceState}
        />

        <div className="relative flex flex-1">
          <div
            aria-hidden={appDestination === "settings" ? true : undefined}
            data-workspace-key={workspaceKey}
            className={`flex flex-1 ${
              appDestination === "settings" ? "invisible" : ""
            }`}
            inert={appDestination === "settings" ? true : undefined}
          >
            {workspaceState !== null &&
            workspaceState.currentWorkspace === null &&
            workspaceState.pendingWorkspace === null ? (
              <main
                aria-label="Choose a workspace"
                className="flex flex-1 items-center justify-center bg-background p-8 text-center"
              >
                <div>
                  <h1 className="text-lg font-semibold text-primary">
                    Choose a workspace
                  </h1>
                  <p className="mt-2 text-sm text-muted">
                    Select a Beadwork repository to load its issue views.
                  </p>
                  <button
                    className="mt-4 rounded border border-border-main px-3 py-2 text-sm hover:bg-white/5"
                    onClick={() => workspaceHandlers.onChoose()}
                    type="button"
                  >
                    Choose folder
                  </button>
                </div>
              </main>
            ) : (
              <Switch location={location}>
                <Route path="/issues/:issueId">{issueExplorerView}</Route>
                <Route path="/issues">{issueExplorerView}</Route>
                <Route>{issueExplorerView}</Route>
              </Switch>
            )}
          </div>
          <Switch location={location}>
            <Route path="/settings">
              <SettingsPage
                className="absolute inset-0 z-10"
                onDraftChange={(value) => settings.setDraft(value)}
                onReset={() => settings.reset()}
                onRetry={() => settings.retry()}
                state={settings.state}
              />
            </Route>
          </Switch>
        </div>
      </div>
    </div>
  );
};

export default App;

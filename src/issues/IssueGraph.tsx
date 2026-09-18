import { AlertTriangle, LoaderCircle, Network } from "lucide-react";

import { useExternalLifecycle } from "../lib/use-external-lifecycle";
import type { RefreshHealth } from "../refresh-health";
import { buildFocusedIssueGraph } from "./issue-graph";
import type { IssueExplorerLoadState } from "./issue-loader";
import type { IssueGraphRouteState } from "./issue-navigation";
import { IssueGraphCanvas } from "./IssueGraphCanvas";
import {
  RefreshFailureBanner,
  selectBannerFailure,
} from "./RefreshFailureBanner";

export const IssueGraph = ({
  issueState,
  refreshHealth,
  route,
  titleOverride,
}: {
  issueState: IssueExplorerLoadState;
  refreshHealth: RefreshHealth | null;
  route: IssueGraphRouteState;
  titleOverride?: string | null;
}) => {
  useExternalLifecycle(() => {
    document.title = titleOverride ?? "Graph · Beadsmithy";
  }, [titleOverride]);

  const bannerFailure = refreshHealth
    ? selectBannerFailure(refreshHealth)
    : null;
  const focusedGraph =
    issueState.status === "success"
      ? buildFocusedIssueGraph({
          allIssues: issueState.allIssues,
          selectedIssueId: route.issueId,
        })
      : null;

  if (issueState.status === "loading") {
    return (
      <main
        aria-label="Issue Graph"
        className="bg-background flex flex-1 flex-col"
      >
        <RefreshFailureBanner failure={bannerFailure} />
        <div className="text-muted flex flex-1 flex-col items-center justify-center p-6 text-center text-sm">
          <LoaderCircle className="text-accent mb-3 size-5 animate-spin" />
          <p className="text-text-main font-medium">Loading issue graph</p>
          <p className="mt-1 text-xs">
            Reading issue relationships from Beadwork…
          </p>
        </div>
      </main>
    );
  }

  if (issueState.status === "failure") {
    return (
      <main
        aria-label="Issue Graph"
        className="bg-background flex flex-1 flex-col"
      >
        <RefreshFailureBanner failure={bannerFailure} />
        <div className="p-4" role="alert">
          <div className="border-danger/40 bg-danger/10 rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-red-200">
              <AlertTriangle className="size-4" />
              Could not load issues
            </div>
            <p className="text-text-main text-xs leading-5">
              {issueState.error.message}
            </p>
            <p className="text-muted mt-2 font-mono text-[10px]">
              {issueState.error.kind}
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (issueState.allIssues.length === 0) {
    return (
      <main
        aria-label="Issue Graph"
        className="bg-background flex flex-1 flex-col"
      >
        <RefreshFailureBanner failure={bannerFailure} />
        <div className="text-muted flex flex-1 flex-col items-center justify-center p-6 text-center text-sm">
          <Network className="text-muted mb-3 size-6" />
          <h1 className="text-text-main font-medium">No issues to graph</h1>
          <p className="mt-1 text-xs">
            Beadwork returned an empty issue list for this workspace.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      aria-label="Issue Graph"
      className="bg-background flex flex-1 flex-col"
      data-graph-scope={route.scope}
      data-graph-selected-issue={route.issueId ?? ""}
    >
      <RefreshFailureBanner failure={bannerFailure} />
      <header className="border-border-main flex items-center justify-between border-b px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Network aria-hidden="true" className="text-accent size-5" />
            <h1 className="text-primary text-lg font-semibold">
              {route.scope === "focused" ? "Focused Graph" : "All Graph"}
            </h1>
          </div>
          <p className="text-muted mt-1 text-xs">
            {route.scope === "focused"
              ? "Current work and its direct parent context."
              : "Every Issue in this Workspace."}
          </p>
        </div>
        <span className="text-muted font-mono text-xs">
          {focusedGraph?.nodes.length ?? 0} visible /{" "}
          {issueState.allIssues.length} total Issues
        </span>
      </header>
      {focusedGraph === null || focusedGraph.anomalies.length === 0 ? null : (
        <div
          aria-live="polite"
          className="border-accent/40 bg-accent/10 border-b px-5 py-2 text-xs text-indigo-200"
          data-graph-anomaly-warning="true"
        >
          {focusedGraph.anomalies.length} relationship endpoint
          {focusedGraph.anomalies.length === 1 ? " is" : "s are"} missing from
          this Workspace snapshot.
        </div>
      )}
      <div className="border-border-main text-muted flex items-center gap-4 border-b px-5 py-2 text-xs">
        <span data-graph-visible-count="true">
          {route.scope === "focused" ? "Focused" : "All"} graph
        </span>
        <span aria-label="Visible issue count">
          {issueState.allIssues.length} total Issues
        </span>
      </div>
      <IssueGraphCanvas
        allIssues={issueState.allIssues}
        selectedIssueId={route.issueId}
      />
    </main>
  );
};

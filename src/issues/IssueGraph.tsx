import type { Viewport } from "@xyflow/react";
import { AlertTriangle, LoaderCircle, Network } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { ExternalLinkOpener } from "../components/external-link-opener";
import { openExternalLink as defaultOpenExternalLink } from "../components/external-link-opener";
import { useExternalLifecycle } from "../lib/use-external-lifecycle";
import type { RefreshHealth } from "../refresh-health";
import type { Issue } from "../rpc/bindings";
import { buildFocusedIssueGraph } from "./issue-graph";
import { getChildIssues } from "./issue-hierarchy";
import type { IssueExplorerLoadState } from "./issue-loader";
import { generateIssueLocationUri } from "./issue-location-uri";
import { serializeIssueExplorerRoute } from "./issue-navigation";
import type { IssueGraphRouteState } from "./issue-navigation";
import { IssueDetailPane } from "./IssueDetail";
import { IssueGraphCanvas } from "./IssueGraphCanvas";
import {
  RefreshFailureBanner,
  selectBannerFailure,
} from "./RefreshFailureBanner";

export const IssueGraph = ({
  issueState,
  markdownFontSizePx,
  onIssueClose,
  onIssueSelect,
  handleViewportChange,
  openExternalLink = defaultOpenExternalLink,
  refreshHealth,
  route,
  titleOverride,
  viewport,
  workspacePath,
}: {
  issueState: IssueExplorerLoadState;
  markdownFontSizePx?: number;
  onIssueClose: () => void;
  onIssueSelect: (issueId: string) => void;
  handleViewportChange: (viewport: Viewport) => void;
  openExternalLink?: ExternalLinkOpener;
  refreshHealth: RefreshHealth | null;
  route: IssueGraphRouteState;
  titleOverride?: string | null;
  viewport: Viewport | null;
  workspacePath: string | null;
}) => {
  const [copySucceeded, setCopySucceeded] = useState(false);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
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
  const selectedIssue = useMemo(() => {
    if (issueState.status !== "success" || route.issueId === null) {
      return null;
    }
    return (
      issueState.allIssues.find((issue) => issue.id === route.issueId) ?? null
    );
  }, [issueState, route.issueId]);
  const issueMap = useMemo<Record<string, Issue>>(() => {
    if (issueState.status !== "success") {
      return {};
    }
    return Object.fromEntries(
      issueState.allIssues.map((issue) => [issue.id, issue])
    );
  }, [issueState]);
  const childIssues = useMemo(() => {
    if (selectedIssue === null || issueState.status !== "success") {
      return [];
    }
    return getChildIssues(issueState.allIssues, selectedIssue.id);
  }, [issueState, selectedIssue]);
  const handleCopyDeepLink = async (): Promise<void> => {
    if (
      issueState.status !== "success" ||
      route.issueId === null ||
      navigator.clipboard === undefined
    ) {
      return;
    }
    const result = generateIssueLocationUri({
      issueId: route.issueId,
      workspacePath: issueState.workspacePath,
    });
    if (!result.ok) {
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
      <div className="relative min-h-0 flex-1">
        <IssueGraphCanvas
          allIssues={issueState.allIssues}
          key={workspacePath ?? "no-workspace"}
          onIssueSelect={onIssueSelect}
          handleViewportChange={handleViewportChange}
          selectedIssueId={route.issueId}
          viewport={viewport}
        />
        {route.issueId === null ? null : (
          <aside
            aria-label="Graph Issue detail panel"
            className="border-border-main bg-background absolute inset-y-0 right-0 z-20 flex w-[min(520px,calc(100%-48px))] flex-col border-l shadow-2xl"
            data-graph-detail-panel="true"
          >
            <div className="border-border-main flex h-10 shrink-0 items-center justify-end border-b px-3">
              <button
                aria-label="Close Issue detail"
                className="border-border-main text-muted hover:text-text-main rounded border px-2 py-1 text-xs hover:bg-white/5"
                data-graph-detail-close="true"
                onClick={onIssueClose}
                type="button"
              >
                Close
              </button>
            </div>
            <IssueDetailPane
              childIssues={childIssues}
              copySucceeded={copySucceeded}
              issueMap={issueMap}
              missingIssueId={selectedIssue === null ? route.issueId : null}
              navigation={{
                hrefForIssue: (issueId) =>
                  serializeIssueExplorerRoute({ ...route, issueId }),
                onSelectIssue: onIssueSelect,
              }}
              onCopyDeepLink={
                selectedIssue === null ? undefined : handleCopyDeepLink
              }
              openExternalLink={openExternalLink}
              markdownFontSizePx={markdownFontSizePx}
              selectedIssue={selectedIssue}
              titleRef={detailHeadingRef}
            />
          </aside>
        )}
      </div>
    </main>
  );
};

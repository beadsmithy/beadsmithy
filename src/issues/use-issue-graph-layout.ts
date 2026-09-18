import { useMemo, useState } from "react";

import { useExternalLifecycle } from "../lib/use-external-lifecycle";
import type { FocusedIssueGraph } from "./issue-graph";
import {
  layoutIssueGraph,
  layoutIssueGraphWithDagre,
} from "./issue-graph-layout";
import type { IssueGraphLayoutResult } from "./issue-graph-layout";

export interface IssueGraphLayoutState {
  error: Error | null;
  isFallback: boolean;
  isLoading: boolean;
  layout: IssueGraphLayoutResult | null;
}

const INITIAL_LAYOUT_STATE: IssueGraphLayoutState = {
  error: null,
  isFallback: false,
  isLoading: true,
  layout: null,
};

const graphIdentity = (graph: FocusedIssueGraph): string =>
  JSON.stringify({
    anomalies: graph.anomalies,
    edges: graph.edges,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
    })),
  });

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

export const useIssueGraphLayout = (
  graph: FocusedIssueGraph
): IssueGraphLayoutState => {
  const graphKey = useMemo(() => graphIdentity(graph), [graph]);
  const [state, setState] =
    useState<IssueGraphLayoutState>(INITIAL_LAYOUT_STATE);

  useExternalLifecycle(() => {
    const graphForLayout = graph;
    if (graphForLayout.nodes.length === 0) {
      setState({
        error: null,
        isFallback: false,
        isLoading: false,
        layout: null,
      });
      return;
    }

    let cancelled = false;
    setState((previous) => ({
      error: null,
      isFallback: false,
      isLoading: true,
      layout:
        previous.layout === null
          ? null
          : layoutIssueGraphWithDagre(graphForLayout),
    }));

    void (async () => {
      try {
        const layout = await layoutIssueGraph({ graph: graphForLayout });
        if (cancelled) {
          return;
        }
        setState({ error: null, isFallback: false, isLoading: false, layout });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({
          error: toError(error),
          isFallback: true,
          isLoading: false,
          layout: layoutIssueGraphWithDagre(graphForLayout),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [graphKey]);

  return state;
};

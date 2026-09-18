import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as LayoutModule from "./issue-graph-layout";
import type { IssueGraphLayoutResult } from "./issue-graph-layout";
import { createIssueGraphLayoutFixture } from "./issue-graph-layout-fixture";

const layoutIssueGraph = vi.fn();
const layoutIssueGraphWithDagre = vi.fn();

vi.mock("./issue-graph-layout", async (importOriginal) => {
  const actual = await importOriginal<typeof LayoutModule>();
  return {
    ...actual,
    layoutIssueGraph,
    layoutIssueGraphWithDagre,
  };
});

const { useIssueGraphLayout } = await import("./use-issue-graph-layout");

const createLayout = (
  graph: ReturnType<typeof createIssueGraphLayoutFixture>,
  engine: "dagre" | "elk"
): IssueGraphLayoutResult => ({
  edges: graph.edges.map((edge) => ({
    id: edge.id,
    kind: edge.kind,
    sections: [
      {
        bendPoints: [],
        endPoint: { x: 1, y: 1 },
        id: `${edge.id}:section`,
        startPoint: { x: 0, y: 0 },
      },
    ],
    source: edge.source,
    sourcePort: edge.kind === "blocker" ? "blocker-source" : "parent-source",
    target: edge.target,
    targetPort: edge.kind === "blocker" ? "blocker-target" : "parent-target",
  })),
  engine,
  executionTimeMs: 0,
  nodes: graph.nodes.map((node, index) => ({
    height: 104,
    id: node.id,
    position: { x: index * 250, y: 0 },
    width: 240,
  })),
});

describe("useIssueGraphLayout", () => {
  beforeEach(() => {
    layoutIssueGraph.mockReset();
    layoutIssueGraphWithDagre.mockReset();
  });

  it("shows loading, retains a current graph during recomputation, and adopts ELK", async () => {
    const graph = createIssueGraphLayoutFixture();
    const elkLayout = createLayout(graph, "elk");
    let resolveLayout!: (layout: IssueGraphLayoutResult) => void;
    // oxlint-disable-next-line promise/avoid-new
    const layoutPromise = new Promise<IssueGraphLayoutResult>((resolve) => {
      resolveLayout = resolve;
    });
    layoutIssueGraph.mockReturnValue(layoutPromise);
    layoutIssueGraphWithDagre.mockReturnValue(createLayout(graph, "dagre"));

    const { result, rerender } = renderHook(
      ({ currentGraph }) => useIssueGraphLayout(currentGraph),
      { initialProps: { currentGraph: graph } }
    );

    expect(result.current.isLoading).toBeTruthy();
    expect(result.current.layout).toBeNull();

    resolveLayout(elkLayout);
    await waitFor(() => {
      expect(result.current.layout?.engine).toBe("elk");
      expect(result.current.isLoading).toBeFalsy();
    });

    const [firstNode] = graph.nodes;
    if (firstNode === undefined) {
      throw new Error("Expected the graph fixture to contain a node");
    }
    const changedGraph = {
      ...graph,
      nodes: [...graph.nodes, { ...firstNode, id: "bsm-new-node" }],
    };
    const changedDagreLayout = createLayout(changedGraph, "dagre");
    layoutIssueGraphWithDagre.mockReturnValue(changedDagreLayout);
    layoutIssueGraph.mockResolvedValue(createLayout(changedGraph, "elk"));
    rerender({ currentGraph: changedGraph });

    await waitFor(() => {
      expect(result.current.isLoading).toBeTruthy();
      expect(result.current.layout).toBe(changedDagreLayout);
    });
  });

  it("keeps the graph visible with a Dagre fallback when ELK fails", async () => {
    const graph = createIssueGraphLayoutFixture();
    const fallback = createLayout(graph, "dagre");
    layoutIssueGraph.mockRejectedValue(new Error("ELK unavailable"));
    layoutIssueGraphWithDagre.mockReturnValue(fallback);

    const { result } = renderHook(() => useIssueGraphLayout(graph));

    await waitFor(() => {
      expect(result.current.error?.message).toBe("ELK unavailable");
      expect(result.current.isFallback).toBeTruthy();
      expect(result.current.layout).toBe(fallback);
      expect(result.current.layout?.engine).toBe("dagre");
    });
  });
});

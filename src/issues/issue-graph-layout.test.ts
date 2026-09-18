import { describe, expect, it } from "vitest";

import {
  diagnoseIssueGraphLayout,
  layoutIssueGraphWithDagre,
  layoutIssueGraphWithElk,
} from "./issue-graph-layout";
import { createIssueGraphLayoutFixture } from "./issue-graph-layout-fixture";

const geometry = (
  layout: Awaited<ReturnType<typeof layoutIssueGraphWithElk>>
) =>
  layout.nodes.map((node) => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
  }));

describe("issue graph layout", () => {
  it("keeps the Dagre baseline deterministic and diagnoses the fixture", () => {
    const graph = createIssueGraphLayoutFixture();
    const first = layoutIssueGraphWithDagre(graph);
    const second = layoutIssueGraphWithDagre(graph);
    const diagnostics = diagnoseIssueGraphLayout(graph, first);

    expect(geometry(first)).toStrictEqual(geometry(second));
    expect(first.edges).toHaveLength(graph.edges.length);
    expect(diagnostics.nodeOverlaps).toStrictEqual([]);
    expect(diagnostics.duplicateEdgeIds).toStrictEqual([]);
    expect(diagnostics.missingEndpointCount).toBe(1);
    expect(diagnostics.blockerCycles).toStrictEqual([
      ["bsm-fixture-a.2", "bsm-fixture-b.1"],
    ]);
    expect(diagnostics.connectedComponentCount).toBeGreaterThan(1);
  });

  it("lays out both relationship classes with explicit ports and routes", async () => {
    const graph = createIssueGraphLayoutFixture();
    const layout = await layoutIssueGraphWithElk({ graph });
    const diagnostics = diagnoseIssueGraphLayout(graph, layout);

    expect(layout.nodes).toHaveLength(graph.nodes.length);
    expect(layout.edges).toHaveLength(graph.edges.length);
    expect(layout.edges.every((edge) => edge.sections.length > 0)).toBeTruthy();
    expect(layout.edges).toContainEqual(
      expect.objectContaining({
        id: "parent:bsm-fixture-a->bsm-fixture-a.1",
        sourcePort: "parent-source",
        targetPort: "parent-target",
      })
    );
    expect(layout.edges).toContainEqual(
      expect.objectContaining({
        id: "blocker:bsm-fixture-b.1->bsm-fixture-a.1",
        sourcePort: "blocker-source",
        targetPort: "blocker-target",
      })
    );
    expect(diagnostics.nodeOverlaps).toStrictEqual([]);
    expect(diagnostics.duplicateEdgeIds).toStrictEqual([]);
    expect(diagnostics.blockerCycles).toStrictEqual([
      ["bsm-fixture-a.2", "bsm-fixture-b.1"],
    ]);
  });

  it("proves hierarchy-only ELK cannot provide blocker routes", async () => {
    const graph = createIssueGraphLayoutFixture();
    const layout = await layoutIssueGraphWithElk({
      graph,
      includeBlockers: false,
    });

    expect(layout.edges.every((edge) => edge.kind === "parent")).toBeTruthy();
    expect(layout.edges).toHaveLength(
      graph.edges.filter((edge) => edge.kind === "parent").length
    );
  });
});

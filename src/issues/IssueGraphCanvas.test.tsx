import { render } from "@testing-library/react";
import type * as ReactFlowModule from "@xyflow/react";
import type { Viewport } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";

import type { Issue } from "../rpc/bindings";
import { IssueGraphCanvas } from "./IssueGraphCanvas";

const observedReactFlowProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const original = await importOriginal<typeof ReactFlowModule>();
  return {
    ...original,
    ReactFlow: (props: Record<string, unknown>) => {
      observedReactFlowProps.current = props;
      return <div data-testid="react-flow" />;
    },
  };
});

vi.mock("./use-issue-graph-layout", () => ({
  useIssueGraphLayout: () => ({
    error: null,
    isFallback: false,
    isLoading: false,
    layout: {
      edges: [],
      engine: "elk",
      executionTimeMs: 1,
      nodes: [
        {
          height: 104,
          id: "bsm-graph-node",
          position: { x: 0, y: 0 },
          width: 240,
        },
      ],
    },
    layoutGraphKey: "graph-key",
  }),
}));

const issue: Issue = {
  assignee: "",
  blockedBy: [],
  blocks: [],
  closeReason: "",
  closedAt: "",
  comments: [],
  created: "2026-09-20T08:00:00Z",
  deferUntil: "",
  description: "",
  due: "",
  id: "bsm-graph-node",
  labels: [],
  parent: "",
  priority: 2,
  status: "open",
  title: "Viewport regression fixture",
  type: "task",
  updatedAt: "2026-09-20T08:00:00Z",
};

describe(IssueGraphCanvas, () => {
  it("restores the saved viewport without controlling live pan and zoom", () => {
    const handleViewportChange = vi.fn();
    const savedViewport: Viewport = { x: 42, y: -18, zoom: 1.25 };

    render(
      <IssueGraphCanvas
        allIssues={[issue]}
        handleViewportChange={handleViewportChange}
        onIssueSelect={vi.fn()}
        scope="all"
        selectedIssueId={null}
        viewport={savedViewport}
      />
    );

    expect(observedReactFlowProps.current).toMatchObject({
      defaultViewport: savedViewport,
      fitView: false,
      onMoveEnd: expect.any(Function),
    });
    expect(observedReactFlowProps.current).not.toHaveProperty("viewport");
    expect(observedReactFlowProps.current).not.toHaveProperty(
      "onViewportChange"
    );

    const movedViewport: Viewport = { x: 80, y: 40, zoom: 0.75 };
    const onMoveEnd = observedReactFlowProps.current?.onMoveEnd;
    if (typeof onMoveEnd !== "function") {
      throw new TypeError("React Flow onMoveEnd callback was not configured");
    }
    onMoveEnd(null, movedViewport);

    expect(handleViewportChange).toHaveBeenCalledWith(movedViewport);
  });
});

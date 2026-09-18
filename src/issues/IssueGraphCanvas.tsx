import { graphlib, layout } from "@dagrejs/dagre";
import {
  BaseEdge,
  Background,
  Controls,
  getSmoothStepPath,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
} from "@xyflow/react";
import type {
  Edge,
  EdgeProps,
  EdgeTypes,
  Node,
  NodeProps,
  NodeTypes,
} from "@xyflow/react";
import { useMemo } from "react";

import type { Issue } from "../rpc/bindings";
import { buildFocusedIssueGraph } from "./issue-graph";
import type { FocusedIssueGraph, IssueGraphEdgeKind } from "./issue-graph";

import "@xyflow/react/dist/style.css";

const GRAPH_NODE_WIDTH = 240;
const GRAPH_NODE_HEIGHT = 104;
const GRAPH_COMPONENT_GAP = 72;
const GRAPH_LAYOUT_ROW_WIDTH = 1000;

interface IssueCardData extends Record<string, unknown> {
  issue: Issue;
  parentId: string | null;
}

type IssueCardNode = Node<IssueCardData, "issue">;
type IssueFlowEdge = Edge<{ kind: IssueGraphEdgeKind }, "blocker" | "default">;

const IssueCard = ({ data }: NodeProps<IssueCardNode>) => (
  <div className="relative w-[240px]">
    <Handle
      aria-hidden="true"
      className="bg-muted! border-none!"
      id="parent-target"
      isConnectable={false}
      position={Position.Top}
      type="target"
    />
    <Handle
      aria-hidden="true"
      className="bg-danger! border-none! opacity-0"
      id="blocker-target"
      isConnectable={false}
      position={Position.Left}
      type="target"
    />
    <button
      aria-label={`${data.issue.id}: ${data.issue.title}. Status: ${data.issue.status.replace(
        "_",
        " "
      )}${data.parentId === null ? ". Root Issue." : `. Parent: ${data.parentId}`}`}
      className="border-border-main bg-surface min-h-[104px] w-full rounded-lg border p-3 shadow-lg"
      data-issue-card-id={data.issue.id}
      type="button"
    >
      <div className="text-muted font-mono text-[11px]">{data.issue.id}</div>
      <span className="text-text-main mt-1 block text-left text-sm font-medium">
        {data.issue.title}
      </span>
      <div className="text-muted mt-2 text-[11px] capitalize">
        {data.issue.status.replace("_", " ")}
      </div>
    </button>
    <Handle
      aria-hidden="true"
      className="bg-muted! border-none!"
      id="parent-source"
      isConnectable={false}
      position={Position.Bottom}
      type="source"
    />
    <Handle
      aria-hidden="true"
      className="bg-danger! border-none! opacity-0"
      id="blocker-source"
      isConnectable={false}
      position={Position.Right}
      type="source"
    />
  </div>
);

const NODE_TYPES: NodeTypes = {
  issue: IssueCard,
};

const BlockerEdge = ({
  markerEnd,
  source,
  sourcePosition,
  sourceX,
  sourceY,
  style,
  target,
  targetPosition,
  targetX,
  targetY,
}: EdgeProps<IssueFlowEdge>) => {
  const [path] = getSmoothStepPath({
    borderRadius: 16,
    offset: 24,
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  });
  return (
    <BaseEdge
      aria-label={`Blocker relationship: ${source} blocks ${target}`}
      markerEnd={markerEnd}
      path={path}
      style={style}
    />
  );
};

const EDGE_TYPES: EdgeTypes = {
  blocker: BlockerEdge,
};

interface ParentComponentLayout {
  height: number;
  nodePositions: Map<string, { x: number; y: number }>;
  width: number;
}

const createParentComponentLayouts = (
  graph: FocusedIssueGraph
): ParentComponentLayout[] => {
  const parentEdges = graph.edges.filter((edge) => edge.kind === "parent");
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of parentEdges) {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }

  const unvisitedIds = new Set(graph.nodes.map((node) => node.id));
  const componentLayouts: ParentComponentLayout[] = [];
  for (const graphNode of graph.nodes) {
    if (!unvisitedIds.has(graphNode.id)) {
      continue;
    }

    const componentIds: string[] = [];
    const pendingIds = [graphNode.id];
    unvisitedIds.delete(graphNode.id);
    let pendingIndex = 0;
    while (pendingIndex < pendingIds.length) {
      const currentId = pendingIds[pendingIndex];
      pendingIndex += 1;
      componentIds.push(currentId);
      for (const neighborId of adjacency.get(currentId) ?? []) {
        if (unvisitedIds.has(neighborId)) {
          unvisitedIds.delete(neighborId);
          pendingIds.push(neighborId);
        }
      }
    }

    const componentIdSet = new Set(componentIds);
    const dagreGraph = new graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({
      nodesep: 32,
      rankdir: "TB",
      ranksep: 64,
    });
    for (const id of componentIds) {
      dagreGraph.setNode(id, {
        height: GRAPH_NODE_HEIGHT,
        width: GRAPH_NODE_WIDTH,
      });
    }
    for (const edge of parentEdges) {
      if (componentIdSet.has(edge.source) && componentIdSet.has(edge.target)) {
        dagreGraph.setEdge(edge.source, edge.target);
      }
    }
    layout(dagreGraph);

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const absolutePositions = new Map<string, { x: number; y: number }>();
    for (const id of componentIds) {
      const position = dagreGraph.node(id);
      const x = position.x - GRAPH_NODE_WIDTH / 2;
      const y = position.y - GRAPH_NODE_HEIGHT / 2;
      absolutePositions.set(id, { x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + GRAPH_NODE_WIDTH);
      maxY = Math.max(maxY, y + GRAPH_NODE_HEIGHT);
    }

    const nodePositions = new Map<string, { x: number; y: number }>();
    for (const [id, position] of absolutePositions) {
      nodePositions.set(id, {
        x: position.x - minX,
        y: position.y - minY,
      });
    }
    componentLayouts.push({
      height: maxY - minY,
      nodePositions,
      width: maxX - minX,
    });
  }

  return componentLayouts;
};

const packParentComponentLayouts = (
  componentLayouts: ParentComponentLayout[]
): Map<string, { x: number; y: number }> => {
  const nodePositions = new Map<string, { x: number; y: number }>();
  let rowHeight = 0;
  let rowX = 0;
  let rowY = 0;
  for (const component of componentLayouts) {
    const startsNewRow =
      rowX > 0 && rowX + component.width > GRAPH_LAYOUT_ROW_WIDTH;
    if (startsNewRow) {
      rowX = 0;
      rowY += rowHeight + GRAPH_COMPONENT_GAP;
      rowHeight = 0;
    }

    for (const [id, position] of component.nodePositions) {
      nodePositions.set(id, {
        x: rowX + position.x,
        y: rowY + position.y,
      });
    }
    rowX += component.width + GRAPH_COMPONENT_GAP;
    rowHeight = Math.max(rowHeight, component.height);
  }
  return nodePositions;
};

const layoutFocusedGraph = (
  graph: FocusedIssueGraph
): { edges: IssueFlowEdge[]; nodes: IssueCardNode[] } => {
  const componentLayouts = createParentComponentLayouts(graph);
  const nodePositions = packParentComponentLayouts(componentLayouts);

  const nodes = graph.nodes.map((node) => {
    const position = nodePositions.get(node.id) ?? { x: 0, y: 0 };
    return {
      data: { issue: node.issue, parentId: node.parentId },
      id: node.id,
      position: {
        x: position.x,
        y: position.y,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      type: "issue" as const,
    };
  });
  const edges = graph.edges.map((edge) => ({
    className: edge.kind === "blocker" ? "beadsmith-blocker-edge" : undefined,
    data: { kind: edge.kind },
    id: edge.id,
    markerEnd: { type: MarkerType.ArrowClosed },
    source: edge.source,
    sourceHandle: edge.kind === "blocker" ? "blocker-source" : "parent-source",
    style:
      edge.kind === "blocker"
        ? {
            stroke: "var(--color-danger)",
            strokeDasharray: "6 4",
            strokeWidth: 2,
          }
        : { stroke: "var(--color-muted)", strokeWidth: 1.5 },
    target: edge.target,
    targetHandle: edge.kind === "blocker" ? "blocker-target" : "parent-target",
    type: edge.kind === "blocker" ? ("blocker" as const) : ("default" as const),
  }));

  return { edges, nodes };
};

export const IssueGraphCanvas = ({
  allIssues,
  selectedIssueId,
}: {
  allIssues: Issue[];
  selectedIssueId: string | null;
}) => {
  const graph = useMemo(
    () => buildFocusedIssueGraph({ allIssues, selectedIssueId }),
    [allIssues, selectedIssueId]
  );
  const flowGraph = useMemo(() => layoutFocusedGraph(graph), [graph]);

  if (graph.nodes.length === 0) {
    return (
      <div
        aria-label="Focused graph is empty"
        className="text-muted flex flex-1 items-center justify-center p-8 text-center text-sm"
        data-focused-graph-empty="true"
      >
        <div>
          <h2 className="text-text-main font-medium">Focused graph is empty</h2>
          <p className="mt-1 text-xs">
            Focused Graph includes current work and the selected Issue.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      aria-label="Focused Issue Graph canvas"
      className="relative min-h-0 flex-1"
      data-focused-graph="true"
    >
      <ReactFlow
        aria-label="Focused Issue Graph"
        nodes={flowGraph.nodes}
        edges={flowGraph.edges}
        fitView
        edgeTypes={EDGE_TYPES}
        fitViewOptions={{ padding: 0.18 }}
        maxZoom={1.5}
        minZoom={0.25}
        nodesConnectable={false}
        nodesDraggable={false}
        nodeTypes={NODE_TYPES}
        panOnDrag
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        <Panel position="top-left">
          <div
            aria-label="Graph relationship legend"
            className="border-border-main bg-surface text-muted flex gap-3 rounded border px-2 py-1 text-[11px]"
          >
            <span
              className="flex items-center gap-1.5"
              data-graph-edge-kind="parent"
            >
              <span aria-hidden="true" className="bg-muted h-px w-4" />
              Parent → child
            </span>
            <span
              className="flex items-center gap-1.5"
              data-graph-edge-kind="blocker"
            >
              <span
                aria-hidden="true"
                className="border-danger w-4 border-t-2 border-dashed"
              />
              Blocker → blocked
            </span>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
};

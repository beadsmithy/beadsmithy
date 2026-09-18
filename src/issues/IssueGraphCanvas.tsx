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
import { layoutIssueGraphWithDagre } from "./issue-graph-layout";

import "@xyflow/react/dist/style.css";

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

const layoutFocusedGraph = (
  graph: FocusedIssueGraph
): { edges: IssueFlowEdge[]; nodes: IssueCardNode[] } => {
  const layout = layoutIssueGraphWithDagre(graph);
  const layoutNodeById = new Map(layout.nodes.map((node) => [node.id, node]));

  const nodes = graph.nodes.map((node) => {
    const position = layoutNodeById.get(node.id)?.position ?? { x: 0, y: 0 };
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
  const edges = layout.edges.map((edge) => ({
    className: edge.kind === "blocker" ? "beadsmith-blocker-edge" : undefined,
    data: { kind: edge.kind },
    id: edge.id,
    markerEnd: { type: MarkerType.ArrowClosed },
    source: edge.source,
    sourceHandle: edge.sourcePort,
    style:
      edge.kind === "blocker"
        ? {
            stroke: "var(--color-danger)",
            strokeDasharray: "6 4",
            strokeWidth: 2,
          }
        : { stroke: "var(--color-muted)", strokeWidth: 1.5 },
    target: edge.target,
    targetHandle: edge.targetPort,
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

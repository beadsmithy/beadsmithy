import { graphlib, layout } from "@dagrejs/dagre";
import {
  BaseEdge,
  Background,
  Controls,
  getStraightPath,
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

interface IssueCardData extends Record<string, unknown> {
  issue: Issue;
  parentId: string | null;
}

type IssueCardNode = Node<IssueCardData, "issue">;
type IssueFlowEdge = Edge<{ kind: IssueGraphEdgeKind }, "blocker" | "default">;

const IssueCard = ({ data }: NodeProps<IssueCardNode>) => (
  <div className="relative">
    <Handle
      aria-hidden="true"
      className="bg-muted! border-none!"
      isConnectable={false}
      position={Position.Top}
      type="target"
    />
    <button
      aria-label={`${data.issue.id}: ${data.issue.title}. Status: ${data.issue.status.replace(
        "_",
        " "
      )}${data.parentId === null ? ". Root Issue." : `. Parent: ${data.parentId}`}`}
      className="border-border-main bg-surface min-w-[220px] rounded-lg border p-3 shadow-lg"
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
      isConnectable={false}
      position={Position.Bottom}
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
  sourceX,
  sourceY,
  style,
  target,
  targetX,
  targetY,
}: EdgeProps<IssueFlowEdge>) => {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
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
  const dagreGraph = new graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    nodesep: 48,
    rankdir: "TB",
    ranksep: 88,
  });

  for (const node of graph.nodes) {
    dagreGraph.setNode(node.id, {
      height: GRAPH_NODE_HEIGHT,
      width: GRAPH_NODE_WIDTH,
    });
  }
  for (const graphEdge of graph.edges.filter(
    (candidateEdge) => candidateEdge.kind === "parent"
  )) {
    dagreGraph.setEdge(graphEdge.source, graphEdge.target);
  }
  layout(dagreGraph);

  const nodes = graph.nodes.map((node) => {
    const position = dagreGraph.node(node.id);
    return {
      data: { issue: node.issue, parentId: node.parentId },
      id: node.id,
      position: {
        x: position.x - GRAPH_NODE_WIDTH / 2,
        y: position.y - GRAPH_NODE_HEIGHT / 2,
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
    style:
      edge.kind === "blocker"
        ? { stroke: "var(--color-danger)", strokeDasharray: "6 4" }
        : undefined,
    target: edge.target,
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
            <span data-graph-edge-kind="parent">Parent → child</span>
            <span data-graph-edge-kind="blocker">Blocker → blocked</span>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
};

import {
  BaseEdge,
  Background,
  Controls,
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
import type {
  IssueGraphLayoutSection,
  IssueGraphLayoutResult,
} from "./issue-graph-layout";
import { useIssueGraphLayout } from "./use-issue-graph-layout";

import "@xyflow/react/dist/style.css";

interface IssueCardData extends Record<string, unknown> {
  issue: Issue;
  isSelected: boolean;
  onSelectIssue: (issueId: string) => void;
  parentId: string | null;
}

type IssueCardNode = Node<IssueCardData, "issue">;
interface IssueFlowEdgeData extends Record<string, unknown> {
  kind: IssueGraphEdgeKind;
  sections: IssueGraphLayoutSection[];
}

type IssueFlowEdge = Edge<IssueFlowEdgeData, "issue">;

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
      className={`border-border-main bg-surface min-h-[104px] w-full rounded-lg border p-3 shadow-lg ${data.isSelected ? "ring-accent ring-2" : ""}`}
      data-issue-card-id={data.issue.id}
      data-selected={data.isSelected ? "true" : "false"}
      onClick={() => data.onSelectIssue(data.issue.id)}
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

const createOrthogonalPath = (
  sections: IssueGraphLayoutSection[],
  fallbackStart: { x: number; y: number },
  fallbackEnd: { x: number; y: number }
): string => {
  const points = sections.flatMap((section) => [
    section.startPoint,
    ...section.bendPoints,
    section.endPoint,
  ]);
  const distinctPoints = points.filter((point, index) => {
    const [previousPoint] = points.slice(index - 1, index);
    return (
      index === 0 ||
      point.x !== previousPoint?.x ||
      point.y !== previousPoint?.y
    );
  });
  const [firstPoint] = distinctPoints;
  if (firstPoint === undefined) {
    return `M ${fallbackStart.x} ${fallbackStart.y} L ${fallbackEnd.x} ${fallbackEnd.y}`;
  }
  let path = `M ${firstPoint.x} ${firstPoint.y}`;
  for (const point of distinctPoints.slice(1)) {
    path += ` L ${point.x} ${point.y}`;
  }
  return path;
};

const IssueGraphEdge = ({
  data,
  markerEnd,
  source,
  sourceX,
  sourceY,
  style,
  target,
  targetX,
  targetY,
}: EdgeProps<IssueFlowEdge>) => (
  <BaseEdge
    aria-label={`${data?.kind === "blocker" ? "Blocker" : "Parent"} relationship: ${source} to ${target}`}
    markerEnd={markerEnd}
    path={createOrthogonalPath(
      data?.sections ?? [],
      { x: sourceX, y: sourceY },
      { x: targetX, y: targetY }
    )}
    style={style}
  />
);

const EDGE_TYPES: EdgeTypes = {
  issue: IssueGraphEdge,
};

const layoutFocusedGraph = (
  graph: FocusedIssueGraph,
  layout: IssueGraphLayoutResult,
  onSelectIssue: (issueId: string) => void,
  selectedIssueId: string | null
): { edges: IssueFlowEdge[]; nodes: IssueCardNode[] } => {
  const layoutNodeById = new Map(layout.nodes.map((node) => [node.id, node]));

  const nodes = graph.nodes.map((node) => {
    const position = layoutNodeById.get(node.id)?.position ?? { x: 0, y: 0 };
    return {
      data: {
        isSelected: node.id === selectedIssueId,
        issue: node.issue,
        onSelectIssue,
        parentId: node.parentId,
      },
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
    data: { kind: edge.kind, sections: edge.sections },
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
    type: "issue" as const,
  }));

  return { edges, nodes };
};

export const IssueGraphCanvas = ({
  allIssues,
  onIssueSelect,
  selectedIssueId,
}: {
  allIssues: Issue[];
  onIssueSelect: (issueId: string) => void;
  selectedIssueId: string | null;
}) => {
  const graph = useMemo(
    () => buildFocusedIssueGraph({ allIssues, selectedIssueId }),
    [allIssues, selectedIssueId]
  );
  const layoutState = useIssueGraphLayout(graph);
  const flowGraph = useMemo(
    () =>
      layoutState.layout === null
        ? null
        : layoutFocusedGraph(
            graph,
            layoutState.layout,
            onIssueSelect,
            selectedIssueId
          ),
    [graph, layoutState.layout, onIssueSelect, selectedIssueId]
  );

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

  if (flowGraph === null) {
    return (
      <div
        aria-label="Focused Issue Graph canvas"
        className="relative flex min-h-0 flex-1 items-center justify-center"
        data-focused-graph="true"
        data-graph-layout-state="loading"
      >
        <div className="text-muted text-center text-sm">
          <p className="text-text-main font-medium">Arranging issue graph</p>
          <p className="mt-1 text-xs">Calculating relationship routes…</p>
        </div>
      </div>
    );
  }

  const { layout } = layoutState;
  if (layout === null) {
    return null;
  }

  return (
    <div
      aria-label="Focused Issue Graph canvas"
      className="relative min-h-0 flex-1"
      data-focused-graph="true"
      data-graph-layout-engine={layout.engine}
      data-graph-layout-fallback={layoutState.isFallback ? "true" : undefined}
      data-graph-layout-state={layoutState.isLoading ? "loading" : "ready"}
    >
      {layoutState.error === null ? null : (
        <output
          aria-live="assertive"
          className="border-danger/40 bg-danger/10 text-danger absolute inset-x-4 top-4 z-10 rounded border px-3 py-2 text-xs"
          data-graph-layout-error="true"
          role="alert"
        >
          Graph layout failed; showing the deterministic Dagre fallback. ELK
          will retry when the graph changes.
        </output>
      )}
      {layoutState.isLoading ? (
        <output
          aria-live="polite"
          className="bg-surface/90 text-muted absolute bottom-4 left-4 z-10 rounded border px-3 py-2 text-xs shadow"
          data-graph-layout-loading="true"
        >
          Refreshing graph layout…
        </output>
      ) : null}
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

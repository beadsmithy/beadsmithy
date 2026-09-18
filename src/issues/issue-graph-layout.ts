import { graphlib, layout as dagreLayout } from "@dagrejs/dagre";
import type { ElkEdgeSection, ElkNode, ElkPort } from "elkjs/lib/elk-api.js";

import type {
  FocusedIssueGraph,
  IssueGraphEdge,
  IssueGraphEdgeKind,
} from "./issue-graph";

export const ISSUE_GRAPH_NODE_WIDTH = 240;
export const ISSUE_GRAPH_NODE_HEIGHT = 104;

const GRAPH_COMPONENT_GAP = 72;
const GRAPH_LAYOUT_ROW_WIDTH = 1000;

export type IssueGraphLayoutEngine = "dagre" | "elk";

export interface IssueGraphLayoutPoint {
  x: number;
  y: number;
}

export interface IssueGraphLayoutSection {
  bendPoints: IssueGraphLayoutPoint[];
  endPoint: IssueGraphLayoutPoint;
  id: string;
  startPoint: IssueGraphLayoutPoint;
}

export interface IssueGraphLayoutNode {
  height: number;
  id: string;
  position: IssueGraphLayoutPoint;
  width: number;
}

export interface IssueGraphLayoutEdge {
  id: string;
  kind: IssueGraphEdgeKind;
  sections: IssueGraphLayoutSection[];
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface IssueGraphLayoutResult {
  edges: IssueGraphLayoutEdge[];
  engine: IssueGraphLayoutEngine;
  executionTimeMs: number;
  nodes: IssueGraphLayoutNode[];
}

interface ParentComponentLayout {
  height: number;
  nodePositions: Map<string, IssueGraphLayoutPoint>;
  width: number;
}

interface LayoutNodeBounds {
  height: number;
  position: IssueGraphLayoutPoint;
  width: number;
}

interface LayoutPortNames {
  source: string;
  target: string;
}

interface ElkLayoutOutput extends ElkNode {
  logging?: {
    executionTime?: number;
  };
}

const getPortNames = (kind: IssueGraphEdgeKind): LayoutPortNames =>
  kind === "blocker"
    ? { source: "blocker-source", target: "blocker-target" }
    : { source: "parent-source", target: "parent-target" };

const getPortPoint = (
  node: LayoutNodeBounds,
  port: string
): IssueGraphLayoutPoint => {
  if (port === "parent-source") {
    return {
      x: node.position.x + node.width / 2,
      y: node.position.y + node.height,
    };
  }
  if (port === "blocker-source") {
    return {
      x: node.position.x + node.width,
      y: node.position.y + node.height / 2,
    };
  }
  if (port === "blocker-target") {
    return {
      x: node.position.x,
      y: node.position.y + node.height / 2,
    };
  }
  return {
    x: node.position.x + node.width / 2,
    y: node.position.y,
  };
};

const createOrthogonalSection = (
  edge: IssueGraphEdge,
  source: LayoutNodeBounds,
  target: LayoutNodeBounds
): IssueGraphLayoutSection => {
  const ports = getPortNames(edge.kind);
  const startPoint = getPortPoint(source, ports.source);
  const endPoint = getPortPoint(target, ports.target);

  if (edge.kind === "parent") {
    const middleY = (startPoint.y + endPoint.y) / 2;
    return {
      bendPoints:
        startPoint.x === endPoint.x
          ? []
          : [
              { x: startPoint.x, y: middleY },
              { x: endPoint.x, y: middleY },
            ],
      endPoint,
      id: `${edge.id}:section`,
      startPoint,
    };
  }

  const middleX = (startPoint.x + endPoint.x) / 2;
  return {
    bendPoints:
      startPoint.y === endPoint.y
        ? []
        : [
            { x: middleX, y: startPoint.y },
            { x: middleX, y: endPoint.y },
          ],
    endPoint,
    id: `${edge.id}:section`,
    startPoint,
  };
};

const createLayoutEdges = (
  graph: FocusedIssueGraph,
  nodeBounds: Map<string, LayoutNodeBounds>,
  sectionForEdge: (
    edge: IssueGraphEdge,
    source: LayoutNodeBounds,
    target: LayoutNodeBounds
  ) => IssueGraphLayoutSection
): IssueGraphLayoutEdge[] => {
  const edges: IssueGraphLayoutEdge[] = [];
  for (const edge of graph.edges) {
    const source = nodeBounds.get(edge.source);
    const target = nodeBounds.get(edge.target);
    if (source === undefined || target === undefined) {
      continue;
    }
    const ports = getPortNames(edge.kind);
    edges.push({
      id: edge.id,
      kind: edge.kind,
      sections: [sectionForEdge(edge, source, target)],
      source: edge.source,
      sourcePort: ports.source,
      target: edge.target,
      targetPort: ports.target,
    });
  }
  return edges;
};

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
        height: ISSUE_GRAPH_NODE_HEIGHT,
        width: ISSUE_GRAPH_NODE_WIDTH,
      });
    }
    for (const edge of parentEdges) {
      if (componentIdSet.has(edge.source) && componentIdSet.has(edge.target)) {
        dagreGraph.setEdge(edge.source, edge.target);
      }
    }
    dagreLayout(dagreGraph);

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const absolutePositions = new Map<string, IssueGraphLayoutPoint>();
    for (const id of componentIds) {
      const position = dagreGraph.node(id);
      const x = position.x - ISSUE_GRAPH_NODE_WIDTH / 2;
      const y = position.y - ISSUE_GRAPH_NODE_HEIGHT / 2;
      absolutePositions.set(id, { x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + ISSUE_GRAPH_NODE_WIDTH);
      maxY = Math.max(maxY, y + ISSUE_GRAPH_NODE_HEIGHT);
    }

    const nodePositions = new Map<string, IssueGraphLayoutPoint>();
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
): Map<string, IssueGraphLayoutPoint> => {
  const nodePositions = new Map<string, IssueGraphLayoutPoint>();
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

export const layoutIssueGraphWithDagre = (
  graph: FocusedIssueGraph
): IssueGraphLayoutResult => {
  const startedAt = performance.now();
  const nodePositions = packParentComponentLayouts(
    createParentComponentLayouts(graph)
  );
  const nodes = graph.nodes.map((node) => ({
    height: ISSUE_GRAPH_NODE_HEIGHT,
    id: node.id,
    position: nodePositions.get(node.id) ?? { x: 0, y: 0 },
    width: ISSUE_GRAPH_NODE_WIDTH,
  }));
  const nodeBounds = new Map<string, LayoutNodeBounds>(
    nodes.map((node) => [node.id, node])
  );

  return {
    edges: createLayoutEdges(graph, nodeBounds, createOrthogonalSection),
    engine: "dagre",
    executionTimeMs: performance.now() - startedAt,
    nodes,
  };
};

const createElkPort = (
  nodeId: string,
  id: string,
  side: "EAST" | "NORTH" | "SOUTH" | "WEST"
): ElkPort => ({
  height: 1,
  id: `${nodeId}:${id}`,
  layoutOptions: { "elk.port.side": side },
  width: 1,
});

const createElkGraph = (
  graph: FocusedIssueGraph,
  includeBlockers: boolean
): ElkNode => {
  const edges = graph.edges.filter(
    (edge) => includeBlockers || edge.kind === "parent"
  );
  return {
    children: graph.nodes.map((node) => ({
      height: ISSUE_GRAPH_NODE_HEIGHT,
      id: node.id,
      layoutOptions: { "elk.portConstraints": "FIXED_ORDER" },
      ports: [
        createElkPort(node.id, "parent-target", "NORTH"),
        createElkPort(node.id, "blocker-target", "WEST"),
        createElkPort(node.id, "parent-source", "SOUTH"),
        createElkPort(node.id, "blocker-source", "EAST"),
      ],
      width: ISSUE_GRAPH_NODE_WIDTH,
    })),
    edges: edges.map((edge) => {
      const ports = getPortNames(edge.kind);
      return {
        id: edge.id,
        sources: [`${edge.source}:${ports.source}`],
        targets: [`${edge.target}:${ports.target}`],
      };
    }),
    id: "issue-graph",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.spacing.edgeNodeBetweenLayers": "32",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.separateConnectedComponents": "true",
      "elk.spacing.edgeEdge": "24",
      "elk.spacing.edgeNode": "32",
      "elk.spacing.nodeNode": "48",
    },
  };
};

const shiftPoint = (
  point: IssueGraphLayoutPoint,
  shift: IssueGraphLayoutPoint
): IssueGraphLayoutPoint => ({
  x: point.x - shift.x,
  y: point.y - shift.y,
});

const convertElkSection = (
  section: ElkEdgeSection,
  shift: IssueGraphLayoutPoint
): IssueGraphLayoutSection => ({
  bendPoints: (section.bendPoints ?? []).map((point) =>
    shiftPoint(point, shift)
  ),
  endPoint: shiftPoint(section.endPoint, shift),
  id: section.id,
  startPoint: shiftPoint(section.startPoint, shift),
});

export const layoutIssueGraphWithElk = async ({
  graph,
  includeBlockers = true,
}: {
  graph: FocusedIssueGraph;
  includeBlockers?: boolean;
}): Promise<IssueGraphLayoutResult> => {
  const startedAt = performance.now();
  const { default: ElkConstructor } = await import("elkjs/lib/elk.bundled.js");
  const elk = new ElkConstructor();
  const output = (await elk.layout(createElkGraph(graph, includeBlockers), {
    measureExecutionTime: true,
  })) as ElkLayoutOutput;
  const laidOutNodes = output.children ?? [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const node of laidOutNodes) {
    minX = Math.min(minX, node.x ?? 0);
    minY = Math.min(minY, node.y ?? 0);
  }
  const shift = {
    x: Number.isFinite(minX) ? minX : 0,
    y: Number.isFinite(minY) ? minY : 0,
  };
  const nodes = laidOutNodes.map((node) => ({
    height: node.height ?? ISSUE_GRAPH_NODE_HEIGHT,
    id: node.id,
    position: shiftPoint({ x: node.x ?? 0, y: node.y ?? 0 }, shift),
    width: node.width ?? ISSUE_GRAPH_NODE_WIDTH,
  }));
  const edges = (output.edges ?? []).flatMap((edge) => {
    const source = graph.edges.find((candidate) => candidate.id === edge.id);
    if (source === undefined) {
      return [];
    }
    const ports = getPortNames(source.kind);
    return [
      {
        id: source.id,
        kind: source.kind,
        sections: (edge.sections ?? []).map((section) =>
          convertElkSection(section, shift)
        ),
        source: source.source,
        sourcePort: ports.source,
        target: source.target,
        targetPort: ports.target,
      },
    ];
  });

  return {
    edges,
    engine: "elk",
    executionTimeMs:
      (output.logging?.executionTime ?? 0) * 1000 ||
      performance.now() - startedAt,
    nodes,
  };
};

export const layoutIssueGraph = ({
  engine,
  graph,
}: {
  engine: IssueGraphLayoutEngine;
  graph: FocusedIssueGraph;
}): Promise<IssueGraphLayoutResult> =>
  engine === "elk"
    ? layoutIssueGraphWithElk({ graph })
    : Promise.resolve(layoutIssueGraphWithDagre(graph));

const rectangleContainsSegment = (
  start: IssueGraphLayoutPoint,
  end: IssueGraphLayoutPoint,
  node: IssueGraphLayoutNode
): boolean => {
  const left = node.position.x;
  const right = left + node.width;
  const top = node.position.y;
  const bottom = top + node.height;
  if (start.x === end.x) {
    return (
      start.x > left &&
      start.x < right &&
      Math.max(Math.min(start.y, end.y), top) <
        Math.min(Math.max(start.y, end.y), bottom)
    );
  }
  if (start.y === end.y) {
    return (
      start.y > top &&
      start.y < bottom &&
      Math.max(Math.min(start.x, end.x), left) <
        Math.min(Math.max(start.x, end.x), right)
    );
  }
  return false;
};

const sectionPoints = (
  section: IssueGraphLayoutSection
): IssueGraphLayoutPoint[] => [
  section.startPoint,
  ...section.bendPoints,
  section.endPoint,
];

const findBlockerCycles = (graph: FocusedIssueGraph): string[][] => {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (edge.kind === "blocker") {
      adjacency.get(edge.source)?.push(edge.target);
    }
  }

  const indexById = new Map<string, number>();
  const lowLinkById = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;
  const visit = (id: string): void => {
    indexById.set(id, nextIndex);
    lowLinkById.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);
    for (const neighbor of adjacency.get(id) ?? []) {
      if (!indexById.has(neighbor)) {
        visit(neighbor);
        lowLinkById.set(
          id,
          Math.min(lowLinkById.get(id) ?? 0, lowLinkById.get(neighbor) ?? 0)
        );
      } else if (onStack.has(neighbor)) {
        lowLinkById.set(
          id,
          Math.min(lowLinkById.get(id) ?? 0, indexById.get(neighbor) ?? 0)
        );
      }
    }
    if (lowLinkById.get(id) !== indexById.get(id)) {
      return;
    }
    const component: string[] = [];
    let member = "";
    while (member !== id) {
      member = stack.pop() ?? "";
      onStack.delete(member);
      component.push(member);
    }
    if (component.length > 1 || adjacency.get(id)?.includes(id)) {
      // oxlint-disable-next-line unicorn(no-array-sort)
      component.sort((left, right) => left.localeCompare(right));
      components.push(component);
    }
  };

  for (const node of graph.nodes) {
    if (!indexById.has(node.id)) {
      visit(node.id);
    }
  }
  // oxlint-disable-next-line unicorn(no-array-sort)
  components.sort((left, right) =>
    left.join("\0").localeCompare(right.join("\0"))
  );
  return components;
};

const countConnectedComponents = (graph: FocusedIssueGraph): number => {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }
  const remaining = new Set(graph.nodes.map((node) => node.id));
  let count = 0;
  while (remaining.size > 0) {
    const [first] = remaining;
    if (first === undefined) {
      break;
    }
    count += 1;
    const pending = [first];
    remaining.delete(first);
    for (const current of pending) {
      for (const neighbor of adjacency.get(current) ?? []) {
        if (remaining.has(neighbor)) {
          remaining.delete(neighbor);
          pending.push(neighbor);
        }
      }
    }
  }
  return count;
};

export interface IssueGraphLayoutDiagnostics {
  blockerCycles: string[][];
  connectedComponentCount: number;
  duplicateEdgeIds: string[];
  edgeCrossingCount: number;
  edgeThroughNode: { edgeId: string; nodeId: string }[];
  missingEndpointCount: number;
  nodeOverlaps: { leftNodeId: string; rightNodeId: string }[];
}

const segmentsCross = (
  leftStart: IssueGraphLayoutPoint,
  leftEnd: IssueGraphLayoutPoint,
  rightStart: IssueGraphLayoutPoint,
  rightEnd: IssueGraphLayoutPoint
): boolean => {
  const leftHorizontal = leftStart.y === leftEnd.y;
  const rightHorizontal = rightStart.y === rightEnd.y;
  if (leftHorizontal === rightHorizontal) {
    return false;
  }
  const horizontal = leftHorizontal
    ? { end: leftEnd, start: leftStart }
    : { end: rightEnd, start: rightStart };
  const vertical = leftHorizontal
    ? { end: rightEnd, start: rightStart }
    : { end: leftEnd, start: leftStart };
  const horizontalLeft = Math.min(horizontal.start.x, horizontal.end.x);
  const horizontalRight = Math.max(horizontal.start.x, horizontal.end.x);
  const verticalTop = Math.min(vertical.start.y, vertical.end.y);
  const verticalBottom = Math.max(vertical.start.y, vertical.end.y);
  return (
    vertical.start.x > horizontalLeft &&
    vertical.start.x < horizontalRight &&
    horizontal.start.y > verticalTop &&
    horizontal.start.y < verticalBottom
  );
};

const collectLayoutSegments = (
  layout: IssueGraphLayoutResult
): {
  edgeThroughNodeKeys: Set<string>;
  segmentsByEdge: Map<string, [IssueGraphLayoutPoint, IssueGraphLayoutPoint][]>;
} => {
  const edgeThroughNodeKeys = new Set<string>();
  const segmentsByEdge = new Map<
    string,
    [IssueGraphLayoutPoint, IssueGraphLayoutPoint][]
  >();
  for (const edge of layout.edges) {
    const segments: [IssueGraphLayoutPoint, IssueGraphLayoutPoint][] = [];
    for (const section of edge.sections) {
      const points = sectionPoints(section);
      for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        if (start === undefined || end === undefined) {
          continue;
        }
        segments.push([start, end]);
        for (const node of layout.nodes) {
          const isEndpoint = node.id === edge.source || node.id === edge.target;
          if (!isEndpoint && rectangleContainsSegment(start, end, node)) {
            edgeThroughNodeKeys.add(`${edge.id}\0${node.id}`);
          }
        }
      }
    }
    segmentsByEdge.set(edge.id, segments);
  }
  return { edgeThroughNodeKeys, segmentsByEdge };
};

const countLayoutEdgeCrossings = (
  layout: IssueGraphLayoutResult,
  segmentsByEdge: Map<string, [IssueGraphLayoutPoint, IssueGraphLayoutPoint][]>
): number => {
  const edgeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const segmentEntries = [...segmentsByEdge.entries()];
  let edgeCrossingCount = 0;
  for (let index = 0; index < segmentEntries.length; index += 1) {
    const leftEntry = segmentEntries[index];
    if (leftEntry === undefined) {
      continue;
    }
    const [leftEdgeId, leftSegments] = leftEntry;
    const leftEdge = edgeById.get(leftEdgeId);
    if (leftEdge === undefined) {
      continue;
    }
    for (const [rightEdgeId, rightSegments] of segmentEntries.slice(
      index + 1
    )) {
      const rightEdge = edgeById.get(rightEdgeId);
      if (
        rightEdge === undefined ||
        leftEdge.source === rightEdge.source ||
        leftEdge.source === rightEdge.target ||
        leftEdge.target === rightEdge.source ||
        leftEdge.target === rightEdge.target
      ) {
        continue;
      }
      for (const [leftStart, leftEnd] of leftSegments) {
        for (const [rightStart, rightEnd] of rightSegments) {
          if (segmentsCross(leftStart, leftEnd, rightStart, rightEnd)) {
            edgeCrossingCount += 1;
          }
        }
      }
    }
  }
  return edgeCrossingCount;
};

export const diagnoseIssueGraphLayout = (
  graph: FocusedIssueGraph,
  layout: IssueGraphLayoutResult
): IssueGraphLayoutDiagnostics => {
  const nodeOverlaps: IssueGraphLayoutDiagnostics["nodeOverlaps"] = [];
  for (let index = 0; index < layout.nodes.length; index += 1) {
    const left = layout.nodes[index];
    if (left === undefined) {
      continue;
    }
    for (const right of layout.nodes.slice(index + 1)) {
      if (
        left.position.x < right.position.x + right.width &&
        left.position.x + left.width > right.position.x &&
        left.position.y < right.position.y + right.height &&
        left.position.y + left.height > right.position.y
      ) {
        nodeOverlaps.push({ leftNodeId: left.id, rightNodeId: right.id });
      }
    }
  }

  const edgeIds = layout.edges.map((edge) => edge.id);
  const duplicateEdgeIds = edgeIds.filter(
    (id, index) => edgeIds.indexOf(id) !== index
  );
  const { edgeThroughNodeKeys, segmentsByEdge } = collectLayoutSegments(layout);

  return {
    blockerCycles: findBlockerCycles(graph),
    connectedComponentCount: countConnectedComponents(graph),
    duplicateEdgeIds: [...new Set(duplicateEdgeIds)],
    edgeCrossingCount: countLayoutEdgeCrossings(layout, segmentsByEdge),
    edgeThroughNode: [...edgeThroughNodeKeys].map((key) => {
      const [edgeId, nodeId] = key.split("\0");
      return { edgeId: edgeId ?? "", nodeId: nodeId ?? "" };
    }),
    missingEndpointCount: graph.anomalies.length,
    nodeOverlaps,
  };
};

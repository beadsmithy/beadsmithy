import type { Issue } from "../rpc/bindings";

export type IssueGraphEdgeKind = "blocker" | "parent";

export type IssueGraphAnomalyKind = "missing-blocker" | "missing-parent";

export interface IssueGraphAnomaly {
  issueId: string;
  kind: IssueGraphAnomalyKind;
  referencedIssueId: string;
}

export interface IssueGraphNode {
  id: string;
  issue: Issue;
  parentId: string | null;
}

export interface IssueGraphEdge {
  id: string;
  kind: IssueGraphEdgeKind;
  source: string;
  target: string;
}

export interface FocusedIssueGraph {
  anomalies: IssueGraphAnomaly[];
  edges: IssueGraphEdge[];
  nodes: IssueGraphNode[];
  seedIds: string[];
  totalIssueCount: number;
}

export interface BuildFocusedIssueGraphInput {
  allIssues: Issue[];
  selectedIssueId: string | null;
}

export interface BuildIssueGraphInput extends BuildFocusedIssueGraphInput {
  scope: "all" | "focused";
}

const compareIssueIds = (left: Issue, right: Issue): number =>
  left.id.localeCompare(right.id);

const sortCopy = <Value>(
  values: readonly Value[],
  compare: (left: Value, right: Value) => number
): Value[] => {
  const copy = [...values];
  // oxlint-disable-next-line unicorn(no-array-sort)
  copy.sort(compare);
  return copy;
};

const collectSeedIds = (
  allIssues: Issue[],
  issueById: Map<string, Issue>,
  selectedIssueId: string | null
): string[] => {
  const seedIds: string[] = [];
  for (const issue of allIssues) {
    if (issue.status !== "closed") {
      seedIds.push(issue.id);
    }
  }
  if (
    selectedIssueId !== null &&
    issueById.has(selectedIssueId) &&
    !seedIds.includes(selectedIssueId)
  ) {
    seedIds.push(selectedIssueId);
  }
  return seedIds;
};

const collectVisibleRelationshipContext = (
  seedIds: string[],
  issueById: Map<string, Issue>
): { anomalies: IssueGraphAnomaly[]; visibleIds: Set<string> } => {
  const visibleIds = new Set(seedIds);
  const anomalies: IssueGraphAnomaly[] = [];
  for (const seedId of seedIds) {
    const issue = issueById.get(seedId);
    const parentId = issue?.parent ?? "";
    if (parentId !== "") {
      if (issueById.has(parentId)) {
        visibleIds.add(parentId);
      } else {
        anomalies.push({
          issueId: seedId,
          kind: "missing-parent",
          referencedIssueId: parentId,
        });
      }
    }

    for (const blockerId of issue?.blockedBy ?? []) {
      if (issueById.has(blockerId)) {
        visibleIds.add(blockerId);
      } else {
        anomalies.push({
          issueId: seedId,
          kind: "missing-blocker",
          referencedIssueId: blockerId,
        });
      }
    }
  }
  return { anomalies, visibleIds };
};

export const buildIssueGraph = ({
  allIssues,
  selectedIssueId,
  scope,
}: BuildIssueGraphInput): FocusedIssueGraph => {
  const issueById = new Map(allIssues.map((issue) => [issue.id, issue]));
  const seedIds =
    scope === "all"
      ? allIssues.map((issue) => issue.id)
      : collectSeedIds(allIssues, issueById, selectedIssueId);
  const seedIdSet = new Set(seedIds);
  const { anomalies, visibleIds } = collectVisibleRelationshipContext(
    seedIds,
    issueById
  );

  const visibleIssues: Issue[] = [];
  for (const id of visibleIds) {
    const issue = issueById.get(id);
    if (issue !== undefined) {
      visibleIssues.push(issue);
    }
  }
  const nodes = sortCopy(visibleIssues, compareIssueIds).map((issue) => ({
    id: issue.id,
    issue,
    parentId:
      seedIdSet.has(issue.id) &&
      issue.parent !== "" &&
      visibleIds.has(issue.parent)
        ? issue.parent
        : null,
  }));

  const unsortedParentEdges = nodes
    .filter(
      (node): node is IssueGraphNode & { parentId: string } =>
        node.parentId !== null
    )
    .map((node) => ({
      id: `parent:${node.parentId}->${node.id}`,
      kind: "parent" as const,
      source: node.parentId,
      target: node.id,
    }));
  const parentEdges = sortCopy(unsortedParentEdges, (left, right) =>
    left.id.localeCompare(right.id)
  );

  const unsortedBlockerEdges: IssueGraphEdge[] = [];
  for (const node of nodes) {
    for (const blockerId of new Set(node.issue.blockedBy)) {
      if (!visibleIds.has(blockerId) || !issueById.has(blockerId)) {
        continue;
      }
      unsortedBlockerEdges.push({
        id: `blocker:${blockerId}->${node.id}`,
        kind: "blocker",
        source: blockerId,
        target: node.id,
      });
    }
  }
  const blockerEdges = sortCopy(unsortedBlockerEdges, (left, right) =>
    left.id.localeCompare(right.id)
  );

  const sortedAnomalies = sortCopy(anomalies, (left, right) => {
    const leftKey = `${left.kind}:${left.issueId}:${left.referencedIssueId}`;
    const rightKey = `${right.kind}:${right.issueId}:${right.referencedIssueId}`;
    return leftKey.localeCompare(rightKey);
  });
  const uniqueAnomalies = sortedAnomalies.filter(
    (anomaly, index) =>
      index === 0 ||
      anomaly.kind !== sortedAnomalies[index - 1]?.kind ||
      anomaly.issueId !== sortedAnomalies[index - 1]?.issueId ||
      anomaly.referencedIssueId !==
        sortedAnomalies[index - 1]?.referencedIssueId
  );

  return {
    anomalies: uniqueAnomalies,
    edges: [...parentEdges, ...blockerEdges],
    nodes,
    seedIds: sortCopy(seedIds, (left, right) => left.localeCompare(right)),
    totalIssueCount: allIssues.length,
  };
};

export const buildFocusedIssueGraph = ({
  allIssues,
  selectedIssueId,
}: BuildFocusedIssueGraphInput): FocusedIssueGraph =>
  buildIssueGraph({ allIssues, scope: "focused", selectedIssueId });

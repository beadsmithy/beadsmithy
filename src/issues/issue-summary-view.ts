import type { IssueSummary } from "../rpc/bindings";

export type IssueTone =
  | "blocked"
  | "closed"
  | "deferred"
  | "inProgress"
  | "open";

export interface IssueSummaryViewModel {
  id: string;
  title: string;
  statusLabel: string;
  priorityLabel: string;
  typeLabel: string;
  tone: IssueTone;
  badgeTone: IssueTone;
  labels: string[];
  dependencyLabel: string;
  metadataLabel: string;
}

const STATUS_LABELS: Record<string, string> = {
  closed: "Closed",
  deferred: "Deferred",
  in_progress: "In progress",
  open: "Open",
};

const toDisplayLabel = (value: string): string => {
  const words = value
    .split("-")
    .join(" ")
    .split("_")
    .join(" ")
    .trim()
    .split(/\s+/u);

  return words
    .filter((word) => word.length > 0)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
};

const normalizeText = (value: string, fallback: string): string => {
  const normalized = value.trim();

  return normalized.length > 0 ? normalized : fallback;
};

const badgeToneFor = (issue: IssueSummary): IssueTone => {
  if (issue.status === "in_progress") {
    return "inProgress";
  }

  if (issue.status === "closed") {
    return "closed";
  }

  if (issue.status === "deferred") {
    return "deferred";
  }

  return "open";
};

const issueToneFor = (issue: IssueSummary): IssueTone => {
  if (issue.blockedBy.length > 0) {
    return "blocked";
  }

  return badgeToneFor(issue);
};

const dependencyLabelFor = (issue: IssueSummary): string => {
  const fragments: string[] = [];

  if (issue.blockedBy.length > 0) {
    fragments.push(`blocked by ${issue.blockedBy.length}`);
  }

  if (issue.blocks.length > 0) {
    fragments.push(`blocks ${issue.blocks.length}`);
  }

  return fragments.join(" · ");
};

export const toIssueSummaryViewModel = (
  issue: IssueSummary
): IssueSummaryViewModel => {
  const statusLabel =
    STATUS_LABELS[issue.status] ?? toDisplayLabel(issue.status);
  const typeLabel = toDisplayLabel(normalizeText(issue.type, "issue"));
  const priorityLabel = `P${issue.priority}`;
  const dependencyLabel = dependencyLabelFor(issue);
  const labels = issue.labels.filter((label) => label.trim().length > 0);

  return {
    badgeTone: badgeToneFor(issue),
    dependencyLabel,
    id: normalizeText(issue.id, "unknown"),
    labels,
    metadataLabel: [statusLabel, priorityLabel, typeLabel, dependencyLabel]
      .filter((item) => item.length > 0)
      .join(", "),
    priorityLabel,
    statusLabel,
    title: normalizeText(issue.title, "Untitled issue"),
    tone: issueToneFor(issue),
    typeLabel,
  };
};

import type { Issue } from "../rpc/bindings";

/**
 * Return the loaded Child Issues whose Beadwork `parent` field exactly
 * matches the given Issue ID, preserving the incoming order.
 *
 * A Child Issue is a loaded Issue whose `parent` references the selected
 * Issue; the relationship lives on the child, so the parent itself never
 * appears in the result. Matching is exact: whitespace-padded, different
 * case, or dotted-ID-derived candidates do not match.
 *
 * The derivation is presentation-only. It must not mutate the supplied
 * collection, sort it, trim IDs, infer hierarchy from dotted IDs, or
 * add a durable hierarchy field to `Issue`.
 */
export const getChildIssues = (
  allIssues: Issue[],
  parentIssueId: string
): Issue[] => allIssues.filter((issue) => issue.parent === parentIssueId);

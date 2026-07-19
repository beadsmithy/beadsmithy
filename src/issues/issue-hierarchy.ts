import type { Issue } from "../rpc/bindings";

/**
 * Comparator used to order derived Child Issues. Mirrors Beadwork's
 * own ordering: numeric priority ascending (P0 first), then `created`
 * ascending (oldest first). Beadwork's `created` values are RFC3339
 * strings in UTC, so a lexicographic string comparison matches
 * chronological order.
 *
 * Stable for equal `priority` and `created`: tied entries retain their
 * incoming order, which is the runtime's stable sort behavior. No
 * third key (id, title, etc.) is introduced.
 */
const compareChildIssues = (a: Issue, b: Issue): number => {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }

  if (a.created !== b.created) {
    return a.created < b.created ? -1 : 1;
  }

  return 0;
};

/**
 * Return the loaded Child Issues whose Beadwork `parent` field exactly
 * matches the given Issue ID, ordered by numeric priority ascending
 * (P0 through P4), then by `created` ascending (oldest first).
 *
 * A Child Issue is a loaded Issue whose `parent` references the selected
 * Issue; the relationship lives on the child, so the parent itself never
 * appears in the result. Matching is exact: whitespace-padded, different
 * case, or dotted-ID-derived candidates do not match.
 *
 * The derivation is presentation-only. It must not mutate the supplied
 * collection, sort it in place, trim IDs, infer hierarchy from dotted
 * IDs, or add a durable hierarchy field to `Issue`.
 */
export const getChildIssues = (
  allIssues: Issue[],
  parentIssueId: string
): Issue[] => {
  const children = allIssues.filter((issue) => issue.parent === parentIssueId);
  children.sort(compareChildIssues);
  return children;
};

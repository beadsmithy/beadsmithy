import type { Issue } from "../rpc/bindings";

const WHITESPACE_PATTERN = /\s+/u;

export const tokenizeIssueSearchQuery = (query: string): string[] =>
  query.trim().toLocaleLowerCase().split(WHITESPACE_PATTERN).filter(Boolean);

const getIssueSearchText = (issue: Issue): string =>
  `${issue.id} ${issue.title} ${issue.description}`.toLocaleLowerCase();

export const filterIssuesBySearchQuery = (
  issues: Issue[],
  query: string
): Issue[] => {
  const tokens = tokenizeIssueSearchQuery(query);

  if (tokens.length === 0) {
    return issues;
  }

  return issues.filter((issue) => {
    const searchableText = getIssueSearchText(issue);
    return tokens.every((token) => searchableText.includes(token));
  });
};

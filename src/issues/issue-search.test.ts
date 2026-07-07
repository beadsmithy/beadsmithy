import { describe, expect, it } from "vitest";

import type { Issue } from "../rpc/bindings";
import { filterIssuesBySearchQuery } from "./issue-search";

const buildIssue = (overrides: Partial<Issue> = {}): Issue => ({
  assignee: "",
  blockedBy: [],
  blocks: [],
  closeReason: "",
  closedAt: "",
  comments: [],
  created: "2026-07-05T08:00:00Z",
  deferUntil: "",
  description: "",
  due: "",
  id: "bsm-search.1",
  labels: [],
  parent: "",
  priority: 2,
  status: "open",
  title: "Search issue",
  type: "task",
  updatedAt: "2026-07-05T08:00:00Z",
  ...overrides,
});

const getIds = (issues: Issue[]) => issues.map((issue) => issue.id);

describe("filterIssuesBySearchQuery", () => {
  it("returns all issues for empty or whitespace-only queries", () => {
    const issues = [
      buildIssue({ id: "bsm-first" }),
      buildIssue({ id: "bsm-second" }),
    ];

    expect(filterIssuesBySearchQuery(issues, "")).toBe(issues);
    expect(filterIssuesBySearchQuery(issues, "   \n\t  ")).toBe(issues);
  });

  it("matches ID, title, and raw description case-insensitively", () => {
    const idMatch = buildIssue({ id: "bsm-DBH.6", title: "Plain" });
    const titleMatch = buildIssue({ id: "bsm-title", title: "Render Search" });
    const descriptionMatch = buildIssue({
      description: "Raw Markdown has a HiddenToken before rendering.",
      id: "bsm-description",
      title: "Plain",
    });
    const miss = buildIssue({ id: "bsm-miss", title: "Plain" });

    expect(
      getIds(
        filterIssuesBySearchQuery(
          [idMatch, titleMatch, descriptionMatch, miss],
          "dbh.6"
        )
      )
    ).toEqual(["bsm-DBH.6"]);
    expect(
      getIds(
        filterIssuesBySearchQuery(
          [idMatch, titleMatch, descriptionMatch, miss],
          "search"
        )
      )
    ).toEqual(["bsm-title"]);
    expect(
      getIds(
        filterIssuesBySearchQuery(
          [idMatch, titleMatch, descriptionMatch, miss],
          "hiddentoken"
        )
      )
    ).toEqual(["bsm-description"]);
  });

  it("uses whitespace-tokenized AND substring matching while preserving punctuation", () => {
    const fullMatch = buildIssue({
      description: "Implements the local search foundation.",
      id: "bsm-dbh.6",
      title: "Add All-only local Issue Search foundation",
    });
    const partialMatch = buildIssue({
      id: "bsm-dbh.60",
      title: "Local search follow-up",
    });
    const missingOneToken = buildIssue({
      id: "bsm-other",
      title: "Local filtering",
    });

    expect(
      getIds(
        filterIssuesBySearchQuery(
          [fullMatch, partialMatch, missingOneToken],
          "  bsm-dbh.6 sea  "
        )
      )
    ).toEqual(["bsm-dbh.6", "bsm-dbh.60"]);
  });

  it("preserves the incoming issue order", () => {
    const secondAlphabetically = buildIssue({ id: "bsm-b", title: "Search" });
    const firstAlphabetically = buildIssue({ id: "bsm-a", title: "Search" });

    expect(
      getIds(
        filterIssuesBySearchQuery(
          [secondAlphabetically, firstAlphabetically],
          "search"
        )
      )
    ).toEqual(["bsm-b", "bsm-a"]);
  });
});

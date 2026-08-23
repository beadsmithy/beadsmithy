import { describe, expect, it } from "vitest";

import {
  createIssueNavigationEntry,
  createIssueNavigationLedger,
  issueNavigationDestinationLabel,
  nextIssueNavigationIndex,
  readIssueNavigationEntry,
  recordIssueNavigationEntry,
  truncateForwardIssueNavigationEntries,
  writeIssueNavigationState,
} from "./issue-navigation-coordinator";

const route = {
  issueId: "bsm-1",
  search: "needle",
  viewId: "all" as const,
};

describe("Issue Navigation coordinator", () => {
  it("creates an indexed serializable entry and reads it from history state", () => {
    const entry = createIssueNavigationEntry(route, "/workspace", 3);
    const state = writeIssueNavigationState({ unrelated: true }, entry);

    expect(readIssueNavigationEntry(state)).toEqual(entry);
    expect(nextIssueNavigationIndex(entry)).toBe(4);
  });

  it("rejects malformed history state", () => {
    expect(
      readIssueNavigationEntry({ beadsmithNavigation: { index: -1 } })
    ).toBe(null);
    expect(readIssueNavigationEntry({ beadsmithNavigation: null })).toBe(null);
    expect(
      readIssueNavigationEntry({
        beadsmithNavigation: { ...route, index: 0, viewId: "unknown" },
      })
    ).toBe(null);
  });

  it("truncates forward entries after a new push", () => {
    const ledger = createIssueNavigationLedger();
    recordIssueNavigationEntry(
      ledger,
      createIssueNavigationEntry({ ...route, issueId: null }, "/workspace", 0)
    );
    recordIssueNavigationEntry(
      ledger,
      createIssueNavigationEntry(route, "/workspace", 1)
    );
    recordIssueNavigationEntry(
      ledger,
      createIssueNavigationEntry(
        { ...route, issueId: "bsm-2" },
        "/workspace",
        2
      )
    );

    truncateForwardIssueNavigationEntries(ledger, 1);

    expect([...ledger.entries.keys()]).toEqual([0, 1]);
  });

  it("labels selected and unselected destinations for control tooltips", () => {
    expect(
      issueNavigationDestinationLabel(
        createIssueNavigationEntry(route, "/workspace", 1)
      )
    ).toBe("bsm-1");
    expect(
      issueNavigationDestinationLabel(
        createIssueNavigationEntry({ ...route, issueId: null }, "/workspace", 2)
      )
    ).toBe("All Issues");
    expect(issueNavigationDestinationLabel(null)).toBeNull();
  });
});

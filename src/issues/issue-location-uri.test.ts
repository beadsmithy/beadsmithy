import { describe, expect, it } from "vitest";

import {
  generateIssueLocationUri,
  parseIssueLocationUri,
} from "./issue-location-uri";

describe("Issue Location URI", () => {
  it("generates and parses canonical Unix links with encoded segments", () => {
    const generated = generateIssueLocationUri({
      issueId: "bsm-7en.2/#?",
      workspacePath: "/Users/tomas/Work issue/#repo",
    });

    expect(generated).toEqual({
      ok: true,
      value:
        "beadsmithy:///Users/tomas/Work%20issue/%23repo/issue/bsm-7en.2%2F%23%3F",
    });
    if (!generated.ok) {
      throw new Error("Expected URI generation to succeed");
    }
    expect(parseIssueLocationUri(generated.value)).toEqual({
      ok: true,
      value: {
        issueId: "bsm-7en.2/#?",
        workspacePath: "/Users/tomas/Work issue/#repo",
      },
    });
  });

  it("uses the final issue suffix when a workspace directory is named issue", () => {
    const generated = generateIssueLocationUri({
      issueId: "bsm-1",
      workspacePath: "/tmp/issue/workspace",
    });

    expect(generated.ok).toBe(true);
    if (generated.ok) {
      expect(parseIssueLocationUri(generated.value)).toEqual({
        ok: true,
        value: { issueId: "bsm-1", workspacePath: "/tmp/issue/workspace" },
      });
    }
  });

  it.each([
    "https:///Users/work/issue/bsm-1",
    "beadsmith:///Users/work",
    "beadsmith:///Users/work/issue/",
    "beadsmith:///Users/work/issue/bsm-1/extra",
    "beadsmith:///Users/%E0%A4%A/issue/bsm-1",
  ])("rejects malformed URI %s", (uri) => {
    expect(parseIssueLocationUri(uri).ok).toBe(false);
  });

  it("rejects empty Issue IDs and relative workspace paths", () => {
    expect(
      generateIssueLocationUri({ issueId: "", workspacePath: "/Users/work" })
    ).toEqual({ error: "empty-issue-id", ok: false });
    expect(
      generateIssueLocationUri({ issueId: "bsm-1", workspacePath: "relative" })
    ).toEqual({ error: "invalid-workspace-path", ok: false });
  });
});

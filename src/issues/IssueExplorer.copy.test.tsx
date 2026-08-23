import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Issue } from "../rpc/bindings";
import type { IssueExplorerLoadState } from "./issue-loader";
import { IssueExplorer } from "./IssueExplorer";

const issue: Issue = {
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
  id: "bsm-copy",
  labels: [],
  parent: "",
  priority: 2,
  status: "open",
  title: "Copyable Issue",
  type: "task",
  updatedAt: "2026-07-05T08:00:00Z",
};

const state: IssueExplorerLoadState = {
  allIssues: [issue],
  blockedIssues: [],
  readyIssues: [],
  status: "success",
  workspaceGeneration: 1,
  workspacePath: "/Users/tomas/Work issue",
};

describe("Issue detail deep-link copy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies the canonical Issue Location and exposes temporary success feedback", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<IssueExplorer issueState={state} />);
    await user.click(screen.getByRole("link", { name: /Copyable Issue/iu }));
    await user.click(screen.getByRole("button", { name: "Copy deep link" }));

    expect(writeText).toHaveBeenCalledWith(
      "beadsmithy:///Users/tomas/Work%20issue/issue/bsm-copy"
    );
    expect(
      screen.getByRole("button", { name: "Copy deep link" })
    ).toHaveAttribute("title", "Copied!");
  });

  it("does not expose copy for no-selection or missing-Issue destinations", () => {
    const { rerender } = render(<IssueExplorer issueState={state} />);
    expect(screen.queryByRole("button", { name: "Copy deep link" })).toBeNull();

    rerender(
      <IssueExplorer
        issueState={state}
        route={{ issueId: "bsm-missing", search: "", viewId: "all" }}
      />
    );
    expect(screen.queryByRole("button", { name: "Copy deep link" })).toBeNull();
    expect(screen.getByText("Issue not found")).toBeInTheDocument();
  });
});

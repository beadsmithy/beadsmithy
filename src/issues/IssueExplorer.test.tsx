import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ExternalLinkOpener } from "../components/external-link-opener";
import type { Issue } from "../rpc/bindings";
import type { IssueLoadState } from "./issue-loader";
import { IssueExplorer } from "./IssueExplorer";

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
  id: "bsm-7en.2",
  labels: ["ready-for-agent", "in-progress"],
  parent: "bsm-7en",
  priority: 2,
  status: "open",
  title: "Select an Issue and render basic Issue Detail",
  type: "task",
  updatedAt: "2026-07-05T08:00:00Z",
  ...overrides,
});

const successState = (
  issues: Issue[],
  workspacePath = "/Users/dev/work/portal"
): IssueLoadState => {
  const [first, ...rest] = issues;
  if (first === undefined) {
    return { issues: [], status: "empty", workspacePath };
  }
  return {
    issues: [first, ...rest],
    status: "success",
    workspacePath,
  };
};

interface RenderExplorerOptions {
  openExternalLink?: ExternalLinkOpener;
}

const renderExplorer = (
  issues: Issue[],
  options: RenderExplorerOptions = {}
) => {
  const state: IssueLoadState = successState(issues);
  const props: {
    issueState: IssueLoadState;
    openExternalLink?: ExternalLinkOpener;
  } = {
    issueState: state,
  };
  if (options.openExternalLink !== undefined) {
    props.openExternalLink = options.openExternalLink;
  }
  return render(<IssueExplorer {...props} />);
};

const getDetail = () => within(screen.getByRole("main"));

const getRowButton = (issue: Issue) =>
  within(screen.getByRole("list", { name: "Issues" }))
    .getAllByRole("button")
    .find((button) => button.dataset.issueId === issue.id) ??
  (() => {
    throw new Error(`No row button rendered for issue ${issue.id}`);
  })();

describe("IssueExplorer", () => {
  it("renders the empty Issue detail state on successful load without auto-selecting", () => {
    const issue = buildIssue();

    renderExplorer([issue]);

    expect(screen.getByRole("list")).toBeInTheDocument();

    const detail = getDetail();

    expect(detail.getByText(/No issue selected/u)).toBeInTheDocument();
    expect(
      detail.getByText(/Select an issue from the list/u)
    ).toBeInTheDocument();

    const row = getRowButton(issue);
    expect(row).not.toHaveAttribute("aria-current");
    expect(row).toHaveAttribute("data-selected", "false");
  });

  it("renders the selected Issue title, ID, status, priority, type, and labels in the detail pane", async () => {
    const user = userEvent.setup();
    const issue = buildIssue();
    const other = buildIssue({
      id: "bsm-other",
      labels: [],
      priority: 4,
      status: "closed",
      title: "Already shipped",
      type: "chore",
    });

    renderExplorer([issue, other]);

    await user.click(getRowButton(issue));

    const detail = getDetail();

    expect(
      detail.getByRole("heading", { level: 2, name: issue.title })
    ).toBeInTheDocument();
    expect(detail.getByText(issue.id)).toBeInTheDocument();
    expect(detail.getByText("Open")).toBeInTheDocument();
    expect(detail.getByText("P2")).toBeInTheDocument();
    expect(detail.getByText("Task")).toBeInTheDocument();
    expect(detail.getByText("ready-for-agent")).toBeInTheDocument();
    expect(detail.getByText("in-progress")).toBeInTheDocument();
  });

  it("renders the de-emphasized Issue ID beside the title in the detail header", async () => {
    const user = userEvent.setup();
    const issue = buildIssue();

    renderExplorer([issue]);

    await user.click(getRowButton(issue));

    const detail = getDetail();
    const title = detail.getByRole("heading", { level: 2, name: issue.title });

    // The ID must be in the same header container as the title (not on a
    // separate paragraph below it).
    const header = title.closest("header");
    expect(header).not.toBeNull();
    expect(
      within(header as HTMLElement).getByText(issue.id)
    ).toBeInTheDocument();

    // And it must not be a sibling <p> sitting below the <h2>.
    const paragraphsBelowTitle = title.parentElement?.querySelectorAll("p");
    const idInParagraphs =
      paragraphsBelowTitle === undefined
        ? null
        : [...paragraphsBelowTitle].find((p) => p.textContent === issue.id);
    expect(idInParagraphs ?? null).toBeNull();
  });

  it("marks the clicked Issue row as the selected row with an accessible current state", async () => {
    const user = userEvent.setup();
    const issue = buildIssue();
    const other = buildIssue({
      id: "bsm-other",
      title: "Another issue",
    });

    renderExplorer([issue, other]);

    const issueRow = getRowButton(issue);
    const otherRow = getRowButton(other);

    await user.click(issueRow);

    expect(issueRow).toHaveAttribute("aria-current", "true");
    expect(issueRow).toHaveAttribute("data-selected", "true");
    expect(otherRow).not.toHaveAttribute("aria-current");
    expect(otherRow).toHaveAttribute("data-selected", "false");
  });

  it("keeps the selection populated when the already-selected row is clicked again", async () => {
    const user = userEvent.setup();
    const issue = buildIssue();

    renderExplorer([issue]);

    const row = getRowButton(issue);

    await user.click(row);
    await user.click(row);

    const detail = getDetail();

    expect(
      detail.getByRole("heading", { level: 2, name: issue.title })
    ).toBeInTheDocument();
    expect(detail.getByText(issue.id)).toBeInTheDocument();
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).toHaveAttribute("data-selected", "true");
    expect(detail.queryByText(/No issue selected/u)).not.toBeInTheDocument();
  });

  it("hides labels when the selected Issue has no non-empty labels and shows them otherwise", async () => {
    const user = userEvent.setup();

    const noLabels = buildIssue({
      id: "bsm-empty-labels",
      labels: ["", "   "],
      title: "Issue with only empty labels",
    });
    const labeled = buildIssue({
      id: "bsm-labeled",
      labels: ["ready-for-agent"],
      title: "Issue with real labels",
    });

    renderExplorer([noLabels, labeled]);

    await user.click(getRowButton(noLabels));
    expect(getDetail().queryByText(/^Labels$/u)).not.toBeInTheDocument();
    expect(getDetail().queryByText("ready-for-agent")).not.toBeInTheDocument();

    await user.click(getRowButton(labeled));

    const detail = getDetail();
    expect(detail.getByText(/^Labels$/u)).toBeInTheDocument();
    expect(detail.getByText("ready-for-agent")).toBeInTheDocument();
  });

  it("renders the selected Issue description as formatted Markdown in the detail pane", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({
      description: [
        "## Summary",
        "",
        "- bullet one",
        "- bullet two",
        "",
        "Inline `code` and a code block:",
        "",
        "```",
        "rendered = true",
        "```",
      ].join("\n"),
      id: "bsm-markdown",
    });

    renderExplorer([issue]);

    await user.click(getRowButton(issue));

    const detail = getDetail();

    // Headings, lists, inline code, and code blocks are rendered as DOM,
    // not as raw Markdown punctuation.
    expect(
      detail.getByRole("heading", { level: 2, name: "Summary" })
    ).toBeInTheDocument();

    const markdownList = detail
      .getAllByRole("list")
      .find((list) => within(list).queryByText("bullet one") !== null);
    expect(markdownList).toBeDefined();
    expect(
      within(markdownList as HTMLElement).getByText("bullet one")
    ).toBeInTheDocument();
    expect(
      within(markdownList as HTMLElement).getByText("bullet two")
    ).toBeInTheDocument();

    expect(detail.getByText("code").tagName).toBe("CODE");
    expect(detail.getByText("rendered = true")).toBeInTheDocument();
  });

  it("renders the icon-and-text empty-description card for an empty or whitespace description", async () => {
    const user = userEvent.setup();

    const blankDescription = buildIssue({
      description: "",
      id: "bsm-blank-description",
      title: "Issue with no description",
    });
    const whitespaceDescription = buildIssue({
      description: "   \n  ",
      id: "bsm-whitespace-description",
      title: "Issue with whitespace description",
    });

    renderExplorer([blankDescription, whitespaceDescription]);

    await user.click(getRowButton(blankDescription));

    const detail = getDetail();
    expect(detail.getByText(/^Description$/u)).toBeInTheDocument();
    expect(detail.getByText(/^No description$/u)).toBeInTheDocument();
    expect(
      detail.getByText(
        /This issue (?:doesn't|doesn\u2019t) have a description yet\./u
      )
    ).toBeInTheDocument();

    await user.click(getRowButton(whitespaceDescription));
    expect(getDetail().getByText(/^No description$/u)).toBeInTheDocument();
  });

  it("routes external HTTP(S) links in the description through the injected opener and renders non-HTTP links as inert text", async () => {
    const user = userEvent.setup();
    const openExternalLink = vi.fn();

    const issue = buildIssue({
      description: [
        "Read [the docs](https://example.com/docs) or",
        "see [the readme](./README.md) for [context](#background).",
        "Email [support](mailto:support@example.com) at",
        "[js link](javascript:alert(1)) or check bsm-7en.2 in",
        "`src/issues/IssueExplorer.tsx`.",
      ].join("\n"),
      id: "bsm-mixed-links",
    });

    renderExplorer([issue], { openExternalLink });

    await user.click(getRowButton(issue));

    const detail = getDetail();

    const externalLink = detail.getByRole("link", { name: "the docs" });
    expect(externalLink).toHaveAttribute("href", "https://example.com/docs");
    expect(externalLink).toHaveAttribute("target", "_blank");
    expect(externalLink).toHaveAttribute("rel", "noopener noreferrer");

    await user.click(externalLink);
    expect(openExternalLink).toHaveBeenCalledWith("https://example.com/docs");

    // No inert text was upgraded into a link.
    expect(detail.queryByRole("link", { name: "the readme" })).toBeNull();
    expect(detail.queryByRole("link", { name: "context" })).toBeNull();
    expect(detail.queryByRole("link", { name: "support" })).toBeNull();
    expect(detail.queryByRole("link", { name: "js link" })).toBeNull();

    // The inert text is still present.
    expect(detail.getByText("the readme")).toBeInTheDocument();
    expect(detail.getByText("context")).toBeInTheDocument();
    expect(detail.getByText("support")).toBeInTheDocument();
    expect(detail.getByText("js link")).toBeInTheDocument();

    // And the plain-text Issue ID / file path is preserved without becoming a link.
    expect(detail.queryByRole("link", { name: "bsm-7en.2" })).toBeNull();
    expect(detail.getByText("src/issues/IssueExplorer.tsx").tagName).toBe(
      "CODE"
    );
  });
});

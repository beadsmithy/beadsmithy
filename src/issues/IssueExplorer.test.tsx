import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ExternalLinkOpener } from "../components/external-link-opener";
import type { Issue } from "../rpc/bindings";
import type { IssueListViewId } from "./issue-list-view";
import type { IssueExplorerLoadState } from "./issue-loader";
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

type SuccessfulIssueExplorerLoadState = Extract<
  IssueExplorerLoadState,
  { status: "success" }
>;

const successState = (
  issues: Issue[],
  workspacePath = "/Users/dev/work/portal"
): SuccessfulIssueExplorerLoadState => ({
  allIssues: issues,
  blockedIssues: [],
  readyIssues: [],
  status: "success",
  workspacePath,
});

interface RenderExplorerOptions {
  activeIssueListViewId?: IssueListViewId;
  openExternalLink?: ExternalLinkOpener;
  state?: IssueExplorerLoadState;
}

const renderExplorer = (
  issues: Issue[],
  options: RenderExplorerOptions = {}
) => {
  const state: IssueExplorerLoadState = options.state ?? successState(issues);
  const props: {
    activeIssueListViewId?: IssueListViewId;
    issueState: IssueExplorerLoadState;
    openExternalLink?: ExternalLinkOpener;
  } = {
    issueState: state,
  };
  if (options.activeIssueListViewId !== undefined) {
    props.activeIssueListViewId = options.activeIssueListViewId;
  }
  if (options.openExternalLink !== undefined) {
    props.openExternalLink = options.openExternalLink;
  }
  return render(<IssueExplorer {...props} />);
};

const getDetailElement = () => screen.getByRole("main");

const getDetail = () => within(getDetailElement());

const requireHTMLElement = (element: Element | null): HTMLElement => {
  if (!(element instanceof HTMLElement)) {
    throw new Error("Expected an HTMLElement ancestor");
  }
  return element;
};

const getRowButton = (issue: Issue) =>
  within(screen.getByRole("list", { name: "Issues" }))
    .getAllByRole("button")
    .find((button) => button.dataset.issueId === issue.id) ??
  (() => {
    throw new Error(`No row button rendered for issue ${issue.id}`);
  })();

const getRenderedIssueIds = () =>
  within(screen.getByRole("list", { name: "Issues" }))
    .getAllByRole("button")
    .map((button) => button.dataset.issueId ?? "");

const getSearchInput = () =>
  screen.getByRole("textbox", { name: "Search issues" });

const getDetailSectionFlow = () =>
  [...getDetailElement().children].map((child) => {
    if (child.tagName === "HEADER") {
      return "title/header";
    }
    if (child.tagName === "DL") {
      return "primary metadata";
    }

    const heading = within(requireHTMLElement(child)).queryByRole("heading", {
      level: 3,
    });
    return heading?.textContent ?? "";
  });

describe("IssueExplorer", () => {
  it("renders the empty Issue List UI from a successful empty All Issues collection", () => {
    renderExplorer([]);

    expect(screen.getByText("No issues found")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Beadwork returned an empty issue list for this workspace."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Issues" })).toBeNull();
  });

  it("enables search after successful load while preserving the placeholder and Cmd+F hint", () => {
    renderExplorer([]);

    const searchInput = getSearchInput();
    expect(searchInput).toBeEnabled();
    expect(searchInput).toHaveAttribute("placeholder", "Search issues...");
    expect(screen.getByText("Cmd+F")).toBeInTheDocument();
  });

  it("disables search while issues are loading or failed", () => {
    const { rerender } = renderExplorer([], {
      state: { status: "loading" },
    });

    expect(getSearchInput()).toBeDisabled();

    rerender(
      <IssueExplorer
        issueState={{
          error: { kind: "command-failed", message: "bw failed" },
          status: "failure",
        }}
      />
    );

    expect(getSearchInput()).toBeDisabled();
  });

  it("filters All Issues immediately by ID, title, and raw description but not comments", async () => {
    const user = userEvent.setup();
    const idMatch = buildIssue({ id: "bsm-dbh.6", title: "Plain" });
    const titleMatch = buildIssue({
      id: "bsm-title",
      title: "Keyboard Search",
    });
    const descriptionMatch = buildIssue({
      description: "Raw description mentions Needlework.",
      id: "bsm-description",
      title: "Plain",
    });
    const commentOnlyMatch = buildIssue({
      comments: [
        {
          author: "Tomas",
          text: "Needlework appears only in a comment.",
          timestamp: "2026-07-05T12:00:00Z",
        },
      ],
      id: "bsm-comment",
      title: "Plain",
    });

    renderExplorer([idMatch, titleMatch, descriptionMatch, commentOnlyMatch]);

    await user.type(getSearchInput(), "needle");
    expect(getRenderedIssueIds()).toEqual(["bsm-description"]);

    await user.clear(getSearchInput());
    await user.type(getSearchInput(), "DBH.6");
    expect(getRenderedIssueIds()).toEqual(["bsm-dbh.6"]);

    await user.clear(getSearchInput());
    await user.type(getSearchInput(), "key sea");
    expect(getRenderedIssueIds()).toEqual(["bsm-title"]);
  });

  it("keeps whitespace-only All Issues search unfiltered and preserves match order", async () => {
    const user = userEvent.setup();
    const first = buildIssue({ id: "bsm-z", title: "Search" });
    const second = buildIssue({ id: "bsm-a", title: "Search" });
    const miss = buildIssue({ id: "bsm-miss", title: "Other" });

    renderExplorer([first, second, miss]);

    await user.type(getSearchInput(), "   ");
    expect(getRenderedIssueIds()).toEqual(["bsm-z", "bsm-a", "bsm-miss"]);

    await user.type(getSearchInput(), "search");
    expect(getRenderedIssueIds()).toEqual(["bsm-z", "bsm-a"]);
  });

  it("applies the same search query to the active Issue List View", async () => {
    const user = userEvent.setup();
    const allMatch = buildIssue({
      id: "bsm-all",
      status: "triaged",
      title: "needle in All",
    });
    const readyMatch = buildIssue({
      id: "bsm-ready",
      title: "needle in Ready",
    });
    const blockedMatch = buildIssue({
      id: "bsm-blocked",
      title: "needle in Blocked",
    });
    const closedMatch = buildIssue({
      id: "bsm-closed",
      status: "closed",
      title: "needle in Closed",
    });
    const openMatch = buildIssue({
      id: "bsm-open",
      status: "open",
      title: "needle in Open",
    });
    const closedMiss = buildIssue({
      id: "bsm-closed-miss",
      status: "closed",
      title: "Closed miss",
    });
    const state = {
      ...successState([allMatch, closedMatch, closedMiss, openMatch]),
      blockedIssues: [blockedMatch],
      readyIssues: [readyMatch],
    };

    const { rerender } = render(
      <IssueExplorer activeIssueListViewId="all" issueState={state} />
    );

    await user.type(getSearchInput(), "needle");
    expect(getRenderedIssueIds()).toEqual([
      "bsm-all",
      "bsm-closed",
      "bsm-open",
    ]);

    rerender(
      <IssueExplorer activeIssueListViewId="ready" issueState={state} />
    );
    expect(getSearchInput()).toHaveValue("needle");
    expect(getRenderedIssueIds()).toEqual(["bsm-ready"]);

    rerender(
      <IssueExplorer activeIssueListViewId="blocked" issueState={state} />
    );
    expect(getRenderedIssueIds()).toEqual(["bsm-blocked"]);

    rerender(
      <IssueExplorer activeIssueListViewId="closed" issueState={state} />
    );
    expect(getRenderedIssueIds()).toEqual(["bsm-closed"]);

    rerender(<IssueExplorer activeIssueListViewId="open" issueState={state} />);
    expect(getRenderedIssueIds()).toEqual(["bsm-open"]);
  });

  it("does not leak search matches from another active Issue List View", async () => {
    const user = userEvent.setup();
    const readyOnlyMatch = buildIssue({
      id: "bsm-ready-only",
      title: "ready-only needle",
    });
    const blockedMiss = buildIssue({
      id: "bsm-blocked-miss",
      title: "Blocked miss",
    });
    const state = {
      ...successState([readyOnlyMatch]),
      blockedIssues: [blockedMiss],
      readyIssues: [readyOnlyMatch],
    };

    renderExplorer([], {
      activeIssueListViewId: "blocked",
      state,
    });

    await user.type(getSearchInput(), "ready-only");

    expect(screen.getByText("No issues found")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Issues" })).toBeNull();
  });

  it("renders the All Issue List View from All Issues in original order", () => {
    const closedIssue = buildIssue({
      id: "bsm-closed",
      status: "closed",
      title: "Closed first by command order",
    });
    const unknownStatusIssue = buildIssue({
      id: "bsm-unknown",
      status: "triaged",
      title: "Unknown status remains in All",
    });
    const openIssue = buildIssue({
      id: "bsm-open",
      status: "open",
      title: "Open last by command order",
    });

    renderExplorer([closedIssue, unknownStatusIssue, openIssue], {
      activeIssueListViewId: "all",
    });

    expect(getRenderedIssueIds()).toEqual([
      "bsm-closed",
      "bsm-unknown",
      "bsm-open",
    ]);
  });

  it("renders status Issue List Views from exact stored status matches with the same row and detail UI", async () => {
    const user = userEvent.setup();
    const closedIssue = buildIssue({
      id: "bsm-closed",
      status: "closed",
      title: "Closed issue",
    });
    const inProgressEpic = buildIssue({
      blockedBy: ["bsm-blocker"],
      blocks: ["bsm-blocked"],
      id: "bsm-progress-epic",
      status: "in_progress",
      title: "Progress epic",
      type: "epic",
    });
    const unknownStatusIssue = buildIssue({
      id: "bsm-unknown",
      status: "triaged",
      title: "Unknown status issue",
    });
    const inProgressTask = buildIssue({
      id: "bsm-progress-task",
      status: "in_progress",
      title: "Progress task",
      type: "task",
    });

    renderExplorer(
      [closedIssue, inProgressEpic, unknownStatusIssue, inProgressTask],
      { activeIssueListViewId: "in_progress" }
    );

    expect(getRenderedIssueIds()).toEqual([
      "bsm-progress-epic",
      "bsm-progress-task",
    ]);
    expect(screen.queryByText(closedIssue.title)).toBeNull();
    expect(screen.queryByText(unknownStatusIssue.title)).toBeNull();
    expect(screen.getAllByText("In Progress")).toHaveLength(2);
    expect(screen.getByText("blocked by 1 · blocks 1")).toBeInTheDocument();

    await user.click(getRowButton(inProgressEpic));

    const detail = getDetail();
    expect(
      detail.getByRole("heading", { level: 2, name: inProgressEpic.title })
    ).toBeInTheDocument();
    expect(detail.getByText("In Progress")).toBeInTheDocument();
    expect(detail.getByText("Epic")).toBeInTheDocument();
    expect(detail.getByText("bsm-blocker")).toBeInTheDocument();
    expect(detail.getByText("bsm-blocked")).toBeInTheDocument();
  });

  it("renders Blocked from the command-backed Blocked collection in command order", () => {
    const allBlockedByDependency = buildIssue({
      blockedBy: ["bsm-open-blocker"],
      id: "bsm-derived-only",
      title: "Would be derived locally",
    });
    const blockedSecond = buildIssue({
      blockedBy: [],
      id: "bsm-command-second",
      title: "Second blocked command result",
    });
    const blockedFirst = buildIssue({
      blockedBy: [],
      id: "bsm-command-first",
      title: "First blocked command result",
    });

    renderExplorer([], {
      activeIssueListViewId: "blocked",
      state: {
        ...successState([allBlockedByDependency, blockedSecond, blockedFirst]),
        blockedIssues: [blockedFirst, blockedSecond],
      },
    });

    const rowButtons = within(screen.getByRole("list", { name: "Issues" }))
      .getAllByRole("button")
      .map((button) => button.dataset.issueId);

    expect(rowButtons).toEqual(["bsm-command-first", "bsm-command-second"]);
    expect(screen.queryByText("Would be derived locally")).toBeNull();
  });

  it("renders Issue Detail from the selected Blocked issue collection", async () => {
    const user = userEvent.setup();
    const allIssueWithSameId = buildIssue({
      id: "bsm-overlap",
      title: "All collection title",
    });
    const blockedIssueWithSameId = buildIssue({
      blockedBy: ["bsm-real-blocker"],
      id: "bsm-overlap",
      title: "Blocked collection title",
    });

    renderExplorer([], {
      activeIssueListViewId: "blocked",
      state: {
        ...successState([allIssueWithSameId]),
        blockedIssues: [blockedIssueWithSameId],
      },
    });

    await user.click(getRowButton(blockedIssueWithSameId));

    expect(
      getDetail().getByText("Blocked collection title")
    ).toBeInTheDocument();
    expect(getDetail().queryByText("All collection title")).toBeNull();
    expect(getDetail().getByText("bsm-real-blocker")).toBeInTheDocument();
  });

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
    expect(
      within(requireHTMLElement(title.closest("header"))).getByText(issue.id)
    ).toBeInTheDocument();

    // And it must not be a sibling <p> sitting below the <h2>.
    const paragraphsBelowTitle = title.parentElement?.querySelectorAll("p");
    const idInParagraphs =
      paragraphsBelowTitle === undefined
        ? null
        : [...paragraphsBelowTitle].find((p) => p.textContent === issue.id);
    expect(idInParagraphs ?? null).toBeNull();
  });

  it("renders Parent directly below the title header and omits it when blank", async () => {
    const user = userEvent.setup();
    const issueWithParent = buildIssue({
      id: "bsm-with-parent",
      parent: "bsm-7en",
    });
    const issueWithoutParent = buildIssue({
      id: "bsm-without-parent",
      parent: "   ",
    });

    renderExplorer([issueWithParent, issueWithoutParent]);

    await user.click(getRowButton(issueWithParent));

    const detail = getDetail();
    const title = detail.getByRole("heading", {
      level: 2,
      name: issueWithParent.title,
    });
    const headerScope = within(requireHTMLElement(title.closest("header")));

    expect(headerScope.getByText("Parent")).toBeInTheDocument();
    expect(headerScope.getByText("bsm-7en")).toBeInTheDocument();

    await user.click(getRowButton(issueWithoutParent));

    const blankParentHeaderScope = within(
      requireHTMLElement(
        getDetail()
          .getByRole("heading", {
            level: 2,
            name: issueWithoutParent.title,
          })
          .closest("header")
      )
    );
    expect(blankParentHeaderScope.queryByText("Parent")).toBeNull();
  });

  it("orders selected Issue Detail sections with comments after Other metadata", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({
      blockedBy: ["bsm-blocker"],
      blocks: ["bsm-blocked"],
      comments: [
        {
          author: "Tomas",
          text: "Final note.",
          timestamp: "2026-07-05T12:00:00Z",
        },
      ],
      description: "Detail body.",
      id: "bsm-section-order",
      labels: ["ready-for-agent"],
      parent: "bsm-7en",
    });

    renderExplorer([issue]);

    await user.click(getRowButton(issue));

    expect(getDetailSectionFlow()).toEqual([
      "title/header",
      "primary metadata",
      "Labels",
      "Description",
      "Dependencies",
      "Other metadata",
      "Comments",
    ]);
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

  it("omits the Comments section when the selected Issue has no comments", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({
      comments: [],
      id: "bsm-no-comments",
    });

    renderExplorer([issue]);

    await user.click(getRowButton(issue));

    expect(getDetail().queryByText(/^Comments$/u)).not.toBeInTheDocument();
  });

  it("renders comment timestamps and present authors while omitting missing authors", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({
      comments: [
        {
          author: "Tomas",
          text: "First comment body.",
          timestamp: "2026-07-05T12:00:00Z",
        },
        {
          author: "   ",
          text: "Second comment body.",
          timestamp: "2026-07-05T13:00:00Z",
        },
      ],
      id: "bsm-comment-authors",
    });

    renderExplorer([issue]);

    await user.click(getRowButton(issue));

    const commentsHeading = getDetail().getByRole("heading", {
      level: 3,
      name: "Comments",
    });
    const commentsScope = within(
      requireHTMLElement(commentsHeading.closest("section"))
    );

    expect(commentsScope.getByText("2026-07-05T12:00:00Z")).toBeInTheDocument();
    expect(commentsScope.getByText("2026-07-05T13:00:00Z")).toBeInTheDocument();
    expect(commentsScope.getByText("Tomas")).toBeInTheDocument();
    expect(commentsScope.queryByText(/^\s+$/u)).toBeNull();
  });

  it("renders comment bodies as Markdown and routes safe external links through the injected opener", async () => {
    const user = userEvent.setup();
    const openExternalLink = vi.fn();
    const issue = buildIssue({
      comments: [
        {
          author: "Tomas",
          text: [
            "### Comment update",
            "",
            "- shipped Markdown",
            "",
            "See [public docs](https://example.com/comments) and [local notes](./notes.md).",
          ].join("\n"),
          timestamp: "2026-07-05T14:00:00Z",
        },
      ],
      id: "bsm-comment-markdown",
    });

    renderExplorer([issue], { openExternalLink });

    await user.click(getRowButton(issue));

    const commentsHeading = getDetail().getByRole("heading", {
      level: 3,
      name: "Comments",
    });
    const commentsScope = within(
      requireHTMLElement(commentsHeading.closest("section"))
    );

    expect(
      commentsScope.getByRole("heading", { level: 3, name: "Comment update" })
    ).toBeInTheDocument();
    expect(commentsScope.getByText("shipped Markdown")).toBeInTheDocument();

    const externalLink = commentsScope.getByRole("link", {
      name: "public docs",
    });
    expect(externalLink).toHaveAttribute(
      "href",
      "https://example.com/comments"
    );

    await user.click(externalLink);
    expect(openExternalLink).toHaveBeenCalledWith(
      "https://example.com/comments"
    );

    expect(
      commentsScope.queryByRole("link", { name: "local notes" })
    ).toBeNull();
    expect(commentsScope.getByText("local notes")).toBeInTheDocument();
  });

  it("renders the Dependencies card with raw canonical IDs preserving prefixes and no link or button wrappers", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({
      blockedBy: ["bsm-7en.2", "bsm-7en.3"],
      blocks: ["bsm-7en.5"],
      id: "bsm-with-deps",
    });

    renderExplorer([issue]);

    await user.click(getRowButton(issue));

    const detail = getDetail();
    const depsHeading = detail.getByRole("heading", {
      level: 3,
      name: "Dependencies",
    });
    const depsScope = within(
      requireHTMLElement(depsHeading.closest("section"))
    );

    // Row labels are present.
    expect(depsScope.getByText("Blocked by")).toBeInTheDocument();
    expect(depsScope.getByText("Blocking")).toBeInTheDocument();

    // Raw canonical IDs (including the prefix) are rendered as plain text.
    expect(depsScope.getByText("bsm-7en.2")).toBeInTheDocument();
    expect(depsScope.getByText("bsm-7en.3")).toBeInTheDocument();
    expect(depsScope.getByText("bsm-7en.5")).toBeInTheDocument();

    // IDs are not wrapped in <a> or <button> — no dependency navigation.
    expect(depsScope.queryByRole("link", { name: "bsm-7en.2" })).toBeNull();
    expect(depsScope.queryByRole("link", { name: "bsm-7en.3" })).toBeNull();
    expect(depsScope.queryByRole("link", { name: "bsm-7en.5" })).toBeNull();
    expect(depsScope.queryByRole("button", { name: "bsm-7en.2" })).toBeNull();
    expect(depsScope.queryByRole("button", { name: "bsm-7en.3" })).toBeNull();
    expect(depsScope.queryByRole("button", { name: "bsm-7en.5" })).toBeNull();

    // No empty-state copy when dependencies are populated.
    expect(depsScope.queryByText("No blockers")).toBeNull();
    expect(depsScope.queryByText("Not blocking anything")).toBeNull();
  });

  it("renders the exact empty-state copy in the Dependencies card when blockers and blocks are empty", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({
      blockedBy: [],
      blocks: [],
      id: "bsm-no-deps",
    });

    renderExplorer([issue]);

    await user.click(getRowButton(issue));

    const detail = getDetail();
    const depsHeading = detail.getByRole("heading", {
      level: 3,
      name: "Dependencies",
    });
    const depsScope = within(
      requireHTMLElement(depsHeading.closest("section"))
    );

    expect(depsScope.getByText("Blocked by")).toBeInTheDocument();
    expect(depsScope.getByText("Blocking")).toBeInTheDocument();

    // Exact empty-state copy locked by the bead.
    expect(depsScope.getByText("No blockers")).toBeInTheDocument();
    expect(depsScope.getByText("Not blocking anything")).toBeInTheDocument();
  });

  it("renders the Other metadata section with raw values when all optional fields are present", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({
      assignee: "Tomas",
      closeReason: "Done",
      closedAt: "2026-07-04T08:00:00Z",
      created: "2026-07-01T08:00:00Z",
      deferUntil: "2026-09-01",
      due: "2026-08-01",
      id: "bsm-full-meta",
      parent: "bsm-7en",
      updatedAt: "2026-07-05T10:00:00Z",
    });

    renderExplorer([issue]);

    await user.click(getRowButton(issue));

    const detail = getDetail();
    const otherScope = within(
      requireHTMLElement(
        detail
          .getByRole("heading", { level: 3, name: "Other metadata" })
          .closest("section")
      )
    );

    // Every label appears once in the Other metadata section.
    expect(otherScope.getByText("Assignee")).toBeInTheDocument();
    expect(otherScope.getByText("Created")).toBeInTheDocument();
    expect(otherScope.getByText("Updated")).toBeInTheDocument();
    expect(otherScope.getByText("Due")).toBeInTheDocument();
    expect(otherScope.getByText("Deferred until")).toBeInTheDocument();
    expect(otherScope.getByText("Closed at")).toBeInTheDocument();
    expect(otherScope.getByText("Close reason")).toBeInTheDocument();
    expect(otherScope.queryByText("Parent")).toBeNull();

    // Raw values are rendered verbatim — no date formatting.
    expect(otherScope.getByText("Tomas")).toBeInTheDocument();
    expect(otherScope.getByText("2026-07-01T08:00:00Z")).toBeInTheDocument();
    expect(otherScope.getByText("2026-07-05T10:00:00Z")).toBeInTheDocument();
    expect(otherScope.getByText("2026-08-01")).toBeInTheDocument();
    expect(otherScope.getByText("2026-09-01")).toBeInTheDocument();
    expect(otherScope.getByText("2026-07-04T08:00:00Z")).toBeInTheDocument();
    expect(otherScope.getByText("Done")).toBeInTheDocument();
    expect(otherScope.queryByText("bsm-7en")).toBeNull();
  });

  it("hides optional Other metadata fields when their values are empty or whitespace-only and always shows Created and Updated", async () => {
    const user = userEvent.setup();

    const emptyMeta = buildIssue({
      assignee: "",
      closeReason: "",
      closedAt: "",
      created: "2026-07-01T08:00:00Z",
      deferUntil: "",
      due: "",
      id: "bsm-empty-meta",
      parent: "",
      updatedAt: "2026-07-05T10:00:00Z",
    });
    const whitespaceMeta = buildIssue({
      assignee: "   ",
      closeReason: "   ",
      closedAt: "   ",
      created: "2026-07-01T08:00:00Z",
      deferUntil: "   ",
      due: "   ",
      id: "bsm-whitespace-meta",
      parent: "   ",
      updatedAt: "2026-07-05T10:00:00Z",
    });

    renderExplorer([emptyMeta, whitespaceMeta]);

    // Empty-string values hide their labels.
    await user.click(getRowButton(emptyMeta));
    {
      const detail = getDetail();
      const otherScope = within(
        requireHTMLElement(
          detail
            .getByRole("heading", { level: 3, name: "Other metadata" })
            .closest("section")
        )
      );

      expect(otherScope.queryByText("Assignee")).toBeNull();
      expect(otherScope.queryByText("Due")).toBeNull();
      expect(otherScope.queryByText("Deferred until")).toBeNull();
      expect(otherScope.queryByText("Closed at")).toBeNull();
      expect(otherScope.queryByText("Close reason")).toBeNull();
      expect(otherScope.queryByText("Parent")).toBeNull();

      // Created and Updated remain visible with raw values.
      expect(otherScope.getByText("Created")).toBeInTheDocument();
      expect(otherScope.getByText("Updated")).toBeInTheDocument();
      expect(otherScope.getByText("2026-07-01T08:00:00Z")).toBeInTheDocument();
      expect(otherScope.getByText("2026-07-05T10:00:00Z")).toBeInTheDocument();
    }

    // Whitespace-only values hide their labels the same way.
    await user.click(getRowButton(whitespaceMeta));
    {
      const detail = getDetail();
      const otherScope = within(
        requireHTMLElement(
          detail
            .getByRole("heading", { level: 3, name: "Other metadata" })
            .closest("section")
        )
      );

      expect(otherScope.queryByText("Assignee")).toBeNull();
      expect(otherScope.queryByText("Due")).toBeNull();
      expect(otherScope.queryByText("Deferred until")).toBeNull();
      expect(otherScope.queryByText("Closed at")).toBeNull();
      expect(otherScope.queryByText("Close reason")).toBeNull();
      expect(otherScope.queryByText("Parent")).toBeNull();

      expect(otherScope.getByText("Created")).toBeInTheDocument();
      expect(otherScope.getByText("Updated")).toBeInTheDocument();
    }
  });

  it("renders Ready from the command-backed Ready collection in command order", () => {
    const allDerivedReady = buildIssue({
      id: "bsm-derived-only",
      status: "open",
      title: "Would be derived locally",
    });
    const readySecond = buildIssue({
      blockedBy: ["bsm-real-blocker"],
      id: "bsm-command-second",
      status: "in_progress",
      title: "Second ready command result",
    });
    const readyFirst = buildIssue({
      blockedBy: ["bsm-real-blocker"],
      id: "bsm-command-first",
      status: "in_progress",
      title: "First ready command result",
    });

    renderExplorer([], {
      activeIssueListViewId: "ready",
      state: {
        ...successState([allDerivedReady, readySecond, readyFirst]),
        readyIssues: [readyFirst, readySecond],
      },
    });

    const rowButtons = within(screen.getByRole("list", { name: "Issues" }))
      .getAllByRole("button")
      .map((button) => button.dataset.issueId);

    expect(rowButtons).toEqual(["bsm-command-first", "bsm-command-second"]);
    expect(screen.queryByText("Would be derived locally")).toBeNull();
  });

  it("renders Issue Detail from the selected Ready issue collection", async () => {
    const user = userEvent.setup();
    const allIssueWithSameId = buildIssue({
      id: "bsm-overlap",
      title: "All collection title",
    });
    const readyIssueWithSameId = buildIssue({
      blockedBy: ["bsm-real-blocker"],
      id: "bsm-overlap",
      status: "in_progress",
      title: "Ready collection title",
    });

    renderExplorer([], {
      activeIssueListViewId: "ready",
      state: {
        ...successState([allIssueWithSameId]),
        readyIssues: [readyIssueWithSameId],
      },
    });

    await user.click(getRowButton(readyIssueWithSameId));

    expect(getDetail().getByText("Ready collection title")).toBeInTheDocument();
    expect(getDetail().queryByText("All collection title")).toBeNull();
    expect(getDetail().getByText("bsm-real-blocker")).toBeInTheDocument();
  });

  it("renders the empty Issue List state when the preloaded Ready collection is empty", () => {
    const allOnly = buildIssue({
      id: "bsm-all-only",
      title: "Only in All Issues",
    });

    renderExplorer([], {
      activeIssueListViewId: "ready",
      state: {
        ...successState([allOnly]),
        readyIssues: [],
      },
    });

    expect(screen.getByText("No issues found")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Issues" })).toBeNull();
    expect(screen.queryByText("Only in All Issues")).toBeNull();
  });
});

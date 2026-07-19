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
  workspacePath = "/Users/dev/work/portal",
  workspaceGeneration = 1
): SuccessfulIssueExplorerLoadState => ({
  allIssues: issues,
  blockedIssues: [],
  readyIssues: [],
  status: "success",
  workspaceGeneration,
  workspacePath,
});

interface RenderExplorerOptions {
  activeIssueListViewId?: IssueListViewId;
  markdownFontSizePx?: number;
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
    markdownFontSizePx?: number;
    openExternalLink?: ExternalLinkOpener;
  } = {
    issueState: state,
  };
  if (options.activeIssueListViewId !== undefined) {
    props.activeIssueListViewId = options.activeIssueListViewId;
  }
  if (options.markdownFontSizePx !== undefined) {
    props.markdownFontSizePx = options.markdownFontSizePx;
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

const getIssueListScrollContainer = (): HTMLElement => {
  // The container is keyed by the active Issue List View, so a view
  // change remounts it. Use the stable data attribute to find whichever
  // instance is currently rendered.
  const container = document.querySelector(
    "[data-issue-list-scroll-container]"
  );
  if (!(container instanceof HTMLElement)) {
    throw new Error(
      "Expected the Issue List scroll container to be an HTMLElement"
    );
  }
  return container;
};

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
  it("renders the true-empty Issue List UI from a successful empty All Issues collection", () => {
    renderExplorer([]);

    expect(screen.getByText("No issues found")).toBeInTheDocument();
    expect(screen.getByText("No issues found").closest("div")).toHaveAttribute(
      "data-empty-reason",
      "true-empty"
    );
    expect(
      screen.getByText(
        "Beadwork returned an empty issue list for this workspace."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Issues" })).toBeNull();
  });

  it("prefers true-empty over base-empty and search-filtered-empty across active views and non-empty search text", async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <IssueExplorer
        activeIssueListViewId="ready"
        issueState={successState([])}
      />
    );

    await user.type(getSearchInput(), "needle");
    expect(screen.getByText("No issues found")).toBeInTheDocument();
    expect(screen.getByText("No issues found").closest("div")).toHaveAttribute(
      "data-empty-reason",
      "true-empty"
    );
    expect(
      screen.getByText(
        "Beadwork returned an empty issue list for this workspace."
      )
    ).toBeInTheDocument();

    rerender(
      <IssueExplorer
        activeIssueListViewId="blocked"
        issueState={successState([])}
      />
    );
    expect(screen.getByText("No issues found").closest("div")).toHaveAttribute(
      "data-empty-reason",
      "true-empty"
    );
    expect(getSearchInput()).toHaveValue("needle");

    rerender(
      <IssueExplorer
        activeIssueListViewId="closed"
        issueState={successState([])}
      />
    );
    expect(screen.getByText("No issues found").closest("div")).toHaveAttribute(
      "data-empty-reason",
      "true-empty"
    );
  });

  it("enables search after successful load while preserving the placeholder and Cmd+F hint", () => {
    renderExplorer([]);

    const searchInput = getSearchInput();
    expect(searchInput).toBeEnabled();
    expect(searchInput).toHaveAttribute("placeholder", "Search issues...");
    expect(screen.getByText("Cmd+F")).toBeInTheDocument();
  });

  it("renders loading copy that refers to loading issue views across multiple Beadwork commands", () => {
    renderExplorer([], { state: { status: "loading" } });

    expect(screen.getByText("Loading issue views")).toBeInTheDocument();
    expect(
      screen.getByText("Reading All, Ready, and Blocked views from Beadwork…")
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Loading issues$/u)).toBeNull();
    expect(screen.queryByText("Reading Beadwork issues…")).toBeNull();
  });

  it("renders the failure state as a whole-explorer error using the error message and kind", () => {
    const errorState: IssueExplorerLoadState = {
      error: {
        kind: "command-failed",
        message: "bw list --all --json exited with status 1",
      },
      status: "failure",
    };

    renderExplorer([], { state: errorState });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Could not load issues")).toBeInTheDocument();
    expect(
      screen.getByText("bw list --all --json exited with status 1")
    ).toBeInTheDocument();
    expect(screen.getByText("command-failed")).toBeInTheDocument();
    // No partial list rendered alongside the failure.
    expect(screen.queryByRole("list", { name: "Issues" })).toBeNull();
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

    expect(screen.getByText("No matching issues")).toBeInTheDocument();
    expect(
      screen.getByText("No matching issues").closest("div")
    ).toHaveAttribute("data-empty-reason", "search-filtered-empty");
    expect(
      screen.getByText('No issues in Blocked match "ready-only".')
    ).toBeInTheDocument();
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
    // A matching child is included so the conditional Child Issues
    // section is part of the section flow in this scenario. When the
    // selected Issue has no children, the section is omitted entirely
    // and "Child Issues" disappears from the flow.
    const child = buildIssue({
      id: "bsm-section-order.1",
      parent: "bsm-section-order",
      title: "Section-order child",
    });

    renderExplorer([issue, child]);

    await user.click(getRowButton(issue));

    expect(getDetailSectionFlow()).toEqual([
      "title/header",
      "primary metadata",
      "Labels",
      "Description",
      "Dependencies",
      "Child Issues",
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

  it("forwards markdownFontSizePx to both description and comment MarkdownContent renderers", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({
      comments: [
        {
          author: "Tomas",
          text: "A **comment**.",
          timestamp: "2026-07-05T14:00:00Z",
        },
      ],
      description: "# Description\n\nBody.",
      id: "bsm-font-size",
    });

    renderExplorer([issue], { markdownFontSizePx: 42 });

    await user.click(getRowButton(issue));

    const markdownArticles = [
      ...getDetailElement().querySelectorAll("article"),
    ].filter((article) => article.style.fontSize !== "");

    expect(markdownArticles).toHaveLength(2);
    for (const article of markdownArticles) {
      expect(article).toHaveStyle({ fontSize: "42px" });
    }
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

  describe("Child Issues section", () => {
    const getChildIssuesSection = () => {
      const detail = getDetail();
      const heading = detail.getByRole("heading", {
        level: 3,
        name: "Child Issues",
      });
      return within(requireHTMLElement(heading.closest("section")));
    };

    it("renders matching children in priority/created order with id, status, then title", async () => {
      const user = userEvent.setup();
      // `allIssues` order is intentionally not the priority/date order:
      // the section reorders matching children by priority ascending,
      // then `created` ascending. The Issue List itself must still
      // render rows in the loaded (incoming) order.
      const parent = buildIssue({
        id: "bsm-parent",
        parent: "",
        status: "open",
        title: "Parent epic",
      });
      // P1 with a newer created timestamp — should appear after the
      // older P1, before any P2/P4 children.
      const newerP1Child = buildIssue({
        created: "2026-07-10T00:00:00Z",
        id: "bsm-parent.p1-newer",
        parent: "bsm-parent",
        priority: 1,
        status: "in_progress",
        title: "Newer P1 task",
      });
      // P1 with an older created timestamp — should appear first.
      const olderP1Child = buildIssue({
        created: "2026-07-01T00:00:00Z",
        id: "bsm-parent.p1-older",
        parent: "bsm-parent",
        priority: 1,
        status: "in_progress",
        title: "Older P1 task",
      });
      // P4 with a default created timestamp — must come after every
      // P0/P1/P2 entry, regardless of `created`.
      const p4Child = buildIssue({
        id: "bsm-parent.p4",
        parent: "bsm-parent",
        priority: 4,
        status: "open",
        title: "Low-priority task",
      });
      // P2 with an older created timestamp — must follow both P1s.
      const p2Child = buildIssue({
        created: "2026-07-02T00:00:00Z",
        id: "bsm-parent.p2",
        parent: "bsm-parent",
        priority: 2,
        status: "open",
        title: "Default-priority task",
      });
      const unrelated = buildIssue({
        id: "bsm-other",
        parent: "bsm-other-parent",
        status: "open",
        title: "Unrelated Issue",
      });

      renderExplorer([
        parent,
        p4Child,
        newerP1Child,
        unrelated,
        p2Child,
        olderP1Child,
      ]);

      await user.click(getRowButton(parent));

      const section = getChildIssuesSection();

      // Section is present directly after Dependencies.
      expect(
        section.getByRole("heading", { level: 3, name: "Child Issues" })
      ).toBeInTheDocument();

      // Only matching children appear, ordered P1-oldest, P1-newer,
      // P2, then P4. The unrelated Issue does not leak in.
      const list = section.getByRole("list", { name: "Child Issues" });
      const items = within(list).getAllByRole("listitem");
      expect(items).toHaveLength(4);
      const orderedIds = items.map(
        (item) =>
          within(item as HTMLElement).getByText(/^bsm-parent\./u).textContent ??
          ""
      );
      expect(orderedIds).toEqual([
        "bsm-parent.p1-older",
        "bsm-parent.p1-newer",
        "bsm-parent.p2",
        "bsm-parent.p4",
      ]);
      expect(section.queryByText("Unrelated Issue")).toBeNull();

      // Each entry exposes id, humanized status badge, and title in that order.
      const firstItem = items[0] as HTMLElement;
      const firstItemText = firstItem.textContent ?? "";
      expect(firstItemText.indexOf("bsm-parent.p1-older")).toBeLessThan(
        firstItemText.indexOf("In Progress")
      );
      expect(firstItemText.indexOf("In Progress")).toBeLessThan(
        firstItemText.indexOf("Older P1 task")
      );

      // Entries are read-only: no links, buttons, or clickable surfaces.
      expect(section.queryByRole("link")).toBeNull();
      expect(section.queryByRole("button")).toBeNull();

      // The full section flow still places Child Issues between
      // Dependencies and Other metadata when children are populated.
      expect(getDetailSectionFlow()).toEqual([
        "title/header",
        "primary metadata",
        "Labels",
        "Description",
        "Dependencies",
        "Child Issues",
        "Other metadata",
      ]);

      // The Issue List rows themselves remain in their loaded order:
      // the derived reordering of children must not have mutated the
      // shared `allIssues` collection. The unrelated Issue sits
      // between two children in the input, which is also the order
      // the list renders.
      expect(getRenderedIssueIds()).toEqual([
        "bsm-parent",
        "bsm-parent.p4",
        "bsm-parent.p1-newer",
        "bsm-other",
        "bsm-parent.p2",
        "bsm-parent.p1-older",
      ]);
    });

    it("omits the Child Issues section entirely when no children exist", async () => {
      const user = userEvent.setup();
      const issue = buildIssue({
        id: "bsm-no-children",
        parent: "",
        title: "Lonely Issue",
      });
      const unrelated = buildIssue({
        id: "bsm-other",
        parent: "bsm-other-parent",
        title: "Unrelated Issue",
      });

      renderExplorer([issue, unrelated]);

      await user.click(getRowButton(issue));

      // The Issue Detail scope is the selected Issue's `<main>` only;
      // this guards against accidental matches in the Issue List
      // (which is separate and renders the issues themselves).
      const detail = getDetail();

      // No Child Issues heading is rendered.
      expect(
        detail.queryByRole("heading", { level: 3, name: "Child Issues" })
      ).toBeNull();

      // No "No Child Issues" empty-state copy is rendered anywhere in
      // the detail — neither as the section body nor as a fallback.
      expect(detail.queryByText("No Child Issues")).toBeNull();

      // No Child Issues list is rendered.
      expect(detail.queryByRole("list", { name: "Child Issues" })).toBeNull();

      // The section flow for an Issue without children skips straight
      // from Dependencies to Other metadata; Comments is absent
      // because the lonely Issue has no comments either.
      expect(getDetailSectionFlow()).toEqual([
        "title/header",
        "primary metadata",
        "Labels",
        "Description",
        "Dependencies",
        "Other metadata",
      ]);
    });

    it("derives children from the successful allIssues collection even when a non-All view is active", async () => {
      const user = userEvent.setup();
      const parent = buildIssue({
        id: "bsm-cross-view-parent",
        parent: "",
        status: "open",
        title: "Cross-view parent",
      });
      const child = buildIssue({
        id: "bsm-cross-view-child",
        parent: "bsm-cross-view-parent",
        status: "closed",
        title: "Cross-view child",
      });
      // Active view is "closed" but the parent's status is "open", so the
      // parent only appears when viewing "all". Child derivation must still
      // come from `allIssues`, not from the active view's visible list.
      const state = {
        ...successState([parent, child]),
        blockedIssues: [],
        readyIssues: [],
      };

      const { rerender } = render(
        <IssueExplorer activeIssueListViewId="closed" issueState={state} />
      );

      // Parent is not in the Closed view; select it via All.
      rerender(
        <IssueExplorer activeIssueListViewId="all" issueState={state} />
      );
      await user.click(getRowButton(parent));

      const section = getChildIssuesSection();
      expect(
        section.getByRole("list", { name: "Child Issues" })
      ).toBeInTheDocument();
      const listItems = within(
        section.getByRole("list", { name: "Child Issues" })
      ).getAllByRole("listitem");
      expect(listItems).toHaveLength(1);
      const childRow = listItems[0] as HTMLElement;
      expect(
        within(childRow).getByText("bsm-cross-view-child")
      ).toBeInTheDocument();
      expect(within(childRow).getByText("Closed")).toBeInTheDocument();
      expect(
        within(childRow).getByText("Cross-view child")
      ).toBeInTheDocument();
    });
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

  it("renders the base-empty Issue List state when the preloaded Ready collection is empty", () => {
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

    expect(screen.getByText("No issues in Ready.")).toBeInTheDocument();
    expect(
      screen.getByText("No issues in Ready.").closest("div")
    ).toHaveAttribute("data-empty-reason", "base-empty");
    expect(screen.queryByRole("list", { name: "Issues" })).toBeNull();
    expect(screen.queryByText("Only in All Issues")).toBeNull();
  });

  describe("selection coordination with view and search changes", () => {
    it("keeps the selected Issue Detail populated when switching Issue List Views still includes the selected Issue", async () => {
      const user = userEvent.setup();
      const crossViewIssue = buildIssue({
        blockedBy: ["bsm-real-blocker"],
        id: "bsm-cross-view",
        status: "in_progress",
        title: "Cross-view issue",
      });
      const state = {
        ...successState([crossViewIssue]),
        readyIssues: [crossViewIssue],
      };

      const { rerender } = render(
        <IssueExplorer activeIssueListViewId="all" issueState={state} />
      );

      await user.click(getRowButton(crossViewIssue));
      expect(getDetail().getByText(crossViewIssue.title)).toBeInTheDocument();

      // Switching from All to Ready: the same Issue is still visible.
      rerender(
        <IssueExplorer activeIssueListViewId="ready" issueState={state} />
      );

      const row = getRowButton(crossViewIssue);
      expect(row).toHaveAttribute("aria-current", "true");
      expect(row).toHaveAttribute("data-selected", "true");
      expect(
        getDetail().getByRole("heading", {
          level: 2,
          name: crossViewIssue.title,
        })
      ).toBeInTheDocument();
    });

    it("keeps the selected Issue Detail populated when a search change still matches the selected Issue", async () => {
      const user = userEvent.setup();
      const selected = buildIssue({
        id: "bsm-search-keep",
        title: "Keyboard foundation",
      });
      const other = buildIssue({
        id: "bsm-search-other",
        title: "Mouse foundation",
      });

      renderExplorer([selected, other]);

      await user.click(getRowButton(selected));
      expect(getDetail().getByText(selected.title)).toBeInTheDocument();

      await user.type(getSearchInput(), "keyboard");

      expect(getRenderedIssueIds()).toEqual(["bsm-search-keep"]);
      const row = getRowButton(selected);
      expect(row).toHaveAttribute("aria-current", "true");
      expect(row).toHaveAttribute("data-selected", "true");
      expect(
        getDetail().getByRole("heading", { level: 2, name: selected.title })
      ).toBeInTheDocument();
    });

    it("clears the selection when a view change hides the selected Issue and leaves the empty Issue Detail state", async () => {
      const user = userEvent.setup();
      const selected = buildIssue({
        id: "bsm-open-selected",
        status: "open",
        title: "Open selected",
      });
      const closedIssue = buildIssue({
        id: "bsm-closed",
        status: "closed",
        title: "Closed only",
      });

      const { rerender } = render(
        <IssueExplorer
          activeIssueListViewId="open"
          issueState={successState([selected, closedIssue])}
        />
      );

      await user.click(getRowButton(selected));
      expect(getDetail().getByText(selected.title)).toBeInTheDocument();

      // Switching to Closed hides the selected open Issue.
      rerender(
        <IssueExplorer
          activeIssueListViewId="closed"
          issueState={successState([selected, closedIssue])}
        />
      );

      expect(getRenderedIssueIds()).toEqual(["bsm-closed"]);
      expect(getDetail().getByText(/No issue selected/u)).toBeInTheDocument();

      const closedRow = getRowButton(closedIssue);
      expect(closedRow).not.toHaveAttribute("aria-current");
      expect(closedRow).toHaveAttribute("data-selected", "false");
    });

    it("clears the selection when a search query hides the selected Issue and leaves the empty Issue Detail state", async () => {
      const user = userEvent.setup();
      const selected = buildIssue({
        id: "bsm-search-selected",
        title: "Needle in selected row",
      });
      const other = buildIssue({
        id: "bsm-search-other",
        title: "Other needle",
      });

      renderExplorer([selected, other]);

      await user.click(getRowButton(selected));
      expect(getDetail().getByText(selected.title)).toBeInTheDocument();

      // Narrow the visible rows to the other Issue only.
      await user.type(getSearchInput(), "other needle");

      expect(getRenderedIssueIds()).toEqual(["bsm-search-other"]);
      expect(getDetail().getByText(/No issue selected/u)).toBeInTheDocument();

      const otherRow = getRowButton(other);
      expect(otherRow).not.toHaveAttribute("aria-current");
      expect(otherRow).toHaveAttribute("data-selected", "false");
    });

    it("does not auto-restore a cleared selection after clearing the hiding search query", async () => {
      const user = userEvent.setup();
      const selected = buildIssue({
        id: "bsm-search-selected",
        title: "Needle in selected row",
      });
      const other = buildIssue({
        id: "bsm-search-other",
        title: "Other needle",
      });

      renderExplorer([selected, other]);

      await user.click(getRowButton(selected));
      await user.type(getSearchInput(), "other needle");

      // Selection was cleared while the query hid the row.
      expect(getDetail().getByText(/No issue selected/u)).toBeInTheDocument();

      // Clear the search query so the row becomes visible again.
      await user.clear(getSearchInput());

      expect(getRenderedIssueIds()).toEqual([
        "bsm-search-selected",
        "bsm-search-other",
      ]);
      expect(getDetail().getByText(/No issue selected/u)).toBeInTheDocument();

      const restoredRow = getRowButton(selected);
      expect(restoredRow).not.toHaveAttribute("aria-current");
      expect(restoredRow).toHaveAttribute("data-selected", "false");
    });

    it("does not auto-restore a cleared selection after switching back to a view that includes the Issue", async () => {
      const user = userEvent.setup();
      const selected = buildIssue({
        id: "bsm-view-selected",
        status: "open",
        title: "Open selected",
      });
      const closedIssue = buildIssue({
        id: "bsm-view-closed",
        status: "closed",
        title: "Closed only",
      });
      const state = successState([selected, closedIssue]);

      const { rerender } = render(
        <IssueExplorer activeIssueListViewId="open" issueState={state} />
      );

      await user.click(getRowButton(selected));
      expect(getDetail().getByText(selected.title)).toBeInTheDocument();

      // View change hides the selected Issue and clears the selection.
      rerender(
        <IssueExplorer activeIssueListViewId="closed" issueState={state} />
      );
      expect(getDetail().getByText(/No issue selected/u)).toBeInTheDocument();

      // Switching back to Open must not auto-restore the cleared selection.
      rerender(
        <IssueExplorer activeIssueListViewId="open" issueState={state} />
      );

      expect(getRenderedIssueIds()).toEqual(["bsm-view-selected"]);
      expect(getDetail().getByText(/No issue selected/u)).toBeInTheDocument();
      const restoredRow = getRowButton(selected);
      expect(restoredRow).not.toHaveAttribute("aria-current");
      expect(restoredRow).toHaveAttribute("data-selected", "false");
    });

    it("does not auto-select the first visible row after a view change leaves rows without a prior selection", () => {
      const firstOpen = buildIssue({
        id: "bsm-no-autoselect-first",
        status: "open",
        title: "First open row",
      });
      const closedIssue = buildIssue({
        id: "bsm-no-autoselect-closed",
        status: "closed",
        title: "Closed only",
      });

      const { rerender } = render(
        <IssueExplorer
          activeIssueListViewId="open"
          issueState={successState([firstOpen, closedIssue])}
        />
      );

      expect(getRowButton(firstOpen)).not.toHaveAttribute("aria-current");

      rerender(
        <IssueExplorer
          activeIssueListViewId="closed"
          issueState={successState([firstOpen, closedIssue])}
        />
      );

      const closedRow = getRowButton(closedIssue);
      expect(closedRow).not.toHaveAttribute("aria-current");
      expect(closedRow).toHaveAttribute("data-selected", "false");
      expect(getDetail().getByText(/No issue selected/u)).toBeInTheDocument();
    });

    it("renders the detail pane from the active visible Issue collection when the selected Issue spans multiple views", async () => {
      const user = userEvent.setup();
      const allIssue = buildIssue({
        id: "bsm-cross-collection",
        title: "All collection title",
      });
      const readyIssue = buildIssue({
        blockedBy: ["bsm-ready-only-blocker"],
        id: "bsm-cross-collection",
        status: "in_progress",
        title: "Ready collection title",
      });

      const state = {
        ...successState([allIssue]),
        readyIssues: [readyIssue],
      };

      const { rerender } = render(
        <IssueExplorer activeIssueListViewId="all" issueState={state} />
      );

      await user.click(getRowButton(allIssue));

      expect(getDetail().getByText("All collection title")).toBeInTheDocument();
      expect(getDetail().queryByText("Ready collection title")).toBeNull();
      expect(getDetail().queryByText("bsm-ready-only-blocker")).toBeNull();

      // Switch to Ready: the same ID is still visible, but the detail must
      // reflect the Ready collection's record, not the All-only one.
      rerender(
        <IssueExplorer activeIssueListViewId="ready" issueState={state} />
      );

      const row = getRowButton(readyIssue);
      expect(row).toHaveAttribute("aria-current", "true");

      expect(
        getDetail().getByText("Ready collection title")
      ).toBeInTheDocument();
      expect(getDetail().queryByText("All collection title")).toBeNull();
      expect(
        getDetail().getByText("bsm-ready-only-blocker")
      ).toBeInTheDocument();
    });
  });

  describe("Issue List scroll position reset", () => {
    it("resets the Issue List scroll position to the top when the active Issue List View changes", () => {
      const openIssue = buildIssue({
        id: "bsm-scroll-open",
        status: "open",
        title: "Scroll open",
      });
      const closedIssue = buildIssue({
        id: "bsm-scroll-closed",
        status: "closed",
        title: "Scroll closed",
      });
      const state = successState([openIssue, closedIssue]);

      const { rerender } = render(
        <IssueExplorer activeIssueListViewId="open" issueState={state} />
      );

      let scrollContainer = getIssueListScrollContainer();

      // Simulate the user having scrolled the list.
      scrollContainer.scrollTop = 100;
      expect(scrollContainer.scrollTop).toBe(100);

      // Switching views remounts the scroll container; the new
      // instance always starts at the top.
      rerender(
        <IssueExplorer activeIssueListViewId="closed" issueState={state} />
      );

      scrollContainer = getIssueListScrollContainer();
      expect(scrollContainer.scrollTop).toBe(0);

      // Switching back also resets the scroll position.
      scrollContainer.scrollTop = 75;
      expect(scrollContainer.scrollTop).toBe(75);

      rerender(
        <IssueExplorer activeIssueListViewId="ready" issueState={state} />
      );
      scrollContainer = getIssueListScrollContainer();
      expect(scrollContainer.scrollTop).toBe(0);
    });

    it("does not reset the Issue List scroll position when only the search query changes", async () => {
      const user = userEvent.setup();
      const first = buildIssue({ id: "bsm-search-alpha", title: "Alpha" });
      const second = buildIssue({ id: "bsm-search-beta", title: "Beta" });
      const third = buildIssue({ id: "bsm-search-gamma", title: "Gamma" });

      renderExplorer([first, second, third]);

      const scrollContainer = getIssueListScrollContainer();
      scrollContainer.scrollTop = 50;
      expect(scrollContainer.scrollTop).toBe(50);

      await user.type(getSearchInput(), "alpha");

      // Search-only changes must preserve the existing scroll offset.
      expect(scrollContainer.scrollTop).toBe(50);
    });
  });

  it("renders the base-empty copy for each Issue List View with view-specific labels", () => {
    const openOnly = buildIssue({
      id: "bsm-open-only",
      status: "open",
      title: "Only an Open issue",
    });

    const cases: {
      viewId: IssueListViewId;
      state: IssueExplorerLoadState;
      expectedLabel: string;
    }[] = [
      {
        expectedLabel: "No issues in Ready.",
        state: { ...successState([openOnly]), readyIssues: [] },
        viewId: "ready",
      },
      {
        expectedLabel: "No issues in Blocked.",
        state: { ...successState([openOnly]), blockedIssues: [] },
        viewId: "blocked",
      },
      {
        expectedLabel: "No issues in Open.",
        state: {
          ...successState([{ ...openOnly, id: "bsm-other", status: "closed" }]),
        },
        viewId: "open",
      },
      {
        expectedLabel: "No issues in In Progress.",
        state: { ...successState([openOnly]) },
        viewId: "in_progress",
      },
      {
        expectedLabel: "No issues in Closed.",
        state: { ...successState([openOnly]) },
        viewId: "closed",
      },
      {
        expectedLabel: "No issues in Deferred.",
        state: { ...successState([openOnly]) },
        viewId: "deferred",
      },
    ];

    for (const { expectedLabel, state, viewId } of cases) {
      const { unmount } = renderExplorer([], {
        activeIssueListViewId: viewId,
        state,
      });
      expect(screen.getByText(expectedLabel)).toBeInTheDocument();
      expect(screen.getByText(expectedLabel).closest("div")).toHaveAttribute(
        "data-empty-reason",
        "base-empty"
      );
      unmount();
    }
  });

  it("renders the search-filtered-empty copy with title and view-aware message including the raw query", async () => {
    const user = userEvent.setup();
    const closedIssue = buildIssue({
      id: "bsm-closed",
      status: "closed",
      title: "Closed project plan",
    });
    const state = successState([closedIssue]);

    renderExplorer([], {
      activeIssueListViewId: "closed",
      state,
    });

    await user.type(getSearchInput(), "migration");

    expect(screen.getByText("No matching issues")).toBeInTheDocument();
    expect(
      screen.getByText("No matching issues").closest("div")
    ).toHaveAttribute("data-empty-reason", "search-filtered-empty");
    expect(
      screen.getByText('No issues in Closed match "migration".')
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Issues" })).toBeNull();
  });

  it("escapes the raw search query as a text node in the search-filtered-empty copy", async () => {
    const user = userEvent.setup();
    const onlyIssue = buildIssue({
      id: "bsm-only",
      title: "plain",
    });

    renderExplorer([], {
      activeIssueListViewId: "all",
      state: successState([onlyIssue]),
    });

    await user.type(getSearchInput(), '<img src="x">');

    const message = screen.getByText('No issues in All match "<img src="x">".');
    expect(message).toBeInTheDocument();
    // The query text is rendered as a text node, not parsed into HTML.
    expect(message.querySelector("img")).toBeNull();
  });

  it("keeps the search input enabled across true-empty, base-empty, and search-filtered-empty states", async () => {
    const user = userEvent.setup();
    const onlyIssue = buildIssue({ id: "bsm-only", title: "Plain" });

    const { rerender } = renderExplorer([], {
      state: successState([]),
    });
    expect(getSearchInput()).toBeEnabled();

    rerender(
      <IssueExplorer
        activeIssueListViewId="ready"
        issueState={{ ...successState([onlyIssue]), readyIssues: [] }}
      />
    );
    expect(getSearchInput()).toBeEnabled();

    rerender(
      <IssueExplorer
        activeIssueListViewId="all"
        issueState={successState([onlyIssue])}
      />
    );
    await user.type(getSearchInput(), "needle");
    expect(getSearchInput()).toBeEnabled();
    expect(screen.getByText("No matching issues")).toBeInTheDocument();
  });
});

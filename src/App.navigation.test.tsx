import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as XYFlowModule from "@xyflow/react";
import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FocusedIssueGraph } from "./issues/issue-graph";
import type { IssueGraphLayoutResult } from "./issues/issue-graph-layout";
import type { IssueExplorerLoadState } from "./issues/issue-loader";
import type * as IssueLoaderModule from "./issues/issue-loader";
import type * as BindingsModule from "./rpc/bindings";
import type { WorkspaceState } from "./rpc/bindings";
import {
  buildIssue,
  failureState,
  successState,
} from "./test/app-workspace-fixtures";

const loadIssueExplorerStateFromTauRpc =
  vi.fn<() => Promise<IssueExplorerLoadState>>();
const open = vi.fn();
const workspaceState = vi.fn<() => Promise<WorkspaceState>>();
const switchWorkspace = vi.fn();
const removeWorkspace = vi.fn();
const retryWorkspaceMemory = vi.fn();
const resetWorkspaceMemory = vi.fn();
const cancelWorkspace = vi.fn();
const appSettingsState = vi.fn();
const updateAppSettings = vi.fn();
const listen = vi.fn().mockResolvedValue(vi.fn());

interface MockReactFlowNode {
  data: Record<string, unknown>;
  id: string;
  type: string;
}

interface MockReactFlowProps {
  children: ReactNode;
  nodeTypes: Record<string, ComponentType<{ data: Record<string, unknown> }>>;
  nodes: MockReactFlowNode[];
}

const layoutGraphSynchronously = (
  graph: FocusedIssueGraph
): IssueGraphLayoutResult => ({
  edges: graph.edges.map((edge) => ({
    id: edge.id,
    kind: edge.kind,
    sections: [],
    source: edge.source,
    sourcePort: edge.kind === "blocker" ? "blocker-source" : "parent-source",
    target: edge.target,
    targetPort: edge.kind === "blocker" ? "blocker-target" : "parent-target",
  })),
  engine: "dagre",
  executionTimeMs: 0,
  nodes: graph.nodes.map((node, index) => ({
    height: 104,
    id: node.id,
    position: { x: index * 250, y: 0 },
    width: 240,
  })),
});
const createTauRPCProxy = vi.fn(() => ({
  app_settings_state: appSettingsState,
  cancel_workspace: cancelWorkspace,
  remove_workspace: removeWorkspace,
  reset_workspace_memory: resetWorkspaceMemory,
  retry_workspace_memory: retryWorkspaceMemory,
  switch_workspace: switchWorkspace,
  update_app_settings: updateAppSettings,
  workspace_state: workspaceState,
}));

vi.mock("./issues/issue-loader", async (importOriginal) => {
  const actual = await importOriginal<typeof IssueLoaderModule>();

  return {
    ...actual,
    loadIssueExplorerStateFromTauRpc,
  };
});

vi.mock("./rpc/bindings", async (importOriginal) => {
  const actual = await importOriginal<typeof BindingsModule>();

  return { ...actual, createTauRPCProxy };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof XYFlowModule>();
  return {
    ...actual,
    Background: () => null,
    BaseEdge: () => null,
    Controls: () => null,
    Handle: () => null,
    Panel: ({ children }: { children: ReactNode }) =>
      createElement("div", undefined, children),
    ReactFlow: ({ children, nodeTypes, nodes }: MockReactFlowProps) =>
      createElement(
        "div",
        { "data-testid": "mock-react-flow" },
        nodes.map((node) => {
          const NodeComponent = nodeTypes[node.type];
          return createElement(NodeComponent, {
            data: node.data,
            key: node.id,
          });
        }),
        children
      ),
  };
});
vi.mock("./issues/use-issue-graph-layout", () => ({
  useIssueGraphLayout: (graph: FocusedIssueGraph) => ({
    error: null,
    isFallback: false,
    isLoading: false,
    layout: layoutGraphSynchronously(graph),
  }),
}));

const { default: App } = await import("./App");

const sidebar = () => screen.getByRole("navigation");

const sidebarButton = (name: RegExp) =>
  within(sidebar()).getByRole("button", { name });
describe("App navigation", () => {
  beforeEach(() => {
    loadIssueExplorerStateFromTauRpc.mockReset();
    open.mockReset();
    removeWorkspace.mockReset();
    resetWorkspaceMemory.mockReset();
    retryWorkspaceMemory.mockReset();
    switchWorkspace.mockReset();
    cancelWorkspace.mockReset();
    appSettingsState.mockReset();
    appSettingsState.mockResolvedValue({
      settings: { markdown: { fontSizePx: 14 } },
      warning: null,
    });
    updateAppSettings.mockReset();
    updateAppSettings.mockResolvedValue({ markdown: { fontSizePx: 14 } });
    listen.mockClear();
    listen.mockResolvedValue(vi.fn());
    workspaceState.mockReset();
    workspaceState.mockRejectedValue(new Error("workspace unavailable"));
  });

  it("replaces an invalid view query parameter with the canonical All route", async () => {
    window.history.replaceState(
      { unrelated: "preserve" },
      "",
      "/issues?view=not-a-view"
    );
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(successState({}));

    render(<App />);

    await screen.findByRole("button", { name: "All, 0 issues" });
    await waitFor(() => {
      expect(window.location.search).toBe("");
      expect(window.history.state).toMatchObject({
        beadsmithNavigation: {
          index: 0,
          issueId: null,
          search: "",
          viewId: "all",
          workspacePath: "/Users/dev/work/beads",
        },
        unrelated: "preserve",
      });
    });
  });

  it("keeps sidebar view controls unavailable with hidden counts while issues are loading", () => {
    loadIssueExplorerStateFromTauRpc.mockReturnValue(Promise.race([]));

    render(<App />);

    expect(sidebarButton(/^All$/u)).toBeDisabled();
    expect(sidebarButton(/^Ready$/u)).toBeDisabled();
    expect(sidebarButton(/^Blocked$/u)).toBeDisabled();
    expect(sidebarButton(/^In Progress$/u)).toBeDisabled();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.queryByText("States")).toBeNull();
    expect(within(sidebar()).queryByText(/^0$/u)).toBeNull();
  });

  it("keeps sidebar view controls unavailable with hidden counts after load failure", async () => {
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(failureState);

    render(<App />);

    await screen.findByRole("alert");

    expect(sidebarButton(/^All$/u)).toBeDisabled();
    expect(sidebarButton(/^Open$/u)).toBeDisabled();
    expect(within(sidebar()).queryByText(/^0$/u)).toBeNull();
  });

  it("shows enabled base counts after load and defaults All to the only active item", async () => {
    const openIssue = buildIssue({ id: "bsm-open", status: "open" });
    const readyIssue = buildIssue({ id: "bsm-ready", status: "open" });
    const blockedIssue = buildIssue({
      blockedBy: ["bsm-blocker"],
      id: "bsm-blocked",
      status: "in_progress",
    });
    const closedIssue = buildIssue({ id: "bsm-closed", status: "closed" });
    const deferredIssue = buildIssue({
      id: "bsm-deferred",
      status: "deferred",
    });

    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [
          openIssue,
          readyIssue,
          blockedIssue,
          closedIssue,
          deferredIssue,
        ],
        blockedIssues: [blockedIssue],
        readyIssues: [readyIssue],
      })
    );

    render(<App />);

    const allButton = await screen.findByRole("button", {
      name: "All, 5 issues",
    });

    expect(allButton).toBeEnabled();
    expect(allButton).toHaveAttribute("aria-current", "true");
    expect(sidebarButton(/^Ready, 1 issue$/u)).toBeEnabled();
    expect(sidebarButton(/^Blocked, 1 issue$/u)).toBeEnabled();
    expect(sidebarButton(/^Open, 2 issues$/u)).toBeEnabled();
    expect(sidebarButton(/^In Progress, 1 issue$/u)).toBeEnabled();
    expect(sidebarButton(/^Closed, 1 issue$/u)).toBeEnabled();
    expect(sidebarButton(/^Deferred, 1 issue$/u)).toBeEnabled();
    expect(
      within(sidebar())
        .getAllByRole("button")
        .filter((button) => button.hasAttribute("aria-current"))
    ).toHaveLength(1);
  });

  it("shows a zero Blocked count from the command-backed Blocked collection", async () => {
    const issueWithDependencies = buildIssue({
      blockedBy: ["bsm-blocker"],
      id: "bsm-derived-only",
    });

    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [issueWithDependencies], blockedIssues: [] })
    );

    render(<App />);

    await expect(
      screen.findByRole("button", { name: "Blocked, 0 issues" })
    ).resolves.toBeEnabled();
  });

  it("changes the active issue list view only when an inactive loaded sidebar item is clicked", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({ status: "open" });

    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [issue] })
    );

    render(<App />);

    const allButton = await screen.findByRole("button", {
      name: "All, 1 issue",
    });
    const closedButton = sidebarButton(/^Closed, 0 issues$/u);

    await user.click(allButton);
    expect(allButton).toHaveAttribute("aria-current", "true");
    expect(closedButton).not.toHaveAttribute("aria-current");

    await user.click(closedButton);
    expect(closedButton).toHaveAttribute("aria-current", "true");
    expect(allButton).not.toHaveAttribute("aria-current");

    await user.click(closedButton);
    await waitFor(() => {
      expect(closedButton).toHaveAttribute("aria-current", "true");
    });
  });

  it("shows a zero count for Ready when the preloaded Ready collection is empty", async () => {
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [buildIssue({ id: "bsm-all" })],
        readyIssues: [],
      })
    );

    render(<App />);

    await screen.findByRole("button", { name: "All, 1 issue" });
    expect(sidebarButton(/^Ready, 0 issues$/u)).toBeEnabled();
  });

  it("renders the preloaded Ready collection when the Ready sidebar item is selected", async () => {
    const user = userEvent.setup();
    const readyIssue = buildIssue({ id: "bsm-ready", title: "Ready one" });
    const allOnly = buildIssue({ id: "bsm-all-only", title: "All only one" });

    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [allOnly],
        readyIssues: [readyIssue],
      })
    );

    render(<App />);

    await screen.findByRole("button", { name: "All, 1 issue" });

    await user.click(sidebarButton(/^Ready, 1 issue$/u));

    expect(screen.getByText("Ready one")).toBeInTheDocument();
    expect(screen.queryByText("All only one")).toBeNull();
  });

  it("keeps sidebar counts based on base collections while search narrows rows", async () => {
    const user = userEvent.setup();
    const matchingIssue = buildIssue({ id: "bsm-match", title: "needle" });
    const hiddenIssue = buildIssue({ id: "bsm-hidden", title: "haystack" });
    const readyIssue = buildIssue({ id: "bsm-ready", title: "needle ready" });

    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [matchingIssue, hiddenIssue],
        readyIssues: [readyIssue],
      })
    );

    render(<App />);

    await screen.findByRole("button", { name: "All, 2 issues" });
    await user.type(
      screen.getByRole("textbox", { name: "Search issues" }),
      "needle"
    );

    expect(sidebarButton(/^All, 2 issues$/u)).toBeEnabled();
    expect(sidebarButton(/^Ready, 1 issue$/u)).toBeEnabled();
    expect(screen.getByText("needle")).toBeInTheDocument();
    expect(screen.queryByText("haystack")).toBeNull();
  });

  it("does not re-run the Beadwork load when switching to the Ready view after load", async () => {
    const user = userEvent.setup();
    const readyIssue = buildIssue({ id: "bsm-ready" });

    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [readyIssue],
        readyIssues: [readyIssue],
      })
    );

    render(<App />);

    await screen.findByRole("button", { name: "All, 1 issue" });
    expect(loadIssueExplorerStateFromTauRpc).toHaveBeenCalledOnce();

    await user.click(sidebarButton(/^Ready, 1 issue$/u));
    expect(loadIssueExplorerStateFromTauRpc).toHaveBeenCalledOnce();
  });

  it("switches between List and Graph without loading the Issue snapshot again", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({ id: "bsm-graph", title: "Graph Issue" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [issue], workspacePath: "/work" })
    );

    render(<App />);

    await screen.findByRole("button", { name: "All, 1 issue" });
    await user.click(sidebarButton(/^Graph$/u));

    expect(window.location.pathname).toBe("/graph");
    expect(
      screen.getByRole("main", { name: "Issue Graph" })
    ).toBeInTheDocument();
    expect(screen.getByText("Focused Graph")).toBeInTheDocument();

    await user.click(sidebarButton(/^All, 1 issue$/u));

    expect(window.location.pathname).toBe("/issues");
    expect(
      screen.getByRole("main", { name: "Issue detail" })
    ).toBeInTheDocument();
    expect(loadIssueExplorerStateFromTauRpc).toHaveBeenCalledOnce();
  });

  it("switches Graph scope through navigation and reveals disconnected Issues", async () => {
    const user = userEvent.setup();
    const currentIssue = buildIssue({
      id: "bsm-current",
      title: "Current Work",
    });
    const closedIssue = buildIssue({
      id: "bsm-disconnected-closed",
      status: "closed",
      title: "Disconnected Closed",
    });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [currentIssue, closedIssue] })
    );

    render(<App />);

    await screen.findByRole("button", { name: "All, 2 issues" });
    await user.click(screen.getByRole("button", { name: /^Graph$/u }));
    expect(screen.getByRole("button", { name: "Show all" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(
      screen.queryByRole("button", {
        name: /bsm-disconnected-closed: Disconnected Closed/iu,
      })
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show all" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/graph");
      expect(window.location.search).toBe("?scope=all");
    });
    expect(screen.getByRole("button", { name: "Show all" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      screen.getByRole("button", {
        name: /bsm-disconnected-closed: Disconnected Closed/iu,
      })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Focused" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/graph");
      expect(window.location.search).toBe("");
    });
  });

  it("restores the selected destination through Graph history", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({
      id: "bsm-graph-selected",
      title: "Selected Graph Issue",
    });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [issue], workspacePath: "/work" })
    );

    render(<App />);

    await user.click(
      await screen.findByRole("link", { name: /Selected Graph Issue/iu })
    );
    const issueDetail = await screen.findByRole("main", {
      name: "Issue detail",
    });
    expect(
      within(issueDetail).getByRole("heading", { name: issue.title })
    ).toBeInTheDocument();
    await user.click(sidebarButton(/^Graph$/u));

    expect(screen.getByRole("main", { name: "Issue Graph" })).toHaveAttribute(
      "data-graph-selected-issue",
      issue.id
    );
    await user.click(sidebarButton(/^All, 1 issue$/u));
    expect(
      within(screen.getByRole("main", { name: "Issue detail" })).getByRole(
        "heading",
        { name: issue.title }
      )
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Back to bsm-graph-selected/iu })
    );
    await waitFor(() => {
      expect(
        screen.getByRole("main", { name: "Issue Graph" })
      ).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("button", { name: /Forward to bsm-graph-selected/iu })
    );
    await waitFor(() => {
      expect(
        within(screen.getByRole("main", { name: "Issue detail" })).getByRole(
          "heading",
          { name: issue.title }
        )
      ).toBeInTheDocument();
    });
  });

  it("opens Graph Issue Detail, closes it, and restores it through history", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({
      id: "bsm-graph-card",
      title: "Graph Card Issue",
    });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [issue], workspacePath: "/work" })
    );

    render(<App />);

    await screen.findByRole("button", { name: "All, 1 issue" });
    await user.click(await screen.findByRole("button", { name: /^Graph$/u }));
    const card = await screen.findByRole("button", {
      name: /bsm-graph-card: Graph Card Issue/iu,
    });
    await user.click(card);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/graph/bsm-graph-card");
    });
    expect(
      within(
        screen.getByRole("complementary", { name: "Graph Issue detail panel" })
      ).getByRole("heading", { name: issue.title })
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Close Issue detail" })
    );
    await waitFor(() => {
      expect(window.location.pathname).toBe("/graph");
    });
    expect(
      screen.queryByRole("complementary", { name: "Graph Issue detail panel" })
    ).toBeNull();

    await user.click(
      screen.getByRole("button", { name: /Back to bsm-graph-card/iu })
    );
    await waitFor(() => {
      expect(
        screen.getByRole("complementary", {
          name: "Graph Issue detail panel",
        })
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: /Forward to Focused Graph/iu })
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("complementary", {
          name: "Graph Issue detail panel",
        })
      ).toBeNull();
    });

    const keyboardCard = screen.getByRole("button", {
      name: /bsm-graph-card: Graph Card Issue/iu,
    });
    keyboardCard.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(window.location.pathname).toBe("/graph/bsm-graph-card");
    });
  });

  it("keeps a missing selected Graph Issue routed with the not-found presentation", async () => {
    window.history.replaceState({}, "", "/graph/bsm-missing");
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [buildIssue({ id: "bsm-present" })] })
    );

    render(<App />);

    const panel = await screen.findByRole("complementary", {
      name: "Graph Issue detail panel",
    });
    expect(
      within(panel).getByRole("heading", { name: "Issue not found" })
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/graph/bsm-missing");
  });

  it("follows a Child Issue reference within the Graph overlay", async () => {
    const user = userEvent.setup();
    const parent = buildIssue({
      id: "bsm-graph-parent",
      parent: "",
      title: "Graph Parent",
    });
    const child = buildIssue({
      id: "bsm-graph-child",
      parent: parent.id,
      status: "closed",
      title: "Graph Child",
    });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [parent, child], workspacePath: "/work" })
    );

    render(<App />);

    await screen.findByRole("button", { name: "All, 2 issues" });
    await user.click(screen.getByRole("button", { name: /^Graph$/u }));
    await user.click(
      await screen.findByRole("button", {
        name: /bsm-graph-parent: Graph Parent/iu,
      })
    );

    const panel = await screen.findByRole("complementary", {
      name: "Graph Issue detail panel",
    });
    await user.click(
      within(panel).getByRole("link", {
        name: /bsm-graph-child: Graph Child/iu,
      })
    );

    await waitFor(() => {
      expect(window.location.pathname).toBe("/graph/bsm-graph-child");
    });
    expect(
      within(
        screen.getByRole("complementary", { name: "Graph Issue detail panel" })
      ).getByRole("heading", { name: child.title })
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Back to bsm-graph-parent/iu })
    );
    await waitFor(() => {
      expect(
        within(
          screen.getByRole("complementary", {
            name: "Graph Issue detail panel",
          })
        ).getByRole("heading", { name: parent.title })
      ).toBeInTheDocument();
    });
  });
});

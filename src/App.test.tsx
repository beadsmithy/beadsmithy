import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IssueExplorerLoadState } from "./issues/issue-loader";
import type * as IssueLoaderModule from "./issues/issue-loader";
import type * as BindingsModule from "./rpc/bindings";
import type { Issue, WorkspaceState } from "./rpc/bindings";

const loadIssueExplorerStateFromTauRpc =
  vi.fn<() => Promise<IssueExplorerLoadState>>();
const open = vi.fn();
const workspaceState = vi.fn<() => Promise<WorkspaceState>>();
const switchWorkspace = vi.fn();
const removeWorkspace = vi.fn();
const retryWorkspaceMemory = vi.fn();
const resetWorkspaceMemory = vi.fn();
const createTauRPCProxy = vi.fn(() => ({
  remove_workspace: removeWorkspace,
  reset_workspace_memory: resetWorkspaceMemory,
  retry_workspace_memory: retryWorkspaceMemory,
  switch_workspace: switchWorkspace,
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

const { default: App } = await import("./App");

const buildIssue = (overrides: Partial<Issue> = {}): Issue => ({
  assignee: "",
  blockedBy: [],
  blocks: [],
  closeReason: "",
  closedAt: "",
  comments: [],
  created: "2026-07-07T08:00:00Z",
  deferUntil: "",
  description: "",
  due: "",
  id: "bsm-dbh.2",
  labels: [],
  parent: "bsm-dbh",
  priority: 2,
  status: "open",
  title: "Model Issue List Views",
  type: "task",
  updatedAt: "2026-07-07T08:00:00Z",
  ...overrides,
});

const successState = (overrides: {
  allIssues?: Issue[];
  readyIssues?: Issue[];
  blockedIssues?: Issue[];
}): IssueExplorerLoadState => ({
  allIssues: overrides.allIssues ?? [],
  blockedIssues: overrides.blockedIssues ?? [],
  readyIssues: overrides.readyIssues ?? [],
  status: "success",
  workspacePath: "/Users/dev/work/beads",
});

const failureState: IssueExplorerLoadState = {
  error: { kind: "commandFailed", message: "Could not list issues." },
  status: "failure",
};

const workspace = (
  overrides: Partial<WorkspaceState> = {}
): WorkspaceState => ({
  catalog: [],
  currentWorkspace: null,
  error: null,
  generation: 0,
  pendingWorkspace: null,
  version: 1,
  ...overrides,
});

const sidebar = () => screen.getByRole("navigation");

const sidebarButton = (name: RegExp) =>
  within(sidebar()).getByRole("button", { name });

describe("App issue list view sidebar", () => {
  beforeEach(() => {
    loadIssueExplorerStateFromTauRpc.mockReset();
    open.mockReset();
    removeWorkspace.mockReset();
    resetWorkspaceMemory.mockReset();
    retryWorkspaceMemory.mockReset();
    switchWorkspace.mockReset();
    workspaceState.mockReset();
    workspaceState.mockRejectedValue(new Error("workspace unavailable"));
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

    expect(
      await screen.findByRole("button", { name: "Blocked, 0 issues" })
    ).toBeEnabled();
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
    expect(loadIssueExplorerStateFromTauRpc).toHaveBeenCalledTimes(1);

    await user.click(sidebarButton(/^Ready, 1 issue$/u));
    expect(loadIssueExplorerStateFromTauRpc).toHaveBeenCalledTimes(1);
  });

  it("renders backend-owned catalog order as MRU order", async () => {
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(failureState);
    workspaceState.mockResolvedValue(
      workspace({
        catalog: [
          { availability: "available", path: "/work/most-recent" },
          { availability: "available", path: "/work/older" },
        ],
      })
    );

    render(<App />);

    const catalog = await screen.findByRole("list", {
      name: "Known workspaces",
    });
    expect(
      within(catalog)
        .getAllByRole("listitem")
        .map((entry) => entry.textContent)
    ).toEqual([
      expect.stringContaining("/work/most-recent"),
      expect.stringContaining("/work/older"),
    ]);
  });

  it("leaves the app unchanged when the native picker is cancelled and defaults to the latest available workspace", async () => {
    const user = userEvent.setup();
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(failureState);
    workspaceState.mockResolvedValue(
      workspace({
        catalog: [
          { availability: "unavailable", path: "/work/missing" },
          { availability: "available", path: "/work/available" },
        ],
      })
    );
    open.mockResolvedValue(null);

    render(<App />);

    const choose = await within(sidebar()).findByRole("button", {
      name: "Choose folder",
    });
    await user.click(choose);

    await waitFor(() => {
      expect(open).toHaveBeenCalledWith({
        defaultPath: "/work/available",
        directory: true,
        multiple: false,
      });
    });
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it("clears the Issue Explorer to the empty chooser after removing Current Workspace", async () => {
    const user = userEvent.setup();
    const currentPath = "/work/current";
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [buildIssue()] })
    );
    workspaceState.mockResolvedValue(
      workspace({
        catalog: [
          { availability: "available", path: currentPath },
          { availability: "available", path: "/work/other" },
        ],
        currentWorkspace: { availability: "available", path: currentPath },
      })
    );
    removeWorkspace.mockResolvedValue(
      workspace({
        catalog: [{ availability: "available", path: "/work/other" }],
      })
    );

    render(<App />);

    const remove = await screen.findByRole("button", {
      name: `Remove ${currentPath}`,
    });
    await user.click(remove);

    expect(removeWorkspace).toHaveBeenCalledWith(currentPath);
    expect(
      await screen.findByRole("heading", { name: "Choose a workspace" })
    ).toBeInTheDocument();
  });

  it("refreshes and renders typed workspace failure after a rejected switch RPC", async () => {
    const user = userEvent.setup();
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(failureState);
    workspaceState
      .mockResolvedValueOnce(
        workspace({
          catalog: [{ availability: "available", path: "/work/current" }],
          currentWorkspace: {
            availability: "available",
            path: "/work/current",
          },
        })
      )
      .mockResolvedValueOnce(
        workspace({
          catalog: [{ availability: "available", path: "/work/current" }],
          currentWorkspace: {
            availability: "available",
            path: "/work/current",
          },
          error: {
            kind: "validationFailed",
            message: "Not a Beadwork workspace",
            retryable: true,
          },
        })
      );
    switchWorkspace.mockRejectedValue(new Error("validation failed"));

    render(<App />);

    const current = await screen.findByRole("button", {
      name: "current, /work/current, Available",
    });
    await user.click(current);

    expect(await screen.findByText("Not a Beadwork workspace")).toHaveAttribute(
      "role",
      "alert"
    );
  });
});

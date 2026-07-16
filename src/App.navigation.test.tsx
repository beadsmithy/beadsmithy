import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});

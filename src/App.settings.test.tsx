import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IssueExplorerLoadState } from "./issues/issue-loader";
import type * as IssueLoaderModule from "./issues/issue-loader";
import type * as BindingsModule from "./rpc/bindings";
import type { WorkspaceState } from "./rpc/bindings";
import {
  buildIssue,
  successState,
  workspace,
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
const settingsButton = () =>
  within(sidebar()).getByRole("button", { name: "Settings" });
const issueDetailMain = () =>
  screen.getByRole("main", { name: "Issue detail" });

describe("App settings", () => {
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
    updateAppSettings.mockImplementation((settings) =>
      Promise.resolve({
        markdown: { fontSizePx: settings.markdown.fontSizePx },
      })
    );
    listen.mockClear();
    listen.mockResolvedValue(vi.fn());
    workspaceState.mockReset();
    workspaceState.mockResolvedValue(workspace({ currentWorkspace: null }));
  });

  it("shows the Settings button enabled even before a workspace is selected", async () => {
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(successState({}));

    render(<App />);

    const button = await waitFor(() => settingsButton());
    expect(button).toBeEnabled();
  });

  it("opens the Settings page and marks the Settings button as current", async () => {
    const user = userEvent.setup();
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(successState({}));

    render(<App />);

    await waitFor(() => settingsButton());
    await user.click(settingsButton());

    expect(settingsButton()).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("main", { name: "Settings" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Markdown Typography" })
    ).toBeInTheDocument();
  });

  it("returns to the Issue Explorer and restores the active list view when a view is clicked", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({ status: "open" });

    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [issue], workspacePath: "/work" })
    );
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: { availability: "available", path: "/work" },
      })
    );

    render(<App />);

    const openButton = await screen.findByRole("button", {
      name: "Open, 1 issue",
    });

    await user.click(settingsButton());
    expect(screen.getByRole("main", { name: "Settings" })).toBeInTheDocument();

    await user.click(openButton);

    expect(openButton).toHaveAttribute("aria-current", "true");
    expect(settingsButton()).not.toHaveAttribute("aria-current");
    expect(
      screen.queryByRole("main", { name: "Settings" })
    ).not.toBeInTheDocument();
  });

  it("keeps the Issue Explorer inert and hidden from assistive tech while Settings is open", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({ id: "bsm-a", status: "open", title: "Alpha" });

    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [issue], workspacePath: "/work" })
    );
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: { availability: "available", path: "/work" },
      })
    );

    render(<App />);

    await waitFor(() => issueDetailMain());
    const explorerMain = issueDetailMain();
    const explorerWrapper = explorerMain.parentElement;

    await user.click(settingsButton());

    expect(explorerWrapper).toHaveAttribute("aria-hidden", "true");
    expect(explorerWrapper).toHaveAttribute("inert");
    expect(explorerWrapper).toHaveClass("invisible");
  });

  it("preserves search query and selected issue across a Settings visit", async () => {
    const user = userEvent.setup();
    const alpha = buildIssue({
      id: "bsm-a",
      status: "open",
      title: "Alpha one",
    });
    const beta = buildIssue({ id: "bsm-b", status: "open", title: "Beta two" });

    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [alpha, beta], workspacePath: "/work" })
    );
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: { availability: "available", path: "/work" },
      })
    );

    render(<App />);

    await screen.findByRole("button", { name: "All, 2 issues" });

    const searchBox = screen.getByRole("textbox", {
      name: "Search issues",
    });

    await user.type(searchBox, "Alpha");
    await user.click(screen.getByRole("button", { name: /Alpha one/iu }));

    await waitFor(() =>
      expect(
        within(issueDetailMain()).getByRole("heading", { name: "Alpha one" })
      ).toBeInTheDocument()
    );

    await user.click(settingsButton());
    expect(screen.getByRole("main", { name: "Settings" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All, 2 issues" }));

    expect(searchBox).toHaveValue("Alpha");
    expect(
      within(issueDetailMain()).getByRole("heading", { name: "Alpha one" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Alpha one/iu })).toHaveAttribute(
      "aria-current",
      "true"
    );
  });

  it("applies the settings font size to rendered Markdown in issue detail", async () => {
    const user = userEvent.setup();
    const issue = buildIssue({
      description: "Some **markdown** description.",
      id: "bsm-a",
      status: "open",
      title: "Alpha",
    });

    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [issue], workspacePath: "/work" })
    );
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: { availability: "available", path: "/work" },
      })
    );

    render(<App />);

    await waitFor(() => screen.getByRole("button", { name: /Alpha/iu }));
    await user.click(screen.getByRole("button", { name: /Alpha/iu }));

    const article = await waitFor(() =>
      within(issueDetailMain()).getByRole("article")
    );
    expect(article).toHaveStyle({ fontSize: "14px" });

    await user.click(settingsButton());

    const fontSizeInput = screen.getByRole("spinbutton", {
      name: "Base font size in pixels",
    });
    fireEvent.change(fontSizeInput, { target: { value: "24" } });

    await user.click(screen.getByRole("button", { name: "All, 1 issue" }));

    await waitFor(() => expect(article).toHaveStyle({ fontSize: "24px" }));
  });

  it("persists the settings font size across a workspace switch", async () => {
    const user = userEvent.setup();
    const issueA = buildIssue({
      description: "Description A.",
      id: "bsm-a",
      status: "open",
      title: "Alpha",
    });
    const issueB = buildIssue({
      description: "Description B.",
      id: "bsm-b",
      status: "open",
      title: "Beta",
    });

    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [issueA], workspacePath: "/work/a" })
    );

    workspaceState.mockResolvedValue(
      workspace({
        catalog: [
          { availability: "available", path: "/work/a" },
          { availability: "available", path: "/work/b" },
        ],
        currentWorkspace: { availability: "available", path: "/work/a" },
        generation: 1,
      })
    );

    switchWorkspace.mockResolvedValue({
      issueData: successState({
        allIssues: [issueB],
        workspacePath: "/work/b",
      }),
      state: workspace({
        catalog: [
          { availability: "available", path: "/work/a" },
          { availability: "available", path: "/work/b" },
        ],
        currentWorkspace: { availability: "available", path: "/work/b" },
        generation: 2,
      }),
    });

    render(<App />);

    await waitFor(() => screen.getByRole("button", { name: /Alpha/iu }));
    await user.click(screen.getByRole("button", { name: /Alpha/iu }));

    await user.click(settingsButton());

    const fontSizeInput = screen.getByRole("spinbutton", {
      name: "Base font size in pixels",
    });
    fireEvent.change(fontSizeInput, { target: { value: "32" } });

    await user.click(screen.getByRole("button", { name: "All, 1 issue" }));

    await user.click(
      screen.getByRole("button", { name: "b, /work/b, Available" })
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Beta/iu })).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /Beta/iu }));

    const article = within(issueDetailMain()).getByRole("article");
    await waitFor(() => expect(article).toHaveStyle({ fontSize: "32px" }));
  });
});

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
const listen = vi.fn().mockResolvedValue(vi.fn());
const createTauRPCProxy = vi.fn(() => ({
  cancel_workspace: cancelWorkspace,
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
vi.mock("@tauri-apps/api/event", () => ({ listen }));

const { default: App } = await import("./App");

const sidebar = () => screen.getByRole("navigation");

describe("App workspace selection", () => {
  beforeEach(() => {
    loadIssueExplorerStateFromTauRpc.mockReset();
    open.mockReset();
    removeWorkspace.mockReset();
    resetWorkspaceMemory.mockReset();
    retryWorkspaceMemory.mockReset();
    switchWorkspace.mockReset();
    cancelWorkspace.mockReset();
    listen.mockClear();
    listen.mockResolvedValue(vi.fn());
    workspaceState.mockReset();
    workspaceState.mockRejectedValue(new Error("workspace unavailable"));
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

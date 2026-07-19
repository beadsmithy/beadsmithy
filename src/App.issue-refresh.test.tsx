import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IssueExplorerLoadState } from "./issues/issue-loader";
import type * as IssueLoaderModule from "./issues/issue-loader";
import type * as BindingsModule from "./rpc/bindings";
import type {
  LoadIssueExplorerDataResponse,
  WorkspaceState,
} from "./rpc/bindings";
import {
  buildIssue,
  createBothListenersMock,
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

const refreshPayload = (overrides: {
  observedRefSha?: string;
  refreshRevision: number;
  issueData: LoadIssueExplorerDataResponse;
}) => ({
  issueData: overrides.issueData,
  observedRefSha: overrides.observedRefSha ?? "abc123",
  refreshRevision: overrides.refreshRevision,
  workspacePath: overrides.issueData.workspacePath,
  workspaceSelectionGeneration: overrides.issueData.workspaceGeneration,
});

describe("App issue explorer refresh", () => {
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
    workspaceState.mockResolvedValue({
      catalog: [],
      currentWorkspace: null,
      error: null,
      generation: 0,
      pendingWorkspace: null,
      retryWorkspace: null,
      version: 1,
    });
  });

  it("registers the refresh listener alongside the workspace transition listener", async () => {
    const { listeners, implementation } = createBothListenersMock();
    listen.mockImplementation(implementation);

    const aIssue = buildIssue({ id: "bsm-initial", title: "Initial issue" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [aIssue], workspaceGeneration: 1 })
    );

    render(<App />);

    await waitFor(() => {
      expect(listeners.transition).toBeDefined();
      expect(listeners.refresh).toBeDefined();
    });
  });

  it("admits a matching newer refresh and replaces the success snapshot in place", async () => {
    const { listeners, implementation } = createBothListenersMock();
    listen.mockImplementation(implementation);

    const aIssue = buildIssue({ id: "shared", title: "Original issue" });
    const newIssue = buildIssue({ id: "bsm-new", title: "New issue" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [aIssue],
        workspaceGeneration: 1,
        workspacePath: "/work/a",
      })
    );
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: { availability: "available", path: "/work/a" },
        generation: 1,
      })
    );

    render(<App />);
    await waitFor(() => {
      expect(listeners.refresh).toBeDefined();
    });
    expect(await screen.findByText("Original issue")).toBeInTheDocument();

    // Ref move observed externally: backend emits a refresh with the
    // newest snapshot and a higher revision.
    act(() => {
      listeners.refresh?.({
        payload: refreshPayload({
          issueData: {
            allIssues: [newIssue],
            blockedIssues: [],
            readyIssues: [newIssue],
            workspaceGeneration: 1,
            workspacePath: "/work/a",
          },
          refreshRevision: 5,
        }),
      });
    });

    expect(await screen.findByText("New issue")).toBeInTheDocument();
    expect(screen.queryByText("Original issue")).toBeNull();

    // Sidebar counts rederive from the new snapshot.
    const readyButton = await screen.findByRole("button", {
      name: /^Ready,/u,
    });
    expect(await readyButton.getAttribute("aria-label")).toBe("Ready, 1 issue");
  });

  it("does not show the loading state while a refresh is in flight", async () => {
    const { listeners, implementation } = createBothListenersMock();
    listen.mockImplementation(implementation);

    const aIssue = buildIssue({ id: "shared", title: "Initial" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [aIssue],
        workspaceGeneration: 1,
        workspacePath: "/work/a",
      })
    );
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: { availability: "available", path: "/work/a" },
        generation: 1,
      })
    );

    render(<App />);
    await waitFor(() => {
      expect(listeners.refresh).toBeDefined();
    });
    expect(await screen.findByText("Initial")).toBeInTheDocument();

    // Fire a refresh event. The original list must remain visible
    // during the synchronous React commit (the synchronous act callback
    // commits immediately, so we read state at the end).
    act(() => {
      listeners.refresh?.({
        payload: refreshPayload({
          issueData: {
            allIssues: [buildIssue({ id: "fresh", title: "Fresh" })],
            blockedIssues: [],
            readyIssues: [],
            workspaceGeneration: 1,
            workspacePath: "/work/a",
          },
          refreshRevision: 2,
        }),
      });
    });

    // No loading spinner orchooser was shown.
    expect(screen.queryByText(/^Loading/u)).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Choose a workspace" })
    ).toBeNull();
    expect(screen.getByText("Fresh")).toBeInTheDocument();
  });

  it("does not disturb the outer Issue Explorer remount key on a refresh", async () => {
    // A refresh must not remount the Issue Explorer subtree: the same
    // workspace identity is rendered through the whole sequence. We
    // observe this indirectly by ensuring the loading state never
    // appears and the rendered issue title swaps without a chooser
    // flash.
    const { listeners, implementation } = createBothListenersMock();
    listen.mockImplementation(implementation);

    const initial = buildIssue({ id: "shared", title: "Initial" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [initial],
        workspaceGeneration: 1,
        workspacePath: "/work/a",
      })
    );
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: { availability: "available", path: "/work/a" },
        generation: 1,
      })
    );

    render(<App />);
    await waitFor(() => {
      expect(listeners.refresh).toBeDefined();
    });
    expect(await screen.findByText("Initial")).toBeInTheDocument();

    // Several rapid refreshes all converge to the newest revision.
    for (const revision of [3, 4, 5]) {
      act(() => {
        listeners.refresh?.({
          payload: refreshPayload({
            issueData: {
              allIssues: [
                buildIssue({ id: "shared", title: `Revision ${revision}` }),
              ],
              blockedIssues: [],
              readyIssues: [
                buildIssue({ id: "shared", title: `Revision ${revision}` }),
              ],
              workspaceGeneration: 1,
              workspacePath: "/work/a",
            },
            refreshRevision: revision,
          }),
        });
      });
    }

    expect(await screen.findByText("Revision 5")).toBeInTheDocument();
    expect(screen.queryByText(/^Loading/u)).toBeNull();
  });

  it("ignores a refresh for a different workspace path", async () => {
    const { listeners, implementation } = createBothListenersMock();
    listen.mockImplementation(implementation);

    const aIssue = buildIssue({ id: "shared", title: "Original" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [aIssue],
        workspaceGeneration: 1,
        workspacePath: "/work/a",
      })
    );
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: { availability: "available", path: "/work/a" },
        generation: 1,
      })
    );

    render(<App />);
    await waitFor(() => {
      expect(listeners.refresh).toBeDefined();
    });
    expect(await screen.findByText("Original")).toBeInTheDocument();

    act(() => {
      listeners.refresh?.({
        payload: refreshPayload({
          issueData: {
            allIssues: [buildIssue({ id: "x", title: "Foreign" })],
            blockedIssues: [],
            readyIssues: [],
            workspaceGeneration: 1,
            workspacePath: "/work/b",
          },
          refreshRevision: 4,
        }),
      });
    });

    expect(screen.getByText("Original")).toBeInTheDocument();
    expect(screen.queryByText("Foreign")).toBeNull();
  });

  it("ignores a refresh with an older revision than the one already admitted", async () => {
    const { listeners, implementation } = createBothListenersMock();
    listen.mockImplementation(implementation);

    const aIssue = buildIssue({ id: "shared", title: "Original" });
    const newerIssue = buildIssue({ id: "shared", title: "Newer" });
    const staleIssue = buildIssue({ id: "shared", title: "Stale" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [aIssue],
        workspaceGeneration: 1,
        workspacePath: "/work/a",
      })
    );
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: { availability: "available", path: "/work/a" },
        generation: 1,
      })
    );

    render(<App />);
    await waitFor(() => {
      expect(listeners.refresh).toBeDefined();
    });
    expect(await screen.findByText("Original")).toBeInTheDocument();

    // First, admit revision 20 (newer).
    act(() => {
      listeners.refresh?.({
        payload: refreshPayload({
          issueData: {
            allIssues: [newerIssue],
            blockedIssues: [],
            readyIssues: [],
            workspaceGeneration: 1,
            workspacePath: "/work/a",
          },
          refreshRevision: 20,
        }),
      });
    });
    expect(await screen.findByText("Newer")).toBeInTheDocument();

    // Then a stale revision 19 arrives.
    act(() => {
      listeners.refresh?.({
        payload: refreshPayload({
          issueData: {
            allIssues: [staleIssue],
            blockedIssues: [],
            readyIssues: [],
            workspaceGeneration: 1,
            workspacePath: "/work/a",
          },
          refreshRevision: 19,
        }),
      });
    });

    // The newer snapshot remains in place.
    expect(screen.getByText("Newer")).toBeInTheDocument();
    expect(screen.queryByText("Stale")).toBeNull();
  });

  it("ignores a refresh whose nested snapshot identity disagrees with the envelope", async () => {
    const { listeners, implementation } = createBothListenersMock();
    listen.mockImplementation(implementation);

    const aIssue = buildIssue({ id: "shared", title: "Original" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [aIssue],
        workspaceGeneration: 1,
        workspacePath: "/work/a",
      })
    );
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: { availability: "available", path: "/work/a" },
        generation: 1,
      })
    );

    render(<App />);
    await waitFor(() => {
      expect(listeners.refresh).toBeDefined();
    });
    expect(await screen.findByText("Original")).toBeInTheDocument();

    act(() => {
      listeners.refresh?.({
        payload: {
          issueData: {
            allIssues: [buildIssue({ id: "x", title: "Inconsistent" })],
            blockedIssues: [],
            readyIssues: [],
            workspaceGeneration: 2,
            workspacePath: "/work/b",
          },
          observedRefSha: "abc",
          refreshRevision: 3,
          workspacePath: "/work/a",
          workspaceSelectionGeneration: 1,
        },
      });
    });

    expect(screen.getByText("Original")).toBeInTheDocument();
    expect(screen.queryByText("Inconsistent")).toBeNull();
  });

  it("continues to admit refreshes after a Pending transition that retains the same Current", async () => {
    const { listeners, implementation } = createBothListenersMock();
    listen.mockImplementation(implementation);

    const aIssue = buildIssue({ id: "shared", title: "A issue" });
    const newIssue = buildIssue({ id: "bsm-new", title: "Brand new" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [aIssue],
        workspaceGeneration: 1,
        workspacePath: "/work/a",
      })
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

    render(<App />);
    await waitFor(() => {
      expect(listeners.refresh).toBeDefined();
    });
    expect(await screen.findByText("A issue")).toBeInTheDocument();

    // Pending transition (user clicked B): confirmed identity remains A.
    act(() => {
      listeners.transition?.({
        payload: {
          issueData: null,
          state: workspace({
            catalog: [
              { availability: "available", path: "/work/a" },
              { availability: "available", path: "/work/b" },
            ],
            currentWorkspace: { availability: "available", path: "/work/a" },
            generation: 2,
            pendingWorkspace: { availability: "available", path: "/work/b" },
          }),
        },
      });
    });

    // Refresh for the still-current A must still be admitted.
    act(() => {
      listeners.refresh?.({
        payload: refreshPayload({
          issueData: {
            allIssues: [newIssue],
            blockedIssues: [],
            readyIssues: [],
            workspaceGeneration: 1,
            workspacePath: "/work/a",
          },
          refreshRevision: 4,
        }),
      });
    });

    expect(await screen.findByText("Brand new")).toBeInTheDocument();
  });
});

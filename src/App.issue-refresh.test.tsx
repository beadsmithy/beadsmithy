import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IssueExplorerLoadState } from "./issues/issue-loader";
import type * as IssueLoaderModule from "./issues/issue-loader";
import type * as BindingsModule from "./rpc/bindings";
import type {
  LoadIssueExplorerDataResponse,
  WorkspaceState,
} from "./rpc/bindings";
import type { RefreshFailure } from "./refresh-health";
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
  workspaceSelectionGeneration?: number;
}) => ({
  eventType: "snapshot" as const,
  issueData: overrides.issueData,
  observedRefSha: overrides.observedRefSha ?? "abc123",
  refreshRevision: overrides.refreshRevision,
  workspacePath: overrides.issueData.workspacePath,
  workspaceSelectionGeneration:
    overrides.workspaceSelectionGeneration ??
    overrides.issueData.workspaceGeneration,
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

    // Refresh for the still-current A must still be admitted while the
    // Pending transition is in flight. The gate intentionally does
    // NOT rebind during Pending (an already-emitted gen-1 refresh for
    // A might arrive after this transition event), so the refresh event
    // carries the prior generation and is admitted as-is. While Pending
    // the renderer's `presentedIssueState` masks the underlying
    // success snapshot with the established loading presentation, so
    // the renderer shows "Loading b…" rather than "Brand new" here;
    // Cancel reveals the admitted refresh.
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
          workspaceSelectionGeneration: 1,
        }),
      });
    });

    // While Pending: established loading presentation for the
    // in-flight switch masks the admitted A refresh. The underlying
    // `issueState` carries A's admitted refresh, but the rendered DOM
    // shows the loading presentation rather than A's Issue List.
    expect(screen.getByText("Loading b…")).toBeInTheDocument();
    expect(screen.queryByText("Brand new")).toBeNull();
    expect(screen.queryByText("A issue")).toBeNull();

    // Cancel drops Pending; A's admitted refresh surfaces.
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
          }),
        },
      });
    });

    expect(await screen.findByText("Brand new")).toBeInTheDocument();
  });

  it("renders the refresh-failure banner above the list when a Health event arrives", async () => {
    // After a healthy snapshot has rendered, a Health event with a
    // missing-bw failure must surface the canonical banner copy while
    // retaining the rendered list below it. The banner is a non-scrolling
    // sibling; search remains enabled and the chooser does not appear.
    const { listeners, implementation } = createBothListenersMock();
    listen.mockImplementation(implementation);

    const initialIssue = buildIssue({ id: "shared", title: "Original" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [initialIssue],
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

    const healthFailure: RefreshFailure = {
      errorKind: "missingBw",
      failureRevision: 1,
      message: "bw missing",
      transient: false,
    };
    act(() => {
      listeners.refresh?.({
        payload: {
          eventType: "health",
          health: { refProbe: null, loader: healthFailure },
          refreshRevision: 5,
          workspacePath: "/work/a",
          workspaceSelectionGeneration: 1,
        },
      });
    });

    const banner = await screen.findByTestId("refresh-failure-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("role", "status");
    expect(banner.textContent).toContain(
      "Automatic refresh needs bw on PATH to read Beadwork data."
    );
    // The Issue List is preserved under the banner.
    expect(screen.getByText("Original")).toBeInTheDocument();
    // Search remains enabled.
    expect(screen.getByPlaceholderText("Search issues...")).not.toBeDisabled();
    // No chooser replaces the rendered list.
    expect(
      screen.queryByRole("heading", { name: "Choose a workspace" })
    ).toBeNull();
  });

  it("clears the banner when a Health event with empty slots arrives", async () => {
    const { listeners, implementation } = createBothListenersMock();
    listen.mockImplementation(implementation);

    const initialIssue = buildIssue({ id: "shared", title: "Original" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [initialIssue],
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

    const bannerFailure: RefreshFailure = {
      errorKind: "refProbe",
      failureRevision: 5,
      message: "failing",
      transient: true,
    };
    act(() => {
      listeners.refresh?.({
        payload: {
          eventType: "health",
          health: { refProbe: bannerFailure, loader: null },
          refreshRevision: 3,
          workspacePath: "/work/a",
          workspaceSelectionGeneration: 1,
        },
      });
    });
    expect(await screen.findByTestId("refresh-failure-banner")).toBeInTheDocument();

    act(() => {
      listeners.refresh?.({
        payload: {
          eventType: "health",
          health: { refProbe: null, loader: null },
          refreshRevision: 4,
          workspacePath: "/work/a",
          workspaceSelectionGeneration: 1,
        },
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("refresh-failure-banner")).toBeNull();
    });
    // The Issue List is preserved through recovery.
    expect(screen.getByText("Original")).toBeInTheDocument();
  });

  it("ignores a Health event whose generation is older than the confirmed identity", async () => {
    const { listeners, implementation } = createBothListenersMock();
    listen.mockImplementation(implementation);

    const initialIssue = buildIssue({ id: "shared", title: "Original" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [initialIssue],
        workspaceGeneration: 2,
        workspacePath: "/work/a",
      })
    );
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: { availability: "available", path: "/work/a" },
        generation: 2,
      })
    );

    render(<App />);
    await waitFor(() => {
      expect(listeners.refresh).toBeDefined();
    });
    expect(await screen.findByText("Original")).toBeInTheDocument();

    // First, admit a Health event at the confirmed generation.
    act(() => {
      listeners.refresh?.({
        payload: {
          eventType: "health",
          health: {
            refProbe: {
              errorKind: "refProbe",
              failureRevision: 5,
              message: "failing",
              transient: true,
            },
            loader: null,
          },
          refreshRevision: 5,
          workspacePath: "/work/a",
          workspaceSelectionGeneration: 2,
        },
      });
    });
    expect(await screen.findByTestId("refresh-failure-banner")).toBeInTheDocument();

    // A stale Health event for a previous generation is ignored.
    act(() => {
      listeners.refresh?.({
        payload: {
          eventType: "health",
          health: {
            refProbe: {
              errorKind: "refProbe",
              failureRevision: 9,
              message: "old",
              transient: true,
            },
            loader: null,
          },
          refreshRevision: 9,
          workspacePath: "/work/a",
          workspaceSelectionGeneration: 1,
        },
      });
    });
    // The original banner remains (the stale event did not replace it).
    expect(screen.getByTestId("refresh-failure-banner")).toBeInTheDocument();
  });

  it("retains both Snapshot and Health variants deferred for the same not-yet-admitted identity", async () => {
    // When the renderer has no confirmed identity (e.g. before the
    // startup snapshot commits), both Snapshot and Health events for
    // the same not-yet-admitted identity must be retained in the
    // deferred buffer. The previous single-slot buffer silently
    // dropped one variant when both were pending for the same
    // identity.
    const { listeners, implementation } = createBothListenersMock();
    listen.mockImplementation(implementation);

    // First startup load never resolves so the gate has no confirmed
    // identity; both refresh events will defer.
    let resolveStartup: ((value: IssueExplorerLoadState) => void) | undefined;
    loadIssueExplorerStateFromTauRpc.mockImplementation(
      () =>
        new Promise<IssueExplorerLoadState>((resolve) => {
          resolveStartup = resolve;
        })
    );
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: { availability: "available", path: "/work/a" },
        generation: 2,
      })
    );

    render(<App />);
    await waitFor(() => {
      expect(listeners.refresh).toBeDefined();
    });

    // Deferred Snapshot for generation 2.
    act(() => {
      listeners.refresh?.({
        payload: {
          eventType: "snapshot",
          issueData: {
            allIssues: [buildIssue({ id: "x", title: "Deferred" })],
            blockedIssues: [],
            readyIssues: [],
            workspaceGeneration: 2,
            workspacePath: "/work/a",
          },
          observedRefSha: "abc",
          refreshRevision: 10,
          workspacePath: "/work/a",
          workspaceSelectionGeneration: 2,
        },
      });
    });

    // Deferred Health for the same generation.
    act(() => {
      listeners.refresh?.({
        payload: {
          eventType: "health",
          health: {
            refProbe: {
              errorKind: "refProbe",
              failureRevision: 11,
              message: "failing",
              transient: true,
            },
            loader: null,
          },
          refreshRevision: 11,
          workspacePath: "/work/a",
          workspaceSelectionGeneration: 2,
        },
      });
    });

    // Now resolve the startup snapshot at generation 2 — this admits
    // the confirmed identity. Both deferred events must replay.
    resolveStartup?.(
      successState({
        allIssues: [buildIssue({ id: "first", title: "First" })],
        workspaceGeneration: 2,
        workspacePath: "/work/a",
      })
    );

    expect(await screen.findByText("Deferred")).toBeInTheDocument();
    // The Health event must also have been replayed and the banner
    // must show the structural copy for the refProbe failure.
    expect(await screen.findByTestId("refresh-failure-banner")).toBeInTheDocument();
    expect(
      screen.getByTestId("refresh-failure-banner").textContent
    ).toContain("Automatic refresh is failing while checking Beadwork changes.");
  });
});

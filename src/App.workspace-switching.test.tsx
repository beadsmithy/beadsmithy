import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IssueExplorerLoadState } from "./issues/issue-loader";
import type * as IssueLoaderModule from "./issues/issue-loader";
import type * as BindingsModule from "./rpc/bindings";
import type { WorkspaceState, WorkspaceSwitchResponse } from "./rpc/bindings";
import {
  buildIssue,
  successState,
  workspace,
} from "./test/app-workspace-fixtures";
import type { WorkspaceTransitionListener } from "./test/app-workspace-fixtures";

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

describe("App workspace switching", () => {
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

  it("drops a late older-generation workspace transition", async () => {
    let transitionListener: WorkspaceTransitionListener | undefined;
    // oxlint-disable-next-line promise/prefer-await-to-callbacks
    listen.mockImplementation((_eventName, callback) => {
      transitionListener = callback;
      return Promise.resolve(vi.fn());
    });

    const aIssue = buildIssue({ id: "shared", title: "A issue" });
    const bIssue = buildIssue({ id: "shared", title: "B issue" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [aIssue] })
    );
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: { availability: "available", path: "/work/a" },
        generation: 1,
      })
    );

    render(<App />);
    await waitFor(() => {
      expect(transitionListener).toBeDefined();
    });

    act(() => {
      transitionListener?.({
        payload: {
          issueData: {
            allIssues: [bIssue],
            blockedIssues: [],
            readyIssues: [],
            workspacePath: "/work/b",
          },
          state: workspace({
            currentWorkspace: { availability: "available", path: "/work/b" },
            generation: 2,
          }),
        },
      });
    });
    expect(await screen.findByText("B issue")).toBeInTheDocument();

    act(() => {
      transitionListener?.({
        payload: {
          issueData: {
            allIssues: [aIssue],
            blockedIssues: [],
            readyIssues: [],
            workspacePath: "/work/a",
          },
          state: workspace({
            currentWorkspace: { availability: "available", path: "/work/a" },
            generation: 1,
          }),
        },
      });
    });

    expect(screen.getByText("B issue")).toBeInTheDocument();
    expect(screen.queryByText("A issue")).toBeNull();
  });
  it("preserves the prior Issue Explorer snapshot when switch_workspace rejects", async () => {
    const user = userEvent.setup();
    const aIssue = buildIssue({ id: "bsm-current", title: "Current issue" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [aIssue] })
    );
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
      .mockResolvedValue(
        workspace({
          catalog: [{ availability: "available", path: "/work/current" }],
          currentWorkspace: {
            availability: "available",
            path: "/work/current",
          },
        })
      );
    switchWorkspace.mockRejectedValue(new Error("load failed"));

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "current, /work/current, Available",
      })
    );

    // Rejection never swapped snapshots: the prior issue is still listed.
    expect(await screen.findByText("Current issue")).toBeInTheDocument();
  });
  it("keeps a Pending transition visible until the success RPC commits, then ignores a delayed same-generation replay", async () => {
    let transitionListener: WorkspaceTransitionListener | undefined;
    // oxlint-disable-next-line promise/prefer-await-to-callbacks
    listen.mockImplementation((_eventName, callback) => {
      transitionListener = callback;
      return Promise.resolve(vi.fn());
    });

    const aIssue = buildIssue({ id: "shared", title: "A issue" });
    const bIssue = buildIssue({ id: "shared", title: "B issue" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [aIssue] })
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
    // Success RPC for B is slow; Pending events arrive first, then commit.
    let resolveSwitch!: (value: WorkspaceSwitchResponse) => void;
    switchWorkspace.mockImplementation(
      () =>
        // The test must explicitly resolve the in-flight typed RPC after
        // asserting the intermediate Pending DOM state.
        // oxlint-disable-next-line promise/avoid-new
        new Promise<WorkspaceSwitchResponse>((resolve) => {
          resolveSwitch = resolve;
        })
    );

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => {
      expect(transitionListener).toBeDefined();
    });

    await user.click(
      await screen.findByRole("button", { name: "b, /work/b, Available" })
    );

    // Pending arrives before the success RPC. This is the legitimate
    // Pending-before-success sequence the renderer must still surface.
    act(() => {
      transitionListener?.({
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

    // A's snapshot remains visible while B is Pending.
    expect(screen.getByText("A issue")).toBeInTheDocument();
    expect(screen.getByText("Loading b…")).toBeInTheDocument();

    // Now the commit fires. The committed-success guard marks generation 2
    // as terminal.
    act(() => {
      resolveSwitch({
        issueData: {
          allIssues: [bIssue],
          blockedIssues: [],
          readyIssues: [],
          workspacePath: "/work/b",
        },
        state: workspace({
          catalog: [
            { availability: "available", path: "/work/a" },
            { availability: "available", path: "/work/b" },
          ],
          currentWorkspace: { availability: "available", path: "/work/b" },
          generation: 2,
        }),
      });
    });

    expect(await screen.findByText("B issue")).toBeInTheDocument();
    expect(screen.queryByText(/^Loading b…$/u)).toBeNull();
  });
  it("produces no mixed workspace state or Issue Explorer snapshot when the success RPC completes before its own Pending transition event", async () => {
    // This test directly asserts the reviewer-flagged invariant: even when
    // the backend completes the durable commit and emits the Pending event
    // afterward (a real race against `emit_transition` ordering), the
    // renderer must not end up with workspaceState pointing at "pending=B,
    // current=null" while the Issue Explorer still shows B's snapshot.
    let transitionListener: WorkspaceTransitionListener | undefined;
    // oxlint-disable-next-line promise/prefer-await-to-callbacks
    listen.mockImplementation((_eventName, callback) => {
      transitionListener = callback;
      return Promise.resolve(vi.fn());
    });

    const aIssue = buildIssue({ id: "shared", title: "A issue" });
    const bIssue = buildIssue({ id: "shared", title: "B issue" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [aIssue] })
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
    switchWorkspace.mockImplementation((path: string) =>
      Promise.resolve({
        issueData: {
          allIssues: [bIssue],
          blockedIssues: [],
          readyIssues: [],
          workspacePath: path,
        },
        state: workspace({
          catalog: [
            { availability: "available", path: "/work/a" },
            { availability: "available", path: "/work/b" },
          ],
          currentWorkspace: { availability: "available", path },
          generation: 2,
        }),
      })
    );

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => {
      expect(transitionListener).toBeDefined();
    });

    await user.click(
      await screen.findByRole("button", { name: "b, /work/b, Available" })
    );
    expect(await screen.findByText("B issue")).toBeInTheDocument();

    // Backend delivered the success RPC first (commit), then the Pending
    // transition event for the same generation arrives late.
    act(() => {
      transitionListener?.({
        payload: {
          issueData: null,
          state: workspace({
            catalog: [
              { availability: "available", path: "/work/a" },
              { availability: "available", path: "/work/b" },
            ],
            currentWorkspace: null,
            generation: 2,
            pendingWorkspace: { availability: "available", path: "/work/b" },
          }),
        },
      });
    });
    // And another stale replay with a non-matching currentPath at the same
    // generation; it must also be rejected so a future regression that drops
    // the committed guard cannot reintroduce a mixed state through this
    // other hand-rolled payload shape.
    act(() => {
      transitionListener?.({
        payload: {
          issueData: null,
          state: workspace({
            catalog: [
              { availability: "available", path: "/work/a" },
              { availability: "available", path: "/work/b" },
            ],
            currentWorkspace: {
              availability: "available",
              path: "/work/a",
            },
            generation: 2,
            pendingWorkspace: { availability: "available", path: "/work/b" },
          }),
        },
      });
    });

    // Workspace state is not mixed: B is Current, no Loading label is shown,
    // and the sidebar still marks B as Current (not pending A).
    expect(screen.queryByText(/^Loading b…$/u)).toBeNull();
    expect(
      within(screen.getByRole("navigation")).getByRole("button", {
        name: "b, /work/b, Available",
      })
    ).toHaveAttribute("aria-current", "true");
    // Issue Explorer snapshot is B's, not A's or a hybrid.
    expect(screen.getByText("B issue")).toBeInTheDocument();
    expect(screen.queryByText("A issue")).toBeNull();
  });
  it("preserves the typed current when an initial-load snapshot races a later committed switch", async () => {
    // bsm-kia.7 (2): the initial `load_issue_explorer_data` IPC can be in
    // flight while a user-driven switch is also racing. The committed B
    // snapshot must win; the initial A snapshot returned late must not
    // overwrite it.
    const aIssue = buildIssue({ id: "bsm-current", title: "Current issue" });
    const bIssue = buildIssue({ id: "shared", title: "B issue" });

    let resolveInitialLoad:
      | ((value: IssueExplorerLoadState) => void)
      | undefined;
    loadIssueExplorerStateFromTauRpc.mockImplementation(
      () =>
        // oxlint-disable-next-line promise/avoid-new
        new Promise<IssueExplorerLoadState>((resolve) => {
          resolveInitialLoad = resolve;
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
    switchWorkspace.mockImplementation((path: string) =>
      Promise.resolve({
        issueData: {
          allIssues: [bIssue],
          blockedIssues: [],
          readyIssues: [],
          workspacePath: path,
        },
        state: workspace({
          catalog: [
            { availability: "available", path: "/work/a" },
            { availability: "available", path: "/work/b" },
          ],
          currentWorkspace: { availability: "available", path },
          generation: 2,
        }),
      })
    );

    const user = userEvent.setup();
    render(<App />);

    // Switch to B commits BEFORE the initial load resolves. The renderer
    // must already render B's snapshot.
    await user.click(
      await screen.findByRole("button", { name: "b, /work/b, Available" })
    );
    expect(await screen.findByText("B issue")).toBeInTheDocument();

    // Now the initial load resolves with A's snapshot. The renderer must
    // NOT overwrite B's snapshot with A's.
    act(() => {
      resolveInitialLoad?.(
        successState({ allIssues: [aIssue], workspacePath: "/work/a" })
      );
    });

    expect(screen.getByText("B issue")).toBeInTheDocument();
    expect(screen.queryByText("Current issue")).toBeNull();
  });
});

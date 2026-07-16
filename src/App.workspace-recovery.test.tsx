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

describe("App workspace recovery", () => {
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

  it("calls cancel_workspace when the in-flight Cancel control is clicked", async () => {
    const user = userEvent.setup();
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [buildIssue()] })
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
          pendingWorkspace: {
            availability: "available",
            path: "/work/second",
          },
        })
      );
    cancelWorkspace.mockResolvedValue(
      workspace({
        catalog: [{ availability: "available", path: "/work/current" }],
        currentWorkspace: {
          availability: "available",
          path: "/work/current",
        },
      })
    );
    // A failed switch leaves the catch branch to refresh workspaceState;
    // the second mock surfaces a pending workspace, which is what the
    // selector needs to render the Cancel control.
    switchWorkspace.mockRejectedValue(new Error("transient failure"));

    render(<App />);

    const trigger = await screen.findByRole("button", {
      name: "current, /work/current, Available",
    });
    await user.click(trigger);

    const cancelButton = await screen.findByTestId("cancel-workspace-switch");
    await user.click(cancelButton);
    expect(cancelWorkspace).toHaveBeenCalledTimes(1);
    expect(
      within(screen.getByRole("navigation")).getByRole("button", {
        name: "current, /work/current, Available",
      })
    ).toHaveAttribute("aria-current", "true");
  });
  it("renders a dismissible Retry banner for a loadFailed switch and hides both controls when dismissed", async () => {
    const user = userEvent.setup();
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [buildIssue()] })
    );
    workspaceState
      .mockResolvedValueOnce(
        workspace({
          catalog: [
            { availability: "available", path: "/work/first" },
            { availability: "available", path: "/work/second" },
          ],
          currentWorkspace: {
            availability: "available",
            path: "/work/first",
          },
        })
      )
      .mockResolvedValue(
        workspace({
          catalog: [
            { availability: "available", path: "/work/first" },
            { availability: "available", path: "/work/second" },
          ],
          currentWorkspace: {
            availability: "available",
            path: "/work/first",
          },
          error: {
            kind: "loadFailed",
            message: "Snapshot bytes could not be loaded",
            retryable: true,
          },
          retryWorkspace: {
            availability: "available",
            path: "/work/second",
          },
        })
      );
    switchWorkspace.mockRejectedValue(new Error("load failed"));

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "second, /work/second, Available",
      })
    );

    const banner = await screen.findByTestId("switch-failure-banner");
    expect(banner).toBeInTheDocument();
    expect(switchWorkspace).toHaveBeenCalledWith("/work/second");

    // Dismiss hides the banner but does not touch the catalog or Current.
    await user.click(
      within(banner).getByRole("button", { name: "Dismiss switch failure" })
    );
    await waitFor(() => {
      expect(screen.queryByTestId("switch-failure-banner")).toBeNull();
    });
    expect(
      within(screen.getByRole("navigation")).getByRole("button", {
        name: "first, /work/first, Available",
      })
    ).toHaveAttribute("aria-current", "true");
  });
  it("Retry replays the backend retry target through selectWorkspace", async () => {
    const user = userEvent.setup();
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [buildIssue()] })
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
      .mockResolvedValueOnce(
        workspace({
          catalog: [{ availability: "available", path: "/work/current" }],
          currentWorkspace: {
            availability: "available",
            path: "/work/current",
          },
          error: {
            kind: "loadFailed",
            message: "Snapshot bytes could not be loaded",
            retryable: true,
          },
          retryWorkspace: {
            availability: "available",
            path: "/work/second",
          },
        })
      );
    let calls = 0;
    switchWorkspace.mockImplementation((path: string) => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new Error("first attempt fails"));
      }
      return Promise.resolve({
        issueData: {
          allIssues: [],
          blockedIssues: [],
          readyIssues: [],
          workspacePath: path,
        },
        state: workspace({
          catalog: [{ availability: "available", path }],
          currentWorkspace: { availability: "available", path },
        }),
      });
    });

    render(<App />);

    open.mockResolvedValue("/work/second");
    await user.click(
      await screen.findByRole("button", { name: "Choose folder" })
    );

    const banner = await screen.findByTestId("switch-failure-banner");
    expect(banner).toBeInTheDocument();
    expect(switchWorkspace).toHaveBeenCalledTimes(1);

    await user.click(within(banner).getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(switchWorkspace).toHaveBeenCalledTimes(2);
    });
    expect(switchWorkspace).toHaveBeenNthCalledWith(2, "/work/second");
  });
  it("preserves the retry banner when delayed Pending follows a retryable failure", async () => {
    // bsm-kia.7 (4): a retryable failure must be terminal against any
    // late same-generation Pending transition so the Retry banner does
    // not disappear when an out-of-order Pending event arrives after the
    // load failure has already been accepted.
    let transitionListener: WorkspaceTransitionListener | undefined;
    // oxlint-disable-next-line promise/prefer-await-to-callbacks
    listen.mockImplementation((_eventName, callback) => {
      transitionListener = callback;
      return Promise.resolve(vi.fn());
    });

    const aIssue = buildIssue({ id: "shared", title: "A issue" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [aIssue] })
    );
    workspaceState
      .mockResolvedValueOnce(
        workspace({
          catalog: [
            { availability: "available", path: "/work/a" },
            { availability: "available", path: "/work/b" },
          ],
          currentWorkspace: { availability: "available", path: "/work/a" },
          generation: 1,
        })
      )
      .mockResolvedValue(
        workspace({
          catalog: [
            { availability: "available", path: "/work/a" },
            { availability: "available", path: "/work/b" },
          ],
          currentWorkspace: { availability: "available", path: "/work/a" },
          error: {
            kind: "loadFailed",
            message: "Snapshot bytes could not be loaded",
            retryable: true,
          },
          generation: 2,
          retryWorkspace: { availability: "available", path: "/work/b" },
        })
      );
    // switch_workspace rejects with a load failure; the renderer must
    // show the retry banner sourced from the typed refresh.
    switchWorkspace.mockRejectedValue(new Error("load failed"));

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => {
      expect(transitionListener).toBeDefined();
    });

    // Click into B's catalog entry to trigger the switch.
    await user.click(
      await screen.findByRole("button", { name: "b, /work/b, Available" })
    );

    // Failure banner appears from the typed refresh that surfaces the
    // loadFailed error and retry target.
    const banner = await screen.findByTestId("switch-failure-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("Snapshot bytes could not be loaded");

    // Late Pending event for the same generation arrives (out-of-order).
    // It must not roll the renderer back to "pending=B, current=A, no
    // error" — the banner must remain visible.
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
            error: null,
            generation: 2,
            pendingWorkspace: { availability: "available", path: "/work/b" },
            retryWorkspace: null,
          }),
        },
      });
    });

    expect(screen.queryByText(/^Loading b…$/u)).toBeNull();
    expect(screen.getByTestId("switch-failure-banner")).toBeInTheDocument();
  });
  it("preserves inline validation feedback when delayed Pending follows a non-retryable failure", async () => {
    let transitionListener: WorkspaceTransitionListener | undefined;
    // oxlint-disable-next-line promise/prefer-await-to-callbacks
    listen.mockImplementation((_eventName, callback) => {
      transitionListener = callback;
      return Promise.resolve(vi.fn());
    });

    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [buildIssue({ title: "A issue" })] })
    );
    workspaceState
      .mockResolvedValueOnce(
        workspace({
          catalog: [
            { availability: "available", path: "/work/a" },
            { availability: "available", path: "/work/b" },
          ],
          currentWorkspace: { availability: "available", path: "/work/a" },
          generation: 1,
        })
      )
      .mockResolvedValue(
        workspace({
          catalog: [
            { availability: "available", path: "/work/a" },
            { availability: "available", path: "/work/b" },
          ],
          currentWorkspace: { availability: "available", path: "/work/a" },
          error: {
            kind: "validationFailed",
            message: "Not a Beadwork workspace",
            retryable: true,
          },
          generation: 2,
        })
      );
    switchWorkspace.mockRejectedValue(new Error("validation failed"));

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => {
      expect(transitionListener).toBeDefined();
    });

    await user.click(
      await screen.findByRole("button", { name: "b, /work/b, Available" })
    );
    expect(await screen.findByText("Not a Beadwork workspace")).toHaveAttribute(
      "role",
      "alert"
    );

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

    expect(screen.queryByText(/^Loading b…$/u)).toBeNull();
    expect(screen.getByText("Not a Beadwork workspace")).toHaveAttribute(
      "role",
      "alert"
    );
    expect(screen.queryByTestId("switch-failure-banner")).toBeNull();
  });
  it("does not regress the committed snapshot when a Cancel transition races a success transition for the same generation", async () => {
    // bsm-kia.7 (1): the renderer must never show "B Current with A
    // snapshot". Reproduces the cancel-after-commit-before-success-
    // publication race at the renderer layer: a Cancel RPC response
    // bumps the accepted generation so the in-flight success transition
    // for the committed-but-not-yet-published B is rejected as "older
    // than accepted". The fix on the backend is that cancel_pending
    // without a pending request does not bump the generation, so a
    // same-generation success transition must still apply.
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
    cancelWorkspace.mockResolvedValue(
      workspace({
        catalog: [
          { availability: "available", path: "/work/a" },
          { availability: "available", path: "/work/b" },
        ],
        currentWorkspace: { availability: "available", path: "/work/a" },
        // Backend cancel_pending without a pending request does not
        // bump the generation, so the renderer must accept the
        // success transition that follows on the same generation.
        generation: 1,
        pendingWorkspace: null,
      })
    );
    switchWorkspace.mockResolvedValue({
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
        generation: 1,
        pendingWorkspace: null,
      }),
    });

    let resolveSwitch: ((value: WorkspaceSwitchResponse) => void) | undefined;
    switchWorkspace.mockImplementation(
      () =>
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

    // Start B and show its Pending state. The user can still click Cancel
    // while this event is displayed.
    await user.click(
      await screen.findByRole("button", { name: "b, /work/b, Available" })
    );
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

    // The final commit has already happened in the backend, so its Cancel
    // response carries B Current but intentionally keeps generation 2.
    // Its snapshot is still unpublished, so A remains rendered here.
    cancelWorkspace.mockResolvedValue(
      workspace({
        catalog: [
          { availability: "available", path: "/work/a" },
          { availability: "available", path: "/work/b" },
        ],
        currentWorkspace: { availability: "available", path: "/work/b" },
        generation: 2,
      })
    );
    await user.click(await screen.findByTestId("cancel-workspace-switch"));
    await waitFor(() => {
      expect(cancelWorkspace).toHaveBeenCalledTimes(1);
    });

    // The delayed success publication is still generation 2, so it must
    // be accepted and replace A's snapshot with B's snapshot.
    act(() => {
      resolveSwitch?.({
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
    expect(screen.queryByText("A issue")).toBeNull();
  });
  it("retry_workspace_memory response carries the restored Issue Explorer snapshot through applyTransition", async () => {
    // bsm-kia.7 (3): retry_workspace_memory must publish the restored
    // snapshot to the renderer so the Issue Explorer reflects the new
    // Current Workspace identity. The typed response now carries
    // `issueData` which is fed through the same generation-guarded
    // handler as switch_workspace.
    const user = userEvent.setup();
    const firstIssue = buildIssue({ id: "bsm-first", title: "First issue" });
    const restoredIssue = buildIssue({
      id: "shared",
      title: "Restored issue",
    });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [firstIssue] })
    );
    // Initial workspace state has no current workspace; restart-style
    // retry is the only path that can publish a snapshot here.
    workspaceState.mockResolvedValue(
      workspace({
        catalog: [{ availability: "available", path: "/work/restored" }],
        currentWorkspace: null,
        error: {
          kind: "storeReadFailed",
          message: "Could not read local workspace memory",
          retryable: true,
        },
        generation: 1,
      })
    );
    retryWorkspaceMemory.mockResolvedValue({
      issueData: {
        allIssues: [restoredIssue],
        blockedIssues: [],
        readyIssues: [],
        workspacePath: "/work/restored",
      },
      state: workspace({
        catalog: [{ availability: "available", path: "/work/restored" }],
        currentWorkspace: {
          availability: "available",
          path: "/work/restored",
        },
        generation: 2,
      }),
    });

    render(<App />);
    await screen.findByRole("heading", { name: "Choose a workspace" });

    await user.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Restored issue")).toBeInTheDocument();
    expect(screen.queryByText("First issue")).toBeNull();
  });
  it("App.retryWorkspaceMemory replaces a stale rendered Issue list with the restored workspace's data, no refresh", async () => {
    // bsm-kia.7 (3): the renderer-level retry path drives
    // `App.retryWorkspaceMemory`, which feeds the typed response into the
    // generation-guarded `applyTransition` handler. Until the response
    // lands, the prior workspace's stale snapshot must remain rendered;
    // once it lands, the Issue Explorer must visibly show the restored
    // workspace's data and the prior snapshot must be gone — no browser
    // refresh, no reliance on the typed RPC being called independently.
    const staleIssue = buildIssue({
      id: "bsm-stale",
      title: "Stale rendered issue",
    });
    const restoredIssue = buildIssue({
      id: "bsm-restored",
      title: "Restored workspace issue",
    });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({
        allIssues: [staleIssue],
        workspacePath: "/work/stale",
      })
    );
    // Surface a storage-read failure while the prior workspace is still
    // Current. The WorkspaceSelector recovery panel is the renderer
    // control that triggers App.retryWorkspaceMemory.
    workspaceState.mockResolvedValue(
      workspace({
        catalog: [
          { availability: "available", path: "/work/stale" },
          { availability: "available", path: "/work/restored" },
        ],
        currentWorkspace: {
          availability: "available",
          path: "/work/stale",
        },
        error: {
          kind: "storeReadFailed",
          message: "Could not read local workspace memory",
          retryable: true,
        },
        generation: 1,
      })
    );
    retryWorkspaceMemory.mockResolvedValue({
      issueData: {
        allIssues: [restoredIssue],
        blockedIssues: [],
        readyIssues: [],
        workspacePath: "/work/restored",
      },
      state: workspace({
        catalog: [
          { availability: "available", path: "/work/stale" },
          { availability: "available", path: "/work/restored" },
        ],
        currentWorkspace: {
          availability: "available",
          path: "/work/restored",
        },
        generation: 2,
      }),
    });

    const user = userEvent.setup();
    render(<App />);

    // Sanity: the prior workspace's issues are rendered before Retry.
    expect(await screen.findByText("Stale rendered issue")).toBeInTheDocument();
    expect(retryWorkspaceMemory).not.toHaveBeenCalled();

    // Click the renderer-level Retry in the recovery panel.
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    expect(retryWorkspaceMemory).toHaveBeenCalledTimes(1);

    // The Issue Explorer now shows the restored workspace's issues and
    // the prior workspace's snapshot has been replaced — without a
    // browser refresh.
    expect(
      await screen.findByText("Restored workspace issue")
    ).toBeInTheDocument();
    expect(screen.queryByText("Stale rendered issue")).toBeNull();
  });
  it("applies the cancel response's matching snapshot atomically when cancel races after commit-before-success-publication", async () => {
    // bsm-kia.7 (1): explicit guard for the intermediate cancel RPC
    // response. The durable commit has already landed on the backend
    // (current=B, runtime.snapshot=B), but the success publication has
    // not yet reached the renderer. Cancel must package the matching
    // Issue Explorer snapshot with the new state so the renderer never
    // shows "B Current with A snapshot" between the Cancel RPC and the
    // delayed success publication. The success RPC in this test never
    // resolves within the assertion window, so any visible B snapshot
    // must come from the cancel response alone.
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
    // The typed success RPC never resolves in this test; cancel must
    // drive the renderer to B all on its own.
    let resolveSwitch: ((value: WorkspaceSwitchResponse) => void) | undefined;
    switchWorkspace.mockImplementation(
      () =>
        // oxlint-disable-next-line promise/avoid-new
        new Promise<WorkspaceSwitchResponse>((resolve) => {
          resolveSwitch = resolve;
        })
    );

    // Cancel arrives after the backend commit cleared pending but before
    // success publication. The typed response now packages B's snapshot.
    // We deliberately set this BEFORE the cancel button is clicked so the
    // shape change is straightforward to inspect in the failure path.
    cancelWorkspace.mockResolvedValue({
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

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => {
      expect(transitionListener).toBeDefined();
    });

    // Start B and surface its Pending window; the prior A snapshot is
    // still rendered.
    await user.click(
      await screen.findByRole("button", { name: "b, /work/b, Available" })
    );
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
    expect(screen.getByText("A issue")).toBeInTheDocument();
    expect(screen.getByText("Loading b…")).toBeInTheDocument();

    // Cancel responds with the just-committed B state and B's snapshot.
    // The success RPC has NOT resolved; the assertion that follows must
    // observe the renderer state sourced entirely from this response.
    await user.click(await screen.findByTestId("cancel-workspace-switch"));
    await waitFor(() => {
      expect(cancelWorkspace).toHaveBeenCalledTimes(1);
    });

    // Workspace state and Issue Explorer snapshot are paired: B Current,
    // B's issues rendered, no Loading label, B is the marked-current entry.
    expect(await screen.findByText("B issue")).toBeInTheDocument();
    expect(screen.queryByText("A issue")).toBeNull();
    expect(screen.queryByText(/^Loading b…$/u)).toBeNull();
    expect(
      within(screen.getByRole("navigation")).getByRole("button", {
        name: "b, /work/b, Available",
      })
    ).toHaveAttribute("aria-current", "true");

    // Even after the deferred success RPC arrives, the renderer must not
    // regress — the typed response we received from switch_workspace is
    // for the same generation that cancel already committed.
    act(() => {
      resolveSwitch?.({
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
    expect(screen.getByText("B issue")).toBeInTheDocument();
    expect(screen.queryByText("A issue")).toBeNull();
  });
});

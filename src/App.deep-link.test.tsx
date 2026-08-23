import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IssueExplorerLoadState } from "./issues/issue-loader";
import type * as IssueLoaderModule from "./issues/issue-loader";
import type * as BindingsModule from "./rpc/bindings";
import type { WorkspaceResolution } from "./rpc/bindings";
import {
  buildIssue,
  createBothListenersMock,
  successState,
  workspace,
} from "./test/app-workspace-fixtures";

const loadIssueExplorerStateFromTauRpc =
  vi.fn<() => Promise<IssueExplorerLoadState>>();
const appSettingsState = vi.fn();
const updateAppSettings = vi.fn();
const workspaceState = vi.fn();
const switchWorkspace = vi.fn();
const resolveWorkspace = vi.fn();
const open = vi.fn();
const confirm = vi.fn();
const getCurrent = vi.fn();
const onOpenUrl = vi.fn();
const windowApi = {
  setFocus: vi.fn().mockResolvedValue(null),
  unminimize: vi.fn().mockResolvedValue(null),
};
const getCurrentWindow = vi.fn(() => windowApi);
const { implementation: listen } = createBothListenersMock();
const createTauRPCProxy = vi.fn(() => ({
  app_settings_state: appSettingsState,
  cancel_workspace: vi.fn(),
  list_issues: vi.fn(),
  load_issue_explorer_data: vi.fn(),
  remove_workspace: vi.fn(),
  reset_workspace_memory: vi.fn(),
  resolve_workspace: resolveWorkspace,
  retry_workspace_memory: vi.fn(),
  switch_workspace: switchWorkspace,
  update_app_settings: updateAppSettings,
  workspace_state: workspaceState,
}));

vi.mock("./issues/issue-loader", async (importOriginal) => {
  const actual = await importOriginal<typeof IssueLoaderModule>();
  return { ...actual, loadIssueExplorerStateFromTauRpc };
});

vi.mock("./rpc/bindings", async (importOriginal) => {
  const actual = await importOriginal<typeof BindingsModule>();
  return { ...actual, createTauRPCProxy };
});

vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow }));
vi.mock("@tauri-apps/plugin-deep-link", () => ({ getCurrent, onOpenUrl }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm, open }));

const { default: App } = await import("./App");

const issueLocation = (workspacePath: string, issueId: string): string =>
  `beadsmithy://${workspacePath}/issue/${issueId}`;

describe("App deep-link delivery", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/issues");
    loadIssueExplorerStateFromTauRpc.mockReset();
    appSettingsState.mockReset();
    appSettingsState.mockResolvedValue({
      settings: { markdown: { fontSizePx: 14 } },
      warning: null,
    });
    updateAppSettings.mockReset();
    updateAppSettings.mockResolvedValue({ markdown: { fontSizePx: 14 } });
    workspaceState.mockReset();
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: { availability: "available", path: "/work" },
        generation: 1,
      })
    );
    switchWorkspace.mockReset();
    resolveWorkspace.mockReset();
    confirm.mockReset();
    open.mockReset();
    getCurrent.mockReset();
    getCurrent.mockResolvedValue([]);
    windowApi.setFocus.mockClear();
    windowApi.unminimize.mockClear();
    onOpenUrl.mockReset();
    onOpenUrl.mockResolvedValue(vi.fn());
  });

  it("opens a startup deep link after the authoritative snapshot commits", async () => {
    const target = buildIssue({ id: "bsm-target", title: "Startup target" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [target], workspacePath: "/work" })
    );
    getCurrent.mockResolvedValue([issueLocation("/work", target.id)]);

    render(<App />);

    await waitFor(() =>
      expect(window.location.pathname).toBe(`/issues/${target.id}`)
    );
    expect(
      screen.getByRole("main", { name: "Issue detail" })
    ).toHaveTextContent(target.title);
    expect(document.title).toContain(target.title);
    expect(confirm).not.toHaveBeenCalled();
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it("defers a current-Workspace startup link until the snapshot is ready", async () => {
    const target = buildIssue({
      id: "bsm-loading-target",
      title: "Loading target",
    });
    let resolveLoad: ((state: IssueExplorerLoadState) => void) | undefined;
    loadIssueExplorerStateFromTauRpc.mockImplementation(
      () =>
        // eslint-disable-next-line promise/avoid-new
        new Promise<IssueExplorerLoadState>((resolve) => {
          resolveLoad = resolve;
        })
    );
    getCurrent.mockResolvedValue([issueLocation("/work", target.id)]);

    render(<App />);

    await waitFor(() => expect(getCurrent).toHaveBeenCalled());
    expect(confirm).not.toHaveBeenCalled();
    expect(switchWorkspace).not.toHaveBeenCalled();

    resolveLoad?.(
      successState({ allIssues: [target], workspacePath: "/work" })
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe(`/issues/${target.id}`)
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it("preserves the current destination and shows an error when a confirmed switch fails", async () => {
    const current = buildIssue({ id: "bsm-current", title: "Current issue" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [current], workspacePath: "/work/one" })
    );
    workspaceState.mockResolvedValue(
      workspace({
        currentWorkspace: {
          availability: "available",
          path: "/work/one",
        },
        generation: 1,
      })
    );
    resolveWorkspace.mockResolvedValue({
      known: true,
      workspace: { availability: "available", path: "/work/two" },
    });
    confirm.mockResolvedValue(true);
    switchWorkspace.mockRejectedValue(new Error("workspace unavailable"));

    render(<App />);
    await screen.findByRole("main", { name: "Issue detail" });
    const deliverUrl = await waitFor(() => {
      const callback = onOpenUrl.mock.calls[0]?.[0] as
        | ((urls: string[]) => void)
        | undefined;
      expect(callback).toBeDefined();
      return callback as (urls: string[]) => void;
    });
    deliverUrl([issueLocation("/work/two", current.id)]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Workspace resolution failed"
    );
    expect(window.location.pathname).toBe("/issues");
    expect(
      screen.getByRole("main", { name: "Issue detail" })
    ).toHaveTextContent("No issue selected");
  });

  it("restores the initial Workspace when Back follows a cross-Workspace deep link", async () => {
    const user = userEvent.setup();
    const issueA = buildIssue({ id: "bsm-history-id", title: "Issue A" });
    const issueB = buildIssue({ id: "bsm-history-id", title: "Issue B" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [issueA], workspacePath: "/work/a" })
    );
    resolveWorkspace.mockResolvedValue({
      known: true,
      workspace: { availability: "available", path: "/work/b" },
    });
    confirm.mockResolvedValue(true);
    switchWorkspace
      .mockResolvedValueOnce({
        issueData: successState({
          allIssues: [issueB],
          workspacePath: "/work/b",
        }),
        state: workspace({
          currentWorkspace: { availability: "available", path: "/work/b" },
          generation: 2,
        }),
      })
      .mockResolvedValueOnce({
        issueData: successState({
          allIssues: [issueA],
          workspacePath: "/work/a",
        }),
        state: workspace({
          currentWorkspace: { availability: "available", path: "/work/a" },
          generation: 3,
        }),
      })
      .mockResolvedValueOnce({
        issueData: successState({
          allIssues: [issueB],
          workspacePath: "/work/b",
        }),
        state: workspace({
          currentWorkspace: { availability: "available", path: "/work/b" },
          generation: 4,
        }),
      })
      .mockResolvedValueOnce({
        issueData: successState({
          allIssues: [issueA],
          workspacePath: "/work/a",
        }),
        state: workspace({
          currentWorkspace: { availability: "available", path: "/work/a" },
          generation: 5,
        }),
      });
    let deliverUrl: ((urls: string[]) => void) | undefined;
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    onOpenUrl.mockImplementation((callback: (urls: string[]) => void) => {
      deliverUrl = callback;
      return Promise.resolve(vi.fn());
    });

    render(<App />);
    await user.click(await screen.findByRole("link", { name: /Issue A/iu }));
    deliverUrl?.([issueLocation("/work/b", issueB.id)]);

    await waitFor(() =>
      expect(
        within(screen.getByRole("main", { name: "Issue detail" })).getByRole(
          "heading",
          { name: issueB.title }
        )
      ).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /Back/iu }));

    await waitFor(() =>
      expect(
        within(screen.getByRole("main", { name: "Issue detail" })).getByRole(
          "heading",
          { name: issueA.title }
        )
      ).toBeInTheDocument()
    );
    expect(document.activeElement).toBe(
      within(screen.getByRole("main", { name: "Issue detail" })).getByRole(
        "heading",
        { name: issueA.title }
      )
    );
    expect(switchWorkspace).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: /Forward/iu }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("main", { name: "Issue detail" })).getByRole(
          "heading",
          { name: issueB.title }
        )
      ).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /Back/iu }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("main", { name: "Issue detail" })).getByRole(
          "heading",
          { name: issueA.title }
        )
      ).toBeInTheDocument()
    );
    expect(switchWorkspace).toHaveBeenCalledTimes(4);
  });

  it("opens the latest running-instance URL and focuses the existing window", async () => {
    const first = buildIssue({ id: "bsm-first", title: "First issue" });
    const second = buildIssue({ id: "bsm-second", title: "Second issue" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [first, second], workspacePath: "/work" })
    );
    let deliverUrl: ((urls: string[]) => void) | undefined;
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    onOpenUrl.mockImplementation((callback: (urls: string[]) => void) => {
      deliverUrl = callback;
      return Promise.resolve(vi.fn());
    });

    render(<App />);
    await screen.findByRole("main", { name: "Issue detail" });
    deliverUrl?.([issueLocation("/work", second.id)]);

    await waitFor(() =>
      expect(window.location.pathname).toBe(`/issues/${second.id}`)
    );
    expect(windowApi.setFocus).toHaveBeenCalled();
  });

  it("lets a newer same-Workspace link supersede an older async Workspace resolution", async () => {
    const current = buildIssue({ id: "bsm-current", title: "Current issue" });
    const newer = buildIssue({ id: "bsm-newer", title: "Newer issue" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [current, newer], workspacePath: "/work/one" })
    );
    let resolveFirst: ((resolution: WorkspaceResolution) => void) | undefined;
    resolveWorkspace.mockImplementation(
      () =>
        // eslint-disable-next-line promise/avoid-new
        new Promise<WorkspaceResolution>((resolve) => {
          resolveFirst = resolve;
        })
    );
    let deliverUrl: ((urls: string[]) => void) | undefined;
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    onOpenUrl.mockImplementation((callback: (urls: string[]) => void) => {
      deliverUrl = callback;
      return Promise.resolve(vi.fn());
    });

    render(<App />);
    await screen.findByRole("heading", { name: current.title });
    deliverUrl?.([issueLocation("/work/two", newer.id)]);
    await waitFor(() => expect(resolveWorkspace).toHaveBeenCalledTimes(1));
    deliverUrl?.([issueLocation("/work/one", newer.id)]);

    await waitFor(() =>
      expect(
        within(screen.getByRole("main", { name: "Issue detail" })).getByRole(
          "heading",
          { name: newer.title }
        )
      ).toBeInTheDocument()
    );
    resolveFirst?.({
      known: true,
      workspace: { availability: "available", path: "/work/two" },
    });
    await waitFor(() => expect(confirm).not.toHaveBeenCalled());
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it("names the target Workspace and leaves it unchanged when confirmation is declined", async () => {
    const current = buildIssue({ id: "bsm-current", title: "Current issue" });
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ allIssues: [current], workspacePath: "/work/one" })
    );
    workspaceState.mockResolvedValue(
      workspace({
        catalog: [
          { availability: "available", path: "/work/one" },
          { availability: "available", path: "/work/two" },
        ],
        currentWorkspace: {
          availability: "available",
          path: "/work/one",
        },
        generation: 1,
      })
    );
    const resolution: WorkspaceResolution = {
      known: true,
      workspace: {
        availability: "available",
        path: "/work/two",
      },
    };
    resolveWorkspace.mockResolvedValue(resolution);
    confirm.mockResolvedValue(false);

    render(<App />);
    await screen.findByRole("heading", { name: current.title });
    const deliverUrl = await waitFor(() => {
      const callback = onOpenUrl.mock.calls[0]?.[0] as
        | ((urls: string[]) => void)
        | undefined;
      expect(callback).toBeDefined();
      return callback as (urls: string[]) => void;
    });
    deliverUrl([issueLocation("/work/two", current.id)]);

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0]?.[0]).toContain("/work/two");
    expect(switchWorkspace).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: current.title })
    ).toBeInTheDocument();
  });
});

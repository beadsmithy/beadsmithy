import type { UnlistenFn } from "@tauri-apps/api/event";
import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IssueExplorerLoadState } from "./issues/issue-loader";
import type * as IssueLoaderModule from "./issues/issue-loader";
import type * as BindingsModule from "./rpc/bindings";
import type { WorkspaceState } from "./rpc/bindings";
import { successState, workspace } from "./test/app-workspace-fixtures";

const loadIssueExplorerStateFromTauRpc =
  vi.fn<() => Promise<IssueExplorerLoadState>>();
const appSettingsState = vi.fn();
const updateAppSettings = vi.fn();
const workspaceState = vi.fn<() => Promise<WorkspaceState>>();
const createTauRPCProxy = vi.fn(() => ({
  app_settings_state: appSettingsState,
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

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const transitionEventName = "workspace-transition";
const refreshEventName = "beadwork://issue-explorer-state-changed";
type RegistrationName = "T1" | "T2" | "R1" | "R2";
type ListenerCallback = (event: { payload: unknown }) => void;

interface Registration {
  active: boolean;
  callback: ListenerCallback;
  eventName: string;
  name: RegistrationName;
  requested: boolean;
  resolved: boolean;
  resolve: () => void;
  unlisten: UnlistenFn;
}

interface ListenerController {
  implementation: (
    eventName: string,
    callback: ListenerCallback
  ) => Promise<UnlistenFn>;
  listen: ReturnType<typeof vi.fn>;
  registration: (name: RegistrationName) => Registration;
  resolve: (name: RegistrationName) => void;
}

const createListenerController = (): ListenerController => {
  const registrations = new Map<RegistrationName, Registration>();
  let transitionCount = 0;
  const refreshOwners = new Set<"T1" | "T2">();

  const implementation = (
    eventName: string,
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    // oxlint-disable-next-line promise/prefer-await-to-callbacks
    callback: ListenerCallback
  ): Promise<UnlistenFn> => {
    const isTransition = eventName === transitionEventName;
    const isRefresh = eventName === refreshEventName;

    if (!isTransition && !isRefresh) {
      throw new Error(`Unexpected listener event: ${eventName}`);
    }

    if (isTransition) {
      transitionCount += 1;
      if (transitionCount > 2) {
        throw new Error("Unexpected transition registration");
      }
    }

    const name: RegistrationName = isTransition
      ? `T${transitionCount}`
      : (() => {
          const owner = (["T1", "T2"] as const).find((transitionName) => {
            const transition = registrations.get(transitionName);
            return transition?.resolved && !refreshOwners.has(transitionName);
          });
          if (!owner) {
            throw new Error(
              "Refresh registration requested before its transition resolved"
            );
          }
          refreshOwners.add(owner);
          return owner === "T1" ? "R1" : "R2";
        })();
    let resolvePromise: (unlisten: UnlistenFn) => void = () => {
      throw new Error(`Registration ${name} was resolved twice`);
    };
    // eslint-disable-next-line promise/avoid-new, promise/prefer-await-to-callbacks
    // oxlint-disable-next-line promise/avoid-new, promise/prefer-await-to-callbacks
    const promise = new Promise<UnlistenFn>((resolve) => {
      resolvePromise = resolve;
    });

    const registration: Registration = {
      active: false,
      callback,
      eventName,
      name,
      requested: true,
      resolve: () => {
        registration.active = true;
        registration.resolved = true;
        resolvePromise(registration.unlisten);
      },
      resolved: false,
      unlisten: vi.fn(() => {
        registration.active = false;
      }),
    };
    registrations.set(name, registration);

    return promise;
  };

  const listen = vi.fn(implementation);

  return {
    implementation,
    listen,
    registration: (name) => {
      const registration = registrations.get(name);
      if (!registration) {
        throw new Error(`Registration ${name} has not been requested yet`);
      }
      return registration;
    },
    resolve: (name) => {
      const registration = registrations.get(name);
      if (!registration) {
        throw new Error(`Registration ${name} has not been requested yet`);
      }
      registration.resolve();
    },
  };
};

let listenerController: ListenerController | undefined;

vi.mock("@tauri-apps/api/event", () => ({
  // eslint-disable-next-line promise/prefer-await-to-callbacks
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  listen: (eventName: string, callback: ListenerCallback) => {
    if (!listenerController) {
      throw new Error("Listener controller has not been initialized");
    }
    return listenerController.listen(eventName, callback);
  },
}));

const { default: App } = await import("./App");

describe("App StrictMode listener lifecycle", () => {
  beforeEach(() => {
    listenerController = createListenerController();
    loadIssueExplorerStateFromTauRpc.mockReset();
    loadIssueExplorerStateFromTauRpc.mockResolvedValue(
      successState({ workspaceGeneration: 1 })
    );
    appSettingsState.mockReset();
    appSettingsState.mockResolvedValue({
      settings: { markdown: { fontSizePx: 14 } },
      warning: null,
    });
    updateAppSettings.mockReset();
    workspaceState.mockReset();
    workspaceState.mockResolvedValue(workspace());
  });

  it("cleans stale-first registrations and starts only the live setup", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    expect(listenerController.listen).toHaveBeenCalledTimes(2);
    expect(listenerController.registration("T1").eventName).toBe(
      transitionEventName
    );
    expect(listenerController.registration("T2").eventName).toBe(
      transitionEventName
    );

    await act(async () => {
      listenerController.resolve("T1");
      await Promise.resolve();
    });
    expect(listenerController.registration("R1").eventName).toBe(
      refreshEventName
    );
    expect(listenerController.listen).toHaveBeenCalledTimes(3);

    await act(async () => {
      listenerController.resolve("R1");
      await Promise.resolve();
    });
    expect(
      listenerController.registration("T1").unlisten
    ).toHaveBeenCalledTimes(1);
    expect(loadIssueExplorerStateFromTauRpc).not.toHaveBeenCalled();
    expect(workspaceState).not.toHaveBeenCalled();

    await act(async () => {
      listenerController.resolve("T2");
      await Promise.resolve();
    });
    expect(listenerController.registration("R2").eventName).toBe(
      refreshEventName
    );

    await act(async () => {
      listenerController.resolve("R2");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listenerController.listen).toHaveBeenCalledTimes(4);
    expect(
      listenerController.registration("R1").unlisten
    ).toHaveBeenCalledTimes(1);
    expect(
      listenerController.registration("T2").unlisten
    ).not.toHaveBeenCalled();
    expect(
      listenerController.registration("R2").unlisten
    ).not.toHaveBeenCalled();
    expect(listenerController.registration("T2").active).toBe(true);
    expect(listenerController.registration("R2").active).toBe(true);
    expect(loadIssueExplorerStateFromTauRpc).toHaveBeenCalledTimes(1);
    expect(workspaceState).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadIssueExplorerStateFromTauRpc).toHaveBeenCalledTimes(1);
    expect(workspaceState).toHaveBeenCalledTimes(1);
  });

  it("keeps live listeners when live registration completes before stale registration", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    expect(listenerController.listen).toHaveBeenCalledTimes(2);

    await act(async () => {
      listenerController.resolve("T2");
      await Promise.resolve();
    });
    expect(listenerController.registration("R2").eventName).toBe(
      refreshEventName
    );

    await act(async () => {
      listenerController.resolve("R2");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listenerController.registration("T2").active).toBe(true);
    expect(listenerController.registration("R2").active).toBe(true);
    expect(
      listenerController.registration("T2").unlisten
    ).not.toHaveBeenCalled();
    expect(
      listenerController.registration("R2").unlisten
    ).not.toHaveBeenCalled();
    expect(loadIssueExplorerStateFromTauRpc).toHaveBeenCalledTimes(1);
    expect(workspaceState).toHaveBeenCalledTimes(1);

    await act(async () => {
      listenerController.resolve("T1");
      await Promise.resolve();
    });
    expect(listenerController.registration("R1").eventName).toBe(
      refreshEventName
    );
    expect(
      listenerController.registration("T1").unlisten
    ).toHaveBeenCalledTimes(1);

    await act(async () => {
      listenerController.resolve("R1");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      listenerController.registration("R1").unlisten
    ).toHaveBeenCalledTimes(1);
    expect(
      listenerController.registration("T2").unlisten
    ).not.toHaveBeenCalled();
    expect(
      listenerController.registration("R2").unlisten
    ).not.toHaveBeenCalled();
    expect(loadIssueExplorerStateFromTauRpc).toHaveBeenCalledTimes(1);
    expect(workspaceState).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadIssueExplorerStateFromTauRpc).toHaveBeenCalledTimes(1);
    expect(workspaceState).toHaveBeenCalledTimes(1);
  });
});

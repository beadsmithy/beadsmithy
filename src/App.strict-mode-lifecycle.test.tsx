import type { UnlistenFn } from "@tauri-apps/api/event";
import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import type { Mock } from "vitest";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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
  reject: () => void;
  rejected: boolean;
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
  listen: Mock<
    (eventName: string, callback: ListenerCallback) => Promise<UnlistenFn>
  >;
  registration: (name: RegistrationName) => Registration;
  reject: (name: RegistrationName) => void;
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

    let name: RegistrationName;
    if (isTransition) {
      name = transitionCount === 1 ? "T1" : "T2";
    } else {
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
      name = owner === "T1" ? "R1" : "R2";
    }
    let rejectPromise: (reason: Error) => void = () => {
      throw new Error(`Registration ${name} was rejected twice`);
    };
    let resolvePromise: (unlisten: UnlistenFn) => void = () => {
      throw new Error(`Registration ${name} was resolved twice`);
    };
    // eslint-disable-next-line promise/avoid-new, promise/prefer-await-to-callbacks
    // oxlint-disable-next-line promise/avoid-new, promise/prefer-await-to-callbacks
    const promise = new Promise<UnlistenFn>((resolve, reject) => {
      rejectPromise = reject;
      resolvePromise = resolve;
    });

    const registration: Registration = {
      active: false,
      callback,
      eventName,
      name,
      reject: () => {
        registration.rejected = true;
        rejectPromise(new Error(`Registration ${name} rejected`));
      },
      rejected: false,
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
    reject: (name) => {
      const registration = registrations.get(name);
      if (!registration) {
        throw new Error(`Registration ${name} has not been requested yet`);
      }
      registration.reject();
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

// Assigned in `beforeEach` before any test body or listener mock call
// runs. Declared without `| undefined` so the (many) test-body usages
// below do not each need a narrowing assertion; the `listen` mock keeps
// its runtime guard so a missed initialization still fails loudly.
let listenerController: ListenerController;

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

const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

const completionOrders = [
  {
    label: "T1 → R1 → T2 → R2",
    order: ["T1", "R1", "T2", "R2"],
  },
  {
    label: "T1 → T2 → R1 → R2",
    order: ["T1", "T2", "R1", "R2"],
  },
  {
    label: "T1 → T2 → R2 → R1",
    order: ["T1", "T2", "R2", "R1"],
  },
  {
    label: "T2 → T1 → R1 → R2",
    order: ["T2", "T1", "R1", "R2"],
  },
  {
    label: "T2 → T1 → R2 → R1",
    order: ["T2", "T1", "R2", "R1"],
  },
  {
    label: "T2 → R2 → T1 → R1",
    order: ["T2", "R2", "T1", "R1"],
  },
] as const;

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

  afterEach(() => {
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockClear();
    consoleWarnSpy.mockClear();
  });

  it.each(completionOrders)(
    "keeps only live listeners for completion order $label",
    async ({ order }) => {
      render(
        <StrictMode>
          <App />
        </StrictMode>
      );

      expect(listenerController.listen).toHaveBeenCalledTimes(2);

      const resolveRegistration = async (
        name: RegistrationName
      ): Promise<void> => {
        await act(async () => {
          listenerController.resolve(name);
          await Promise.resolve();
          await Promise.resolve();
        });
      };
      let startupStarted = false;

      for (const name of order) {
        // eslint-disable-next-line no-await-in-loop
        await resolveRegistration(name);

        if (name === "R2") {
          startupStarted = true;
          expect(loadIssueExplorerStateFromTauRpc).toHaveBeenCalledTimes(1);
          expect(workspaceState).toHaveBeenCalledTimes(1);
        } else if (!startupStarted) {
          expect(loadIssueExplorerStateFromTauRpc).not.toHaveBeenCalled();
          expect(workspaceState).not.toHaveBeenCalled();
        }
      }

      expect(listenerController.listen).toHaveBeenCalledTimes(4);
      expect(listenerController.registration("T1").active).toBe(false);
      expect(listenerController.registration("R1").active).toBe(false);
      expect(listenerController.registration("T2").active).toBe(true);
      expect(listenerController.registration("R2").active).toBe(true);
      expect(
        listenerController.registration("T1").unlisten
      ).toHaveBeenCalledTimes(1);
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
    }
  );

  it("falls back to startup loading when the first listener registration rejects", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    expect(listenerController.listen).toHaveBeenCalledTimes(2);
    listenerController.reject("T1");
    listenerController.reject("T2");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadIssueExplorerStateFromTauRpc).toHaveBeenCalledTimes(1);
    expect(workspaceState).toHaveBeenCalledTimes(1);
    expect(listenerController.registration("T1").rejected).toBe(true);
    expect(listenerController.registration("T2").rejected).toBe(true);
    expect(listenerController.listen).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
    consoleWarnSpy.mockClear();
  });

  it("starts up and cleans up the transition listener when refresh registration rejects", async () => {
    const { unmount } = render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    expect(listenerController.listen).toHaveBeenCalledTimes(2);

    const resolveRegistration = async (
      name: RegistrationName
    ): Promise<void> => {
      await act(async () => {
        listenerController.resolve(name);
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    await resolveRegistration("T1");
    await resolveRegistration("T2");

    act(() => {
      listenerController.reject("R1");
      listenerController.reject("R2");
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listenerController.registration("R1").rejected).toBe(true);
    expect(listenerController.registration("R2").rejected).toBe(true);
    expect(loadIssueExplorerStateFromTauRpc).toHaveBeenCalledTimes(1);
    expect(workspaceState).toHaveBeenCalledTimes(1);
    expect(
      listenerController.registration("T1").unlisten
    ).toHaveBeenCalledTimes(1);
    expect(
      listenerController.registration("T2").unlisten
    ).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
    consoleWarnSpy.mockClear();

    act(() => {
      unmount();
    });

    // The second StrictMode lifecycle's successful transition registration is
    // disposed exactly once when the App is finally unmounted.
    expect(
      listenerController.registration("T2").unlisten
    ).toHaveBeenCalledTimes(1);
  });

  it("unregisters every listener when unmounted with registrations pending", async () => {
    const { unmount } = render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    expect(listenerController.listen).toHaveBeenCalledTimes(2);

    act(() => {
      unmount();
    });

    await act(async () => {
      listenerController.resolve("T1");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      listenerController.registration("T1").unlisten
    ).toHaveBeenCalledTimes(1);
    expect(listenerController.registration("R1").eventName).toBe(
      refreshEventName
    );

    await act(async () => {
      listenerController.resolve("T2");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      listenerController.registration("T2").unlisten
    ).toHaveBeenCalledTimes(1);
    expect(listenerController.registration("R2").eventName).toBe(
      refreshEventName
    );

    await act(async () => {
      listenerController.resolve("R1");
      listenerController.resolve("R2");
      await Promise.resolve();
      await Promise.resolve();
    });

    for (const name of ["T1", "T2", "R1", "R2"] as const) {
      expect(listenerController.registration(name).active).toBe(false);
      expect(
        listenerController.registration(name).unlisten
      ).toHaveBeenCalledTimes(1);
    }
    expect(loadIssueExplorerStateFromTauRpc).not.toHaveBeenCalled();
    expect(workspaceState).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadIssueExplorerStateFromTauRpc).not.toHaveBeenCalled();
    expect(workspaceState).not.toHaveBeenCalled();
  });

  it("removes only live listeners when unmounted after startup", async () => {
    const { unmount } = render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    const resolveRegistration = async (
      name: RegistrationName
    ): Promise<void> => {
      await act(async () => {
        listenerController.resolve(name);
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    await resolveRegistration("T1");
    await resolveRegistration("R1");
    await resolveRegistration("T2");
    await resolveRegistration("R2");

    expect(listenerController.registration("T1").active).toBe(false);
    expect(listenerController.registration("R1").active).toBe(false);
    expect(listenerController.registration("T2").active).toBe(true);
    expect(listenerController.registration("R2").active).toBe(true);
    expect(
      listenerController.registration("T1").unlisten
    ).toHaveBeenCalledTimes(1);
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

    act(() => {
      unmount();
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      listenerController.registration("T1").unlisten
    ).toHaveBeenCalledTimes(1);
    expect(
      listenerController.registration("R1").unlisten
    ).toHaveBeenCalledTimes(1);
    expect(
      listenerController.registration("T2").unlisten
    ).toHaveBeenCalledTimes(1);
    expect(
      listenerController.registration("R2").unlisten
    ).toHaveBeenCalledTimes(1);
    for (const name of ["T1", "T2", "R1", "R2"] as const) {
      expect(listenerController.registration(name).active).toBe(false);
    }
    expect(loadIssueExplorerStateFromTauRpc).toHaveBeenCalledTimes(1);
    expect(workspaceState).toHaveBeenCalledTimes(1);
  });
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

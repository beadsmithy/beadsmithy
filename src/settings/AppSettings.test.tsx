import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  AppSettings,
  AppSettingsError,
  AppSettingsUpdate,
} from "../rpc/bindings";
import { useAppSettings } from "./app-settings";
import type { SettingsTransportClient } from "./settings-transport";

const defaultSettings = (): AppSettings => ({ markdown: { fontSizePx: 14 } });

const defaultLoadResult = () => ({
  settings: defaultSettings(),
  warning: null as { kind: string; message: string } | null,
});

interface ControllableTransport {
  load: SettingsTransportClient["load"];
  rejectUpdate: (error: AppSettingsError) => void;
  resolveUpdate: (value: AppSettings) => void;
  update: SettingsTransportClient["update"];
  updateCalls: AppSettingsUpdate[];
}

interface DeferredAppSettings {
  promise: Promise<AppSettings>;
  reject: (error: AppSettingsError) => void;
  resolve: (value: AppSettings) => void;
}

const createDeferredAppSettings = (): DeferredAppSettings => {
  const result: DeferredAppSettings = {
    promise: Promise.resolve({ markdown: { fontSizePx: 14 } }),
    reject: () => {},
    resolve: () => {},
  };

  // oxlint-disable-next-line promise/avoid-new
  result.promise = new Promise<AppSettings>((resolve, reject) => {
    result.resolve = resolve;
    result.reject = reject;
  });

  return result;
};

const createControllableTransport = (
  loadResult = defaultLoadResult()
): ControllableTransport => {
  const updateCalls: AppSettingsUpdate[] = [];
  const deferreds: DeferredAppSettings[] = [];

  const load = vi.fn().mockResolvedValue(loadResult);

  const update = vi.fn().mockImplementation((settings: AppSettingsUpdate) => {
    updateCalls.push(settings);

    const deferred = createDeferredAppSettings();
    deferreds.push(deferred);
    return deferred.promise;
  });

  const resolveUpdate = (value: AppSettings) => {
    const deferred = deferreds.shift();
    deferred?.resolve(value);
  };

  const rejectUpdate = (error: AppSettingsError) => {
    const deferred = deferreds.shift();
    deferred?.reject(error);
  };

  return { load, rejectUpdate, resolveUpdate, update, updateCalls };
};

describe("useAppSettings", () => {
  it("loads persisted settings and shows Saved when they match the default", async () => {
    const transport = createControllableTransport();
    const { result } = renderHook(() => useAppSettings(transport));

    await waitFor(() => expect(result.current.state.loadStatus).toBe("loaded"));

    expect(result.current.state.appliedFontSizePx).toBe(14);
    expect(result.current.state.confirmedFontSizePx).toBe(14);
    expect(result.current.state.draft).toBe("14");
    expect(result.current.state.loadWarning).toBeNull();
    expect(result.current.state.saveStatus).toBe("saved");
    expect(transport.load).toHaveBeenCalledTimes(1);
  });

  it("surfaces a load warning and keeps the applied value at 14 px", async () => {
    const transport = createControllableTransport({
      settings: defaultSettings(),
      warning: { kind: "malformed", message: "Saved settings are malformed." },
    });
    const { result } = renderHook(() => useAppSettings(transport));

    await waitFor(() => expect(result.current.state.loadStatus).toBe("loaded"));

    expect(result.current.state.loadWarning).toEqual({
      kind: "malformed",
      message: "Saved settings are malformed.",
    });
    expect(result.current.state.appliedFontSizePx).toBe(14);
    expect(result.current.state.saveStatus).toBe("idle");
  });

  it("applies a valid draft and queues it for persistence", async () => {
    const transport = createControllableTransport();
    const { result } = renderHook(() => useAppSettings(transport));

    await waitFor(() => expect(result.current.state.loadStatus).toBe("loaded"));

    act(() => {
      result.current.setDraft("24");
    });

    expect(result.current.state.draft).toBe("24");
    expect(result.current.state.appliedFontSizePx).toBe(24);
    expect(result.current.state.validationError).toBeNull();
    expect(result.current.state.saveStatus).toBe("saving");
    expect(transport.updateCalls).toEqual([{ markdown: { fontSizePx: 24 } }]);

    act(() => {
      transport.resolveUpdate({ markdown: { fontSizePx: 24 } });
    });

    await waitFor(() => expect(result.current.state.saveStatus).toBe("saved"));

    expect(result.current.state.confirmedFontSizePx).toBe(24);
    expect(result.current.state.loadWarning).toBeNull();
  });

  it("does not apply invalid drafts or enter the save queue", async () => {
    const transport = createControllableTransport();
    const { result } = renderHook(() => useAppSettings(transport));

    await waitFor(() => expect(result.current.state.loadStatus).toBe("loaded"));

    act(() => {
      result.current.setDraft("abc");
    });

    expect(result.current.state.draft).toBe("abc");
    expect(result.current.state.appliedFontSizePx).toBe(14);
    expect(result.current.state.validationError).not.toBeNull();
    expect(transport.update).not.toHaveBeenCalled();

    act(() => {
      result.current.setDraft("7");
    });

    expect(result.current.state.appliedFontSizePx).toBe(14);
    expect(result.current.state.validationError).not.toBeNull();

    act(() => {
      result.current.setDraft("73");
    });

    expect(result.current.state.appliedFontSizePx).toBe(14);
    expect(transport.update).not.toHaveBeenCalled();
  });

  it("coalesces rapid valid edits so the newest value is persisted", async () => {
    const transport = createControllableTransport();
    const { result } = renderHook(() => useAppSettings(transport));

    await waitFor(() => expect(result.current.state.loadStatus).toBe("loaded"));

    act(() => {
      result.current.setDraft("18");
    });

    expect(transport.updateCalls).toEqual([{ markdown: { fontSizePx: 18 } }]);

    act(() => {
      result.current.setDraft("20");
    });

    act(() => {
      result.current.setDraft("24");
    });

    expect(transport.updateCalls).toHaveLength(1);

    act(() => {
      transport.resolveUpdate({ markdown: { fontSizePx: 18 } });
    });

    await waitFor(() =>
      expect(transport.updateCalls).toEqual([
        { markdown: { fontSizePx: 18 } },
        { markdown: { fontSizePx: 24 } },
      ])
    );

    act(() => {
      transport.resolveUpdate({ markdown: { fontSizePx: 24 } });
    });

    await waitFor(() => expect(result.current.state.saveStatus).toBe("saved"));

    expect(result.current.state.confirmedFontSizePx).toBe(24);
    expect(result.current.state.appliedFontSizePx).toBe(24);
  });

  it("does not mark an older completion as saved while a newer value is pending", async () => {
    const transport = createControllableTransport();
    const { result } = renderHook(() => useAppSettings(transport));

    await waitFor(() => expect(result.current.state.loadStatus).toBe("loaded"));

    act(() => {
      result.current.setDraft("18");
    });

    act(() => {
      result.current.setDraft("24");
    });

    act(() => {
      transport.resolveUpdate({ markdown: { fontSizePx: 18 } });
    });

    await waitFor(() =>
      expect(result.current.state.confirmedFontSizePx).toBe(18)
    );
    expect(result.current.state.saveStatus).toBe("saving");
    expect(result.current.state.appliedFontSizePx).toBe(24);

    act(() => {
      transport.resolveUpdate({ markdown: { fontSizePx: 24 } });
    });

    await waitFor(() => expect(result.current.state.saveStatus).toBe("saved"));

    expect(result.current.state.confirmedFontSizePx).toBe(24);
  });

  it("discards an older failure when a newer value is already pending", async () => {
    const transport = createControllableTransport();
    const { result } = renderHook(() => useAppSettings(transport));

    await waitFor(() => expect(result.current.state.loadStatus).toBe("loaded"));

    act(() => {
      result.current.setDraft("18");
    });

    act(() => {
      result.current.setDraft("24");
    });

    act(() => {
      transport.rejectUpdate({
        kind: "storeSaveFailed",
        message: "disk full",
      });
    });

    await waitFor(() =>
      expect(transport.updateCalls).toEqual([
        { markdown: { fontSizePx: 18 } },
        { markdown: { fontSizePx: 24 } },
      ])
    );

    expect(result.current.state.saveError).toBeNull();
    expect(result.current.state.appliedFontSizePx).toBe(24);

    act(() => {
      transport.resolveUpdate({ markdown: { fontSizePx: 24 } });
    });

    await waitFor(() => expect(result.current.state.saveStatus).toBe("saved"));
  });

  it("keeps the newest applied value active and shows Retry after the newest save fails", async () => {
    const transport = createControllableTransport();
    const { result } = renderHook(() => useAppSettings(transport));

    await waitFor(() => expect(result.current.state.loadStatus).toBe("loaded"));

    act(() => {
      result.current.setDraft("24");
    });

    act(() => {
      transport.rejectUpdate({
        kind: "storeSaveFailed",
        message: "disk full",
      });
    });

    await waitFor(() => expect(result.current.state.saveError).not.toBeNull());

    expect(result.current.state.appliedFontSizePx).toBe(24);
    expect(result.current.state.draft).toBe("24");
    expect(result.current.state.saveStatus).toBe("idle");
    expect(result.current.state.saveError).toEqual({
      kind: "storeSaveFailed",
      message: "disk full",
    });

    act(() => {
      result.current.retry();
    });

    expect(result.current.state.saveError).toBeNull();
    expect(result.current.state.saveStatus).toBe("saving");
    expect(transport.updateCalls).toEqual([
      { markdown: { fontSizePx: 24 } },
      { markdown: { fontSizePx: 24 } },
    ]);

    act(() => {
      transport.resolveUpdate({ markdown: { fontSizePx: 24 } });
    });

    await waitFor(() => expect(result.current.state.saveStatus).toBe("saved"));
  });

  it("Reset clears invalid state, applies 14 px, and repairs a load warning", async () => {
    const transport = createControllableTransport({
      settings: defaultSettings(),
      warning: { kind: "malformed", message: "Saved settings are malformed." },
    });
    const { result } = renderHook(() => useAppSettings(transport));

    await waitFor(() => expect(result.current.state.loadStatus).toBe("loaded"));

    act(() => {
      result.current.setDraft("abc");
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.draft).toBe("14");
    expect(result.current.state.appliedFontSizePx).toBe(14);
    expect(result.current.state.validationError).toBeNull();
    expect(result.current.state.saveStatus).toBe("saving");
    expect(transport.updateCalls).toEqual([{ markdown: { fontSizePx: 14 } }]);

    act(() => {
      transport.resolveUpdate({ markdown: { fontSizePx: 14 } });
    });

    await waitFor(() => expect(result.current.state.saveStatus).toBe("saved"));

    expect(result.current.state.loadWarning).toBeNull();
  });

  it("clears a load warning after a deliberate valid edit succeeds", async () => {
    const transport = createControllableTransport({
      settings: defaultSettings(),
      warning: { kind: "malformed", message: "Saved settings are malformed." },
    });
    const { result } = renderHook(() => useAppSettings(transport));

    await waitFor(() => expect(result.current.state.loadStatus).toBe("loaded"));

    act(() => {
      result.current.setDraft("20");
    });

    act(() => {
      transport.resolveUpdate({ markdown: { fontSizePx: 20 } });
    });

    await waitFor(() => expect(result.current.state.saveStatus).toBe("saved"));

    expect(result.current.state.loadWarning).toBeNull();
  });

  it("accepts 8 and 72 as boundaries and rejects out-of-range values", async () => {
    const transport = createControllableTransport();
    const { result } = renderHook(() => useAppSettings(transport));

    await waitFor(() => expect(result.current.state.loadStatus).toBe("loaded"));

    act(() => {
      result.current.setDraft("8");
    });

    expect(result.current.state.appliedFontSizePx).toBe(8);
    expect(result.current.state.validationError).toBeNull();

    act(() => {
      result.current.setDraft("72");
    });

    expect(result.current.state.appliedFontSizePx).toBe(72);

    act(() => {
      result.current.setDraft("7");
    });

    expect(result.current.state.appliedFontSizePx).toBe(72);
    expect(result.current.state.validationError).not.toBeNull();

    act(() => {
      result.current.setDraft("73");
    });

    expect(result.current.state.appliedFontSizePx).toBe(72);
  });

  it("still completes an in-flight save after the component unmounts", async () => {
    const transport = createControllableTransport();
    const { result, unmount } = renderHook(() => useAppSettings(transport));

    await waitFor(() => expect(result.current.state.loadStatus).toBe("loaded"));

    act(() => {
      result.current.setDraft("24");
    });

    unmount();

    await act(async () => {
      transport.resolveUpdate({ markdown: { fontSizePx: 24 } });
      await Promise.resolve();
    });
  });
});

import { Effect } from "effect";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type {
  AppSettings,
  AppSettingsError,
  AppSettingsWarning,
} from "../rpc/bindings";
import {
  createTauRpcSettingsTransport,
  loadAppSettings,
  SettingsTransport,
  updateAppSettings,
} from "./settings-transport";
import type { SettingsTransportClient } from "./settings-transport";

const DEFAULT_FONT_SIZE_PX = 14;
const MIN_FONT_SIZE_PX = 8;
const MAX_FONT_SIZE_PX = 72;

export type AppSettingsLoadStatus = "loading" | "loaded";
export type AppSettingsSaveStatus = "idle" | "saving" | "saved";

export interface AppSettingsHookState {
  appliedFontSizePx: number;
  confirmedFontSizePx: number;
  draft: string;
  loadStatus: AppSettingsLoadStatus;
  loadWarning: AppSettingsWarning | null;
  saveError: AppSettingsError | null;
  saveStatus: AppSettingsSaveStatus;
  validationError: string | null;
}

interface DraftValidation {
  error: string;
  valid: false;
}

interface DraftValidationSuccess {
  valid: true;
  value: number;
}

type DraftValidationResult = DraftValidation | DraftValidationSuccess;

const validateDraft = (draft: string): DraftValidationResult => {
  const trimmed = draft.trim();

  if (trimmed.length === 0) {
    return {
      error: "Font size is required.",
      valid: false,
    };
  }

  const numeric = Number(trimmed);

  if (Number.isNaN(numeric) || !Number.isInteger(numeric)) {
    return {
      error: `Font size must be a whole number from ${MIN_FONT_SIZE_PX} to ${MAX_FONT_SIZE_PX} px.`,
      valid: false,
    };
  }

  if (numeric < MIN_FONT_SIZE_PX || numeric > MAX_FONT_SIZE_PX) {
    return {
      error: `Font size must be a whole number from ${MIN_FONT_SIZE_PX} to ${MAX_FONT_SIZE_PX} px.`,
      valid: false,
    };
  }

  return { valid: true, value: numeric };
};

const initialState = (): AppSettingsHookState => ({
  appliedFontSizePx: DEFAULT_FONT_SIZE_PX,
  confirmedFontSizePx: DEFAULT_FONT_SIZE_PX,
  draft: String(DEFAULT_FONT_SIZE_PX),
  loadStatus: "loading",
  loadWarning: null,
  saveError: null,
  saveStatus: "idle",
  validationError: null,
});

const toAppSettingsError = (error: unknown): AppSettingsError => {
  if (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    "message" in error
  ) {
    return error as AppSettingsError;
  }

  return {
    kind: "storeSaveFailed",
    message:
      error instanceof Error ? error.message : "Could not update app settings.",
  } as AppSettingsError;
};

type UpdateResult =
  | { _tag: "failure"; error: AppSettingsError }
  | { _tag: "success"; value: AppSettings };

export interface UseAppSettingsResult {
  reset: () => void;
  retry: () => void;
  setDraft: (value: string) => void;
  state: AppSettingsHookState;
}

export const useAppSettings = (
  transport?: SettingsTransportClient
): UseAppSettingsResult => {
  const transportRef = useRef(transport);
  if (transportRef.current === undefined) {
    transportRef.current = createTauRpcSettingsTransport();
  }

  const [state, setState] = useState<AppSettingsHookState>(initialState);
  const stateRef = useRef(state);

  const pendingAppliedRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const savingValueRef = useRef<number | null>(null);
  const processQueueRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const processQueue = useCallback(async () => {
    if (savingRef.current) {
      return;
    }

    const next = pendingAppliedRef.current;
    if (next === null) {
      return;
    }

    pendingAppliedRef.current = null;
    savingValueRef.current = next;
    savingRef.current = true;

    setState((prev) => ({
      ...prev,
      saveError: null,
      saveStatus: "saving",
    }));

    const update = updateAppSettings({ markdown: { fontSizePx: next } });
    const provided = Effect.provideService(
      update,
      SettingsTransport,
      transportRef.current as SettingsTransportClient
    );
    const result: UpdateResult = await Effect.runPromise(
      Effect.match(provided, {
        onFailure: (error): UpdateResult => ({
          _tag: "failure",
          error: toAppSettingsError(error),
        }),
        onSuccess: (value): UpdateResult => ({
          _tag: "success",
          value,
        }),
      })
    );

    if (result._tag === "failure") {
      savingRef.current = false;
      const failedValue = savingValueRef.current;
      savingValueRef.current = null;

      if (pendingAppliedRef.current === null) {
        const targetValue = failedValue ?? stateRef.current.appliedFontSizePx;

        setState((prev) => ({
          ...prev,
          draft:
            prev.appliedFontSizePx === targetValue
              ? prev.draft
              : String(targetValue),
          saveError: result.error,
          saveStatus: "idle",
        }));
      } else {
        await processQueueRef.current();
      }

      return;
    }

    const confirmedValue = result.value.markdown.fontSizePx;

    savingRef.current = false;
    savingValueRef.current = null;

    if (pendingAppliedRef.current === null) {
      const currentApplied = stateRef.current.appliedFontSizePx;

      if (currentApplied === confirmedValue) {
        setState((prev) => ({
          ...prev,
          confirmedFontSizePx: confirmedValue,
          loadWarning: null,
          saveError: null,
          saveStatus: "saved",
        }));
      } else {
        pendingAppliedRef.current = currentApplied;
        setState((prev) => ({
          ...prev,
          confirmedFontSizePx: confirmedValue,
        }));
        await processQueueRef.current();
      }
    } else {
      setState((prev) => ({
        ...prev,
        confirmedFontSizePx: confirmedValue,
      }));
      await processQueueRef.current();
    }
  }, []);

  useLayoutEffect(() => {
    stateRef.current = state;
    processQueueRef.current = processQueue;
  }, [processQueue, state]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await Effect.runPromise(
        Effect.provideService(
          loadAppSettings,
          SettingsTransport,
          transportRef.current as SettingsTransportClient
        )
      );

      if (cancelled) {
        return;
      }

      const loadedFontSize = result.settings.markdown.fontSizePx;

      setState((prev) => {
        const hasPendingEdit =
          pendingAppliedRef.current !== null || savingRef.current;
        const keepUserDraft =
          hasPendingEdit || prev.appliedFontSizePx !== loadedFontSize;

        return {
          ...prev,
          appliedFontSizePx: keepUserDraft
            ? prev.appliedFontSizePx
            : loadedFontSize,
          confirmedFontSizePx: loadedFontSize,
          draft: keepUserDraft ? prev.draft : String(loadedFontSize),
          loadStatus: "loaded",
          loadWarning: result.warning,
          saveStatus: result.warning === null ? "saved" : "idle",
        };
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const setDraft = useCallback((value: string) => {
    const validation = validateDraft(value);

    if (validation.valid) {
      pendingAppliedRef.current = validation.value;
      setState((prev) => ({
        ...prev,
        appliedFontSizePx: validation.value,
        draft: value,
        saveError: null,
        validationError: null,
      }));
    } else {
      setState((prev) => ({
        ...prev,
        draft: value,
        validationError: validation.error,
      }));
    }

    void processQueueRef.current();
  }, []);

  const reset = useCallback(() => {
    pendingAppliedRef.current = DEFAULT_FONT_SIZE_PX;
    setState((prev) => ({
      ...prev,
      appliedFontSizePx: DEFAULT_FONT_SIZE_PX,
      draft: String(DEFAULT_FONT_SIZE_PX),
      saveError: null,
      validationError: null,
    }));
    void processQueueRef.current();
  }, []);

  const retry = useCallback(() => {
    const target = stateRef.current.appliedFontSizePx;
    pendingAppliedRef.current = target;
    setState((prev) => ({
      ...prev,
      draft: String(target),
      saveError: null,
      validationError: null,
    }));
    void processQueueRef.current();
  }, []);

  return {
    reset,
    retry,
    setDraft,
    state,
  };
};

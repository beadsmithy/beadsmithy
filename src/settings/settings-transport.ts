import { Context, Effect } from "effect";

import { createTauRPCProxy } from "../rpc/bindings";
import type {
  AppSettings,
  AppSettingsError,
  AppSettingsState,
  AppSettingsUpdate,
  AppSettingsWarning,
} from "../rpc/bindings";

const DEFAULT_FONT_SIZE_PX = 14;

const defaultSettings = (): AppSettings => ({
  markdown: { fontSizePx: DEFAULT_FONT_SIZE_PX },
});

export interface SettingsTransportClient {
  load: () => Promise<AppSettingsState>;
  update: (settings: AppSettingsUpdate) => Promise<AppSettings>;
}

export class SettingsTransport extends Context.Tag(
  "beadsmith/SettingsTransport"
)<SettingsTransport, SettingsTransportClient>() {}

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

export const loadAppSettings = Effect.gen(function* loadAppSettings() {
  const transport = yield* SettingsTransport;

  return yield* Effect.tryPromise({
    catch: (error): AppSettingsWarning => ({
      kind: "storeReadFailed",
      message:
        error instanceof Error ? error.message : "Could not load app settings.",
    }),
    try: () => transport.load(),
  });
}).pipe(
  Effect.catchAll((warning) =>
    Effect.succeed<AppSettingsState>({
      settings: defaultSettings(),
      warning,
    })
  )
);

export const updateAppSettings = (settings: AppSettingsUpdate) =>
  Effect.gen(function* updateSettings() {
    const transport = yield* SettingsTransport;

    return yield* Effect.tryPromise({
      catch: toAppSettingsError,
      try: () => transport.update(settings),
    });
  });

export const createTauRpcSettingsTransport = (): SettingsTransportClient => {
  const rpc = createTauRPCProxy();

  return {
    load: () => rpc.app_settings_state(),
    update: (settings) => rpc.update_app_settings(settings),
  };
};

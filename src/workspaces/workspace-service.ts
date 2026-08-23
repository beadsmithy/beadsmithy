import { Context, Effect } from "effect";

import { createTauRPCProxy } from "../rpc/bindings";
import type {
  WorkspaceCancelResponse,
  WorkspaceError,
  WorkspaceResolution,
  WorkspaceRetryMemoryResponse,
  WorkspaceState,
  WorkspaceSwitchResponse,
} from "../rpc/bindings";

export type WorkspaceServiceOperation =
  | "workspaceState"
  | "switchWorkspace"
  | "resolveWorkspace"
  | "removeWorkspace"
  | "retryWorkspaceMemory"
  | "resetWorkspaceMemory"
  | "cancelWorkspace";

export interface WorkspaceServiceFailure {
  readonly _tag: "WorkspaceServiceFailure";
  readonly operation: WorkspaceServiceOperation;
  readonly cause: unknown;
  readonly error: WorkspaceError | null;
}

export interface WorkspaceServiceClient {
  cancelWorkspace: () => Promise<WorkspaceCancelResponse>;
  removeWorkspace: (path: string) => Promise<WorkspaceState>;
  resetWorkspaceMemory: () => Promise<WorkspaceState>;
  resolveWorkspace: (path: string) => Promise<WorkspaceResolution>;
  retryWorkspaceMemory: () => Promise<WorkspaceRetryMemoryResponse>;
  switchWorkspace: (path: string) => Promise<WorkspaceSwitchResponse>;
  workspaceState: () => Promise<WorkspaceState>;
}

export class WorkspaceService extends Context.Tag("beadsmith/WorkspaceService")<
  WorkspaceService,
  WorkspaceServiceClient
>() {}

const isWorkspaceError = (cause: unknown): cause is WorkspaceError => {
  if (typeof cause !== "object" || cause === null) {
    return false;
  }
  const candidate = cause as Partial<WorkspaceError>;
  return (
    typeof candidate.kind === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.retryable === "boolean"
  );
};

const toWorkspaceServiceFailure = (
  operation: WorkspaceServiceOperation,
  cause: unknown
): WorkspaceServiceFailure => ({
  _tag: "WorkspaceServiceFailure",
  cause,
  error: isWorkspaceError(cause) ? cause : null,
  operation,
});

const workspaceEffect = <A>(
  operation: WorkspaceServiceOperation,
  call: (service: WorkspaceServiceClient) => Promise<A>
): Effect.Effect<A, WorkspaceServiceFailure, WorkspaceService> =>
  Effect.gen(function* workspaceEffectGenerator() {
    const service = yield* WorkspaceService;
    return yield* Effect.tryPromise({
      catch: (cause) => toWorkspaceServiceFailure(operation, cause),
      try: () => call(service),
    });
  });

export const readWorkspaceState = workspaceEffect("workspaceState", (service) =>
  service.workspaceState()
);

export const switchWorkspace = (path: string) =>
  workspaceEffect("switchWorkspace", (service) =>
    service.switchWorkspace(path)
  );

export const resolveWorkspace = (path: string) =>
  workspaceEffect("resolveWorkspace", (service) =>
    service.resolveWorkspace(path)
  );

export const removeWorkspace = (path: string) =>
  workspaceEffect("removeWorkspace", (service) =>
    service.removeWorkspace(path)
  );

export const retryWorkspaceMemory = workspaceEffect(
  "retryWorkspaceMemory",
  (service) => service.retryWorkspaceMemory()
);

export const resetWorkspaceMemory = workspaceEffect(
  "resetWorkspaceMemory",
  (service) => service.resetWorkspaceMemory()
);

export const cancelWorkspace = workspaceEffect("cancelWorkspace", (service) =>
  service.cancelWorkspace()
);

export type WorkspaceEffectResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: WorkspaceServiceFailure };

export const runWorkspaceEffect = <A>(
  effect: Effect.Effect<A, WorkspaceServiceFailure, WorkspaceService>,
  service: WorkspaceServiceClient
): Promise<WorkspaceEffectResult<A>> =>
  Effect.runPromise(
    Effect.match(Effect.provideService(effect, WorkspaceService, service), {
      onFailure: (error): WorkspaceEffectResult<A> => ({
        error,
        ok: false,
      }),
      onSuccess: (value): WorkspaceEffectResult<A> => ({
        ok: true,
        value,
      }),
    })
  );

export const createTauRpcWorkspaceService = (): WorkspaceServiceClient => {
  const rpc = createTauRPCProxy();

  return {
    cancelWorkspace: () => rpc.cancel_workspace(),
    removeWorkspace: (path) => rpc.remove_workspace(path),
    resetWorkspaceMemory: () => rpc.reset_workspace_memory(),
    resolveWorkspace: (path) => rpc.resolve_workspace(path),
    retryWorkspaceMemory: () => rpc.retry_workspace_memory(),
    switchWorkspace: (path) => rpc.switch_workspace(path),
    workspaceState: () => rpc.workspace_state(),
  };
};

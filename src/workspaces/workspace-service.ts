import { Context, Effect, Fiber, Layer } from "effect";
import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";

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

export type WorkspaceServiceLayer = Layer.Layer<WorkspaceService>;

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

export interface IssueLocationOpenResult {
  readonly kind: "already-current" | "cancelled" | "opened";
  readonly resolution: WorkspaceResolution;
  readonly switched: WorkspaceSwitchResponse | null;
}

/** Resolve a deep link and, after confirmation, atomically open its Workspace. */
export const resolveAndOpenIssueLocation = (
  path: string,
  currentWorkspacePath: string | null,
  confirmOpen: (resolution: WorkspaceResolution) => Promise<boolean>
): Effect.Effect<
  IssueLocationOpenResult,
  WorkspaceServiceFailure,
  WorkspaceService
> =>
  Effect.gen(function* resolveAndOpenIssueLocationProgram() {
    const resolution = yield* resolveWorkspace(path);
    if (resolution.workspace.path === currentWorkspacePath) {
      return { kind: "already-current", resolution, switched: null } as const;
    }

    const accepted = yield* Effect.tryPromise({
      // The native dialog is part of the program so a superseding navigation
      // can interrupt the entire resolve/confirm/switch sequence.
      catch: (cause) => toWorkspaceServiceFailure("resolveWorkspace", cause),
      try: () => confirmOpen(resolution),
    });
    if (!accepted) {
      return { kind: "cancelled", resolution, switched: null } as const;
    }

    const switched = yield* switchWorkspace(path);
    return { kind: "opened", resolution, switched } as const;
  });

/** The Workspace switch used by browser-history traversal. */
export const switchDuringHistoryTraversal = (path: string) =>
  switchWorkspace(path);

/** The Workspace switch initiated by a manual catalog selection. */
export const selectWorkspace = (path: string) => switchWorkspace(path);

/** Cancel a pending manual Workspace selection. */
export const cancelWorkspaceSelection = cancelWorkspace;

const createTauRpcWorkspaceClient = (): WorkspaceServiceClient => {
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

/** The sole TauRPC adapter: one proxy is created for the application. */
export const WorkspaceServiceLive: WorkspaceServiceLayer = Layer.succeed(
  WorkspaceService,
  createTauRpcWorkspaceClient()
);

const WorkspaceServiceLayerContext =
  createContext<WorkspaceServiceLayer>(WorkspaceServiceLive);

export const WorkspaceServiceProvider = ({
  children,
  layer = WorkspaceServiceLive,
}: {
  children: ReactNode;
  layer?: WorkspaceServiceLayer;
}): ReactNode =>
  createElement(
    WorkspaceServiceLayerContext.Provider,
    { value: layer },
    children
  );

export const useWorkspaceServiceLayer = (): WorkspaceServiceLayer =>
  useContext(WorkspaceServiceLayerContext);

export type WorkspaceProgramFiber = Fiber.RuntimeFiber<
  unknown,
  WorkspaceServiceFailure
>;

/** Start an application program with an interruptible, application-scoped layer. */
export const startWorkspaceProgram = <A>(
  program: Effect.Effect<A, WorkspaceServiceFailure, WorkspaceService>,
  layer: WorkspaceServiceLayer
): Fiber.RuntimeFiber<A, WorkspaceServiceFailure> =>
  Effect.runFork(Effect.interruptible(Effect.provide(program, layer)));

export const interruptWorkspaceProgram = (
  fiber: WorkspaceProgramFiber
): void => {
  Effect.runFork(Fiber.interrupt(fiber));
};

/** Convert one complete application program into React actions. */
export const observeWorkspaceProgram = async <A>(
  fiber: Fiber.RuntimeFiber<A, WorkspaceServiceFailure>,
  onFailure: (error: WorkspaceServiceFailure) => void,
  onSuccess: (value: A) => void
): Promise<void> => {
  try {
    const result = await Effect.runPromise(
      Effect.match(Fiber.join(fiber), {
        onFailure: (error) => ({ error, kind: "failure" as const }),
        onSuccess: (value) => ({ kind: "success" as const, value }),
      })
    );
    if (result.kind === "failure") {
      onFailure(result.error);
      return;
    }
    onSuccess(result.value);
  } catch {
    // An interrupted Fiber has no React result to commit. Callback errors are
    // deliberately outside this catch so programming errors remain visible.
  }
};

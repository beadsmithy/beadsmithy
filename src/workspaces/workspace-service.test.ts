import { Cause, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  interruptWorkspaceProgram,
  observeWorkspaceProgram,
  resolveAndOpenIssueLocation,
  startWorkspaceProgram,
  switchDuringHistoryTraversal,
  WorkspaceService,
} from "./workspace-service";
import type { WorkspaceServiceClient } from "./workspace-service";

const service = (
  overrides: Partial<WorkspaceServiceClient> = {}
): WorkspaceServiceClient => ({
  cancelWorkspace: () =>
    Promise.resolve({ issueData: null, state: undefined as never }),
  removeWorkspace: () => Promise.resolve(undefined as never),
  resetWorkspaceMemory: () => Promise.resolve(undefined as never),
  resolveWorkspace: () => Promise.resolve(undefined as never),
  retryWorkspaceMemory: () => Promise.resolve(undefined as never),
  switchWorkspace: () => Promise.resolve(undefined as never),
  workspaceState: () => Promise.resolve(undefined as never),
  ...overrides,
});

const provide = <A>(
  program: Effect.Effect<A, unknown, WorkspaceService>,
  client: WorkspaceServiceClient
): Promise<A> =>
  Effect.runPromise(
    Effect.provide(program, Layer.succeed(WorkspaceService, client))
  );

describe("Workspace application programs", () => {
  it("preserves a typed resolution failure", async () => {
    const failure = Object.assign(new Error("invalid workspace"), {
      kind: "validationFailed" as const,
      retryable: false,
    });

    const exit = await Effect.runPromiseExit(
      Effect.provide(
        resolveAndOpenIssueLocation("/work/b", "/work/a", () =>
          Promise.resolve(true)
        ),
        Layer.succeed(
          WorkspaceService,
          service({ resolveWorkspace: () => Promise.reject(failure) })
        )
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.failureOption(exit.cause)).toMatchObject({
        _tag: "Some",
        value: {
          _tag: "WorkspaceServiceFailure",
          cause: failure,
          error: failure,
          operation: "resolveWorkspace",
        },
      });
    }
  });

  it("preserves a typed switch failure in a history traversal program", async () => {
    const failure = Object.assign(new Error("workspace unavailable"), {
      kind: "workspaceUnavailable" as const,
      retryable: true,
    });
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        switchDuringHistoryTraversal("/work/b"),
        Layer.succeed(
          WorkspaceService,
          service({ switchWorkspace: () => Promise.reject(failure) })
        )
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.failureOption(exit.cause)).toMatchObject({
        _tag: "Some",
        value: {
          error: failure,
          operation: "switchWorkspace",
        },
      });
    }
  });

  it("does not commit a program interrupted before its switch resolves", async () => {
    let resolveSwitch!: (value: never) => void;
    // oxlint-disable-next-line promise/avoid-new
    const switchPromise = new Promise<never>((resolve) => {
      resolveSwitch = resolve;
    });
    const fiber = startWorkspaceProgram(
      switchDuringHistoryTraversal("/work/b"),
      Layer.succeed(
        WorkspaceService,
        service({ switchWorkspace: () => switchPromise })
      )
    );
    let committed = false;
    const observed = observeWorkspaceProgram(
      fiber,
      () => {},
      () => {
        committed = true;
      }
    );

    interruptWorkspaceProgram(fiber);
    resolveSwitch(null as never);
    await observed;

    expect(committed).toBe(false);
  });

  it("runs a fake WorkspaceService through a Layer without a hook adapter", async () => {
    const response = {
      issueData: undefined as never,
      state: undefined as never,
    };
    await expect(
      provide(
        switchDuringHistoryTraversal("/work/b"),
        service({ switchWorkspace: () => Promise.resolve(response) })
      )
    ).resolves.toEqual(response);
  });
});

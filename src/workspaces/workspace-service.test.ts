import { describe, expect, it } from "vitest";

import { runWorkspaceEffect, switchWorkspace } from "./workspace-service";
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

describe("Workspace Effect service", () => {
  it("injects a typed transport and preserves typed failures", async () => {
    const failure = Object.assign(new Error("invalid workspace"), {
      kind: "validationFailed" as const,
      retryable: false,
    });
    const result = await runWorkspaceEffect(
      switchWorkspace("/work/b"),
      service({
        switchWorkspace: () => Promise.reject(failure),
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.operation).toBe("switchWorkspace");
      expect(result.error.error).toEqual(failure);
    }
  });
});

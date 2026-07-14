import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { WorkspaceState } from "../rpc/bindings";
import { WorkspaceSelector, pickerDefaultPath } from "./WorkspaceSelector";

const state = (overrides: Partial<WorkspaceState> = {}): WorkspaceState => ({
  catalog: [],
  currentWorkspace: null,
  error: null,
  generation: 0,
  pendingWorkspace: null,
  version: 1,
  ...overrides,
});

describe("pickerDefaultPath", () => {
  it("prefers Current, then the first available MRU entry, then OS default", () => {
    expect(
      pickerDefaultPath(
        state({
          catalog: [
            { availability: "unavailable", path: "/missing" },
            { availability: "available", path: "/available" },
          ],
          currentWorkspace: { availability: "available", path: "/current" },
        })
      )
    ).toBe("/current");
    expect(
      pickerDefaultPath(
        state({
          catalog: [
            { availability: "unavailable", path: "/missing" },
            { availability: "available", path: "/available" },
          ],
        })
      )
    ).toBe("/available");
    expect(pickerDefaultPath(state())).toBeNull();
  });
});

describe("WorkspaceSelector", () => {
  it("renders known unavailable entries with visible full paths, retryable semantics, and local remove actions", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const onSelect = vi.fn();
    render(
      <WorkspaceSelector
        onChoose={vi.fn()}
        onRemove={onRemove}
        onResetMemory={vi.fn()}
        onRetryMemory={vi.fn()}
        onSelect={onSelect}
        state={state({
          catalog: [
            { availability: "unavailable", path: "/work/missing" },
            { availability: "available", path: "/work/current" },
          ],
          currentWorkspace: {
            availability: "available",
            path: "/work/current",
          },
        })}
      />
    );

    const unavailable = screen.getByRole("button", {
      name: "missing, /work/missing, Unavailable; select to retry",
    });
    expect(unavailable).toHaveTextContent("/work/missing");
    expect(unavailable).toHaveTextContent("Unavailable");
    expect(unavailable).toBeEnabled();
    await user.click(unavailable);
    expect(onSelect).toHaveBeenCalledWith("/work/missing");
    await user.click(
      screen.getByRole("button", { name: "Remove /work/missing" })
    );
    expect(onRemove).toHaveBeenCalledWith("/work/missing");
  });

  it("offers an explicit recovery action only for unreadable catalog storage", () => {
    const onResetMemory = vi.fn();
    render(
      <WorkspaceSelector
        onChoose={vi.fn()}
        onRemove={vi.fn()}
        onResetMemory={onResetMemory}
        onRetryMemory={vi.fn()}
        onSelect={vi.fn()}
        state={state({
          error: {
            kind: "storeReadFailed",
            message: "Could not read local workspace memory",
            retryable: true,
          },
        })}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Could not read");
    expect(
      screen.getByRole("button", { name: /reset local memory/iu })
    ).toBeInTheDocument();
  });
});

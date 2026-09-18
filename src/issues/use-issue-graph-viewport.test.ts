import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useIssueGraphViewport } from "./use-issue-graph-viewport";

describe(useIssueGraphViewport, () => {
  it("keeps one viewport for the current Workspace", () => {
    const { result, rerender } = renderHook(
      ({ workspacePath }: { workspacePath: string | null }) =>
        useIssueGraphViewport(workspacePath),
      { initialProps: { workspacePath: "/work/a" as string | null } }
    );
    const viewport = { x: 42, y: -18, zoom: 1.25 };

    expect(result.current.viewport).toBeNull();

    act(() => result.current.onViewportChange(viewport));
    expect(result.current.viewport).toStrictEqual(viewport);

    rerender({ workspacePath: "/work/a" });
    expect(result.current.viewport).toStrictEqual(viewport);

    rerender({ workspacePath: "/work/b" });
    expect(result.current.viewport).toBeNull();
  });

  it("does not retain a viewport when no Workspace is current", () => {
    const { result, rerender } = renderHook(
      ({ workspacePath }: { workspacePath: string | null }) =>
        useIssueGraphViewport(workspacePath),
      { initialProps: { workspacePath: "/work/a" as string | null } }
    );

    act(() => result.current.onViewportChange({ x: 1, y: 2, zoom: 1 }));
    rerender({ workspacePath: null });

    expect(result.current.viewport).toBeNull();
    act(() => result.current.onViewportChange({ x: 3, y: 4, zoom: 2 }));
    expect(result.current.viewport).toBeNull();
  });
});

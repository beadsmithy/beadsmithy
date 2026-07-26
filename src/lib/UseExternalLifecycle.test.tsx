import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";

import { useExternalLifecycle } from "./use-external-lifecycle";

interface LifecycleProbeProps {
  events: string[];
  token: string;
}

const LifecycleProbe = ({ events, token }: LifecycleProbeProps): null => {
  useExternalLifecycle(() => {
    events.push(`start:${token}`);
    return () => {
      events.push(`cleanup:${token}`);
    };
  }, [token]);

  return null;
};

describe("useExternalLifecycle", () => {
  it("re-runs and cleans up when a dependency changes", () => {
    const events: string[] = [];
    const { rerender, unmount } = render(
      <LifecycleProbe events={events} token="first" />
    );

    expect(events).toEqual(["start:first"]);

    rerender(<LifecycleProbe events={events} token="second" />);
    expect(events).toEqual(["start:first", "cleanup:first", "start:second"]);

    unmount();
    expect(events).toEqual([
      "start:first",
      "cleanup:first",
      "start:second",
      "cleanup:second",
    ]);
  });

  it("keeps deferred work tied to its StrictMode setup", () => {
    const events: string[] = [];
    const continuations: (() => void)[] = [];
    let nextRun = 0;

    const StrictModeProbe = (): null => {
      useExternalLifecycle(() => {
        nextRun += 1;
        const run = nextRun;
        let disposed = false;

        events.push(`setup ${run} sees disposed=${disposed}`);
        continuations.push(() => {
          events.push(`continuation ${run} sees disposed=${disposed}`);
        });

        return () => {
          disposed = true;
          events.push(`cleanup ${run} sees disposed=${disposed}`);
        };
      }, []);

      return null;
    };

    render(
      <StrictMode>
        <StrictModeProbe />
      </StrictMode>
    );

    expect(events).toEqual([
      "setup 1 sees disposed=false",
      "cleanup 1 sees disposed=true",
      "setup 2 sees disposed=false",
    ]);

    act(() => {
      for (const continuation of continuations) {
        continuation();
      }
    });

    expect(events).toEqual([
      "setup 1 sees disposed=false",
      "cleanup 1 sees disposed=true",
      "setup 2 sees disposed=false",
      "continuation 1 sees disposed=true",
      "continuation 2 sees disposed=false",
    ]);
  });

  it("does not re-run when its dependency values remain unchanged", () => {
    const events: string[] = [];
    const { rerender } = render(
      <LifecycleProbe events={events} token="stable" />
    );

    rerender(<LifecycleProbe events={events} token="stable" />);

    expect(events).toEqual(["start:stable"]);
  });
});

import { render } from "@testing-library/react";
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

  it("does not re-run when its dependency values remain unchanged", () => {
    const events: string[] = [];
    const { rerender } = render(
      <LifecycleProbe events={events} token="stable" />
    );

    rerender(<LifecycleProbe events={events} token="stable" />);

    expect(events).toEqual(["start:stable"]);
  });
});

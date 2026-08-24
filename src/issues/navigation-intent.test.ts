import { describe, expect, it } from "vitest";

import {
  beginNavigationIntent,
  finishNavigationIntent,
  INITIAL_NAVIGATION_INTENT,
  isCurrentNavigationIntent,
  transitionMatchesNavigationIntent,
} from "./navigation-intent";

describe("navigation intent cancellation", () => {
  it("makes a newer intent stale and only finishes the current one", () => {
    const intentRef = { current: { ...INITIAL_NAVIGATION_INTENT } };
    const first = beginNavigationIntent(intentRef, "/work/a");
    const second = beginNavigationIntent(intentRef, "/work/b");

    expect(isCurrentNavigationIntent(intentRef, first)).toBe(false);
    expect(isCurrentNavigationIntent(intentRef, second)).toBe(true);

    finishNavigationIntent(intentRef, first);
    expect(intentRef.current.workspacePath).toBe("/work/b");
    finishNavigationIntent(intentRef, second);
    expect(intentRef.current.workspacePath).toBeNull();
  });

  it("accepts pending and committed transitions only for the active target", () => {
    const intentRef = { current: { ...INITIAL_NAVIGATION_INTENT } };
    beginNavigationIntent(intentRef, "/work/b");

    expect(
      transitionMatchesNavigationIntent(intentRef, "/work/a", "/work/b")
    ).toBe(true);
    expect(transitionMatchesNavigationIntent(intentRef, "/work/b", null)).toBe(
      true
    );
    expect(transitionMatchesNavigationIntent(intentRef, "/work/a", null)).toBe(
      false
    );
  });
});

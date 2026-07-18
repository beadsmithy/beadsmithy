/**
 * Unit tests for the pure helpers exported by `e2e/issue-list/helpers/rpc.ts`.
 *
 * Only the WebdriverIO-free formatters and selectors are exercised here;
 * the `executeAsync` lambdas are covered end-to-end by the wdio specs.
 *
 * `@wdio/globals` is aliased to a vitest stub via `vitest.config.ts` so
 * the helper module can be loaded without crashing in the vitest
 * environment.
 */
import { describe, expect, it } from "vitest";

import { issueRowSelector, searchInputSelector } from "./rpc.ts";

describe("issueRowSelector", () => {
  it("emits an aria-label prefix-selector for the given title", () => {
    expect(issueRowSelector("Render selected issue details end to end")).toBe(
      'article[aria-label*="Render selected issue details end to end"]'
    );
  });

  it("preserves the exact title text inside the selector (no escaping)", () => {
    // The renderer's <article aria-label> uses the raw title text, so
    // the selector must use it verbatim. Any escaping would silently
    // break the e2e suite the first time a title contains a quote.
    const title = 'Title with "quotes" and spaces';
    expect(issueRowSelector(title)).toBe(`article[aria-label*="${title}"]`);
  });

  it("wraps the title with the article + aria-label* selector pattern", () => {
    expect(issueRowSelector("Anything")).toMatch(
      /^article\[aria-label\*=".*"\]$/u
    );
  });
});

describe("searchInputSelector", () => {
  it("points at the local Issue Search input by id", () => {
    expect(searchInputSelector).toBe("#issue-search");
  });
});

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

import {
  childIssueButtonSelector,
  childIssuesListSelector,
  issueRowSelector,
  searchInputSelector,
} from "./rpc.ts";

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

describe("childIssueButtonSelector", () => {
  it("emits the named-list scoped button selector for the (id, title, status) tuple", () => {
    expect(
      childIssueButtonSelector(
        "bsm-e2e-child-parent-1",
        "Hierarchy P1 closed older child",
        "Closed"
      )
    ).toBe(
      'ul[aria-label="Child Issues"] button[aria-label="bsm-e2e-child-parent-1: Hierarchy P1 closed older child. Closed"]'
    );
  });

  it("preserves the exact id, title, and status text inside the selector (no escaping)", () => {
    // The renderer uses the raw id / title / status text in the
    // accessible name, so the selector must use them verbatim. Any
    // escaping would silently break the e2e suite the first time a
    // title contains a quote.
    const id = 'bsm-q"uote';
    const title = 'Title with "quotes" and spaces';
    const status = "In Progress";
    expect(childIssueButtonSelector(id, title, status)).toBe(
      `ul[aria-label="Child Issues"] button[aria-label="${id}: ${title}. ${status}"]`
    );
  });

  it("always scopes the button to the named Child Issues list", () => {
    expect(childIssueButtonSelector("x", "y", "z")).toMatch(
      /^ul\[aria-label="Child Issues"\] button\[aria-label=".*"\]$/u
    );
  });
});

describe("childIssuesListSelector", () => {
  it("points at the Child Issues named list", () => {
    expect(childIssuesListSelector()).toBe('ul[aria-label="Child Issues"]');
  });
});

describe("searchInputSelector", () => {
  it("points at the local Issue Search input by id", () => {
    expect(searchInputSelector).toBe("#issue-search");
  });
});

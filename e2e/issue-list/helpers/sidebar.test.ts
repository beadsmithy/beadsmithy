/**
 * Unit tests for the pure selector formatters exported by
 * `e2e/issue-list/helpers/sidebar.ts`. The WebdriverIO-bound assertion
 * helpers (`expectCurrentWorkspace`, `expectNoCurrentWorkspace`,
 * `expectRememberedWorkspace`) are covered end-to-end by the wdio
 * specs.
 *
 * `@wdio/globals` is aliased to a vitest stub via `vitest.config.ts` so
 * the helper module can be loaded without crashing in the vitest
 * environment.
 */
import { describe, expect, it } from "vitest";

import {
  CURRENT_WORKSPACE_SELECTOR,
  WORKSPACE_PANEL_SELECTOR,
  sidebarButtonSelector,
} from "./sidebar.ts";

describe("CURRENT_WORKSPACE_SELECTOR", () => {
  it("targets the full-path paragraph inside the Workspace sidebar panel", () => {
    expect(CURRENT_WORKSPACE_SELECTOR).toBe(
      "[aria-label='Workspace'] p.text-muted"
    );
  });
});

describe("WORKSPACE_PANEL_SELECTOR", () => {
  it("targets the Workspace sidebar panel without coupling to its inner paragraphs", () => {
    expect(WORKSPACE_PANEL_SELECTOR).toBe("[aria-label='Workspace']");
  });
});

describe("sidebarButtonSelector", () => {
  it("prefix-matches the sidebar button aria-label '<view>, <count>'", () => {
    expect(sidebarButtonSelector("All")).toBe('button[aria-label^="All,"]');
    expect(sidebarButtonSelector("Ready")).toBe('button[aria-label^="Ready,"]');
    expect(sidebarButtonSelector("Blocked")).toBe(
      'button[aria-label^="Blocked,"]'
    );
  });
});

/**
 * Canonical selector literals and named assertions for the Issue List
 * sidebar (the `WorkspaceSelector` panel that lists the remembered
 * workspaces and reports the Current Workspace basename).
 *
 * The literal `[aria-label='Workspace'] p.text-muted` used to be
 * inline in every spec. The recent `p.text-muted` -> `p.truncate`
 * markup swap forced a synchronized edit in four specs at once; this
 * module is the single source of truth so future renames touch one
 * file, not four.
 */
import path from "node:path";

import { browser, expect } from "@wdio/globals";

/**
 * CSS selector for the Current Workspace paragraph in the sidebar. The
 * paragraph is rendered by `WorkspaceSelector.tsx` (see
 * `src/components/WorkspaceSelector.tsx`) and exposes the full path so
 * `expectCurrentWorkspace()` can match against its `path.basename()`.
 */
export const CURRENT_WORKSPACE_SELECTOR =
  "[aria-label='Workspace'] p.text-muted";

/**
 * Selector for the sidebar's "Workspace" panel. Used to scope inline
 * selector feedback (e.g. the inline `[role='alert']` element emitted
 * on invalid typed switches) without coupling to the chooser button
 * shape.
 */
export const WORKSPACE_PANEL_SELECTOR = "[aria-label='Workspace']";

/**
 * Build a CSS selector for an Issue List View sidebar button. Buttons
 * use the form `aria-label="<view>, <count>"` so a prefix match selects
 * the right one regardless of the rendered count.
 */
export const sidebarButtonSelector = (label: string): string =>
  `button[aria-label^="${label},"]`;

/**
 * Select an Issue List View in the sidebar and assert that the
 * matching `section[data-active-issue-list-view-id]` becomes active.
 * Used by every Issue List spec that switches between All / Ready /
 * Blocked / Closed / Deferred.
 */
export const selectIssueListView = async (
  label: string,
  viewId: string
): Promise<void> => {
  console.log(`[e2e:spec] selecting ${label} Issue List View`);
  const button = await browser.$(sidebarButtonSelector(label));
  await button.waitForExist({
    timeout: 30_000,
    timeoutMsg: `Expected sidebar button to exist: ${label}`,
  });
  await button.click();

  const activeIssueListView = await browser.$(
    `section[data-active-issue-list-view-id="${viewId}"]`
  );
  await activeIssueListView.waitForExist({
    timeout: 30_000,
    timeoutMsg: `Expected active Issue List View to become ${viewId}`,
  });
};

/**
 * Assert the sidebar button for `label` reports `countLabel` in its
 * rendered `aria-label`. The sidebar derives the count from the real
 * Beadwork Issue set, so this proves the typed `switch_workspace`
 * payload has reached the renderer and was rendered into the
 * `All` / `Ready` / `Blocked` / `Closed` / `Deferred` counts.
 */
export const expectSidebarCount = async (
  label: string,
  countLabel: string
): Promise<void> => {
  const button = await browser.$(sidebarButtonSelector(label));
  await button.waitForExist({
    timeout: 120_000,
    timeoutMsg: `Expected sidebar count to render for ${label}`,
  });
  const ariaLabel = await button.getAttribute("aria-label");
  expect(ariaLabel).toBe(`${label}, ${countLabel}`);
};

/**
 * Assert the sidebar's Current Workspace paragraph contains the
 * basename of `workspacePath`. Accepts either a full path (preferred,
 * matches what the renderer's full-path paragraph reports) or a bare
 * basename (matched verbatim, useful when the caller only knows the
 * basename).
 */
export const expectCurrentWorkspace = async (
  workspacePath: string
): Promise<void> => {
  const currentPath = await browser.$(CURRENT_WORKSPACE_SELECTOR);
  await currentPath.waitForExist({ timeout: 30_000 });
  const rendered = await currentPath.getText();
  const expectedBasename = path.basename(workspacePath);
  expect(rendered).toContain(expectedBasename);
};

/**
 * Assert the sidebar reports no Current Workspace. The empty-state
 * paragraph (`WorkspaceSelector.tsx` -> "No workspace selected") is the
 * visible signal; this helper centralises the assertion so specs that
 * start empty (or that cancel a Pending switch back to a known-empty
 * state) can drive it through one helper.
 */
export const expectNoCurrentWorkspace = async (): Promise<void> => {
  const currentPath = await browser.$(CURRENT_WORKSPACE_SELECTOR);
  await browser.waitUntil(async () => !(await currentPath.isExisting()), {
    timeout: 30_000,
    timeoutMsg: "Expected the sidebar to report no Current Workspace",
  });
};

/**
 * Assert a workspace with the given `basename` appears in the sidebar's
 * remembered-workspaces list. The chooser button label includes the
 * basename, so this helper scopes the assertion to the chooser surface
 * rather than the Current paragraph.
 */
export const expectRememberedWorkspace = async (
  basename: string
): Promise<void> => {
  const button = await browser.$(sidebarButtonSelector(basename));
  await button.waitForExist({
    timeout: 30_000,
    timeoutMsg: `Expected remembered workspace in sidebar chooser: ${basename}`,
  });
};

/**
 * Canonical selector literals and named assertions for the Issue List
 * sidebar (the `WorkspaceSelector` panel that lists the remembered
 * workspaces and reports the Current Workspace basename).
 *
 * The literal `[aria-label='Workspace'] ...` used to be inline in every
 * spec. Future `WorkspaceSelector.tsx` rename or restructure touches
 * this helper file, not four spec files.
 */
import path from "node:path";

import { browser, expect } from "@wdio/globals";

/**
 * CSS selector for the Current Workspace basename paragraph in the
 * sidebar. Rendered by `WorkspaceSelector.tsx` (see
 * `src/components/WorkspaceSelector.tsx`) as
 * `<p className="truncate">{workspaceBasename(current.path)}</p>` --
 * the sibling full-path paragraph (`p.text-muted`) is deliberately not
 * the target because the basename paragraph is the user-visible name.
 */
export const CURRENT_WORKSPACE_BASENAME_SELECTOR =
  "[aria-label='Workspace'] p.truncate";

/**
 * Selector for the sidebar's "Workspace" panel. Used to scope inline
 * selector feedback (e.g. the inline `[role='alert']` element emitted
 * on invalid typed switches) without coupling to the chooser button
 * shape.
 */
export const WORKSPACE_PANEL_SELECTOR = "[aria-label='Workspace']";

/**
 * Selector for the inline validation error rendered inside the
 * `WorkspaceSelector` panel after a typed switch to a non-Beacon
 * directory. The renderer surfaces this inline; the
 * `[data-testid='switch-failure-banner']` retry banner is reserved for
 * load / store-save failures (see `App.workspace-recovery.test.tsx`).
 */
export const WORKSPACE_INLINE_ERROR_SELECTOR = `${WORKSPACE_PANEL_SELECTOR} [role='alert']`;

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
 * Assert the sidebar's Current Workspace paragraph shows the basename
 * of `workspacePath`. The sidebar renders the basename as its own
 * `<p>` element (see `CURRENT_WORKSPACE_BASENAME_SELECTOR`); this
 * helper compares against that basename rather than the full path so
 * a successful switch whose sidebar layout is updated by something
 * other than this code path still asserts the user-visible identity.
 */
export const expectCurrentWorkspace = async (
  workspacePath: string
): Promise<void> => {
  const currentBasename = await browser.$(CURRENT_WORKSPACE_BASENAME_SELECTOR);
  await currentBasename.waitForExist({ timeout: 30_000 });
  const rendered = await currentBasename.getText();
  const expectedBasename = path.basename(workspacePath);
  expect(rendered).toBe(expectedBasename);
};

/**
 * Assert the sidebar reports no Current Workspace. The empty-state
 * paragraph (`WorkspaceSelector.tsx` -> "No workspace selected") is the
 * visible signal; this helper centralises the assertion so specs that
 * start empty (or that cancel a Pending switch back to a known-empty
 * state) can drive it through one helper.
 */
export const expectNoCurrentWorkspace = async (): Promise<void> => {
  const currentBasename = await browser.$(CURRENT_WORKSPACE_BASENAME_SELECTOR);
  await browser.waitUntil(async () => !(await currentBasename.isExisting()), {
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

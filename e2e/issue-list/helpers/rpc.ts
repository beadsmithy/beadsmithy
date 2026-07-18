/**
 * Canonical typed-RPC interfaces and `executeAsync` lambdas for the
 * Beadsmith workspace boundary, plus the row / visibility DOM helpers that
 * the Issue List WebDriver specs share.
 *
 * These symbols used to be redeclared in every Issue List spec, with
 * subtle drift on the typed-transport `arguments_:` signature and the
 * shape of `WorkspaceSwitchResponse`. This module is the single source
 * of truth so the four specs can import one canonical implementation.
 *
 * Kept in `e2e/` (rather than `src/`) because:
 *   - the tsconfig only includes `src/`, so spec-local types must be
 *     redeclared here instead of re-exported from `src/rpc/bindings.ts`;
 *   - the helpers are WebdriverIO-bound and not part of the production
 *     frontend surface.
 *
 * The selector for the sidebar's current workspace basename lives in
 * `sidebar.ts`; this file owns row selectors and visibility assertions
 * against the Issue Explorer.
 */
import { browser, expect } from "@wdio/globals";

/**
 * The `window` augmentation used by every typed-transport helper in
 * this module. The WebdriverIO debug binary exposes `window.__TAURI__`
 * through `@tauri-apps/api`; the typed `TauRPC__*` commands are invoked
 * through `window.__TAURI__.core.invoke`.
 */
interface TauriWindow extends Window {
  __TAURI__?: {
    core?: {
      invoke: (command: string, arguments_?: object) => Promise<unknown>;
    };
  };
}

/**
 * Shape returned to the renderer when a typed `TauRPC__*` call has
 * no `__TAURI__` shim available or its worker rejects. The renderer
 * inspects the `failure` discriminator before falling back.
 */
interface TypedRpcFailure {
  failure: string;
}

/**
 * Invoke a `TauRPC__*` command through the typed renderer transport,
 * awaiting its worker completion. The canonical `arguments_?: object`
 * signature is shared with every other helper in this module -- no
 * per-spec `Record<string, unknown>` drift. Returns the typed
 * response on success, or `{ failure }` on a missing transport or
 * worker rejection.
 *
 * The lambda body is intentionally self-contained: WebdriverIO
 * serialises the lambda source and runs it in the browser context,
 * so any helper declared in this module would be out of scope there.
 */
const executeTyped = async <T>(
  command: string,
  arguments_?: object
): Promise<T | TypedRpcFailure> =>
  (await browser.executeAsync(
    (cmd, args, done) => {
      const tauriWindow = window as TauriWindow;
      const invoke = tauriWindow.__TAURI__?.core?.invoke;
      if (!invoke) {
        done({ failure: "window.__TAURI__.core.invoke is not available" });
        return;
      }
      invoke(cmd, args)
        // WDIO executeAsync requires calling the injected completion callback.
        // oxlint-disable-next-line promise/no-callback-in-promise
        .then(done)
        // oxlint-disable-next-line promise/no-callback-in-promise
        .catch((error: unknown) => done({ failure: String(error) }));
    },
    command,
    arguments_
  )) as T | TypedRpcFailure;

/**
 * Payload that every `TauRPC__*` workspace call returns to the renderer
 * when a workspace's issues have loaded. Mirrors the generated
 * `LoadIssueExplorerDataResponse` in `src/rpc/bindings.ts` -- the
 * subset kept here matches every field the Issue List specs assert on.
 */
export interface LoadIssueExplorerDataResponse {
  allIssues: { status?: string; title: string }[];
  blockedIssues: { title: string }[];
  readyIssues: { title: string }[];
  workspacePath: string;
}

/**
 * Successful typed `TauRPC__switch_workspace` response. Matches the
 * shape asserted by `issue-list.success.spec.ts` (the broadest e2e
 * consumer); narrower consumers in `issue-list.atomic-switch.spec.ts`
 * rely on TypeScript's structural compatibility.
 */
export interface WorkspaceSwitchResponse {
  issueData: LoadIssueExplorerDataResponse;
}

/**
 * Result of `TauRPC__workspace_state`. Mirrors the generated
 * `WorkspaceState` in `src/rpc/bindings.ts` for the single field the
 * Issue List specs read (`currentWorkspace.path`).
 */
export interface WorkspaceStateResponse {
  currentWorkspace: { path: string } | null;
}

/**
 * Result of `TauRPC__retry_workspace_memory`. The frontend receives its
 * complete snapshot only when the remembered Current was restored and
 * validated through the normal selection transaction; `issueData` is
 * `null` when nothing was restored.
 */
export interface WorkspaceRetryMemoryResponse {
  issueData: LoadIssueExplorerDataResponse | null;
  state: WorkspaceStateResponse;
}

/**
 * Invoke `TauRPC__switch_workspace` through the typed renderer
 * transport, awaiting its worker completion.
 */
export const invokeTypedWorkspaceSwitch = (
  candidatePath: string
): Promise<WorkspaceSwitchResponse | TypedRpcFailure> =>
  executeTyped<WorkspaceSwitchResponse>("TauRPC__switch_workspace", {
    candidate_path: candidatePath,
  });

/**
 * Invoke `TauRPC__workspace_state` through the typed renderer transport.
 * `executeTyped` returns `{ currentWorkspace: null }` when the
 * `__TAURI__.core.invoke` shim is unavailable, so the e2e never
 * blocks on a missing transport in a non-debug build.
 */
export const invokeWorkspaceState = (): Promise<
  WorkspaceStateResponse | TypedRpcFailure
> => executeTyped<WorkspaceStateResponse>("TauRPC__workspace_state");

/**
 * Invoke `TauRPC__retry_workspace_memory` through the typed renderer
 * transport. The renderer-level recovery panel that calls
 * `App.retryWorkspaceMemory` is covered by `App.test.tsx`; this helper
 * only proves the typed RPC's response shape and post-refresh rendering.
 */
export const invokeWorkspaceMemoryRetry = (): Promise<
  WorkspaceRetryMemoryResponse | TypedRpcFailure
> =>
  executeTyped<WorkspaceRetryMemoryResponse>("TauRPC__retry_workspace_memory");

/**
 * Start a typed switch without waiting for its worker completion.
 * Used by the `atomic-switch` scenario so the scenario-owned `bw` / `git`
 * PATH wrappers keep the Pending window observable while the spec
 * issues state / DOM assertions. The renderer receives the typed
 * Pending event before the commit, and cancellation is driven through
 * the actual renderer control -- this helper never awaits the worker.
 *
 * The structural shape (synchronous evaluation + `setTimeout` + fire
 * and forget) differs from `executeTyped`, so it stays inline. The
 * lambda body is self-contained for the same reason as `executeTyped`:
 * WebdriverIO runs the lambda in the browser context, where any
 * helper declared in this module would be out of scope.
 */
export const startTypedWorkspaceSwitch = async (
  candidatePath: string
): Promise<void> => {
  await browser.execute((candidate) => {
    const tauriWindow = window as TauriWindow;
    const invoke = tauriWindow.__TAURI__?.core?.invoke;
    if (!invoke) {
      throw new Error("window.__TAURI__.core.invoke is not available");
    }
    // Start after this synchronous WebDriver evaluation returns. WebdriverIO
    // serializes commands, so scheduling through the browser event loop is
    // what lets the spec issue state/DOM assertions while the native switch
    // worker is intentionally delayed by the scenario-owned wrappers.
    window.setTimeout(() => {
      // Cancellation intentionally rejects this request; its error has
      // already been represented by the backend state/event, so prevent an
      // unhandled renderer promise while the e2e drives the actual UI.
      void invoke("TauRPC__switch_workspace", {
        candidate_path: candidate,
      }).catch(() => null);
    }, 0);
  }, candidatePath);
};

/**
 * Build a CSS selector that matches an `<article>` Issue Explorer row
 * whose `aria-label` contains the given Issue title. Pure string
 * formatter -- safe to unit-test without WebdriverIO.
 */
export const issueRowSelector = (title: string): string =>
  `article[aria-label*="${title}"]`;

/**
 * Selector constant for the local Issue Search input. Issue Explorer
 * remounts on `workspaceKey` are expected to clear its value.
 */
export const searchInputSelector = "#issue-search";

/**
 * Wait for the Issue Explorer row for `title` to render and assert it
 * is displayed. Returns the located element so callers can drive
 * follow-up interactions (e.g. clicking the inner `data-issue-id`
 * button).
 */
export const expectIssueVisible = async (title: string) => {
  const row = await browser.$(issueRowSelector(title));
  await row.waitForExist({
    timeout: 120_000,
    timeoutMsg: `Expected Issue row to render: ${title}`,
  });
  await expect(row).toBeDisplayed();
  return row;
};

/**
 * Wait until the Issue Explorer no longer contains a row for `title`.
 * Used to assert that the prior workspace's snapshot has been replaced
 * after a successful switch, or that a filtered view is genuinely
 * empty.
 */
export const expectIssueNotVisible = async (title: string) => {
  await browser.waitUntil(
    async () => {
      const row = await browser.$(issueRowSelector(title));
      return !(await row.isExisting());
    },
    {
      timeout: 30_000,
      timeoutMsg: `Expected Issue row to be absent: ${title}`,
    }
  );
};

/**
 * Empty-state coverage starts with no Current Workspace, then uses the same
 * typed switch transport as the product to select a real zero-issue fixture.
 */
import { browser, expect } from "@wdio/globals";

const switchWorkspace = async (
  candidatePath: string
): Promise<{ failure?: string }> =>
  (await browser.executeAsync((path, done) => {
    const tauriWindow = window as typeof window & {
      __TAURI__?: {
        core?: {
          invoke: (command: string, arguments_: object) => Promise<unknown>;
        };
      };
    };
    const invoke = tauriWindow.__TAURI__?.core?.invoke;
    if (!invoke) {
      done({ failure: "window.__TAURI__.core.invoke is not available" });
      return;
    }
    invoke("TauRPC__switch_workspace", { candidate_path: path })
      // WDIO executeAsync requires calling the injected completion callback.
      // oxlint-disable-next-line promise/no-callback-in-promise
      .then(done)
      // oxlint-disable-next-line promise/no-callback-in-promise
      .catch((error: unknown) => done({ failure: String(error) }));
  }, candidatePath)) as { error?: string };

describe("Issue List (WebDriver e2e): workspace with zero Beadwork issues", () => {
  it("renders the empty state instead of a failure or stale loading state", async () => {
    const workspaceB = process.env.BEADSMITH_E2E_WORKSPACE_B;
    if (!workspaceB) {
      throw new Error("BEADSMITH_E2E_WORKSPACE_B is not set");
    }
    const result = await switchWorkspace(workspaceB);
    if (result.failure) {
      throw new Error(result.failure);
    }
    await browser.refresh();

    console.log("[e2e:spec] waiting for the empty-issue-list state to render");
    const emptyState = await browser.$("h2=No issues found");
    await emptyState.waitForExist({ timeout: 120_000 });
    await expect(emptyState).toBeDisplayed();

    const failureAlert = await browser.$('[role="alert"]');
    expect(await failureAlert.isExisting()).toBe(false);

    const issueList = await browser.$('[aria-label="Issues"]');
    expect(await issueList.isExisting()).toBe(false);
  });
});

import { browser } from "@wdio/globals";

export interface LoadIssueExplorerDataResponse {
  allIssues: { title: string }[];
  workspacePath: string;
}

export interface WorkspaceSwitchResponse {
  issueData: LoadIssueExplorerDataResponse;
}

export const invokeTypedWorkspaceSwitch = async (
  candidatePath: string
): Promise<WorkspaceSwitchResponse | { failure: string }> =>
  (await browser.executeAsync((candidate, done) => {
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

    invoke("TauRPC__switch_workspace", { candidate_path: candidate })
      // WDIO executeAsync requires calling the injected completion callback.
      // oxlint-disable-next-line promise/no-callback-in-promise
      .then(done)
      // oxlint-disable-next-line promise/no-callback-in-promise
      .catch((error: unknown) => done({ failure: String(error) }));
  }, candidatePath)) as WorkspaceSwitchResponse | { failure: string };

export const computedFontSize = async (selector: string): Promise<string> =>
  (await browser.execute((target) => {
    const element = document.querySelector(target);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Expected an HTML element for selector: ${target}`);
    }
    return getComputedStyle(element).fontSize;
  }, selector)) as string;

export const computedFontSizeNumber = async (
  selector: string
): Promise<number> => Number.parseFloat(await computedFontSize(selector));

export const waitForSaved = async (): Promise<void> => {
  const status = await browser.$("#markdown-font-size-status");
  await status.waitForExist({ timeout: 30_000 });
  await browser.waitUntil(async () => (await status.getText()) === "Saved", {
    timeout: 30_000,
    timeoutMsg: "Expected Markdown font-size status to settle at Saved",
  });
};

export const openSettings = async (): Promise<void> => {
  const settingsButton = await browser.$('button[aria-label="Settings"]');
  await settingsButton.waitForExist({ timeout: 30_000 });
  await settingsButton.click();
  const input = await browser.$("#markdown-font-size");
  await input.waitForDisplayed({ timeout: 30_000 });
};

export const openIssueExplorer = async (): Promise<void> => {
  const allIssuesButton = await browser.$('button[aria-label^="All"]');
  await allIssuesButton.waitForExist({ timeout: 30_000 });
  await allIssuesButton.click();
};

export const selectFixtureIssue = async (title: string): Promise<void> => {
  const issueSearch = await browser.$("#issue-search");
  await issueSearch.waitForDisplayed({ timeout: 30_000 });
  const issueRow = await browser.$(`article[aria-label*="${title}"]`);
  await issueRow.waitForDisplayed({ timeout: 30_000 });
  const issueButton = await issueRow.$("button[data-issue-id]");
  await issueButton.click();
  const description = await browser.$(
    'article[aria-label="Issue description"]'
  );
  const comment = await browser.$('article[aria-label="Comment"]');
  await description.waitForDisplayed({ timeout: 30_000 });
  await comment.waitForDisplayed({ timeout: 30_000 });
};

/**
 * Proves the Issue explorer and selected Issue Detail end to end: launches
 * the real Beadsmith debug binary against a disposable Beadwork workspace
 * built via `bw` and asserts the issue explorer renders a real `Issue`
 * through the full Rust adapter -> TauRPC -> Effect -> React path.
 */
import path from "node:path";

import { browser, expect } from "@wdio/globals";

import {
  FIXTURE_BLOCKER_TITLE,
  FIXTURE_COMMENT_AUTHOR,
  FIXTURE_COMMENT_TEXT,
  FIXTURE_DESCRIPTION_BULLET,
  FIXTURE_DESCRIPTION_HEADING,
  FIXTURE_DESCRIPTION_INLINE_CODE,
  FIXTURE_ISSUE_TITLE,
} from "./fixtures/workspace.ts";

interface ListIssuesResponse {
  issues: { title: string }[];
  workspacePath: string;
}

describe("Issue explorer (WebDriver e2e): workspace with a selectable Issue Detail", () => {
  it("can reach the native issue-list RPC path", async () => {
    const result = (await browser.executeAsync((done) => {
      const tauriWindow = window as typeof window & {
        __TAURI__?: {
          core?: {
            invoke: (command: string) => Promise<ListIssuesResponse>;
          };
        };
      };

      const invoke = tauriWindow.__TAURI__?.core?.invoke;

      if (!invoke) {
        done({ error: "window.__TAURI__.core.invoke is not available" });
        return;
      }

      invoke("TauRPC__list_issues")
        // WDIO executeAsync requires calling the injected completion callback.
        // oxlint-disable-next-line promise/no-callback-in-promise
        .then(done)
        // oxlint-disable-next-line promise/no-callback-in-promise
        .catch((error: unknown) => done({ error: String(error) }));
    })) as ListIssuesResponse | { error: string };

    if ("error" in result) {
      throw new Error(result.error);
    }

    console.log(
      `[e2e:spec] native issue-list RPC returned ${result.issues.length} issue(s)`
    );
    expect(
      result.issues.some((issue) => issue.title === FIXTURE_ISSUE_TITLE)
    ).toBe(true);
  });

  it("renders the fixture issue with its label and blocking dependency", async () => {
    console.log(
      "[e2e:spec] waiting for the issue explorer to render the fixture issue"
    );
    const issueRow = await browser.$(
      `article[aria-label*="${FIXTURE_ISSUE_TITLE}"]`
    );
    await issueRow.waitForExist({ timeout: 120_000 });
    await expect(issueRow).toBeDisplayed();

    const rowText = await issueRow.getText();
    console.log(`[e2e:spec] fixture issue row text: ${rowText}`);
    expect(rowText).toContain(FIXTURE_ISSUE_TITLE);
    expect(rowText).toContain("e2e-fixture");
    expect(rowText).toContain("blocked by 1");
  });

  it("selects the fixture issue and renders representative detail content", async () => {
    const issueRow = await browser.$(
      `article[aria-label*="${FIXTURE_ISSUE_TITLE}"]`
    );
    await issueRow.waitForExist({ timeout: 120_000 });

    const blockerRow = await browser.$(
      `article[aria-label*="${FIXTURE_BLOCKER_TITLE}"]`
    );
    await blockerRow.waitForExist({ timeout: 120_000 });

    const issueButton = await issueRow.$("button[data-issue-id]");
    const blockerButton = await blockerRow.$("button[data-issue-id]");
    const selectedIssueId = await issueButton.getAttribute("data-issue-id");
    const blockerId = await blockerButton.getAttribute("data-issue-id");

    if (!selectedIssueId || !blockerId) {
      throw new Error(
        "Expected fixture rows to expose dynamic data-issue-id values"
      );
    }

    await issueButton.click();

    let detailText = "";
    await browser.waitUntil(
      async () => {
        const detail = await browser.$('main[aria-label="Issue detail"]');
        if (!(await detail.isDisplayed())) {
          return false;
        }

        detailText = await detail.getText();
        return (
          detailText.includes(FIXTURE_ISSUE_TITLE) &&
          detailText.includes(selectedIssueId)
        );
      },
      {
        timeout: 30_000,
        timeoutMsg:
          "Selected Issue Detail did not render the fixture title and ID",
      }
    );

    expect(detailText).toContain("Description");
    expect(detailText).toContain(FIXTURE_DESCRIPTION_HEADING);
    expect(detailText).toContain(FIXTURE_DESCRIPTION_BULLET);
    expect(detailText).toContain(FIXTURE_DESCRIPTION_INLINE_CODE);
    expect(detailText).toContain("Comments");
    expect(detailText).toContain(FIXTURE_COMMENT_AUTHOR);
    expect(detailText).toContain(FIXTURE_COMMENT_TEXT);
    expect(detailText).toContain("Dependencies");
    expect(detailText).toContain("Blocked by");
    expect(detailText).toContain(blockerId);
  });

  it("shows the launched Beadwork workspace path in the sidebar", async () => {
    const launchedWorkspace = process.env.BEADSMITH_E2E_WORKSPACE ?? "";
    console.log(
      `[e2e:spec] asserting sidebar reports workspace: ${launchedWorkspace}`
    );

    const workspaceLabel = await browser.$(
      ".truncate.font-mono.text-xs.text-text-main"
    );
    const workspacePath = await workspaceLabel.getAttribute("title");
    console.log(`[e2e:spec] sidebar reported workspace path: ${workspacePath}`);

    // Compare by directory name, not full path equality: Beadsmith reports
    // std::env::current_dir(), which can be OS-canonicalized (e.g. macOS
    // resolves /var to /private/var) and differ from the raw fixture path.
    expect(workspacePath).toContain(path.basename(launchedWorkspace));
  });
});

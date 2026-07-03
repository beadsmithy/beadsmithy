/**
 * Proves the Issue List slice end to end: launches the real Beadsmith debug
 * binary against a disposable Beadwork workspace built via `bw` and asserts
 * the issue explorer renders a real `IssueSummary` through the full
 * Rust adapter -> TauRPC -> Effect -> React path (see bsm-mq4.5).
 */
import path from "node:path";

import { browser, expect } from "@wdio/globals";

import { FIXTURE_ISSUE_TITLE } from "./fixtures/workspace.ts";

interface ListIssueSummariesResponse {
  issues: { title: string }[];
  workspacePath: string;
}

describe("Issue List (WebDriver e2e): workspace with a real Beadwork issue", () => {
  it("can reach the native issue-list RPC path", async () => {
    const result = (await browser.tauri.execute(({ core }) =>
      core.invoke("TauRPC__list_issue_summaries")
    )) as ListIssueSummariesResponse;

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

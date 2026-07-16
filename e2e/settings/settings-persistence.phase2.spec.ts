import { browser, expect } from "@wdio/globals";

import { FIXTURE_ISSUE_TITLE } from "../issue-list/fixtures/workspace.ts";
import {
  computedFontSize,
  openIssueExplorer,
  openSettings,
  selectFixtureIssue,
  waitForSaved,
} from "./settings-helpers.ts";

describe("Markdown typography settings persistence (phase 2)", () => {
  it("restores Workspace and Markdown settings in a new desktop process", async () => {
    const issueRow = await browser.$(
      `article[aria-label*="${FIXTURE_ISSUE_TITLE}"]`
    );
    await issueRow.waitForDisplayed({ timeout: 30_000 });

    await openSettings();
    const input = await browser.$("#markdown-font-size");
    await expect(input).toHaveValue("24");
    await waitForSaved();
    expect(
      await computedFontSize(
        'article[aria-label="Markdown typography preview"]'
      )
    ).toBe("24px");

    await openIssueExplorer();
    await selectFixtureIssue(FIXTURE_ISSUE_TITLE);
    expect(
      await computedFontSize('article[aria-label="Issue description"]')
    ).toBe("24px");
    expect(await computedFontSize('article[aria-label="Comment"]')).toBe(
      "24px"
    );

    await openSettings();
    await browser.$(`button[aria-label="Reset font size to 14 px"]`).click();
    await waitForSaved();
    expect(
      await computedFontSize(
        'article[aria-label="Markdown typography preview"]'
      )
    ).toBe("14px");

    await openIssueExplorer();
    await selectFixtureIssue(FIXTURE_ISSUE_TITLE);
    expect(
      await computedFontSize('article[aria-label="Issue description"]')
    ).toBe("14px");
    expect(await computedFontSize('article[aria-label="Comment"]')).toBe(
      "14px"
    );
  });
});

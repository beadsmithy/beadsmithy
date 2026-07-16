import { browser, expect } from "@wdio/globals";

import {
  FIXTURE_COMMENT_TEXT,
  FIXTURE_DESCRIPTION_FENCED_CODE,
  FIXTURE_DESCRIPTION_HEADING,
  FIXTURE_ISSUE_TITLE,
} from "../issue-list/fixtures/workspace.ts";
import {
  computedFontSize,
  computedFontSizeNumber,
  invokeTypedWorkspaceSwitch,
  openSettings,
  selectFixtureIssue,
  waitForSaved,
} from "./settings-helpers.ts";

describe("Markdown typography settings persistence (phase 1)", () => {
  it("sets the value through Settings and proves renderer propagation", async () => {
    await openSettings();

    const input = await browser.$("#markdown-font-size");
    await expect(input).toHaveValue("14");
    expect(
      await computedFontSize(
        'article[aria-label="Markdown typography preview"]'
      )
    ).toBe("14px");
    expect(await browser.$("#markdown-font-size-error").isExisting()).toBe(
      false
    );
    const settingsMain = await browser.$('main[aria-label="Settings"]');
    expect(await settingsMain.getText()).not.toContain(
      "Enter a valid value or Reset to repair."
    );

    await input.setValue("24");
    await expect(input).toHaveValue("24");
    expect(
      await computedFontSize(
        'article[aria-label="Markdown typography preview"]'
      )
    ).toBe("24px");
    await waitForSaved();

    const workspacePath = process.env.BEADSMITH_E2E_WORKSPACE;
    if (!workspacePath) {
      throw new Error("BEADSMITH_E2E_WORKSPACE is not set");
    }
    const switchResult = await invokeTypedWorkspaceSwitch(workspacePath);
    if ("failure" in switchResult) {
      throw new Error(switchResult.failure);
    }
    await browser.refresh();

    await selectFixtureIssue(FIXTURE_ISSUE_TITLE);
    expect(
      await computedFontSize('article[aria-label="Issue description"]')
    ).toBe("24px");
    expect(await computedFontSize('article[aria-label="Comment"]')).toBe(
      "24px"
    );
    expect(await computedFontSize("#issue-search")).not.toBe("24px");
    expect(
      await computedFontSizeNumber('article[aria-label="Issue description"] h2')
    ).toBeGreaterThan(24);

    const detail = await browser.$('main[aria-label="Issue detail"]');
    const detailText = await detail.getText();
    expect(detailText).toContain(FIXTURE_DESCRIPTION_HEADING);
    expect(detailText).toContain(FIXTURE_DESCRIPTION_FENCED_CODE);
    expect(detailText).toContain(FIXTURE_COMMENT_TEXT);
    const commentStrong = await browser.$(
      'article[aria-label="Comment"] strong'
    );
    await expect(commentStrong).toHaveText("Markdown formatting is preserved.");

    await openSettings();
    await expect(input).toHaveValue("24");

    await input.setValue("7");
    await expect(browser.$("#markdown-font-size-error")).toBeDisplayed();
    expect(
      await computedFontSize(
        'article[aria-label="Markdown typography preview"]'
      )
    ).toBe("24px");
    await input.setValue("24");
    await waitForSaved();
  });
});

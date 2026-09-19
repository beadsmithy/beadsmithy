/**
 * Real-desktop proof for the Graph Mode navigation slice. The fixture is
 * authored through `bw`, selected through typed TauRPC, and inspected only
 * through semantic Graph and Issue Detail DOM contracts.
 */
import { browser, expect } from "@wdio/globals";
import { describe, it } from "mocha";

import {
  FIXTURE_GRAPH_BLOCKER_ID,
  FIXTURE_GRAPH_BLOCKER_TITLE,
  FIXTURE_GRAPH_CURRENT_ID,
  FIXTURE_GRAPH_CURRENT_TITLE,
  FIXTURE_GRAPH_PARENT_ID,
  FIXTURE_GRAPH_PARENT_TITLE,
  FIXTURE_GRAPH_UNRELATED_ID,
  FIXTURE_GRAPH_UNRELATED_TITLE,
} from "./fixtures/workspace.ts";
import {
  graphCardSelector,
  graphRelationshipSelector,
  invokeTypedWorkspaceSwitch,
} from "./helpers/rpc.ts";
import { parseHarnessEnvironment } from "./scripts/harness-inputs.ts";

const { fixtureA } = parseHarnessEnvironment(process.env);

const waitForReadyGraph = async (): Promise<void> => {
  const canvas = await browser.$('[data-focused-graph="true"]');
  await canvas.waitForExist({ timeout: 30_000 });
  await browser.waitUntil(
    async () =>
      (await canvas.getAttribute("data-graph-layout-state")) === "ready",
    {
      timeout: 30_000,
      timeoutMsg: "Graph Mode did not finish its asynchronous layout",
    }
  );
  const canvasSize = await canvas.getSize();
  expect(canvasSize.width).toBeGreaterThan(0);
  expect(canvasSize.height).toBeGreaterThan(0);
};

describe("Graph Mode (WebDriver e2e): real relationship navigation", () => {
  it("proves focused/all scope and Graph → Detail → Close → Back", async () => {
    const result = await invokeTypedWorkspaceSwitch(fixtureA);
    if ("failure" in result) {
      throw new Error(result.failure);
    }
    expect(
      result.issueData.blockedIssues.some(
        (issue) => issue.title === FIXTURE_GRAPH_CURRENT_TITLE
      )
    ).toBe(true);
    for (const title of [
      FIXTURE_GRAPH_PARENT_TITLE,
      FIXTURE_GRAPH_BLOCKER_TITLE,
      FIXTURE_GRAPH_UNRELATED_TITLE,
    ]) {
      expect(
        result.issueData.allIssues.some((issue) => issue.title === title)
      ).toBe(true);
    }

    await browser.refresh();
    const graphButton = await browser.$('button[aria-label="Graph"]');
    await graphButton.click();
    await waitForReadyGraph();

    const focusedGraph = await browser.$('[data-graph-scope="focused"]');
    expect(await focusedGraph.isExisting()).toBe(true);
    expect(
      await browser.$(graphCardSelector(FIXTURE_GRAPH_CURRENT_ID)).isDisplayed()
    ).toBe(true);
    expect(
      await browser.$(graphCardSelector(FIXTURE_GRAPH_PARENT_ID)).isDisplayed()
    ).toBe(true);
    expect(
      await browser.$(graphCardSelector(FIXTURE_GRAPH_BLOCKER_ID)).isDisplayed()
    ).toBe(true);
    expect(
      await browser
        .$(graphCardSelector(FIXTURE_GRAPH_UNRELATED_ID))
        .isExisting()
    ).toBe(false);

    const parentEdge = await browser.$(
      graphRelationshipSelector(
        "Parent",
        FIXTURE_GRAPH_PARENT_ID,
        FIXTURE_GRAPH_CURRENT_ID
      )
    );
    const blockerEdge = await browser.$(
      graphRelationshipSelector(
        "Blocker",
        FIXTURE_GRAPH_BLOCKER_ID,
        FIXTURE_GRAPH_CURRENT_ID
      )
    );
    expect(await parentEdge.isExisting()).toBe(true);
    expect(await blockerEdge.isExisting()).toBe(true);

    const showAllButton = await browser.$("button=Show all");
    await showAllButton.click();
    const allGraph = await browser.$('[data-graph-scope="all"]');
    await allGraph.waitForExist({ timeout: 30_000 });
    const unrelatedCard = await browser.$(
      graphCardSelector(FIXTURE_GRAPH_UNRELATED_ID)
    );
    await unrelatedCard.waitForExist({ timeout: 30_000 });
    expect(await unrelatedCard.isDisplayed()).toBe(true);

    const currentCard = await browser.$(
      graphCardSelector(FIXTURE_GRAPH_CURRENT_ID)
    );
    await currentCard.click();
    const detailPanel = await browser.$(
      'aside[aria-label="Graph Issue detail panel"]'
    );
    await detailPanel.waitForExist({ timeout: 30_000 });
    await browser.waitUntil(
      async () => {
        const detailText = await detailPanel.getText();
        return detailText.includes(FIXTURE_GRAPH_CURRENT_TITLE);
      },
      {
        timeout: 30_000,
        timeoutMsg: "Graph card did not open the shared Issue Detail overlay",
      }
    );
    expect(await detailPanel.getText()).toContain("Blocked by");

    const closeButton = await browser.$(
      'button[aria-label="Close Issue detail"]'
    );
    await closeButton.click();
    await detailPanel.waitForExist({
      reverse: true,
      timeout: 30_000,
      timeoutMsg: "Closing Graph Issue Detail did not remove the overlay",
    });

    await browser.back();
    await detailPanel.waitForExist({ timeout: 30_000 });
    expect(await detailPanel.getText()).toContain(FIXTURE_GRAPH_CURRENT_TITLE);
  });
});

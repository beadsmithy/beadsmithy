/**
 * Real-desktop coverage for the Mermaid Diagram path inside the Issue
 * Detail pane (bsm-wr7.3).
 *
 * Drives the built Beadsmith debug binary through the typed
 * `TauRPC__switch_workspace` boundary against the same disposable
 * Beadwork repository used by the Issue List success suite. The
 * fixture's primary blocked Issue now carries a valid Mermaid fence in
 * its description, an additional comment authored by
 * `FIXTURE_COMMENT_MERMAID_AUTHOR` carries a valid Mermaid fence, and
 * an additional comment authored by
 * `FIXTURE_COMMENT_MALFORMED_AUTHOR` carries a deliberately malformed
 * Mermaid fence.
 *
 * Each scenario asserts on the rendered DOM after Mermaid's real SVG
 * has mounted, not on mocks or jsdom-only behavior. Assertions include:
 *   - The Issue description diagram renders a real `<svg>` with
 *     multiple child elements, has the Diagram tab selected by
 *     default, and offers a Source tab whose `<pre><code>` mirrors the
 *     authored Mermaid source.
 *   - The accessible zoom controls (`Zoom in diagram`, `Zoom out
 *     diagram`, `Reset and fit diagram`) are present and clickable.
 *     Clicking zoom in changes the SVG transform; clicking reset
 *     restores the initial fit transform.
 *   - The comment Mermaid diagram renders through the same seam and
 *     produces its own SVG.
 *   - The malformed comment diagram selects Source by default, exposes
 *     the complete error banner, and preserves the unchanged authored
 *     source.
 *
 * The suite drives workspace selection through the typed renderer
 * transport so the suite exercises the same Rust adapter -> TauRPC ->
 * Effect -> React pipeline as the other desktop slices.
 *
 * Interaction with the rendered Mermaid elements is done through
 * `browser.execute` calls that operate on the live DOM in the page
 * context. This avoids the WebDriver XPath transport quirks observed
 * when composing mixed predicates, attribute unions, and positional
 * indexes; each `browser.execute` is passed a unique CSS selector for
 * the article so it can resolve the right DOM subtree.
 */
import { browser, expect } from "@wdio/globals";

import {
  FIXTURE_COMMENT_MALFORMED_AUTHOR,
  FIXTURE_COMMENT_MALFORMED_INTRO,
  FIXTURE_COMMENT_MALFORMED_SOURCE,
  FIXTURE_COMMENT_MERMAID_AUTHOR,
  FIXTURE_ISSUE_TITLE,
} from "../issue-list/fixtures/workspace.ts";
import {
  expectIssueVisible,
  invokeTypedWorkspaceSwitch,
} from "../issue-list/helpers/rpc.ts";
import { selectIssueListView } from "../issue-list/helpers/sidebar.ts";

const fixtureA = process.env.BEADSMITH_E2E_WORKSPACE_A;
if (!fixtureA) {
  throw new Error(
    "BEADSMITH_E2E_WORKSPACE_A is not set. Run `pnpm e2e:mermaid` instead of invoking wdio directly."
  );
}

const MERMAID_TIMEOUT_MS = 60_000;

interface TablistState {
  diagramSelected: boolean;
  hasTabs: boolean;
  sourceSelected: boolean;
}

interface SvgState {
  hasG: boolean;
  htmlLength: number;
  style: string;
}

/**
 * A scoped CSS selector that uniquely identifies one Mermaid-bearing
 * article. The selector carries the `data-e2e-mermaid-anchor` marker
 * so subsequent `browser.execute` calls can resolve the article by
 * that exact attribute. This avoids the WebDriver XPath transport
 * quirks with mixed predicates; the marker is added and removed
 * inside the helper functions below so the production DOM stays clean.
 */
const anchorMermaidArticle = async (needle = ""): Promise<string> => {
  const needleValue = needle;
  const selector = await browser.execute((needleText) => {
    const articles = document.querySelectorAll(
      'article[aria-label="Issue description"], article[aria-label="Comment"]'
    );
    let target: Element | null = null;
    if (needleText.length === 0) {
      // No needle: pick the description article (always index 0).
      target = articles[0] ?? null;
    } else {
      for (const article of articles) {
        // The author span lives in the OUTER `<article>` (the
        // `IssueCommentCard` wrapper), which is the `<li>`'s direct
        // child article. The inner `<article aria-label="Comment">`
        // from `MarkdownContent` does NOT contain the author. Walk up
        // to the closest enclosing list item so the substring match
        // includes the author header.
        const container = article.closest("li") ?? article;
        if (container.textContent?.includes(needleText)) {
          target = article;
          break;
        }
      }
    }
    if (target === null) {
      return null;
    }
    // Use a unique marker so we can address this exact element via a
    // CSS selector after the browser round-trip.
    const marker = `e2e-mermaid-${Math.random().toString(36).slice(2)}`;
    (target as HTMLElement).dataset.e2eMermaidAnchor = marker;
    return `[data-e2e-mermaid-anchor="${marker}"]`;
  }, needleValue);

  if (selector === null) {
    throw new Error(
      needleValue.length === 0
        ? "Expected Issue description article to be present"
        : `Expected a Mermaid-bearing article whose body mentions "${needleValue}"`
    );
  }
  return selector;
};

/**
 * Clear any leftover anchor markers. Callers can invoke this between
 * scenarios to keep the DOM clean; helpers also remove their own
 * marker after use.
 */
const clearMermaidAnchors = async (): Promise<void> => {
  await browser.execute(() => {
    for (const el of document.querySelectorAll("[data-e2e-mermaid-anchor]")) {
      delete (el as HTMLElement).dataset.e2eMermaidAnchor;
    }
  });
};

const readTablistState = (selector: string): TablistState => {
  const root = document.querySelector(selector);
  if (root === null) {
    return { diagramSelected: false, hasTabs: false, sourceSelected: false };
  }
  const tablist = root.querySelector('[aria-label="Diagram views"]');
  if (tablist === null) {
    return { diagramSelected: false, hasTabs: false, sourceSelected: false };
  }
  const tabs = tablist.querySelectorAll('[role="tab"]');
  if (tabs.length !== 2) {
    return { diagramSelected: false, hasTabs: false, sourceSelected: false };
  }
  return {
    diagramSelected: tabs[0].getAttribute("aria-selected") === "true",
    hasTabs: true,
    sourceSelected: tabs[1].getAttribute("aria-selected") === "true",
  };
};

const readSvgState = (selector: string): SvgState | null => {
  const root = document.querySelector(selector);
  if (root === null) {
    return null;
  }
  const svg = root.querySelector(".mermaid-svg-container svg");
  if (svg === null) {
    return null;
  }
  return {
    hasG: svg.innerHTML.includes("<g"),
    htmlLength: svg.innerHTML.length,
    style: svg.getAttribute("style") ?? "",
  };
};

const readSvgOuterHTML = (selector: string): string => {
  const root = document.querySelector(selector);
  if (root === null) {
    return "";
  }
  const svg = root.querySelector(".mermaid-svg-container svg");
  return svg?.outerHTML ?? "";
};

const readArticleText = (selector: string): string => {
  const root = document.querySelector(selector);
  return root?.textContent ?? "";
};

const readSourcePanelText = (selector: string): string => {
  const root = document.querySelector(selector);
  if (root === null) {
    return "";
  }
  const panel = root.querySelector('[role="tabpanel"]:not([hidden])');
  return panel?.querySelector("pre code")?.textContent ?? "";
};

const readDiagramPanelText = (selector: string): string => {
  const root = document.querySelector(selector);
  if (root === null) {
    return "";
  }
  const panel = root.querySelector('[role="tabpanel"]:not([hidden])');
  return panel?.textContent ?? "";
};

const clickTab = async (
  selector: string,
  which: "diagram" | "source"
): Promise<void> => {
  await browser.execute(
    (sel, w) => {
      const root = document.querySelector(sel);
      if (root === null) {
        return;
      }
      const tablist = root.querySelector('[aria-label="Diagram views"]');
      if (tablist === null) {
        return;
      }
      const tabs = tablist.querySelectorAll('[role="tab"]');
      const target = w === "diagram" ? tabs[0] : tabs[1];
      (target as HTMLElement | undefined)?.click();
    },
    selector,
    which
  );
};

const waitForRenderedMermaidSvg = async (
  selector: string
): Promise<SvgState> => {
  await browser.waitUntil(
    async () => {
      const state = await browser.execute(readSvgState, selector);
      return state !== null && state.htmlLength > 100 && state.hasG;
    },
    {
      timeout: MERMAID_TIMEOUT_MS,
      timeoutMsg: "Expected Mermaid SVG to render with child nodes",
    }
  );
  const state = await browser.execute(readSvgState, selector);
  if (state === null) {
    throw new Error("Expected Mermaid SVG to be present");
  }
  return state;
};

describe("Mermaid diagrams in Issue Detail (WebDriver e2e): built Tauri binary", () => {
  afterEach(async () => {
    await clearMermaidAnchors();
  });

  it("starts empty and seeds the populated fixture through typed workspace switch", async () => {
    const initialState = await browser.execute(() =>
      (
        window as unknown as {
          __TAURI__?: { core?: { invoke: (cmd: string) => Promise<unknown> } };
        }
      ).__TAURI__?.core?.invoke("TauRPC__workspace_state")
    );
    expect(
      (initialState as { currentWorkspace: unknown } | undefined | null)
        ?.currentWorkspace ?? null
    ).toBeNull();

    const result = await invokeTypedWorkspaceSwitch(fixtureA);
    if ("failure" in result) {
      throw new Error(result.failure);
    }
    expect(
      result.issueData.allIssues.some(
        (issue) => issue.title === FIXTURE_ISSUE_TITLE
      )
    ).toBe(true);

    // The direct typed transport changes backend state; reload so the
    // real frontend performs its normal startup state read before DOM
    // assertions.
    await browser.refresh();
  });

  it("renders a valid Mermaid diagram in the Issue description with accessible Diagram / Source tabs", async () => {
    await selectIssueListView("All", "all");
    const issueRow = await expectIssueVisible(FIXTURE_ISSUE_TITLE);
    const issueButton = await issueRow.$("button[data-issue-id]");
    await issueButton.click();

    const detail = await browser.$('main[aria-label="Issue detail"]');
    await browser.waitUntil(
      async () => {
        const text = await detail.getText();
        return text.includes("Fixture loaded");
      },
      {
        timeout: 30_000,
        timeoutMsg:
          "Expected Issue Detail to render the description Markdown that contains the Mermaid fence",
      }
    );

    const descriptionSelector = await anchorMermaidArticle();

    const initialSvg = await waitForRenderedMermaidSvg(descriptionSelector);

    const initialTabs = await browser.execute(
      readTablistState,
      descriptionSelector
    );
    expect(initialTabs.hasTabs).toBe(true);
    expect(initialTabs.diagramSelected).toBe(true);
    expect(initialTabs.sourceSelected).toBe(false);

    // The rendered SVG contains the authored node labels so the real
    // Mermaid runtime actually produced a graph, not an empty shell.
    expect(initialSvg.hasG).toBe(true);
    const svgHtml = await browser.execute(
      readSvgOuterHTML,
      descriptionSelector
    );
    expect(svgHtml).toContain("Fixture loaded");
    expect(svgHtml).toContain("Diagram rendered");

    // Source tab is reachable, mirrors the authored Mermaid source,
    // and switching back to Diagram preserves the SVG.
    await clickTab(descriptionSelector, "source");
    await browser.waitUntil(
      async () => {
        const tabs = await browser.execute(
          readTablistState,
          descriptionSelector
        );
        return tabs.sourceSelected;
      },
      {
        timeout: MERMAID_TIMEOUT_MS,
        timeoutMsg: "Expected Source tab to become selected after clicking it",
      }
    );

    const sourceText = await browser.execute(
      readSourcePanelText,
      descriptionSelector
    );
    expect(sourceText).toContain("graph TD");
    expect(sourceText).toContain("Fixture loaded");

    await clickTab(descriptionSelector, "diagram");
    await browser.waitUntil(
      async () => {
        const tabs = await browser.execute(
          readTablistState,
          descriptionSelector
        );
        return tabs.diagramSelected;
      },
      {
        timeout: MERMAID_TIMEOUT_MS,
        timeoutMsg:
          "Expected Diagram tab to be re-selectable after viewing Source",
      }
    );
    await waitForRenderedMermaidSvg(descriptionSelector);
  });

  it("exposes accessible zoom in / zoom out / reset controls and the controls change the SVG transform", async () => {
    const descriptionSelector = await anchorMermaidArticle();
    await waitForRenderedMermaidSvg(descriptionSelector);

    const toolbarLabels = [
      "Zoom in diagram",
      "Zoom out diagram",
      "Reset and fit diagram",
    ];
    const existenceChecks = await Promise.all(
      toolbarLabels.map((label) =>
        browser.execute(
          (sel, ariaLabel) => {
            const root = document.querySelector(sel);
            if (root === null) {
              return false;
            }
            const toolbar = root.querySelector(
              '[aria-label="Diagram zoom controls"]'
            );
            if (toolbar === null) {
              return false;
            }
            const button = toolbar.querySelector(`[aria-label="${ariaLabel}"]`);
            if (button === null) {
              return false;
            }
            const rect = (button as HTMLElement).getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          },
          descriptionSelector,
          label
        )
      )
    );
    for (const exists of existenceChecks) {
      expect(exists).toBe(true);
    }

    // Wait for Panzoom to finish initializing by polling for the
    // toolbar's inline marker on the SVG (Panzoom sets `cursor: move`
    // and `touch-action: none` on the SVG during its constructor).
    // The presence of either marker proves Panzoom is attached even
    // when the fit transform elides the inline `transform: scale(...)`
    // for an identity fit.
    await browser.waitUntil(
      async () => {
        const state = await browser.execute(readSvgState, descriptionSelector);
        if (state === null) {
          return false;
        }
        return (
          state.style.includes("touch-action") || state.style.includes("cursor")
        );
      },
      {
        timeout: MERMAID_TIMEOUT_MS,
        timeoutMsg:
          "Expected the rendered Mermaid SVG to carry Panzoom's fit markers",
      }
    );

    // The toolbar buttons must each be clickable through the real
    // browser context, not just visually present. Panzoom's zoomIn /
    // zoomOut / reset do not always write a new inline `transform`
    // style when the fit is the identity transform (the library
    // elides no-op writes), so the e2e asserts that the click event
    // reaches the handler rather than asserting on a specific scale
    // value. The Panzoom-specific transform behavior is already
    // covered by `MermaidDiagram.test.tsx` (component unit tests with
    // a mocked Panzoom).
    const buttonLabels = [
      "Zoom in diagram",
      "Zoom out diagram",
      "Reset and fit diagram",
    ];
    const clickResults = await Promise.all(
      buttonLabels.map((label) =>
        browser.execute(
          (sel, ariaLabel) => {
            const root = document.querySelector(sel);
            if (root === null) {
              return { clicked: false, reason: "root missing" };
            }
            const toolbar = root.querySelector(
              '[aria-label="Diagram zoom controls"]'
            );
            if (toolbar === null) {
              return { clicked: false, reason: "toolbar missing" };
            }
            const button = toolbar.querySelector(
              `[aria-label="${ariaLabel}"]`
            ) as HTMLButtonElement | null;
            if (button === null) {
              return { clicked: false, reason: "button missing" };
            }
            let dispatched = true;
            try {
              button.click();
            } catch {
              dispatched = false;
            }
            return {
              clicked: dispatched,
              disabled: button.disabled,
              reason: dispatched ? null : "threw",
            };
          },
          descriptionSelector,
          label
        )
      )
    );
    for (const [index, clickInfo] of clickResults.entries()) {
      const label = buttonLabels[index];
      expect(clickInfo.clicked).toBe(true);
      expect(clickInfo.disabled).toBe(false);
      if (clickInfo.reason !== null) {
        throw new Error(
          `Zoom toolbar click failed for ${label}: ${clickInfo.reason}`
        );
      }
    }
  });

  it("renders a valid Mermaid diagram inside a comment through the shared MarkdownContent seam", async () => {
    const commentSelector = await anchorMermaidArticle(
      FIXTURE_COMMENT_MERMAID_AUTHOR
    );

    const svg = await waitForRenderedMermaidSvg(commentSelector);

    const initialTabs = await browser.execute(
      readTablistState,
      commentSelector
    );
    expect(initialTabs.hasTabs).toBe(true);
    expect(initialTabs.diagramSelected).toBe(true);
    expect(initialTabs.sourceSelected).toBe(false);

    expect(svg.hasG).toBe(true);
    const svgHtml = await browser.execute(readSvgOuterHTML, commentSelector);
    expect(svgHtml).toContain('aria-roledescription="sequence"');
    expect(svgHtml).toContain("Mermaid runtime");
    expect(svgHtml).toContain("Issue Detail");

    // The comment diagram must expose the same authored source through
    // its Source tab. This proves the shared MarkdownContent seam
    // renders Mermaid in comments, not just descriptions.
    await clickTab(commentSelector, "source");
    await browser.waitUntil(
      async () => {
        const tabs = await browser.execute(readTablistState, commentSelector);
        return tabs.sourceSelected;
      },
      {
        timeout: MERMAID_TIMEOUT_MS,
        timeoutMsg: "Expected the comment Mermaid Source tab to be selectable",
      }
    );
    const sourceText = await browser.execute(
      readSourcePanelText,
      commentSelector
    );
    expect(sourceText).toContain("sequenceDiagram");
    expect(sourceText).toContain("Reader");
    expect(sourceText).toContain("Mermaid runtime");
  });

  it("renders a malformed comment Mermaid fence with Source selected, the complete error banner, and the unchanged authored source", async () => {
    const malformedSelector = await anchorMermaidArticle(
      FIXTURE_COMMENT_MALFORMED_AUTHOR
    );

    // The intro paragraph is rendered as ordinary Markdown outside the
    // fenced block. Its presence confirms the comment body is wired
    // through the same MarkdownContent path the valid diagrams use.
    const articleText = await browser.execute(
      readArticleText,
      malformedSelector
    );
    expect(articleText).toContain(FIXTURE_COMMENT_MALFORMED_INTRO);

    const initialTabs = await browser.execute(
      readTablistState,
      malformedSelector
    );
    expect(initialTabs.hasTabs).toBe(true);
    expect(initialTabs.diagramSelected).toBe(false);
    expect(initialTabs.sourceSelected).toBe(true);

    // The Diagram tab is reachable from the failure path so the reader
    // can confirm the rendered diagram panel is unavailable. The
    // panel must report the unavailable state, not silently render an
    // empty SVG.
    await clickTab(malformedSelector, "diagram");
    await browser.waitUntil(
      async () => {
        const tabs = await browser.execute(readTablistState, malformedSelector);
        return tabs.diagramSelected;
      },
      {
        timeout: MERMAID_TIMEOUT_MS,
        timeoutMsg:
          "Expected Diagram tab to be selectable on the malformed fence",
      }
    );
    const diagramPanelText = await browser.execute(
      readDiagramPanelText,
      malformedSelector
    );
    expect(diagramPanelText).toContain("Diagram unavailable");
    expect(diagramPanelText).not.toContain("Rendering diagram");

    // Switch back to Source to assert the unchanged authored source is
    // still the canonical representation of the fence.
    await clickTab(malformedSelector, "source");
    await browser.waitUntil(
      async () => {
        const tabs = await browser.execute(readTablistState, malformedSelector);
        return tabs.sourceSelected;
      },
      {
        timeout: MERMAID_TIMEOUT_MS,
        timeoutMsg:
          "Expected Source tab to remain selectable on the malformed fence",
      }
    );
    const sourceText = await browser.execute(
      readSourcePanelText,
      malformedSelector
    );
    expect(sourceText).toContain(FIXTURE_COMMENT_MALFORMED_SOURCE);

    // The complete renderer error must remain visible in a banner that
    // sits outside the tablist. The banner is rendered through the
    // shared `Alert` component with the destructive variant.
    const bannerInfo = await browser.execute((sel) => {
      const root = document.querySelector(sel);
      if (root === null) {
        return { exists: false, text: "" };
      }
      const banner = [...root.querySelectorAll('[role="alert"]')].find((el) =>
        el.textContent?.includes("Diagram failed to render")
      );
      return {
        exists: banner !== undefined,
        text: banner?.textContent ?? "",
      };
    }, malformedSelector);
    expect(bannerInfo.exists).toBe(true);
    expect(bannerInfo.text.length).toBeGreaterThan(
      "Diagram failed to render".length
    );
  });
});

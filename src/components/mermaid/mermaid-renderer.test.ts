import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deriveThemeVariables,
  renderMermaid,
  resetMermaidRendererForTests,
} from "./mermaid-renderer";

const initialize = vi.fn();
const render = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => initialize(...args),
    render: (...args: unknown[]) => render(...args),
  },
}));

beforeEach(() => {
  resetMermaidRendererForTests();
  initialize.mockReset();
  render.mockReset();
  render.mockResolvedValue({ svg: "<svg></svg>" });
});

describe("renderMermaid", () => {
  it("does not initialize Mermaid until the first render is requested", async () => {
    expect(initialize).not.toHaveBeenCalled();

    await renderMermaid("graph TD; A-->B");

    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("initializes Mermaid exactly once across many renders", async () => {
    await renderMermaid("graph TD; A-->B");
    await renderMermaid("graph TD; C-->D");
    await renderMermaid("graph TD; E-->F");

    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("configures strict security and locks theme and security directives", async () => {
    await renderMermaid("graph TD; A-->B");

    const config = initialize.mock.calls[0][0] as {
      securityLevel: string;
      theme: string;
      startOnLoad: boolean;
      secure: string[];
      themeVariables: Record<string, string>;
    };

    expect(config.securityLevel).toBe("strict");
    expect(config.theme).toBe("base");
    expect(config.startOnLoad).toBe(false);
    expect(config.secure).toEqual(
      expect.arrayContaining([
        "securityLevel",
        "secure",
        "theme",
        "themeVariables",
      ])
    );
    expect(config.themeVariables).toBeDefined();
  });

  it("assigns a unique render id to every call", async () => {
    await renderMermaid("a");
    await renderMermaid("b");
    await renderMermaid("c");

    const ids = render.mock.calls.map((call) => call[0] as string);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("serializes render calls so they never overlap", async () => {
    const events: string[] = [];
    const firstRender: { resolve: (value: { svg: string }) => void } = {
      resolve: () => {},
    };

    render.mockImplementationOnce((id: string) => {
      events.push(`start:${id}`);
      // oxlint-disable-next-line promise/avoid-new
      return new Promise<{ svg: string }>((resolve) => {
        firstRender.resolve = resolve;
      });
    });
    render.mockImplementationOnce((id: string) => {
      events.push(`start:${id}`);
      return Promise.resolve({ svg: "<svg></svg>" });
    });

    const first = renderMermaid("first");
    const second = renderMermaid("second");

    // Allow lazy init and the first render to start.
    // oxlint-disable-next-line promise/avoid-new
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    // The second render must not have started while the first is pending.
    expect(events).toEqual(["start:beadsmith-mermaid-1"]);

    firstRender.resolve({ svg: "<svg></svg>" });
    await Promise.all([first, second]);

    expect(events).toEqual([
      "start:beadsmith-mermaid-1",
      "start:beadsmith-mermaid-2",
    ]);
  });

  it("propagates the Mermaid error and keeps the queue usable", async () => {
    const failure = new Error("Parse error on line 1");
    render.mockRejectedValueOnce(failure);

    await expect(renderMermaid("broken")).rejects.toThrow(
      "Parse error on line 1"
    );

    render.mockResolvedValueOnce({ svg: "<svg id='ok'></svg>" });
    await expect(renderMermaid("valid")).resolves.toContain("ok");
  });

  it("never binds Mermaid-authored callbacks or links", async () => {
    const bindFunctions = vi.fn();
    render.mockResolvedValueOnce({ bindFunctions, svg: "<svg></svg>" });

    await renderMermaid("graph TD; A-->B");

    expect(bindFunctions).not.toHaveBeenCalled();
  });
});

describe("deriveThemeVariables", () => {
  it("maps resolved Beadsmith tokens to normalized hex theme variables", () => {
    const tokens: Record<string, string> = {
      "--color-accent": "#5E6AD2",
      "--color-background": " #010203 ",
      "--color-border-main": "#27272A",
      "--color-muted": "#71717A",
      "--color-surface": "#111111",
      "--color-text-main": "#E4E4E7",
    };

    const variables = deriveThemeVariables((token) => tokens[token] ?? "");

    expect(variables.background).toBe("#010203");
    expect(variables.primaryColor).toBe("#111111");
    expect(variables.primaryTextColor).toBe("#e4e4e7");
    expect(variables.lineColor).toBe("#71717a");
    expect(variables.nodeBorder).toBe("#27272a");
  });

  it("falls back to the token defaults when a value is not a hex color", () => {
    const variables = deriveThemeVariables((token) =>
      token === "--color-surface" ? "var(--color-surface)" : ""
    );

    expect(variables.primaryColor).toBe("#18181b");
    expect(variables.background).toBe("#09090b");
  });
});

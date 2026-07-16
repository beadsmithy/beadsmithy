import type { Mermaid, MermaidConfig } from "mermaid";

// The Beadsmith Theme tokens (see src/App.css `@theme`) are the single source
// of truth. At runtime they are read from the resolved CSS custom properties;
// these defaults mirror the same token values verbatim so the facade can still
// produce a coherent Beadsmith-derived palette when the tokens cannot be
// resolved (for example in a non-browser test environment). They are not a
// separate hand-tuned Mermaid palette.
const TOKEN_FALLBACKS: Record<string, string> = {
  "--color-accent": "#5e6ad2",
  "--color-background": "#09090b",
  "--color-border-main": "#27272a",
  "--color-muted": "#71717a",
  "--color-primary": "#ffffff",
  "--color-surface": "#18181b",
  "--color-text-main": "#e4e4e7",
};

const FONT_FAMILY = '"Geist", sans-serif';

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;

export type CssTokenReader = (token: string) => string;

const defaultTokenReader: CssTokenReader = (token) => {
  if (
    typeof document === "undefined" ||
    typeof getComputedStyle !== "function"
  ) {
    return "";
  }
  return getComputedStyle(document.documentElement).getPropertyValue(token);
};

const normalizeHex = (value: string, token: string): string => {
  const trimmed = value.trim();
  if (HEX_COLOR.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return TOKEN_FALLBACKS[token];
};

const readColor = (readToken: CssTokenReader, token: string): string =>
  normalizeHex(readToken(token), token);

/**
 * Derives Mermaid `base` theme variables from the resolved Beadsmith Theme
 * tokens. Every color is normalized to a Mermaid-supported hex value so no raw
 * CSS variable ever reaches Mermaid.
 */
export const deriveThemeVariables = (
  readToken: CssTokenReader = defaultTokenReader
): Record<string, string> => {
  const background = readColor(readToken, "--color-background");
  const surface = readColor(readToken, "--color-surface");
  const textMain = readColor(readToken, "--color-text-main");
  const muted = readColor(readToken, "--color-muted");
  const accent = readColor(readToken, "--color-accent");
  const border = readColor(readToken, "--color-border-main");

  return {
    actorBkg: surface,
    actorBorder: border,
    actorTextColor: textMain,
    background,
    clusterBkg: background,
    clusterBorder: border,
    edgeLabelBackground: background,
    fontFamily: FONT_FAMILY,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: border,
    labelTextColor: textMain,
    lineColor: muted,
    mainBkg: surface,
    nodeBorder: border,
    nodeTextColor: textMain,
    noteBkgColor: surface,
    noteBorderColor: accent,
    noteTextColor: textMain,
    primaryBorderColor: border,
    primaryColor: surface,
    primaryTextColor: textMain,
    secondaryBorderColor: border,
    secondaryColor: surface,
    secondaryTextColor: textMain,
    tertiaryBorderColor: border,
    tertiaryColor: background,
    tertiaryTextColor: textMain,
    textColor: textMain,
    titleColor: textMain,
  };
};

const buildConfig = (readToken?: CssTokenReader): MermaidConfig => ({
  fontFamily: FONT_FAMILY,
  // Lock the security-critical and theme settings so Mermaid source directives
  // cannot weaken them (extends Mermaid's default secure list).
  secure: [
    "secure",
    "securityLevel",
    "startOnLoad",
    "maxTextSize",
    "maxEdges",
    "theme",
    "themeVariables",
    "fontFamily",
  ],
  // Untrusted Issue content: strict security disables click handlers and
  // HTML labels, and any generated links are inert.
  securityLevel: "strict",
  startOnLoad: false,
  theme: "base",
  themeVariables: deriveThemeVariables(readToken),
});

interface MermaidModule {
  default: Mermaid;
}

let mermaidModulePromise: Promise<MermaidModule> | null = null;
let initPromise: Promise<Mermaid> | null = null;
let renderIdCounter = 0;
let renderQueue: Promise<unknown> = Promise.resolve();

const loadMermaid = (): Promise<MermaidModule> => {
  if (mermaidModulePromise === null) {
    mermaidModulePromise = import("mermaid");
  }
  return mermaidModulePromise;
};

const ensureInitialized = (readToken?: CssTokenReader): Promise<Mermaid> => {
  if (initPromise === null) {
    initPromise = (async () => {
      const module = await loadMermaid();
      const mermaid = module.default;
      mermaid.initialize(buildConfig(readToken));
      return mermaid;
    })();
  }
  return initPromise;
};

/**
 * Renders untrusted Mermaid source to an SVG string. Mermaid configuration and
 * rendering are process-global, so every call is serialized through a single
 * queue and given a unique render id. The returned SVG must be mounted only
 * through the controlled renderer boundary; on failure the promise rejects with
 * the complete Mermaid error and no diagram callbacks are ever bound.
 */
export const renderMermaid = (
  source: string,
  readToken?: CssTokenReader
): Promise<string> => {
  const run = async (): Promise<string> => {
    const mermaid = await ensureInitialized(readToken);
    renderIdCounter += 1;
    const id = `beadsmith-mermaid-${renderIdCounter}`;
    const { svg } = await mermaid.render(id, source);
    return svg;
  };

  const runAfterQueue = async (): Promise<string> => {
    try {
      await renderQueue;
    } catch {
      // A prior render's failure must not break the shared queue.
    }
    return run();
  };

  const result = runAfterQueue();
  renderQueue = (async () => {
    try {
      await result;
    } catch {
      // Swallow so a failed render does not poison later renders.
    }
  })();
  return result;
};

/**
 * Resets the facade's process-global state. Intended only for tests that need
 * to observe lazy initialization from a clean slate.
 */
export const resetMermaidRendererForTests = (): void => {
  mermaidModulePromise = null;
  initPromise = null;
  renderIdCounter = 0;
  renderQueue = Promise.resolve();
};

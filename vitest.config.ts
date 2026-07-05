import { defineConfig } from "vitest/config";

// Vitest's default `*.spec.ts` glob would otherwise also pick up the
// WebDriver end-to-end specs under e2e/, which are run through `wdio`
// (see docs/agents/webdriver-e2e.md), not vitest.
export default defineConfig({
  test: {
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
    setupFiles: ["src/test/setup.ts"],
  },
});

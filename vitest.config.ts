import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Vitest's default `*.spec.ts` glob would otherwise also pick up the
// WebDriver end-to-end specs under e2e/, which are run through `wdio`
// (see docs/agents/webdriver-e2e.md), not vitest. We deliberately add
// `e2e/issue-list/helpers/**/*.test.ts` to the include set so the pure
// helpers extracted from the WebDriver specs (e.g. `issueRowSelector`,
// sidebar selector formatters) and the pure harness parser can be unit-tested
// without spinning up a debug binary. The wdio `*.spec.ts` files are still
// excluded.
const wdioGlobalsStub = fileURLToPath(
  new URL("e2e/issue-list/helpers/__wdio-globals-stub__.ts", import.meta.url)
);

export default defineConfig({
  resolve: {
    // The helper modules import `browser` / `expect` / `$` from
    // `@wdio/globals`, which is normally injected by the WebdriverIO
    // runtime. Under vitest we only exercise the pure selector /
    // formatter helpers, so redirect the import to a small stub that
    // provides just enough shape for module load to succeed.
    alias: {
      "@wdio/globals": wdioGlobalsStub,
    },
  },
  test: {
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**/*.spec.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "e2e/issue-list/helpers/**/*.test.ts",
      "e2e/issue-list/scripts/**/*.test.ts",
    ],
    setupFiles: ["src/test/setup.ts"],
  },
});

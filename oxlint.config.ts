import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { jsPluginSettings, selectJsPlugins } from "ultracite/oxlint/js-plugins";
import react from "ultracite/oxlint/react";
import vitest from "ultracite/oxlint/vitest";

import { SCRATCH_IGNORES, VENDORED_IGNORES } from "./quality.ignores.ts";

const jsPlugins = selectJsPlugins(["react-doctor"]);

export default defineConfig({
  extends: [core, react, vitest, antiSlop, jsPlugins],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    ...VENDORED_IGNORES,
    ...SCRATCH_IGNORES,
  ],
  jsPlugins: [
    ...(jsPlugins.jsPlugins ?? []),
    "oxlint-tailwindcss",
    {
      name: "eslint-js",
      specifier: "oxlint-plugin-eslint",
    },
  ],
  overrides: [
    {
      files: ["**/*.{jsx,tsx}"],
      plugins: ["unicorn"],
      rules: {
        "unicorn/filename-case": [
          "error",
          {
            case: "pascalCase",
            ignore: ["^main\\.tsx$"],
          },
        ],
      },
    },
    {
      files: ["src/rpc/bindings.ts"],
      rules: {
        "typescript/consistent-indexed-object-style": "off",
      },
    },
    {
      files: ["**/*.{jsx,tsx,ts,js}"],
      plugins: ["vitest"],
      rules: {
        "vitest/consistent-test-filename": "allow",
        "vitest/expect-expect": "allow",
        "vitest/max-expects": [
          "error",
          {
            max: 20,
          },
        ],
        "vitest/no-conditional-expect": "allow",
        "vitest/no-standalone-expect": "allow",
        "vitest/prefer-called-exactly-once-with": "allow",
        "vitest/prefer-import-in-mock": "allow",
        "vitest/require-mock-type-parameters": "allow",
        "vitest/require-top-level-describe": "allow",
      },
    },
    {
      files: ["e2e/**/*.spec.ts"],
      plugins: ["vitest"],
      rules: {
        // WebdriverIO's expect provides the browser matchers used by these
        // real-desktop specs and intentionally replaces Vitest's expect.
        "vitest/prefer-importing-vitest-globals": "allow",
      },
    },
    {
      files: ["**/*.{jsx,tsx,js,ts}"],
      rules: {
        "anti-slop/no-chained-type-assertions": "allow",
        "anti-slop/no-conditional-empty-object-spread": "allow",
        "anti-slop/no-known-value-widening": "allow",
        "anti-slop/no-module-mocking": "allow",
        "anti-slop/no-object-parameters": "allow",
        "anti-slop/no-runtime-typeof": "allow",
        "anti-slop/no-unknown-parameters": "allow",
        "anti-slop/no-unknown-returns": "allow",
        "anti-slop/no-unsafe-dictionary-type": "allow",
        "anti-slop/require-safety-comment-for-type-assertion": "allow",
      },
    },
    {
      files: ["**/*.{jsx,tsx,js,ts}"],
      rules: {
        "react-doctor/js-combine-iterations": "allow",
        "react-doctor/no-tiny-text": "allow",
        "react-doctor/only-export-components": "allow",
      },
    },
  ],
  plugins: ["react", "react-perf"],
  rules: {
    // Blocking enforcement for the no-use-effect policy. Use the official
    // ESLint compatibility plugin so this remains a declarative selector
    // instead of a project-owned AST rule and suppression walker.
    "eslint-js/no-restricted-syntax": [
      "error",
      {
        message:
          "Direct React `useEffect` is forbidden. Use derived state, an event handler, a `key`/remount boundary, a data-fetching hook, or the documented `useMountEffect` escape hatch in src/lib/use-mount-effect.ts instead.",
        selector: "CallExpression[callee.name='useEffect']",
      },
    ],

    // Style and consistency
    "tailwindcss/consistent-variant-order": "warn",
    "tailwindcss/enforce-canonical": "warn",
    "tailwindcss/enforce-consistent-important-position": "warn",
    "tailwindcss/enforce-consistent-variable-syntax": "warn",
    "tailwindcss/enforce-negative-arbitrary-values": "warn",
    "tailwindcss/enforce-physical": "error",
    "tailwindcss/enforce-shorthand": "error",
    "tailwindcss/enforce-sort-order": "warn",

    // Correctness — catch real bugs
    "tailwindcss/no-conflicting-classes": "error",
    "tailwindcss/no-contradicting-variants": "warn",
    "tailwindcss/no-deprecated-classes": "error",
    "tailwindcss/no-duplicate-classes": "warn",
    "tailwindcss/no-hardcoded-colors": "error",
    "tailwindcss/no-unknown-classes": "error",
    "tailwindcss/no-unnecessary-arbitrary-value": "warn",
    "tailwindcss/no-unnecessary-whitespace": "warn",
  },
  settings: {
    ...jsPluginSettings,
    tailwindcss: {
      entryPoint: "src/App.css",
    },
  },
});

import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

// Keep in sync with the pre-commit exclusions in lefthook.yml: these paths
// hold vendored/generated content that isn't ours to lint.
const PROJECT_IGNORES = ["docs/research/infra/**", ".agents/skills/**"];

export default defineConfig({
  extends: [core, react],
  ignorePatterns: [...(core.ignorePatterns ?? []), ...PROJECT_IGNORES],
  jsPlugins: [
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
    tailwindcss: {
      entryPoint: "src/App.css",
    },
  },
});

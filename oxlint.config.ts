import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

// Keep in sync with the pre-commit exclusions in lefthook.yml: these paths
// hold vendored/generated content that isn't ours to lint.
const PROJECT_IGNORES = ["docs/research/infra/**", ".agents/skills/**"];

export default defineConfig({
  extends: [core, react],
  ignorePatterns: [...(core.ignorePatterns ?? []), ...PROJECT_IGNORES],
  jsPlugins: ["oxlint-tailwindcss"],
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
  ],
  plugins: ["react", "react-perf"],
  rules: {
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

import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

// Keep in sync with the pre-commit exclusions in lefthook.yml: these paths
// hold vendored/generated content that isn't ours to reformat.
const PROJECT_IGNORES = ["docs/research/infra/**", ".agents/skills/**"];

export default defineConfig({
  ...ultracite,
  ignorePatterns: [...(ultracite.ignorePatterns ?? []), ...PROJECT_IGNORES],
});

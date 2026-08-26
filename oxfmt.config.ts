import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

import { FORMAT_ONLY_IGNORES, VENDORED_IGNORES } from "./quality.ignores.ts";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    ...VENDORED_IGNORES,
    ...FORMAT_ONLY_IGNORES,
  ],
});

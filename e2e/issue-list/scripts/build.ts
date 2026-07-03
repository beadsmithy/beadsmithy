import { spawnSync } from "node:child_process";

const result = spawnSync(
  "pnpm",
  [
    "tauri",
    "build",
    "--debug",
    "--no-bundle",
    "--config",
    "src-tauri/tauri.e2e.conf.json",
  ],
  {
    env: {
      ...process.env,
      VITE_BEADSMITH_E2E_WDIO: "1",
    },
    stdio: "inherit",
  }
);

process.exitCode = result.status ?? 1;

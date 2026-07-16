import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createIssueListWorkspace,
  removeWorkspace,
  resolveBwPath,
} from "../../issue-list/fixtures/workspace.ts";
import { assertEmbeddedWebDriverPortAvailable } from "../../issue-list/scripts/embedded-webdriver-port.ts";

const SETTINGS_WEBDRIVER_PORT = 46_246;
const BINARY_NAME =
  process.platform === "win32" ? "beadsmith.exe" : "beadsmith";
const APP_BINARY_PATH = path.resolve(
  import.meta.dirname,
  "../../../src-tauri/target/debug",
  BINARY_NAME
);

const root = mkdtempSync(path.join(tmpdir(), "beadsmith-e2e-settings-"));
const catalogStorePath = path.join(root, "workspace-catalog.json");
const settingsStorePath = path.join(root, "app-settings.json");
const workspace = createIssueListWorkspace();

const runPhase = (phase: "1" | "2"): number => {
  console.log(`[e2e:settings] launching desktop process for phase ${phase}`);
  const result = spawnSync(
    "pnpm",
    ["exec", "wdio", "run", "wdio.settings.conf.ts"],
    {
      env: {
        ...process.env,
        BEADSMITH_E2E_PHASE: phase,
        BEADSMITH_E2E_WORKSPACE: workspace.path,
        BEADSMITH_SETTINGS_STORE_PATH: settingsStorePath,
        BEADSMITH_WORKSPACE_STORE_PATH: catalogStorePath,
      },
      stdio: "inherit",
    }
  );
  return result.status ?? 1;
};

try {
  if (resolveBwPath() === "not found on PATH") {
    throw new Error(
      "bw was not found on PATH. Install Beadwork before running `pnpm e2e:settings`."
    );
  }
  if (!existsSync(APP_BINARY_PATH)) {
    throw new Error(
      `Beadsmith debug binary not found at ${APP_BINARY_PATH}. Build it first with \`pnpm e2e:build\`.`
    );
  }
  await assertEmbeddedWebDriverPortAvailable(SETTINGS_WEBDRIVER_PORT);
  console.log(`[e2e:settings] workspace: ${workspace.path}`);
  console.log(`[e2e:settings] catalog store: ${catalogStorePath}`);
  console.log(`[e2e:settings] settings store: ${settingsStorePath}`);

  const phase1Status = runPhase("1");
  process.exitCode = phase1Status;
  if (phase1Status === 0) {
    process.exitCode = runPhase("2");
  }
} finally {
  removeWorkspace(workspace);
  rmSync(root, { force: true, recursive: true });
}

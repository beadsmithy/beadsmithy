import { existsSync } from "node:fs";
import path from "node:path";

import { resolveBwPath } from "./e2e/issue-list/fixtures/workspace.ts";
import { assertEmbeddedWebDriverPortAvailable } from "./e2e/issue-list/scripts/embedded-webdriver-port.ts";

export const SETTINGS_WEBDRIVER_PORT = 46_246;
const BINARY_NAME =
  process.platform === "win32" ? "beadsmith.exe" : "beadsmith";
const APP_BINARY_PATH = path.resolve(
  import.meta.dirname,
  "src-tauri/target/debug",
  BINARY_NAME
);

const phase = process.env.BEADSMITH_E2E_PHASE;
if (phase !== "1" && phase !== "2") {
  throw new Error(
    "BEADSMITH_E2E_PHASE must be 1 or 2. Run `pnpm e2e:settings` instead of invoking wdio directly."
  );
}

const workspacePath = process.env.BEADSMITH_E2E_WORKSPACE;
const catalogStorePath = process.env.BEADSMITH_WORKSPACE_STORE_PATH;
const settingsStorePath = process.env.BEADSMITH_SETTINGS_STORE_PATH;
if (!workspacePath || !catalogStorePath || !settingsStorePath) {
  throw new Error(
    "Settings E2E paths are not set. Run `pnpm e2e:settings` instead of invoking wdio directly."
  );
}

export const config: WebdriverIO.Config = {
  bail: 0,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: APP_BINARY_PATH,
      },
    },
  ],
  connectionRetryCount: 3,
  connectionRetryTimeout: 120_000,
  framework: "mocha",
  logLevel: "info",
  maxInstances: 1,
  mochaOpts: {
    timeout: 180_000,
    ui: "bdd",
  },
  onPrepare: async () => {
    await assertEmbeddedWebDriverPortAvailable(SETTINGS_WEBDRIVER_PORT);
    process.env.TAURI_WEBDRIVER_PORT = String(SETTINGS_WEBDRIVER_PORT);

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
    console.log(`[e2e:settings] phase ${phase}`);
    console.log(`[e2e:settings] workspace: ${workspacePath}`);
    console.log(`[e2e:settings] catalog store: ${catalogStorePath}`);
    console.log(`[e2e:settings] settings store: ${settingsStorePath}`);
    console.log(
      `[e2e:settings] using embedded WebDriver port: ${SETTINGS_WEBDRIVER_PORT}`
    );
  },
  reporters: ["spec"],
  runner: "local",
  services: [
    [
      "@wdio/tauri-service",
      {
        appArgs: [],
        appBinaryPath: APP_BINARY_PATH,
        backendLogLevel: "debug",
        captureBackendLogs: true,
        captureFrontendLogs: true,
        driverProvider: "embedded",
        embeddedPort: SETTINGS_WEBDRIVER_PORT,
        frontendLogLevel: "debug",
        startTimeout: 90_000,
      },
    ],
  ],
  specs: [
    phase === "1"
      ? "./e2e/settings/settings-persistence.phase1.spec.ts"
      : "./e2e/settings/settings-persistence.phase2.spec.ts",
  ],
  waitforTimeout: 30_000,
};

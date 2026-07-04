/**
 * WebDriver end-to-end config for the Issue List slice (bsm-mq4.5).
 *
 * Launches the built Beadsmith debug binary through `@wdio/tauri-service`'s
 * embedded driver provider (no external `tauri-driver` needed; the app embeds
 * `tauri-plugin-wdio-webdriver` in debug builds only, see
 * src-tauri/src/lib.rs). The embedded provider spawns a single app process
 * for the whole run, so the target Beadwork workspace is fixed per
 * invocation.
 *
 * Do not run this file directly: use `pnpm e2e:issue-list:success` /
 * `pnpm e2e:issue-list:empty`, which create the disposable Beadwork
 * workspace and pass it in via `BEADSMITH_E2E_WORKSPACE` (see
 * e2e/issue-list/scripts/run-scenario.ts and
 * docs/agents/webdriver-e2e.md).
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { resolveBwPath } from "./e2e/issue-list/fixtures/workspace.ts";
import {
  assertEmbeddedWebDriverPortAvailable,
  EMBEDDED_WEBDRIVER_PORT,
} from "./e2e/issue-list/scripts/embedded-webdriver-port.ts";

const BINARY_NAME =
  process.platform === "win32" ? "beadsmith.exe" : "beadsmith";
const APP_BINARY_PATH = path.resolve(
  import.meta.dirname,
  "src-tauri/target/debug",
  BINARY_NAME
);

const scenario =
  process.env.BEADSMITH_E2E_SCENARIO === "empty" ? "empty" : "issues";
const workspacePath = process.env.BEADSMITH_E2E_WORKSPACE;

if (!workspacePath) {
  throw new Error(
    "BEADSMITH_E2E_WORKSPACE is not set. Run `pnpm e2e:issue-list:success` or " +
      "`pnpm e2e:issue-list:empty` instead of invoking wdio directly."
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
    // Generous: without tauri-plugin-wdio (deliberately out of scope, see
    // docs/agents/webdriver-e2e.md), @wdio/tauri-service's window-focus check
    // times out on every command before falling back, adding real overhead
    // per WebDriver call.
    timeout: 180_000,
    ui: "bdd",
  },
  onPrepare: async () => {
    await assertEmbeddedWebDriverPortAvailable();

    if (resolveBwPath() === "not found on PATH") {
      throw new Error(
        "bw was not found on PATH. Install Beadwork (https://github.com/jallum/beadwork) before running this suite."
      );
    }
    if (!existsSync(APP_BINARY_PATH)) {
      throw new Error(
        `Beadsmith debug binary not found at ${APP_BINARY_PATH}. Build it first with \`pnpm e2e:build\`.`
      );
    }
    console.log(`[e2e] using Beadsmith binary at ${APP_BINARY_PATH}`);
    console.log(
      `[e2e] launching Beadsmith against workspace: ${workspacePath}`
    );
    console.log(
      `[e2e] using embedded WebDriver port: ${EMBEDDED_WEBDRIVER_PORT}`
    );
  },
  reporters: ["spec"],
  runner: "local",
  services: [
    [
      "@wdio/tauri-service",
      {
        appArgs: ["--workspace", workspacePath],
        appBinaryPath: APP_BINARY_PATH,
        backendLogLevel: "debug",
        captureBackendLogs: true,
        captureFrontendLogs: true,
        driverProvider: "embedded",
        embeddedPort: EMBEDDED_WEBDRIVER_PORT,
        frontendLogLevel: "debug",
        startTimeout: 90_000,
      },
    ],
  ],
  specs: [
    scenario === "empty"
      ? "./e2e/issue-list/issue-list.empty.spec.ts"
      : "./e2e/issue-list/issue-list.success.spec.ts",
  ],
  waitforTimeout: 30_000,
};

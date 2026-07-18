/**
 * WebDriver end-to-end config for the Mermaid Diagram slice (bsm-wr7.3).
 *
 * Launches the built Beadsmith debug binary through `@wdio/tauri-service`'s
 * embedded driver provider (no external `tauri-driver` needed; the app embeds
 * `tauri-plugin-wdio-webdriver` in debug builds only, see
 * src-tauri/src/lib.rs). The app starts with an isolated empty catalog;
 * specs select the disposable repository through `switch_workspace`.
 *
 * Reuses the Issue List fixture workspace (see
 * `e2e/issue-list/fixtures/workspace.ts`) so the description-and-comment
 * Mermaid coverage stays on the same disposable Beadwork repository
 * surface as the focused renderer/component tests. The dedicated
 * embedded WebDriver port (46247) keeps this suite independent of the
 * Issue List and Settings suites.
 *
 * Do not run this file directly: use `pnpm e2e:mermaid`, which creates
 * the disposable Beadwork repository and isolated backend store used by
 * the specs (see `e2e/mermaid/scripts/run-mermaid-scenario.ts` and
 * docs/agents/webdriver-e2e.md).
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { resolveBwPath } from "./e2e/issue-list/fixtures/workspace.ts";

export const MERMAID_WEBDRIVER_PORT = 46_247;
const BINARY_NAME =
  process.platform === "win32" ? "beadsmith.exe" : "beadsmith";
const APP_BINARY_PATH = path.resolve(
  import.meta.dirname,
  "src-tauri/target/debug",
  BINARY_NAME
);

const workspacePath = process.env.BEADSMITH_E2E_WORKSPACE_A;
const storePath = process.env.BEADSMITH_WORKSPACE_STORE_PATH;
if (!workspacePath || !storePath) {
  throw new Error(
    "Mermaid E2E paths are not set. Run `pnpm e2e:mermaid` instead of invoking wdio directly."
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
    // Mirrors the Issue List suite's generous timeout: without
    // tauri-plugin-wdio (deliberately out of scope, see
    // docs/agents/webdriver-e2e.md), `@wdio/tauri-service`'s window-focus
    // check times out before falling back, adding real overhead per
    // WebDriver call.
    timeout: 180_000,
    ui: "bdd",
  },
  onPrepare: () => {
    process.env.TAURI_WEBDRIVER_PORT = String(MERMAID_WEBDRIVER_PORT);

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
    console.log(`[e2e:mermaid] using Beadsmith binary at ${APP_BINARY_PATH}`);
    console.log(
      "[e2e:mermaid] launching Beadsmith with an isolated empty catalog"
    );
    console.log(`[e2e:mermaid] workspace: ${workspacePath}`);
    console.log(`[e2e:mermaid] isolated store: ${storePath}`);
    console.log(
      `[e2e:mermaid] using embedded WebDriver port: ${MERMAID_WEBDRIVER_PORT}`
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
        embeddedPort: MERMAID_WEBDRIVER_PORT,
        frontendLogLevel: "debug",
        startTimeout: 90_000,
      },
    ],
  ],
  specs: ["./e2e/mermaid/mermaid-diagram.spec.ts"],
  waitforTimeout: 30_000,
};

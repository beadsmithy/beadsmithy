/**
 * Process-lifecycle harness for the Mermaid Diagram WebDriver suite
 * (bsm-wr7.3). Creates the disposable Beadwork workspace via
 * `e2e/issue-list/fixtures/workspace.ts` (the same workspace that powers
 * the Issue List success and atomic-switch scenarios, extended with
 * valid-Mermaid description / comment fences and a malformed-Mermaid
 * comment fence) and runs the Mermaid spec through WebDriverIO.
 *
 * Mirrors the focused `run-settings-scenario.ts` shape: a single phase
 * against one fresh store and one fresh fixture root, with the
 * developer's normal workspace-catalog location fingerprinted before
 * and re-fingerprinted after cleanup so the suite fails if it ever
 * touches the developer's catalog.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createIssueListWorkspace,
  removeWorkspace,
  resolveBwPath,
} from "../../issue-list/fixtures/workspace.ts";
import { assertEmbeddedWebDriverPortAvailable } from "../../issue-list/scripts/embedded-webdriver-port.ts";
import {
  assertFingerprintsEqual,
  assertResourcesRemoved,
  fingerprintStoreFile,
  resolveNormalStoreLocation,
} from "../../issue-list/scripts/store-isolation.ts";

const MERMAID_WEBDRIVER_PORT = 46_247;
const BUNDLE_IDENTIFIER = "com.benregn.beadsmith";

console.log(`[e2e:mermaid] bw resolved at: ${resolveBwPath()}`);

try {
  await assertEmbeddedWebDriverPortAvailable(MERMAID_WEBDRIVER_PORT);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const normalLocation = resolveNormalStoreLocation(BUNDLE_IDENTIFIER);
const normalStoreFingerprintBefore = fingerprintStoreFile(
  normalLocation.storeFile
);

const storeDirectory = mkdtempSync(
  path.join(tmpdir(), "beadsmith-e2e-mermaid-store-")
);
mkdirSync(storeDirectory, { recursive: true });
const storePath = path.join(storeDirectory, "workspace-catalog.json");
const workspace = createIssueListWorkspace();

console.log(`[e2e:mermaid] workspace: ${workspace.path}`);
console.log(`[e2e:mermaid] isolated store: ${storePath}`);

let firstFailure = 0;
try {
  console.log(`\n[e2e:mermaid] === launching desktop process ===`);
  const result = spawnSync(
    "pnpm",
    ["exec", "wdio", "run", "wdio.mermaid.conf.ts"],
    {
      env: {
        ...process.env,
        BEADSMITH_E2E_WORKSPACE_A: workspace.path,
        BEADSMITH_WORKSPACE_STORE_PATH: storePath,
      },
      stdio: "inherit",
    }
  );
  const status = result.status ?? 1;
  if (status !== 0) {
    firstFailure = status;
  }
} finally {
  try {
    const normalStoreFingerprintAfter = fingerprintStoreFile(
      normalLocation.storeFile
    );
    assertFingerprintsEqual(
      "workspace-catalog",
      normalStoreFingerprintBefore,
      normalStoreFingerprintAfter
    );
    console.log(
      `[e2e:mermaid] normal store fingerprint unchanged at ${normalLocation.storeFile}`
    );
  } catch (error) {
    console.error(
      `[e2e:mermaid] isolation verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    if (firstFailure === 0) {
      firstFailure = 1;
    }
  }

  try {
    removeWorkspace(workspace);
    rmSync(storeDirectory, { force: true, recursive: true });
    assertResourcesRemoved([workspace.path, storeDirectory]);
    console.log(
      "[e2e:mermaid] cleanup complete; no scenario-owned resources remain"
    );
  } catch (error) {
    console.error(
      `[e2e:mermaid] cleanup failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    if (firstFailure === 0) {
      firstFailure = 1;
    }
  }
}

process.exitCode = firstFailure;

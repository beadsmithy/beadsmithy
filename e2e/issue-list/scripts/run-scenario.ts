/**
 * Creates both disposable Beadwork workspaces and an isolated backend store
 * for one Issue List e2e scenario. The WebDriver app always starts empty;
 * specs seed fixtures with the typed `switch_workspace` RPC before asserting.
 *
 * WDIO's local runner re-evaluates `wdio.issue-list.conf.ts` in more than one
 * Node process (the launcher and each spec worker), so fixture creation cannot
 * safely live at config module scope. Creating the paths here once keeps every
 * process and the spawned desktop binary on the same isolated inputs.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createEmptyWorkspace,
  createIssueListWorkspace,
  removeWorkspace,
  resolveBwPath,
} from "../fixtures/workspace.ts";
import { assertEmbeddedWebDriverPortAvailable } from "./embedded-webdriver-port.ts";

type Scenario = "empty" | "issues";

const isScenario = (value: string | undefined): value is Scenario =>
  value === "empty" || value === "issues";

const scenario = process.argv.at(2);
if (!isScenario(scenario)) {
  console.error("Usage: run-scenario.ts <issues|empty>");
  process.exit(1);
}

console.log(`[e2e] bw resolved at: ${resolveBwPath()}`);
console.log(`[e2e] scenario: ${scenario}`);

try {
  await assertEmbeddedWebDriverPortAvailable();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const workspaceA = createIssueListWorkspace();
const workspaceB = createEmptyWorkspace();
const storeDirectory = mkdtempSync(path.join(tmpdir(), "beadsmith-e2e-store-"));
const storePath = path.join(storeDirectory, "workspace-catalog.json");

try {
  const result = spawnSync(
    "pnpm",
    ["exec", "wdio", "run", "wdio.issue-list.conf.ts"],
    {
      env: {
        ...process.env,
        BEADSMITH_E2E_SCENARIO: scenario,
        BEADSMITH_E2E_WORKSPACE_A: workspaceA.path,
        BEADSMITH_E2E_WORKSPACE_B: workspaceB.path,
        BEADSMITH_WORKSPACE_STORE_PATH: storePath,
      },
      stdio: "inherit",
    }
  );
  process.exitCode = result.status ?? 1;
} finally {
  removeWorkspace(workspaceA);
  removeWorkspace(workspaceB);
  rmSync(storeDirectory, { force: true, recursive: true });
}

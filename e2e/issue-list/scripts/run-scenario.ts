/**
 * Creates a disposable Beadwork workspace for one Issue List e2e scenario,
 * runs the WebDriver suite against it in a single Beadsmith launch, and
 * removes the workspace afterward regardless of pass/fail.
 *
 * WDIO's local runner re-evaluates `wdio.issue-list.conf.ts` in more than one
 * Node process (the launcher and each spec worker), so workspace creation
 * cannot safely live at config module scope -- it would run more than once
 * and desync from the already-launched app. Creating it here, once, and
 * handing the resolved path down via `BEADSMITH_E2E_WORKSPACE` keeps every
 * process reading the same fixture.
 */
import { spawnSync } from "node:child_process";

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

const workspace =
  scenario === "empty" ? createEmptyWorkspace() : createIssueListWorkspace();

try {
  const result = spawnSync(
    "pnpm",
    ["exec", "wdio", "run", "wdio.issue-list.conf.ts"],
    {
      env: {
        ...process.env,
        BEADSMITH_E2E_SCENARIO: scenario,
        BEADSMITH_E2E_WORKSPACE: workspace.path,
      },
      stdio: "inherit",
    }
  );
  process.exitCode = result.status ?? 1;
} finally {
  removeWorkspace(workspace);
}

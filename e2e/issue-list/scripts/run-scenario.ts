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
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createEmptyWorkspace,
  createIssueListWorkspace,
  createSecondIssueListWorkspace,
  removeWorkspace,
  resolveBwPath,
} from "../fixtures/workspace.ts";
import { assertEmbeddedWebDriverPortAvailable } from "./embedded-webdriver-port.ts";
import { isScenario } from "./harness-inputs.ts";

const scenario = process.argv.at(2);
if (!isScenario(scenario)) {
  console.error("Usage: run-scenario.ts <issues|empty|atomic-switch>");
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

const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;

/**
 * Create a scenario-owned PATH prefix that delays only the spawned desktop
 * app's `bw` and `git` calls. The production binary and Rust command runner
 * remain untouched: the wrappers exist only in this temporary scenario
 * directory and are removed with the fixtures after WebDriver exits.
 */
const createDelayedCommandWrappers = (delayMs: string): string => {
  const milliseconds = Number(delayMs);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new Error(
      `BEADSMITH_E2E_COMMAND_DELAY_MS must be a non-negative number, got ${delayMs}`
    );
  }
  const delaySeconds = String(milliseconds / 1000);
  const wrapperDirectory = mkdtempSync(
    path.join(tmpdir(), "beadsmith-e2e-command-wrapper-")
  );
  const commands = [
    ["bw", resolveBwPath()],
    ["git", execFileSync("which", ["git"], { encoding: "utf-8" }).trim()],
  ] as const;

  for (const [name, command] of commands) {
    if (!command || command === "not found on PATH") {
      throw new Error(
        `Could not create delayed ${name} wrapper: command missing`
      );
    }
    const wrapperPath = path.join(wrapperDirectory, name);
    writeFileSync(
      wrapperPath,
      `#!/bin/sh\nsleep ${shellQuote(delaySeconds)}\nexec ${shellQuote(command)} "$@"\n`
    );
    chmodSync(wrapperPath, 0o755);
  }
  return wrapperDirectory;
};

const workspaceA = createIssueListWorkspace();
const workspaceBEmpty = createEmptyWorkspace();
const workspaceBSecond =
  scenario === "atomic-switch" ? createSecondIssueListWorkspace() : undefined;
const workspaceB = workspaceBEmpty;
const storeDirectory = mkdtempSync(path.join(tmpdir(), "beadsmith-e2e-store-"));
const storePath = path.join(storeDirectory, "workspace-catalog.json");
let commandWrapperDirectory: string | undefined;

try {
  if (scenario === "atomic-switch") {
    commandWrapperDirectory = createDelayedCommandWrappers(
      process.env.BEADSMITH_E2E_COMMAND_DELAY_MS ?? "1000"
    );
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BEADSMITH_E2E_SCENARIO: scenario,
    BEADSMITH_E2E_WORKSPACE_A: workspaceA.path,
    BEADSMITH_E2E_WORKSPACE_B: workspaceB.path,
    BEADSMITH_WORKSPACE_STORE_PATH: storePath,
  };
  if (commandWrapperDirectory) {
    env.PATH = `${commandWrapperDirectory}${path.delimiter}${env.PATH ?? ""}`;
  }
  if (workspaceBSecond) {
    env.BEADSMITH_E2E_WORKSPACE_B_SECOND = workspaceBSecond.path;
  }
  const result = spawnSync(
    "pnpm",
    ["exec", "wdio", "run", "wdio.issue-list.conf.ts"],
    {
      env,
      stdio: "inherit",
    }
  );
  process.exitCode = result.status ?? 1;
} finally {
  removeWorkspace(workspaceA);
  removeWorkspace(workspaceB);
  if (workspaceBSecond) {
    removeWorkspace(workspaceBSecond);
  }
  if (commandWrapperDirectory) {
    rmSync(commandWrapperDirectory, { force: true, recursive: true });
  }
  rmSync(storeDirectory, { force: true, recursive: true });
}

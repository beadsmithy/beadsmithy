/**
 * Process-lifecycle harness for the Issue explorer WebDriver suite.
 *
 * Owns the disposable Beadwork workspaces, the scenario-owned backend-store
 * path, the temporary PATH wrappers used to observe the atomic Pending
 * window, and one or two sequential invocations of the WebDriver
 * configuration. Specs never seed state by writing to the store or by
 * changing process cwd: every fixture is selected through the typed
 * `TauRPC__switch_workspace` operation.
 *
 * Each scenario uses a fresh store path (and, except for restoration's two
 * phases, fresh fixture roots). Restoration reuses the same store across
 * its two sequential binary launches so the second binary can prove
 * restoration from store-backed state without hand-seeded fixtures.
 *
 * Scenario layout:
 *   - `issues`         one binary, populated A + true-empty B fixtures
 *   - `empty`          one binary, true-empty B fixture
 *   - `atomic-switch`  one binary, populated A + populated B fixtures, delayed wrappers
 *   - `restoration`    two binaries against one shared scenario-owned store,
 *                      same fixture A reused; phase 1 selects A, phase 2
 *                      asserts the next binary restored A from persistence
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createEmptyWorkspace,
  createIssueListWorkspace,
  createSecondIssueListWorkspace,
  removeWorkspace,
  resolveBwPath,
} from "../fixtures/workspace.ts";
import type { BeadworkWorkspace } from "../fixtures/workspace.ts";
import { assertEmbeddedWebDriverPortAvailable } from "./embedded-webdriver-port.ts";
import { isPhase, isScenario } from "./harness-inputs.ts";
import type { Phase } from "./harness-inputs.ts";
import {
  assertFingerprintsEqual,
  assertResourcesRemoved,
  assertScenarioStoreContainsPersistedCurrent,
  fingerprintStoreFile,
  resolveNormalStoreLocation,
} from "./store-isolation.ts";

interface ScenarioPlan {
  /** Number of sequential WDIO launches this scenario owns. */
  readonly phases: readonly Phase[];
  /** True when subsequent phases must share the scenario's store path. */
  readonly sharesStoreAcrossPhases: boolean;
  /** Default `BEADSMITH_E2E_COMMAND_DELAY_MS` for the atomic scenario. */
  readonly commandDelayMs?: string;
}

const SCENARIO_PLANS: Record<
  ReturnType<typeof isScenario> extends true ? never : string,
  ScenarioPlan
> = {
  "atomic-switch": {
    commandDelayMs: "1000",
    phases: ["1"],
    sharesStoreAcrossPhases: false,
  },
  empty: {
    phases: ["1"],
    sharesStoreAcrossPhases: false,
  },
  issues: {
    phases: ["1"],
    sharesStoreAcrossPhases: false,
  },
  restoration: {
    phases: ["1", "2"],
    sharesStoreAcrossPhases: true,
  },
};

const BUNDLE_IDENTIFIER = "com.benregn.beadsmith";

interface ParsedArgs {
  readonly scenario: ReturnType<typeof isScenario> & string;
  readonly phaseOverride: Phase | null;
}

const parseArgs = (argv: readonly string[]): ParsedArgs => {
  const [scenarioArg, ...rest] = argv;
  if (!isScenario(scenarioArg)) {
    console.error(
      "Usage: run-scenario.ts <issues|empty|atomic-switch|restoration> [--phase 1|2]"
    );
    process.exit(1);
  }
  let phaseOverride: Phase | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--phase") {
      const next = rest[index + 1];
      if (!isPhase(next)) {
        console.error("--phase must be 1 or 2");
        process.exit(1);
      }
      phaseOverride = next;
      index += 1;
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    process.exit(1);
  }
  return { phaseOverride, scenario: scenarioArg };
};

const { scenario, phaseOverride } = parseArgs(process.argv.slice(2));
const plan = SCENARIO_PLANS[scenario];
const phasesToRun: readonly Phase[] =
  phaseOverride === null ? plan.phases : [phaseOverride];

console.log(`[e2e] bw resolved at: ${resolveBwPath()}`);
console.log(`[e2e] scenario: ${scenario}`);
console.log(`[e2e] phases: ${phasesToRun.join(", ")}`);

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
  const bwPath = resolveBwPath();
  const gitPath = execFileSync("which", ["git"], { encoding: "utf-8" }).trim();
  const commands: readonly (readonly [string, string])[] = [
    ["bw", bwPath],
    ["git", gitPath],
  ];
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

interface ScenarioResources {
  readonly commandWrapperDirectory: string | undefined;
  readonly storeDirectory: string;
  readonly storePath: string;
  readonly workspaceA: BeadworkWorkspace;
  readonly workspaceB: BeadworkWorkspace | undefined;
  readonly workspaceBSecond: BeadworkWorkspace | undefined;
  /** Read-only fingerprint of the developer's normal store before the run. */
  readonly normalStoreFingerprintBefore: ReturnType<
    typeof fingerprintStoreFile
  >;
}

const ensureDirectory = (directory: string): string => {
  // The scenario harness is allowed to create only its own parent
  // directory; the desktop binary owns the actual store file as a
  // side-effect of the typed `switch_workspace` RPC.
  mkdirSync(directory, { recursive: true });
  return directory;
};

const provisionResources = (phases: readonly Phase[]): ScenarioResources => {
  // Capture the developer's normal store *before* the run. We never write
  // to the developer location; the harness creates only the scenario-owned
  // temporary parent directory and the absolute path supplied via
  // BEADSMITH_WORKSPACE_STORE_PATH.
  const normalLocation = resolveNormalStoreLocation(BUNDLE_IDENTIFIER);
  const normalStoreFingerprintBefore = fingerprintStoreFile(
    normalLocation.storeFile
  );

  // Restoration's phase 2 reuses phase 1's store path so the second binary
  // can restore from the state the first typed switch persisted. Every
  // other scenario gets a fresh store path every run. We materialise only
  // the parent directory here; the desktop binary creates the actual store
  // file through the typed switch operation.
  const shareStore = phases.length > 1 && plan.sharesStoreAcrossPhases;
  const storeDirectory = ensureDirectory(
    mkdtempSync(
      path.join(
        tmpdir(),
        shareStore ? "beadsmith-e2e-store-restoration-" : "beadsmith-e2e-store-"
      )
    )
  );
  const storePath = path.join(storeDirectory, "workspace-catalog.json");

  // The two populated fixtures are deterministic throwaway repos seeded
  // via `bw`; only create what each scenario needs.
  const workspaceA = createIssueListWorkspace();
  const workspaceBEmpty = createEmptyWorkspace();
  const workspaceBSecond =
    scenario === "atomic-switch" ? createSecondIssueListWorkspace() : undefined;
  // `issues` uses B (true-empty) for its invalid-typed-switch case and
  // `empty` uses B outright; the rest do not need a true-empty fixture.
  const workspaceB =
    scenario === "issues" || scenario === "empty" ? workspaceBEmpty : undefined;

  let commandWrapperDirectory: string | undefined;
  if (plan.commandDelayMs !== undefined) {
    commandWrapperDirectory = createDelayedCommandWrappers(plan.commandDelayMs);
  }

  return {
    commandWrapperDirectory,
    normalStoreFingerprintBefore,
    storeDirectory,
    storePath,
    workspaceA,
    workspaceB,
    workspaceBSecond,
  };
};

const removeIfExists = (target: string | undefined): void => {
  if (!target) {
    return;
  }
  rmSync(target, { force: true, recursive: true });
};

const buildPhaseEnvironment = (
  resources: ScenarioResources,
  phase: Phase
): NodeJS.ProcessEnv => {
  // Restoration phase 2 must NOT issue a seed `switch_workspace` (it
  // proves restoration from the scenario-owned store alone). The fixture
  // A path is still passed through so the phase 2 spec can assert what
  // it expects the second binary to have restored. The webdriver config
  // and the spec are responsible for *not* using the env var for any
  // selection RPC during phase 2; the harness only configures inputs.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BEADSMITH_E2E_PHASE: phase,
    BEADSMITH_E2E_SCENARIO: scenario,
    BEADSMITH_E2E_WORKSPACE_A: resources.workspaceA.path,
    BEADSMITH_WORKSPACE_STORE_PATH: resources.storePath,
  };
  if (resources.workspaceB) {
    env.BEADSMITH_E2E_WORKSPACE_B = resources.workspaceB.path;
  }
  if (resources.workspaceBSecond) {
    env.BEADSMITH_E2E_WORKSPACE_B_SECOND = resources.workspaceBSecond.path;
  }
  if (resources.commandWrapperDirectory) {
    env.PATH = `${resources.commandWrapperDirectory}${path.delimiter}${
      env.PATH ?? ""
    }`;
    // Propagate the deterministic wrapper delay so the spec can wait
    // beyond the cancelled worker's intentionally delayed completion
    // before reasserting A's state. The spec reads this env var; the
    // production binary never sees it because the wrappers are
    // PATH-scoped and the e2e suite is the only consumer.
    if (plan.commandDelayMs !== undefined) {
      env.BEADSMITH_E2E_COMMAND_DELAY_MS = plan.commandDelayMs;
    }
  }
  return env;
};

/** Run one phase; return the spawned process's exit code (0 on success). */
const runPhase = (resources: ScenarioResources, phase: Phase): number => {
  console.log(`\n[e2e] === phase ${phase} ===`);
  const env = buildPhaseEnvironment(resources, phase);
  const result = spawnSync(
    "pnpm",
    ["exec", "wdio", "run", "wdio.issue-list.conf.ts"],
    {
      env,
      stdio: "inherit",
    }
  );
  return result.status ?? 1;
};

const restorePhasePostCheck = (
  resources: ScenarioResources,
  phase: Phase
): void => {
  // After phase 1 of restoration, inspect the *test-only* store as
  // evidence that it was created by the preceding typed operation and
  // contains the expected persisted current path. This is verification,
  // not fixture seeding; the desktop binary is the only writer.
  if (scenario !== "restoration" || phase !== "1") {
    return;
  }
  console.log(
    "[e2e] asserting scenario-owned store reflects phase-1 typed switch"
  );
  assertScenarioStoreContainsPersistedCurrent(
    resources.storePath,
    resources.workspaceA.path
  );
};

const verifyIsolation = (resources: ScenarioResources): void => {
  console.log("\n[e2e] === isolation verification ===");
  const normalLocation = resolveNormalStoreLocation(BUNDLE_IDENTIFIER);
  const normalStoreFingerprintAfter = fingerprintStoreFile(
    normalLocation.storeFile
  );
  assertFingerprintsEqual(
    "workspace-catalog",
    resources.normalStoreFingerprintBefore,
    normalStoreFingerprintAfter
  );
  console.log(
    `[e2e] normal store fingerprint unchanged at ${normalLocation.storeFile}`
  );
};

const cleanupResources = (resources: ScenarioResources): void => {
  console.log("\n[e2e] === cleanup ===");
  removeWorkspace(resources.workspaceA);
  if (resources.workspaceB) {
    removeWorkspace(resources.workspaceB);
  }
  if (resources.workspaceBSecond) {
    removeWorkspace(resources.workspaceBSecond);
  }
  removeIfExists(resources.commandWrapperDirectory);
  removeIfExists(resources.storeDirectory);

  assertResourcesRemoved(
    [
      resources.workspaceA.path,
      resources.workspaceB?.path,
      resources.workspaceBSecond?.path,
      resources.commandWrapperDirectory,
      resources.storeDirectory,
    ].filter((value): value is string => value !== undefined)
  );
  console.log("[e2e] cleanup complete; no scenario-owned resources remain");
};

const resources = provisionResources(phasesToRun);
let firstFailure = 0;
try {
  for (const phase of phasesToRun) {
    const status = runPhase(resources, phase);
    if (status !== 0 && firstFailure === 0) {
      firstFailure = status;
    }
    try {
      restorePhasePostCheck(resources, phase);
    } catch (error) {
      console.error(
        `[e2e] post-phase isolation check failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      if (firstFailure === 0) {
        firstFailure = 1;
      }
    }
  }
} finally {
  try {
    verifyIsolation(resources);
  } catch (error) {
    console.error(
      `[e2e] isolation verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    if (firstFailure === 0) {
      firstFailure = 1;
    }
  }
  cleanupResources(resources);
}

process.exitCode = firstFailure;

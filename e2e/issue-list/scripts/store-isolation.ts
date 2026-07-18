/**
 * Store isolation helpers for the Issue explorer WebDriver suite.
 *
 * The desktop binary resolves its backend workspace catalog from a path it
 * computes itself in production but the suite overrides for isolation via
 * `BEADSMITH_WORKSPACE_STORE_PATH`. This module is read-only with respect to
 * the developer's normal store location: it only fingerprints what is already
 * there so it can prove the suite never touches it and never writes the store
 * itself (fixtures are always seeded through the typed `switch_workspace` RPC).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { platform } from "node:os";
import path from "node:path";

/**
 * Resolve the supported, non-isolated Beadsmith workspace-catalog location
 * the production binary would use on this host. We return both the directory
 * (so the harness can assert nothing was created there) and the file (so it
 * can compare hashes before and after the run). The path is determined the
 * same way the platform-default store would be; we deliberately never
 * create the path.
 */
export interface NormalStoreLocation {
  appSupportDirectory: string;
  storeFile: string;
}

const xdgConfigHome = (): string | undefined => {
  const value = process.env.XDG_CONFIG_HOME;
  return value && value.length > 0 ? value : undefined;
};

/**
 * Best-effort guess at the application-data directory for this user, used
 * only as a fingerprint source. We do NOT create this directory and do NOT
 * write to it; we simply note whether the suite changed it.
 *
 * - macOS: `~/Library/Application Support/<bundleIdentifier>/`
 * - Linux: `$XDG_CONFIG_HOME/<bundleIdentifier>/` or `~/.config/<bundleIdentifier>/`
 * - Windows: `%APPDATA%/<bundleIdentifier>/` (best-effort)
 */
export const resolveNormalStoreLocation = (
  bundleIdentifier: string
): NormalStoreLocation => {
  const home = process.env.HOME ?? "";
  if (platform() === "darwin") {
    const directory = path.join(
      home,
      "Library",
      "Application Support",
      bundleIdentifier
    );
    return {
      appSupportDirectory: directory,
      storeFile: path.join(directory, "workspace-catalog.json"),
    };
  }
  if (platform() === "linux") {
    const base = xdgConfigHome() ?? path.join(home, ".config");
    const directory = path.join(base, bundleIdentifier);
    return {
      appSupportDirectory: directory,
      storeFile: path.join(directory, "workspace-catalog.json"),
    };
  }
  // Windows: best-effort. The CI runner on Windows is uncommon for this
  // suite; failure paths here degrade to a no-op fingerprint.
  const appData = process.env.APPDATA ?? home;
  const directory = path.join(appData, bundleIdentifier);
  return {
    appSupportDirectory: directory,
    storeFile: path.join(directory, "workspace-catalog.json"),
  };
};

export interface StoreFingerprint {
  exists: boolean;
  content: string | null;
  size: number | null;
  mtimeMs: number | null;
}

/**
 * Capture a read-only fingerprint of a file's existence and content. We never
 * create the file or alter it; this is purely a comparative read. The full
 * UTF-8 content is captured so two equal fingerprints prove byte-for-byte
 * equality; a stable hash would only save memory, and the catalog file is
 * tiny.
 */
export const fingerprintStoreFile = (file: string): StoreFingerprint => {
  if (!existsSync(file)) {
    return { content: null, exists: false, mtimeMs: null, size: null };
  }
  const stats = statSync(file);
  const content = readFileSync(file, "utf-8");
  return {
    content,
    exists: true,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
};

export class IsolationBreachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IsolationBreachError";
  }
}

/**
 * Assert two fingerprints are equal. The harness captures one before launch
 * and one after cleanup; equality means the developer catalog (if any) was
 * never touched.
 */
export const assertFingerprintsEqual = (
  label: string,
  before: StoreFingerprint,
  after: StoreFingerprint
): void => {
  const beforeSig = JSON.stringify(before);
  const afterSig = JSON.stringify(after);
  if (beforeSig === afterSig) {
    return;
  }
  throw new IsolationBreachError(
    `Developer ${label} store fingerprint changed across the scenario.\n` +
      `  before: ${beforeSig}\n` +
      `  after:  ${afterSig}\n` +
      "The WebDriver suite must not read or mutate the developer's catalog."
  );
};

/**
 * Assert that a path either does not exist, or contains the expected RPC-created
 * state. This is verification, not seeding: the desktop process must create the
 * file through `tauri-plugin-store` as a side-effect of the typed
 * `switch_workspace` the spec just performed. Failures include the offending
 * paths so the developer can investigate.
 *
 * The store file wraps the persisted state under the `workspaceState` key
 * (see TauriWorkspaceStore::save in src-tauri/src/workspace.rs); we look up
 * the typed shape behind that key.
 */
export const assertScenarioStoreContainsPersistedCurrent = (
  storeFile: string,
  expectedCurrentPath: string
): void => {
  if (!existsSync(storeFile)) {
    throw new IsolationBreachError(
      `Scenario-owned store did not exist after the first phase: ${storeFile}\n` +
        `Expected persisted currentWorkspace path to include: ${expectedCurrentPath}`
    );
  }
  const raw = readFileSync(storeFile, "utf-8");
  let parsed: { workspaceState?: { currentWorkspacePath?: unknown } };
  try {
    parsed = JSON.parse(raw) as {
      workspaceState?: { currentWorkspacePath?: unknown };
    };
  } catch (error) {
    throw new IsolationBreachError(
      `Scenario-owned store is not valid JSON: ${storeFile}\n${String(error)}`
    );
  }
  const current = parsed.workspaceState?.currentWorkspacePath;
  if (typeof current !== "string" || !current.includes(expectedCurrentPath)) {
    throw new IsolationBreachError(
      `Scenario-owned store does not record the expected persisted current path.\n` +
        `  store: ${storeFile}\n` +
        `  expected to include: ${expectedCurrentPath}\n` +
        `  observed: ${String(current)}`
    );
  }
};

/**
 * Assert that every file/directory in a list has been removed by the harness.
 * `finally` cleanup uses this to prove the suite leaves nothing behind that
 * a later scenario could accidentally couple to.
 */
export const assertResourcesRemoved = (paths: string[]): void => {
  const survivors: string[] = [];
  for (const resource of paths) {
    if (existsSync(resource)) {
      survivors.push(resource);
    }
  }
  if (survivors.length > 0) {
    throw new IsolationBreachError(
      `Scenario harness left resources behind after cleanup:\n${survivors
        .map((survivor) => `  - ${survivor}`)
        .join("\n")}\nEach scenario must own and remove its test-only files.`
    );
  }
};

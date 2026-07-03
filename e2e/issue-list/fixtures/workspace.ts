/**
 * Deterministic, disposable Beadwork workspaces for the Issue List WebDriver
 * end-to-end suite. Each workspace is a throwaway git repository initialized
 * with `bw init` under the OS temp directory, so nothing here is committed
 * and nothing depends on a machine-specific path (see
 * docs/agents/webdriver-e2e.md).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BW_BINARY = "bw";

export interface FixtureIssue {
  id: string;
  title: string;
}

export interface BeadworkWorkspace {
  /** Absolute path to the disposable git repository. */
  path: string;
  /** The issue Beadsmith is expected to render, when the workspace has one. */
  issue?: FixtureIssue;
}

const runBw = (args: string[], cwd: string): string =>
  execFileSync(BW_BINARY, args, { cwd, encoding: "utf-8" }).trim();

const runGit = (args: string[], cwd: string): void => {
  execFileSync("git", args, { cwd, stdio: "ignore" });
};

/** Resolve the `bw` binary path (or a diagnostic message) for e2e logging. */
export const resolveBwPath = (): string => {
  try {
    return execFileSync("which", [BW_BINARY], { encoding: "utf-8" }).trim();
  } catch {
    return "not found on PATH";
  }
};

const initGitBeadworkRepo = (workspacePath: string): void => {
  runGit(["init", "--quiet"], workspacePath);
  runGit(["config", "user.email", "beadsmith-e2e@example.com"], workspacePath);
  runGit(["config", "user.name", "Beadsmith E2E"], workspacePath);
  runBw(["init", "--prefix", "e2e"], workspacePath);
};

/** A real Beadwork workspace with zero issues (the "true empty list" scenario). */
export const createEmptyWorkspace = (): BeadworkWorkspace => {
  const workspacePath = mkdtempSync(
    path.join(tmpdir(), "beadsmith-e2e-empty-")
  );
  console.log(
    `[e2e:fixture] creating empty Beadwork workspace at ${workspacePath}`
  );
  initGitBeadworkRepo(workspacePath);
  console.log(`[e2e:fixture] empty workspace ready at ${workspacePath}`);
  return { path: workspacePath };
};

export const FIXTURE_ISSUE_TITLE = "Render real issue summaries end to end";

/**
 * A real Beadwork workspace with one issue that has labels and a blocking
 * dependency, plus the blocker issue itself.
 */
export const createIssueListWorkspace = (): BeadworkWorkspace => {
  const workspacePath = mkdtempSync(
    path.join(tmpdir(), "beadsmith-e2e-issues-")
  );
  console.log(
    `[e2e:fixture] creating Beadwork workspace with issues at ${workspacePath}`
  );
  initGitBeadworkRepo(workspacePath);

  const blockerId = runBw(
    [
      "create",
      "Wire up the deterministic e2e fixture",
      "--type",
      "task",
      "--priority",
      "2",
      "--silent",
    ],
    workspacePath
  );
  const issueId = runBw(
    [
      "create",
      FIXTURE_ISSUE_TITLE,
      "--type",
      "feature",
      "--priority",
      "1",
      "--silent",
    ],
    workspacePath
  );
  runBw(["label", issueId, "+e2e-fixture", "+ready-for-agent"], workspacePath);
  runBw(["dep", "add", blockerId, "blocks", issueId], workspacePath);

  console.log(
    `[e2e:fixture] workspace ready at ${workspacePath}: issue ${issueId} (blocked by ${blockerId})`
  );
  return {
    issue: { id: issueId, title: FIXTURE_ISSUE_TITLE },
    path: workspacePath,
  };
};

export const removeWorkspace = (workspace: BeadworkWorkspace): void => {
  console.log(`[e2e:fixture] removing workspace at ${workspace.path}`);
  rmSync(workspace.path, { force: true, recursive: true });
};

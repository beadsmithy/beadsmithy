/**
 * Deterministic, disposable Beadwork workspaces for the Issue explorer
 * WebDriver end-to-end suite. Each workspace is a throwaway git repository initialized
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

export const FIXTURE_BLOCKER_TITLE = "Wire up the deterministic e2e fixture";
export const FIXTURE_ISSUE_TITLE = "Render selected issue details end to end";
export const FIXTURE_READY_TITLE = "Ready Orchid Issue Search fixture";
export const FIXTURE_READY_SEARCH_QUERY = "orchid-ready-token";
export const FIXTURE_READY_DESCRIPTION = `This ready Issue carries the unique ${FIXTURE_READY_SEARCH_QUERY} description token for local search.`;
export const FIXTURE_CLOSED_TITLE = "Closed Cobalt archived fixture";
export const FIXTURE_CLOSED_DESCRIPTION =
  "Closed through bw close so the Closed view uses real Beadwork state.";
export const FIXTURE_DEFERRED_TITLE = "Deferred Amber waiting fixture";
export const FIXTURE_DEFERRED_DESCRIPTION =
  "Deferred through bw defer so the Deferred view uses real Beadwork state.";
export const FIXTURE_DEFER_UNTIL = "2035-01-01";
export const FIXTURE_DESCRIPTION_HEADING = "Detail-ready fixture";
export const FIXTURE_DESCRIPTION_BULLET =
  "Markdown bullets survive the Beadwork round trip.";
export const FIXTURE_DESCRIPTION_INLINE_CODE = "list_issues";
export const FIXTURE_ISSUE_DESCRIPTION = `## ${FIXTURE_DESCRIPTION_HEADING}

This description proves the desktop app renders selected Issue Detail content from ${FIXTURE_DESCRIPTION_INLINE_CODE}.

- ${FIXTURE_DESCRIPTION_BULLET}
- Inline code such as \`${FIXTURE_DESCRIPTION_INLINE_CODE}\` appears in the detail pane.`;
export const FIXTURE_COMMENT_AUTHOR = "Beadsmith E2E";
export const FIXTURE_COMMENT_TEXT =
  "The detail pane should show this authored fixture comment.";

/**
 * A real Beadwork workspace with one issue that has labels, a blocking
 * dependency, a Markdown description, and comments, plus the blocker issue
 * itself.
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
      FIXTURE_BLOCKER_TITLE,
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
      "--description",
      FIXTURE_ISSUE_DESCRIPTION,
      "--silent",
    ],
    workspacePath
  );
  const readyIssueId = runBw(
    [
      "create",
      FIXTURE_READY_TITLE,
      "--type",
      "task",
      "--priority",
      "2",
      "--description",
      FIXTURE_READY_DESCRIPTION,
      "--silent",
    ],
    workspacePath
  );
  const closedIssueId = runBw(
    [
      "create",
      FIXTURE_CLOSED_TITLE,
      "--type",
      "task",
      "--priority",
      "3",
      "--description",
      FIXTURE_CLOSED_DESCRIPTION,
      "--silent",
    ],
    workspacePath
  );
  const deferredIssueId = runBw(
    [
      "create",
      FIXTURE_DEFERRED_TITLE,
      "--type",
      "task",
      "--priority",
      "3",
      "--description",
      FIXTURE_DEFERRED_DESCRIPTION,
      "--silent",
    ],
    workspacePath
  );

  console.log(
    `[e2e:fixture] created issues: blocker=${blockerId}, blocked=${issueId}, ready=${readyIssueId}, closed=${closedIssueId}, deferred=${deferredIssueId}`
  );
  runBw(["label", issueId, "+e2e-fixture", "+ready-for-agent"], workspacePath);
  runBw(["dep", "add", blockerId, "blocks", issueId], workspacePath);
  runBw(
    ["close", closedIssueId, "--reason", "e2e closed fixture"],
    workspacePath
  );
  runBw(["defer", deferredIssueId, FIXTURE_DEFER_UNTIL], workspacePath);
  runBw(
    [
      "comment",
      issueId,
      FIXTURE_COMMENT_TEXT,
      "--author",
      FIXTURE_COMMENT_AUTHOR,
    ],
    workspacePath
  );

  console.log(
    `[e2e:fixture] workspace ready at ${workspacePath}: blocked issue ${issueId} (blocked by ${blockerId}), ready issue ${readyIssueId}, closed issue ${closedIssueId}, deferred issue ${deferredIssueId}`
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

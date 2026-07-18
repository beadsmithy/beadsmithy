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
  /** An Issue that shares an explicit ID with another workspace's fixture. */
  sharedIssue?: FixtureIssue;
}

const runBw = (args: string[], cwd: string): string =>
  execFileSync(BW_BINARY, args, { cwd, encoding: "utf-8" }).trim();

const runGit = (args: string[], cwd: string): void => {
  execFileSync("git", args, { cwd, stdio: "ignore" });
};

interface TaskIssueOptions {
  description?: string;
  explicitId?: string;
  priority: "2" | "3";
  title: string;
  workspacePath: string;
}

const createTaskIssue = ({
  description,
  explicitId,
  priority,
  title,
  workspacePath,
}: TaskIssueOptions): string => {
  const args = ["create", title, "--type", "task", "--priority", priority];

  if (description !== undefined) {
    args.push("--description", description);
  }

  if (explicitId !== undefined) {
    args.push("--id", explicitId);
  }

  args.push("--silent");
  return runBw(args, workspacePath);
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
export const FIXTURE_SECOND_ISSUE_TITLE =
  "Workspace B atomic-switch snapshot marker";
export const FIXTURE_SECOND_SEARCH_QUERY = "second-workspace-marker";
export const FIXTURE_SECOND_DESCRIPTION = `Workspace B carries the unique ${FIXTURE_SECOND_SEARCH_QUERY} description token so the e2e suite can distinguish it from the populated Workspace A after a switch commits.`;
export const FIXTURE_SECOND_BLOCKER_TITLE =
  "Workspace B committed state marker";
/**
 * Explicit Issue ID deliberately shared across Workspace A and Workspace B.
 * Atomic-switch coverage relies on this collision to prove that selection,
 * detail, and search context cannot leak from A into B across a committed
 * switch. Use Beadwork's supported `--id` flag so the prefix is always the
 * same; random prefixes would let a coincidental match mask a real leak.
 */
export const FIXTURE_SHARED_ID = "bsm-e2e-shared";
export const FIXTURE_SHARED_TITLE_A = "Shared A overlap identity marker";
export const FIXTURE_SHARED_TITLE_B = "Shared B overlap identity marker";
export const FIXTURE_SHARED_SEARCH_TOKEN_A = "shared-alpha-orchid";
export const FIXTURE_SHARED_SEARCH_TOKEN_B = "shared-bravo-cobalt";
export const FIXTURE_SHARED_DESCRIPTION_A = `Workspace A's shared-ID Issue carries the unique ${FIXTURE_SHARED_SEARCH_TOKEN_A} description token.`;
export const FIXTURE_SHARED_DESCRIPTION_B = `Workspace B's shared-ID Issue carries the unique ${FIXTURE_SHARED_SEARCH_TOKEN_B} description token so an A-leaked query never matches it.`;
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
export const FIXTURE_DESCRIPTION_INLINE_CODE = "load_issue_explorer_data";
export const FIXTURE_DESCRIPTION_FENCED_CODE = "const markdownScale = 24;";
export const FIXTURE_ISSUE_DESCRIPTION = `## ${FIXTURE_DESCRIPTION_HEADING}

This description proves the desktop app renders selected Issue Detail content from ${FIXTURE_DESCRIPTION_INLINE_CODE}.

- ${FIXTURE_DESCRIPTION_BULLET}
- Inline code such as \`${FIXTURE_DESCRIPTION_INLINE_CODE}\` appears in the detail pane.

\`\`\`ts
${FIXTURE_DESCRIPTION_FENCED_CODE}
\`\`\``;
export const FIXTURE_COMMENT_AUTHOR = "Beadsmith E2E";
export const FIXTURE_COMMENT_TEXT =
  "The detail pane should show this authored fixture comment.";
export const FIXTURE_COMMENT_MARKDOWN = "**Markdown formatting is preserved.**";

/**
 * A real Beadwork workspace with Issues for the selectable list views: a
 * blocked detail Issue with labels, a dependency, Markdown, and comments;
 * its blocker; a searchable Ready Issue; a Closed Issue; and a Deferred Issue.
 */
export const createIssueListWorkspace = (): BeadworkWorkspace => {
  const workspacePath = mkdtempSync(
    path.join(tmpdir(), "beadsmith-e2e-issues-")
  );
  console.log(
    `[e2e:fixture] creating Beadwork workspace with issues at ${workspacePath}`
  );
  initGitBeadworkRepo(workspacePath);

  const blockerId = createTaskIssue({
    priority: "2",
    title: FIXTURE_BLOCKER_TITLE,
    workspacePath,
  });
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
  const readyIssueId = createTaskIssue({
    description: FIXTURE_READY_DESCRIPTION,
    priority: "2",
    title: FIXTURE_READY_TITLE,
    workspacePath,
  });
  const closedIssueId = createTaskIssue({
    description: FIXTURE_CLOSED_DESCRIPTION,
    priority: "3",
    title: FIXTURE_CLOSED_TITLE,
    workspacePath,
  });
  const deferredIssueId = createTaskIssue({
    description: FIXTURE_DEFERRED_DESCRIPTION,
    priority: "3",
    title: FIXTURE_DEFERRED_TITLE,
    workspacePath,
  });
  const sharedIssueId = createTaskIssue({
    description: FIXTURE_SHARED_DESCRIPTION_A,
    explicitId: FIXTURE_SHARED_ID,
    priority: "2",
    title: FIXTURE_SHARED_TITLE_A,
    workspacePath,
  });

  console.log(
    `[e2e:fixture] created issues: blocker=${blockerId}, blocked=${issueId}, ready=${readyIssueId}, closed=${closedIssueId}, deferred=${deferredIssueId}, shared=${sharedIssueId}`
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
      `${FIXTURE_COMMENT_TEXT}\n\n${FIXTURE_COMMENT_MARKDOWN}`,
      "--author",
      FIXTURE_COMMENT_AUTHOR,
    ],
    workspacePath
  );

  console.log(
    `[e2e:fixture] workspace ready at ${workspacePath}: blocked issue ${issueId} (blocked by ${blockerId}), ready issue ${readyIssueId}, closed issue ${closedIssueId}, deferred issue ${deferredIssueId}, shared issue ${sharedIssueId}`
  );
  return {
    issue: { id: issueId, title: FIXTURE_ISSUE_TITLE },
    path: workspacePath,
    sharedIssue: {
      id: sharedIssueId,
      title: FIXTURE_SHARED_TITLE_A,
    },
  };
};

/**
 * A second populated Beadwork workspace with its own distinguishable Issues
 * for the atomic workspace-switch slice. The Issues here share no titles or
 * search tokens with `createIssueListWorkspace`, so a successful switch can
 * be asserted by the new `Workspace B …` markers appearing in the DOM and
 * `Workspace A …` markers being absent.
 */
export const createSecondIssueListWorkspace = (): BeadworkWorkspace => {
  const workspacePath = mkdtempSync(
    path.join(tmpdir(), "beadsmith-e2e-second-")
  );
  console.log(
    `[e2e:fixture] creating second populated Beadwork workspace at ${workspacePath}`
  );
  initGitBeadworkRepo(workspacePath);

  const blockerId = createTaskIssue({
    priority: "2",
    title: FIXTURE_SECOND_BLOCKER_TITLE,
    workspacePath,
  });
  const secondIssueId = createTaskIssue({
    description: FIXTURE_SECOND_DESCRIPTION,
    priority: "1",
    title: FIXTURE_SECOND_ISSUE_TITLE,
    workspacePath,
  });
  const sharedIssueId = createTaskIssue({
    description: FIXTURE_SHARED_DESCRIPTION_B,
    explicitId: FIXTURE_SHARED_ID,
    priority: "2",
    title: FIXTURE_SHARED_TITLE_B,
    workspacePath,
  });
  console.log(
    `[e2e:fixture] second workspace ready at ${workspacePath}: blocker=${blockerId}, issue=${secondIssueId}, shared=${sharedIssueId}`
  );
  runBw(["dep", "add", blockerId, "blocks", secondIssueId], workspacePath);

  return {
    issue: { id: secondIssueId, title: FIXTURE_SECOND_ISSUE_TITLE },
    path: workspacePath,
    sharedIssue: {
      id: sharedIssueId,
      title: FIXTURE_SHARED_TITLE_B,
    },
  };
};

export const removeWorkspace = (workspace: BeadworkWorkspace): void => {
  console.log(`[e2e:fixture] removing workspace at ${workspace.path}`);
  rmSync(workspace.path, { force: true, recursive: true });
};

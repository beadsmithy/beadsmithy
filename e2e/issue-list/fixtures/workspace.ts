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

const runBw = (
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): string => {
  // Pass `BW_CLOCK` only to intended invocations. The override is
  // merged with `process.env` so the `bw` binary still finds the
  // `PATH` it needs; the harness never mutates `process.env` so a
  // fixed clock cannot leak into other fixture operations.
  const fullEnv: NodeJS.ProcessEnv =
    env === undefined ? process.env : { ...process.env, ...env };
  return execFileSync(BW_BINARY, args, {
    cwd,
    encoding: "utf-8",
    env: fullEnv,
  }).trim();
};

const runGit = (args: string[], cwd: string): void => {
  execFileSync("git", args, { cwd, stdio: "ignore" });
};

interface TaskIssueOptions {
  /** Optional Beadwork `BW_CLOCK` for this single invocation. */
  clock?: string;
  description?: string;
  explicitId?: string;
  /** Optional structured `parent` reference for this Issue. */
  parent?: string;
  priority: "1" | "2" | "3" | "4";
  title: string;
  workspacePath: string;
}

const createTaskIssue = ({
  clock,
  description,
  explicitId,
  parent,
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

  if (parent !== undefined) {
    args.push("--parent", parent);
  }

  args.push("--silent");
  const clockEnv: NodeJS.ProcessEnv = {};
  if (clock !== undefined) {
    clockEnv.BW_CLOCK = clock;
  }
  return runBw(args, workspacePath, clockEnv);
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
export const FIXTURE_DESCRIPTION_MERMAID_HEADING = "Workflow diagram";
/**
 * Valid Mermaid fence that the assembled Beadsmith binary must render to SVG.
 * The fixture exercises the shared `MarkdownContent` seam, so a description
 * render here proves the same path the comment path uses. The content is
 * deliberately compact but produces a multi-node graph so SVG structure
 * assertions are non-trivial.
 */
export const FIXTURE_DESCRIPTION_MERMAID_SOURCE = `graph TD
    Loaded[Fixture loaded] --> Selected[Issue selected]
    Selected --> Rendered[Diagram rendered]
    Rendered --> Pannable[Pannable and zoomable]
    Rendered --> Source[Source tab available]`;
export const FIXTURE_ISSUE_DESCRIPTION = `## ${FIXTURE_DESCRIPTION_HEADING}

This description proves the desktop app renders selected Issue Detail content from ${FIXTURE_DESCRIPTION_INLINE_CODE}.

- ${FIXTURE_DESCRIPTION_BULLET}
- Inline code such as \`${FIXTURE_DESCRIPTION_INLINE_CODE}\` appears in the detail pane.

\`\`\`ts
${FIXTURE_DESCRIPTION_FENCED_CODE}
\`\`\`

## ${FIXTURE_DESCRIPTION_MERMAID_HEADING}

\`\`\`mermaid
${FIXTURE_DESCRIPTION_MERMAID_SOURCE}
\`\`\``;
export const FIXTURE_COMMENT_AUTHOR = "Beadsmith E2E";
export const FIXTURE_COMMENT_TEXT =
  "The detail pane should show this authored fixture comment.";
export const FIXTURE_COMMENT_MARKDOWN = "**Markdown formatting is preserved.**";
/**
 * Comment fixture that proves the shared `MarkdownContent` seam renders a
 * valid Mermaid diagram inside a comment, not just an Issue description.
 */
export const FIXTURE_COMMENT_MERMAID_AUTHOR = "Beadsmith E2E Mermaid";
export const FIXTURE_COMMENT_MERMAID_SOURCE = `sequenceDiagram
    participant Reader
    participant Detail as Issue Detail
    participant Mermaid as Mermaid runtime
    Reader->>Detail: Open Issue
    Detail->>Mermaid: Render fence
    Mermaid-->>Detail: SVG
    Detail-->>Reader: Diagram view`;
/**
 * Comment fixture that proves a malformed Mermaid fence is surfaced as a
 * complete error banner with the unchanged authored source reachable
 * through the Source tab.
 */
export const FIXTURE_COMMENT_MALFORMED_AUTHOR = "Beadsmith E2E Mermaid Broken";
export const FIXTURE_COMMENT_MALFORMED_INTRO =
  "The next fence is deliberately malformed and must surface the complete Mermaid error.";
export const FIXTURE_COMMENT_MALFORMED_SOURCE =
  "this is not valid mermaid ::: !! -- broken %%";

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
  runBw(
    [
      "comment",
      issueId,
      `\`\`\`mermaid\n${FIXTURE_COMMENT_MERMAID_SOURCE}\n\`\`\``,
      "--author",
      FIXTURE_COMMENT_MERMAID_AUTHOR,
    ],
    workspacePath
  );
  runBw(
    [
      "comment",
      issueId,
      `${FIXTURE_COMMENT_MALFORMED_INTRO}\n\n\`\`\`mermaid\n${FIXTURE_COMMENT_MALFORMED_SOURCE}\n\`\`\``,
      "--author",
      FIXTURE_COMMENT_MALFORMED_AUTHOR,
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

/**
 * Fixed-RFC3339 fixture for the Child Issues desktop acceptance scenario
 * (`bsm-nd7.4`). One closed parent and three children exercise both
 * ordering keys (priority ascending, then `created` ascending); one
 * open, root Issue with a unique description token proves the "no
 * children" empty-section branch. Every timestamp is fixed so the
 * expected Child Issues order is declared, not inferred from wall-clock
 * timing.
 *
 * The parent is `closed` so it does not appear in `Ready` (or any
 * non-All/non-Closed view). That is what the navigation preservation
 * test relies on: the parent's Issue List row genuinely disappears
 * while Issue Detail (and its Child Issues section) persist because
 * selection is backed by `allIssues`.
 */
export const FIXTURE_CHILD_PARENT_ID = "bsm-e2e-child-parent";
export const FIXTURE_CHILD_PARENT_TITLE = "Hierarchy parent (closed) fixture";
export const FIXTURE_CHILD_PARENT_PRIORITY = "2";
export const FIXTURE_CHILD_PARENT_CREATED = "2026-01-10T09:00:00Z";
export const FIXTURE_CHILD_PARENT_CLOSED_AT = "2026-02-03T09:00:00Z";
export const FIXTURE_CHILD_PARENT_CLOSE_REASON = "e2e closed fixture";

export const FIXTURE_CHILD_PARENT_1_ID = "bsm-e2e-child-parent-1";
export const FIXTURE_CHILD_PARENT_1_TITLE = "Hierarchy P1 closed older child";
export const FIXTURE_CHILD_PARENT_1_PRIORITY = "1";
export const FIXTURE_CHILD_PARENT_1_CREATED = "2025-12-01T09:00:00Z";
export const FIXTURE_CHILD_PARENT_1_CLOSED_AT = "2026-02-02T09:00:00Z";
export const FIXTURE_CHILD_PARENT_1_CLOSE_REASON = "e2e closed fixture";

export const FIXTURE_CHILD_PARENT_2_ID = "bsm-e2e-child-parent-2";
export const FIXTURE_CHILD_PARENT_2_TITLE =
  "Hierarchy P1 in-progress newer child";
export const FIXTURE_CHILD_PARENT_2_PRIORITY = "1";
export const FIXTURE_CHILD_PARENT_2_CREATED = "2026-01-02T09:00:00Z";
export const FIXTURE_CHILD_PARENT_2_IN_PROGRESS_AT = "2026-02-01T09:00:00Z";

export const FIXTURE_CHILD_PARENT_3_ID = "bsm-e2e-child-parent-3";
export const FIXTURE_CHILD_PARENT_3_TITLE = "Hierarchy P3 open older child";
export const FIXTURE_CHILD_PARENT_3_PRIORITY = "3";
export const FIXTURE_CHILD_PARENT_3_CREATED = "2025-11-15T09:00:00Z";

export const FIXTURE_CHILD_LONELY_ID = "bsm-e2e-child-lonely";
export const FIXTURE_CHILD_LONELY_TITLE =
  "Hierarchy no-children lonely fixture";
export const FIXTURE_CHILD_LONELY_PRIORITY = "2";
export const FIXTURE_CHILD_LONELY_CREATED = "2026-01-05T09:00:00Z";
/**
 * Unique description token the no-children Issue carries. The desktop
 * navigation test searches `Ready` for this token so the active
 * Ready/search result is a deterministic non-empty list that
 * excludes the closed child, which is what the Click + view/search
 * persistence proof relies on.
 */
export const FIXTURE_CHILD_LONELY_TOKEN = "nd7-child-lonely-needle";
/**
 * Full description for the no-children Issue: it contains the token
 * (so a search for the token matches) plus a short human-readable
 * suffix so the description is not just the bare token.
 */
export const FIXTURE_CHILD_LONELY_DESCRIPTION = `${FIXTURE_CHILD_LONELY_TOKEN} — only this Issue matches this token`;
/**
 * Secondary search token used to drive the Issue List View to a
 * deterministic empty state while Issue Detail still holds the
 * selected child. Defined as a constant so the spec, the harness,
 * and any future failure log all reference the same string.
 */
export const FIXTURE_CHILD_NO_MATCH_TOKEN = "xyz-no-match-needle-7c2";

/**
 * Strongly-typed child Issues bag exposed by
 * `createChildIssuesWorkspace()`. The desktop spec reads the
 * structured `id` / `parent` / `priority` / `created` / `status`
 * fields from the typed `TauRPC__switch_workspace` response and
 * uses this bag for the visible-name parts of every selector: the
 * five explicit IDs, the five titles, and the three Child Issue
 * humanised status labels. The harness and any future spec that
 * inspects the typed contract can read this bag directly from the
 * returned `BeadworkWorkspace.hierarchy`; the current
 * spec asserts the same names through the exported constants so
 * the spec stays a pure WebDriver consumer of the typed RCP
 * response.
 *
 * The bag is separate from the existing `BeadworkWorkspace.issue`
 * shape so the empty-fixture contract used by the success /
 * atomic-switch / restoration suites is unchanged.
 */
export interface ChildIssuesFixture {
  readonly child1ClosedOlderId: string;
  readonly child1ClosedOlderStatus: "Closed";
  readonly child1ClosedOlderTitle: string;
  readonly child2InProgressNewerId: string;
  readonly child2InProgressNewerStatus: "In Progress";
  readonly child2InProgressNewerTitle: string;
  readonly child3OpenOlderId: string;
  readonly child3OpenOlderStatus: "Open";
  readonly child3OpenOlderTitle: string;
  readonly lonelyId: string;
  readonly lonelyTitle: string;
  readonly lonelyToken: string;
  readonly parentId: string;
  readonly parentTitle: string;
}

/**
 * A dedicated, deterministic Beadwork workspace for the Child Issues
 * desktop acceptance scenario. Contains:
 *
 *   1. one closed parent (`bsm-e2e-child-parent`) at P2,
 *   2. one older P1 child later closed (`bsm-e2e-child-parent-1`),
 *   3. one newer P1 child moved to `in_progress`
 *      (`bsm-e2e-child-parent-2`),
 *   4. one older P3 child still open (`bsm-e2e-child-parent-3`),
 *   5. one open root Issue with no children and a unique search
 *      token (`bsm-e2e-child-lonely`).
 *
 * The expected Child Issues order under the production comparator
 * (priority ascending, then `created` ascending) is:
 *
 *   1. `bsm-e2e-child-parent-1` (Closed, older P1)
 *   2. `bsm-e2e-child-parent-2` (In Progress, newer P1)
 *   3. `bsm-e2e-child-parent-3` (Open, older P3)
 *
 * The visible ID/status/title order inside each Child Issue button is
 * `id → status badge → title` and the accessible name is
 * `<id>: <title>. <status>`. The desktop spec asserts both without
 * reaching for a `data-issue-id` hook.
 */
export const createChildIssuesWorkspace = (): BeadworkWorkspace & {
  hierarchy: ChildIssuesFixture;
} => {
  const workspacePath = mkdtempSync(
    path.join(tmpdir(), "beadsmith-e2e-child-issues-")
  );
  console.log(
    `[e2e:fixture] creating Child Issues Beadwork workspace at ${workspacePath}`
  );
  initGitBeadworkRepo(workspacePath);

  const parentId = createTaskIssue({
    clock: FIXTURE_CHILD_PARENT_CREATED,
    explicitId: FIXTURE_CHILD_PARENT_ID,
    priority: FIXTURE_CHILD_PARENT_PRIORITY,
    title: FIXTURE_CHILD_PARENT_TITLE,
    workspacePath,
  });
  const child1Id = createTaskIssue({
    clock: FIXTURE_CHILD_PARENT_1_CREATED,
    explicitId: FIXTURE_CHILD_PARENT_1_ID,
    parent: FIXTURE_CHILD_PARENT_ID,
    priority: FIXTURE_CHILD_PARENT_1_PRIORITY,
    title: FIXTURE_CHILD_PARENT_1_TITLE,
    workspacePath,
  });
  const child2Id = createTaskIssue({
    clock: FIXTURE_CHILD_PARENT_2_CREATED,
    explicitId: FIXTURE_CHILD_PARENT_2_ID,
    parent: FIXTURE_CHILD_PARENT_ID,
    priority: FIXTURE_CHILD_PARENT_2_PRIORITY,
    title: FIXTURE_CHILD_PARENT_2_TITLE,
    workspacePath,
  });
  const child3Id = createTaskIssue({
    clock: FIXTURE_CHILD_PARENT_3_CREATED,
    explicitId: FIXTURE_CHILD_PARENT_3_ID,
    parent: FIXTURE_CHILD_PARENT_ID,
    priority: FIXTURE_CHILD_PARENT_3_PRIORITY,
    title: FIXTURE_CHILD_PARENT_3_TITLE,
    workspacePath,
  });
  const lonelyId = createTaskIssue({
    clock: FIXTURE_CHILD_LONELY_CREATED,
    description: FIXTURE_CHILD_LONELY_DESCRIPTION,
    explicitId: FIXTURE_CHILD_LONELY_ID,
    priority: FIXTURE_CHILD_LONELY_PRIORITY,
    title: FIXTURE_CHILD_LONELY_TITLE,
    workspacePath,
  });

  console.log(
    `[e2e:fixture] child issues workspace created: parent=${parentId}, child1=${child1Id}, child2=${child2Id}, child3=${child3Id}, lonely=${lonelyId}`
  );

  runBw(["update", child2Id, "--status", "in_progress"], workspacePath, {
    BW_CLOCK: FIXTURE_CHILD_PARENT_2_IN_PROGRESS_AT,
  });
  runBw(
    ["close", child1Id, "--reason", FIXTURE_CHILD_PARENT_1_CLOSE_REASON],
    workspacePath,
    { BW_CLOCK: FIXTURE_CHILD_PARENT_1_CLOSED_AT }
  );
  runBw(
    ["close", parentId, "--reason", FIXTURE_CHILD_PARENT_CLOSE_REASON],
    workspacePath,
    { BW_CLOCK: FIXTURE_CHILD_PARENT_CLOSED_AT }
  );

  console.log(
    `[e2e:fixture] child issues workspace ready at ${workspacePath}: parent=${parentId} (closed at ${FIXTURE_CHILD_PARENT_CLOSED_AT}), child1=${child1Id} (closed at ${FIXTURE_CHILD_PARENT_1_CLOSED_AT}), child2=${child2Id} (in_progress at ${FIXTURE_CHILD_PARENT_2_IN_PROGRESS_AT}), child3=${child3Id} (open), lonely=${lonelyId}`
  );

  return {
    hierarchy: {
      child1ClosedOlderId: child1Id,
      child1ClosedOlderStatus: "Closed",
      child1ClosedOlderTitle: FIXTURE_CHILD_PARENT_1_TITLE,
      child2InProgressNewerId: child2Id,
      child2InProgressNewerStatus: "In Progress",
      child2InProgressNewerTitle: FIXTURE_CHILD_PARENT_2_TITLE,
      child3OpenOlderId: child3Id,
      child3OpenOlderStatus: "Open",
      child3OpenOlderTitle: FIXTURE_CHILD_PARENT_3_TITLE,
      lonelyId,
      lonelyTitle: FIXTURE_CHILD_LONELY_TITLE,
      lonelyToken: FIXTURE_CHILD_LONELY_TOKEN,
      parentId,
      parentTitle: FIXTURE_CHILD_PARENT_TITLE,
    },
    path: workspacePath,
  };
};

/**
 * Two distinct titles created by the external-mutation proof in
 * `issue-list.success.spec.ts`. The Ready blocker establishes a new
 * Ready Issue; the Blocked target, added with `bw dep add`, joins the
 * Blocked view through the new dependency. Both are appended to the
 * already-selected disposable workspace so the proof is observable in
 * the running Beadsmith UI without a manual refresh.
 */
export const FIXTURE_EXTERNAL_READY_BLOCKER_TITLE =
  "External ready blocker for refresh proof";
export const FIXTURE_EXTERNAL_BLOCKED_TARGET_TITLE =
  "External blocked target for refresh proof";

export interface ExternalMutationOutcome {
  readyBlockerId: string;
  blockedTargetId: string;
  readyBlockerTitle: string;
  blockedTargetTitle: string;
}

/**
 * Apply real external `bw` mutations to an already-selected workspace
 * so the Issue Explorer refresh proof can run from the WebDriver
 * process. Creates one Ready Issue (the blocker) and one target Issue
 * blocked by it; both appear under the same `bw`-authored ref so the
 * `refs/heads/beadwork` probe observes two rapid SHA moves inside a
 * single 2-second window.
 */
export const applyExternalMutation = (
  workspacePath: string
): ExternalMutationOutcome => {
  console.log(`[e2e:fixture] applying external mutation to ${workspacePath}`);
  const readyBlockerId = createTaskIssue({
    priority: "2",
    title: FIXTURE_EXTERNAL_READY_BLOCKER_TITLE,
    workspacePath,
  });
  const blockedTargetId = createTaskIssue({
    priority: "2",
    title: FIXTURE_EXTERNAL_BLOCKED_TARGET_TITLE,
    workspacePath,
  });
  runBw(
    ["dep", "add", readyBlockerId, "blocks", blockedTargetId],
    workspacePath
  );
  console.log(
    `[e2e:fixture] external mutation applied: ready=${readyBlockerId}, blocked=${blockedTargetId}`
  );
  return {
    blockedTargetId,
    blockedTargetTitle: FIXTURE_EXTERNAL_BLOCKED_TARGET_TITLE,
    readyBlockerId,
    readyBlockerTitle: FIXTURE_EXTERNAL_READY_BLOCKER_TITLE,
  };
};

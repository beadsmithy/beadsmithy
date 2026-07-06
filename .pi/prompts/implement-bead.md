---
description: V3 - Implement a bead end-to-end — worktree, scout → plan → implement → review, one fix round, commit, open PR, close bead.
---

Implement Beadwork issue `$1` end-to-end.

## Inputs you should know

- `AGENTS.md` is in context. It tells you to run `bw prime` — do so before anything else.
- Project agents exist at `.pi/agents/`: `planner`, `worker`, `reviewer`. Builtins: `scout`.
- `bw` commands support `--json`. The `bw` work tracker is git-native and works in any worktree.
- Subagent tool shape: `subagent({ chain: [...steps], async: true })`, then `wait({ all: true })` (or `wait({ id })`). Per-step fields you'll use: `agent`, `task`, `model`, `context`, `output`, `outputMode`, `skills`, `tools`, `reads` (rarely needed — agents have `defaultReads` set).
- The planner can't run `bw`, `git`, or tests — that's your job. Never put a command-running task on the planner, it does not have a `bash` tool.
- Async chain recovery: if a subagent pauses for `contact_supervisor`, reply to the request and then `wait()` rather than polling with `status` / `resume`. `resume` can intermittently fail with "intercom target is not registered" or "No running async run with an interrupt-capable pid was found"; `wait()` is the safe fallback and the right thing to do when you have nothing useful to add.
- Subagent `output:` files land under `.pi-subagents/artifacts/outputs/<id>/<output>`, NOT at the worktree root. Both `subagent({ chain: [...] })` and a single `subagent({...})` return an id on launch — for a chain it's the chain id, for a single subagent it's the async run id. The artifact directory uses that id either way.

## Phase 1: Worktree

Branch name: `<issue-id>/<title-slug>` — kebab-case the title, drop filler words, cap at ~40 chars. Example: `bsm-7en.1/add-typed-event-bus`.

```bash
wt switch --create <branch-name> --no-cd --yes --format json
```

If the worktree already exists (resumed run): run `wt switch <branch-name>` to retrieve the worktree path.

Now run `cd <path>` to switch the current working directory to the worktree directory.

If you forget and a subagent runs in the original repo, its artifacts end up under the wrong tree and the next step can't find them.

## Phase 2: Claim and read the `bw` issue

```bash
bw start "$1" --json
```

If `bw start` refuses (already in_progress, blocked, etc.), fall back to `bw show "$1" --json` to read current state and decide whether to proceed. Keep the JSON in context either way — the reviewer uses the description as the spec source.

## Phase 3: Launch the chain

Launch via `subagent({ chain: [steps...], async: true })`. All steps: `context: "fresh"`, `outputMode: "file-only"`. The `output:` value names the artifact; the subagent framework writes it under `.pi-subagents/artifacts/outputs/<chain-id>/<output>`. Capture the chain id from the launch result and substitute the full path into the next step's `task` text — never reference a worktree-root path. (For the single-subagent launches later in this template — the reviewer and the fix worker — the launch also returns an id, but it's a run id rather than a chain id. Same artifact-directory convention.)

Chain steps in order:

1. **scout** — `agent: "scout"`, `model: "MiniMax-M3:low"`. Task: "Read `bw show $1 --json` and map the affected area of the codebase: entry points, key types/functions, data flow, files likely to change, constraints/risks. Write findings to `context.md` using the scout output format. Ensure to include the full output of `bw show $1 --json` at the top of `context.md` with 'Issue description for "$1" (via `bw`)' as heading to indicate what it is and how it was obtained."

2. **planner** — `agent: "planner"`, `model: "openai-codex/gpt-5.5:high"`. Task: "You can find the issue description in the `context.md` under the heading 'Issue description for "$1" (via `bw`)'. Produce a concrete implementation plan with numbered tasks, files to modify, new files, dependencies, risks.."

3. **worker** — `agent: "worker"`, `model: "MiniMax-M3:high"`. Task: "Implement the plan for issue `$1`. Use TDD at pre-agreed seams. Validate with `pnpm run check`, `pnpm exec tsc --noEmit`, and `pnpm test`. Report changed files, validation commands run with exit codes, what was left undone, and any open risks. Do not silently make unapproved product/architecture decisions — escalate via `contact_supervisor` if blocked. **Do not edit files unrelated to the issue** — pre-existing repo lint/format failures are out of scope; surface them in the output, don't fix them."

Then `wait({ all: true })` (or `wait({ id: <chain-id> })`) before continuing.

**The chain stops at the worker.** The reviewer is intentionally not part of it — the worker doesn't commit, and you commit between worker and reviewer so the reviewer can review an actual committed diff instead of a worktree diff. Launch the reviewer as a separate subagent call in the "After the implementation chain completes" subsection below.

### After the implementation chain completes

1. Skim `<chain-id>/worker-handoff.md` for the worker's acceptance report and any open risks. If the worker escalated a blocker via `contact_supervisor` that you haven't handled, address it before committing (or note it for the user).
2. Post the plan as a issue comment. The plan lives at `.pi-subagents/artifacts/outputs/<chain-id>/plan.md`; the cleanest path is `bw comment $1 < <chain-id>/plan.md` if the planner wrote the comment body directly, or extract a "issue comment to add" section if the planner wrapped the plan in scaffolding.
3. **Commit the worker's changes.** Load the `commit-message-storyteller` skill. Verify the staged set matches the issue's intent with `git status --short` before committing. Skip generated noise (`.pi-subagents/artifacts/`, `.scratch/`, build output, etc.) and lockfile-only changes unrelated to the issue. If the worker has uncommitted edits in files outside the issue's scope, `git restore` them — they should never reach this commit either. Capture the resulting commit SHA — the reviewer will need it as the fixed point.
4. **Launch the reviewer as a separate subagent** so it reviews the committed work, not the worktree:

   ```js
   subagent({
     agent: "reviewer",
     model: "openai-codex/gpt-5.5:high",
     cwd: "<worktree-path>",
     async: true,
   });
   ```

   Task: "Apply the `review` skill to the committed diff between `main` and `HEAD` on this worktree. Pin the fixed point at `<commit-sha>` from step 3. Diff command: `git diff <commit-sha>~1..HEAD` (or `git diff $(git merge-base main HEAD)..HEAD` if you prefer merge-base). Commit list: `git log $(git merge-base main HEAD)..HEAD --oneline`. Spec source: `bw show $1 --json` plus the plan comment on the issue (fetch via `bw show $1 --only comments`). Standards sources: `AGENTS.md`, `oxlint.config.ts`, `oxfmt.config.ts`, and any `CONTRIBUTING.md` / `CODING_STANDARDS.md` if present. Run the two parallel axes (Standards + Spec) per the skill, then write the aggregated report to `review.md`. The work is already committed; do not amend, do not push."

5. Capture the reviewer's async id from the launch result and `wait({ id: <reviewer-id> })`. The reviewer writes to `.pi-subagents/artifacts/outputs/<reviewer-id>/review.md` — pass that path to step 4.

## Phase 4: Commit

Load the `commit-message-storyteller` skill. Stage the relevant files. Skip generated noise (`.pi-subagents/artifacts/`, `.scratch/`, build output, etc.) and lockfile-only changes unrelated to your work. Verify the staged set matches the issue's intent with `git status --short` before committing.

If you have uncommitted edits in files outside the issue's scope (from a manual fix during step 5), `git restore` them — they should never reach the commit.

## Phase 5: Review and (maybe) fix

Read the review output from the `reviewer` agent (the path was returned by the reviewer agent). If both axes report no blockers and only optional/defer items, skip the fix step and go to Phase 5. Distinguish "no blockers" from "no findings" — a clean review is one that explicitly enumerated its checks.

Otherwise launch **one** fix worker (cap is 1 round — do not re-review):

- `agent: "worker"`, `model: "MiniMax-M3:high"`, `output: "fix-handoff.md"`.
- Task: "Read `<abs-path-to-context.md>` (the scout output), `<abs-path-to-plan.md>` (the planner output), and `<abs-path-to-review.md>` (the reviewer output from step 3). Apply the accepted findings — every Standards violation and every Spec miss/creep/wrong-implementation. Skip items marked optional/defer unless they're trivial. Use TDD when changing behavior. **Do not address anything outside the review's accepted set** — pre-existing repo findings unrelated to this issue are out of scope even if `pnpm run check` complains about them. Validate with `pnpm run check` (or `pnpm dlx ultracite check`), typecheck, and tests. Report changed files, validation commands with exit codes, and what was deliberately left undone."

Launch with `async: true`, then `wait()`. No second review round.

## Phase 6: Commit review fixes

Load the `commit-message-storyteller` skill. Stage the relevant files. Verify the staged set matches the issue's intent with `git status --short` before committing. Create a separate commit, never amend the implementation commit.

## Phase 7: Pre-PR checks

Read `package.json` scripts and run what's relevant. At minimum the lint/typecheck/test trio using the project's actual commands (typically `pnpm run check`, `pnpm test`, and the typecheck script). For Tauri projects also run `cargo check` in `src-tauri/` if changes touched Rust.

The checks scan the whole repo. **Pre-existing failures unrelated to this issue (in files this issue didn't modify) are not blockers** — note them in the summary and continue. Block only on findings inside the files this issue changed. If a issue-introduced finding blocks the gate, fix it via a follow-up fix worker (no second review round). Do not bypass with `--no-verify` or similar.

If you find yourself about to "just fix it inline" for an unrelated failure, stop and ask: is this in a file the issue changed? If no, leave it alone and mention it in the summary.

## Phase 8: Open PR

```bash
gh pr create --base main --title "<issue-id>: <short summary>" --body-file <body-file>
```

Base branch is `main` — if your worktree was branched off something else, adjust. 

The pull request body should:

- Summarize the issue that was implemented.
- Point out the very, most important changes
- A simple walkthrough of the implementation
- Summary of test cases added

## Phase 9: Close the issue

```bash
bw close "$1"
bw sync
```

Only after `gh pr create` succeeded. If PR creation failed, stop and report — do not close the issue. `bw sync` can take several minutes on slow remotes; expect up to ~5 minutes. SSH signing warnings from `git push` are non-fatal when the push URL is still printed afterward — don't treat them as failures.

## Resume (lightweight)

If `$1` is already in_progress, the worktree exists, and `.pi-subagents/artifacts/outputs/*/context.md` / `plan.md` / `worker-handoff.md` / `review.md` (any id) are present: read the most recent of each, skip completed steps, and resume from the next one. If anything looks ambiguous, fall back to running from scratch in a fresh worktree — don't try to recover partial states.

## Output

Summarize at the end:

- Beadwork issue ID and final state
- worktree path and branch
- changed files (high level)
- pre-PR check results (commands + exit codes)
- PR URL
- any open risks or unaddressed review items

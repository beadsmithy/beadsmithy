---
description: Implement a bead end-to-end — worktree, scout → plan → implement → review, one fix round, commit, open PR, close bead.
---

Implement bead `$1` end-to-end. Drive a scout → planner → worker → reviewer chain via subagents, fix review feedback at most once, run pre-PR checks, commit, open a PR, and close the bead.

Heavy template — only use for non-trivial beads. One-liners should go through normal flow.

## Inputs you should know

- `AGENTS.md` is in context. It tells you to run `bw prime` — do so before anything else.
- Project agents exist at `.pi/agents/`: `planner` and `worker`. Builtins: `scout`, `delegate`, `reviewer`.
- `bw` commands support `--json`. The `bw` work tracker is git-native and works in any worktree.
- Subagent tool shape: `subagent({ chain: [...steps], async: true })`, then `wait({ all: true })` (or `wait({ id })`). Per-step fields you'll use: `agent`, `task`, `model`, `context`, `output`, `outputMode`, `skills`, `tools`, `reads` (rarely needed — agents have `defaultReads` set).
- Default contexts: `scout`, `planner`, `worker`, and `reviewer` have `inheritProjectContext: true` and `inheritSkills: false`. The `delegate` builtin is the vehicle for step 4 — it inherits the parent model and carries no default reads; the actual review work happens via the `review` skill that step 4 loads. `context: "fresh"` overrides both. For the fix worker you want `context: "fork"` so it inherits the bead context you're holding.
- Subagents do not have a `bash` tool by default. The planner can't run `bw`, `git`, or tests — that's your job. Never put a command-running task on the planner; describe what the plan should contain and let the next step / you execute it.
- Async chain recovery: if a subagent pauses for `contact_supervisor`, reply to the request and then `wait()` rather than polling with `status` / `resume`. `resume` can intermittently fail with "intercom target is not registered" or "No running async run with an interrupt-capable pid was found"; `wait()` is the safe fallback and the right thing to do when you have nothing useful to add.
- Subagent `output:` files land under `.pi-subagents/artifacts/outputs/<id>/<output>`, NOT at the worktree root. Both `subagent({ chain: [...] })` and a single `subagent({...})` return an id on launch — for a chain it's the chain id, for a single subagent it's the async run id. The artifact directory uses that id either way. Capture the id from the launch result and substitute the full path into the next step's `task` text. The `.pi-subagents/` directory must be in `.gitignore`; if it isn't, add it before launching (and mention this to the user in the final summary).
- Worktree-root paths in a subagent's `task` text become invisible commitments. Don't tell a subagent to "write to `context.md`" without telling it the absolute path; otherwise it will either (a) write to the worktree root and dirty the git diff or (b) fail to write where the next step looks.

## 1. Worktree

Branch name: `<bead-id>/<title-slug>` — kebab-case the title, drop filler words, cap at ~40 chars. Example: `bsm-7en.1/add-typed-event-bus`.

```bash
wt switch --create <branch-name> --yes
```

`--yes` is required in non-interactive sessions (otherwise `wt` refuses to run pre-start / post-start hooks without a TTY). If the worktree already exists (resumed run), `wt switch <branch-name>` to enter it.

**Run the rest of the session from inside the worktree.** This template assumes the worktree is the working directory for every subsequent step — the orchestrator's `bash` calls, the subagents, and the final commit/PR. Capture the worktree path from `wt switch`'s output and:

- Prefix every `bash` command with `cd <worktree-path> && ...` (or use absolute paths inside the worktree).
- Pass `cwd: "<worktree-path>"` on every `subagent({ ... })` call so scout/planner/worker/reviewer/fix all share the same filesystem root and write artifacts under the same `.pi-subagents/artifacts/outputs/<id>/`.

If you forget and a subagent runs in the original repo, its artifacts end up under the wrong tree and the next step can't find them.

## 2. Claim and read the bead

```bash
bw start "$1" --json
```

If `bw start` refuses (already in_progress, blocked, etc.), fall back to `bw show "$1" --json` to read current state and decide whether to proceed. Keep the JSON in context either way — the reviewer uses the description as the spec source.

For a resumed run, fetch prior plan via `bw show "$1" --only comments`.

## 3. Launch the chain

Launch via `subagent({ chain: [steps...], async: true })`. All steps: `context: "fresh"`, `outputMode: "file-only"`. The `output:` value names the artifact; the subagent framework writes it under `.pi-subagents/artifacts/outputs/<chain-id>/<output>`. Capture the chain id from the launch result and substitute the full path into the next step's `task` text — never reference a worktree-root path. (For the single-subagent launches later in this template — the reviewer and the fix worker — the launch also returns an id, but it's a run id rather than a chain id. Same artifact-directory convention.)

Confirm `.pi-subagents/` is in `.gitignore` before launching. If it isn't, add it (the directory is created by the subagent framework; the fix is one line in `.gitignore`).

Steps in order:

1. **scout** — `agent: "scout"`, `model: "MiniMax-M3:low"`, `output: "context.md"`. Task: "Read `bw show $1 --json` and map the affected area of the codebase: entry points, key types/functions, data flow, files likely to change, constraints/risks. Write findings to `context.md` using the scout output format. Ensure to include the full output of `bw show $1 --json` at the top of `context.md` with 'Bead description for "$1" (via `bw`)' as heading to indicate what it is and how it was obtained."

2. **planner** — `agent: "planner"`, `model: "openai-codex/gpt-5.5:high"`, `output: "plan.md"`. Task: "You can find the bead description in the `context.md` under the heading 'Bead description for "$1" (via `bw`)'. Produce a concrete implementation plan with numbered tasks, files to modify, new files, dependencies, risks. Write the plan to `plan.md`."

3. **worker** — `agent: "worker"`, `model: "MiniMax-M3:high"`, `skills: ["tdd"]`, `output: "worker-handoff.md"`. Task: "Implement the plan for bead `$1`. Use TDD at pre-agreed seams. Validate with `pnpm run check`, `pnpm exec tsc --noEmit`, and `pnpm test`. Report changed files, validation commands run with exit codes, what was left undone, and any open risks. Do not silently make unapproved product/architecture decisions — escalate via `contact_supervisor` if blocked. **Do not edit files unrelated to the bead** — pre-existing repo lint/format failures are out of scope; surface them in the handoff, don't fix them."



Then `wait({ all: true })` (or `wait({ id: <chain-id> })`) before continuing.

**The chain stops at the worker.** The reviewer is intentionally not part of it — the worker doesn't commit, and you commit between worker and reviewer so the reviewer can review an actual committed diff instead of a worktree diff. Launch the reviewer as a separate subagent call in the "After the implementation chain completes" subsection below.

### After the implementation chain completes

1. Skim `<chain-id>/worker-handoff.md` for the worker's acceptance report and any open risks. If the worker escalated a blocker via `contact_supervisor` that you haven't handled, address it before committing (or note it for the user).
2. Post the plan as a bead comment. The plan lives at `.pi-subagents/artifacts/outputs/<chain-id>/plan.md`; the cleanest path is `bw comment $1 < <chain-id>/plan.md` if the planner wrote the comment body directly, or extract a "Bead comment to add" section if the planner wrapped the plan in scaffolding.
3. **Commit the worker's changes.** Load the `commit-message-storyteller` skill. Verify the staged set matches the bead's intent with `git status --short` before committing. Skip generated noise (`.pi-subagents/artifacts/`, `.scratch/`, build output, etc.) and lockfile-only changes unrelated to the bead. If the worker has uncommitted edits in files outside the bead's scope, `git restore` them — they should never reach this commit either. Capture the resulting commit SHA — the reviewer will need it as the fixed point.
4. **Launch the reviewer as a separate subagent** so it reviews the committed work, not the worktree:

   ```js
   subagent({
     agent: "delegate",
     tools: "read, grep, find, ls, bash, edit, write, contact_supervisor, subagent",
     skills: ["review"],
     model: "openai-codex/gpt-5.5:high",
     context: "fresh",
     output: "review.md",
     cwd: "<worktree-path>",
     async: true,
   })
   ```

   Task: "Apply the `review` skill to the committed diff between `main` and `HEAD` on this worktree. Pin the fixed point at `<commit-sha>` from step 3. Diff command: `git diff <commit-sha>~1..HEAD` (or `git diff $(git merge-base main HEAD)..HEAD` if you prefer merge-base). Commit list: `git log $(git merge-base main HEAD)..HEAD --oneline`. Spec source: `bw show $1 --json` plus the plan comment on the bead (fetch via `bw show $1 --only comments`). Standards sources: `AGENTS.md`, `oxlint.config.ts`, `oxfmt.config.ts`, and any `CONTRIBUTING.md` / `CODING_STANDARDS.md` if present. Run the two parallel axes (Standards + Spec) per the skill, then write the aggregated report to `review.md`. The work is already committed; do not amend, do not push."

5. Capture the reviewer's async id from the launch result and `wait({ id: <reviewer-id> })`. The reviewer writes to `.pi-subagents/artifacts/outputs/<reviewer-id>/review.md` — pass that path to step 4.

## 4. Review and (maybe) fix

Read `.pi-subagents/artifacts/outputs/<reviewer-id>/review.md` (the path returned by the reviewer launch in step 3's "After the implementation chain completes" subsection). If both axes report no blockers and only optional/defer items, skip the fix step and go to step 5. Distinguish "no blockers" from "no findings" — a clean review is one that explicitly enumerated its checks.

Otherwise launch **one** fix worker (cap is 1 round — do not re-review):

- `agent: "worker"`, `model: "MiniMax-M3:high"`, `skills: ["tdd"]`, `context: "fork"`, `output: "fix-handoff.md"`.
- Task: "Read `<abs-path-to-context.md>` (the scout output), `<abs-path-to-plan.md>` (the planner output), and `<abs-path-to-review.md>` (the reviewer output from step 3). The bead's work is already committed; the fix worker should `git restore` any worktree drift and amend the existing commit only when changes are tightly coupled to it, otherwise stage and prepare new commits. Apply the accepted findings — every Standards violation and every Spec miss/creep/wrong-implementation. Skip items marked optional/defer unless they're trivial. Use TDD when changing behavior. **Do not address anything outside the review's accepted set** — pre-existing repo findings unrelated to this bead are out of scope even if `pnpm run check` complains about them. Validate with `pnpm run check` (or `pnpm dlx ultracite check`), typecheck, and tests. Report changed files, validation commands with exit codes, and what was deliberately left undone."

Launch with `async: true`, then `wait()`. No second review round.

## 5. Pre-PR checks

Read `package.json` scripts and run what's relevant. At minimum the lint/typecheck/test trio using the project's actual commands (typically `pnpm run check`, `pnpm test`, and the typecheck script). For Tauri projects also run `cargo check` in `src-tauri/` if changes touched Rust.

The checks scan the whole repo. **Pre-existing failures unrelated to this bead (in files this bead didn't modify) are not blockers** — note them in the summary and continue. Block only on findings inside the files this bead changed. If a bead-introduced finding blocks the gate, fix it via a follow-up fix worker (no second review round). Do not bypass with `--no-verify` or similar.

If you find yourself about to "just fix it inline" for an unrelated failure, stop and ask: is this in a file the bead changed? If no, leave it alone and mention it in the summary.

## 6. Commit

Load the `commit-message-storyteller` skill. Stage the relevant files. Skip generated noise (`.pi-subagents/artifacts/`, `.scratch/`, build output, etc.) and lockfile-only changes unrelated to your work. Verify the staged set matches the bead's intent with `git status --short` before committing.

If you have uncommitted edits in files outside the bead's scope (from a manual fix during step 5), `git restore` them — they should never reach the commit.

## 7. Open PR

```bash
gh pr create --base main --title "<bead-id>: <short summary>" --body-file <body-file>
```

Base branch is `main` — if your worktree was branched off something else, adjust. Body should be a normal commit-message-style description. Do **not** mention the bead outside the title.

## 8. Close the bead

```bash
bw close "$1"
bw sync
```

Only after `gh pr create` succeeded. If PR creation failed, stop and report — do not close the bead. `bw sync` can take several minutes on slow remotes; expect up to ~5 minutes. SSH signing warnings from `git push` are non-fatal when the push URL is still printed afterward — don't treat them as failures.

## Resume (lightweight)

If `$1` is already in_progress, the worktree exists, and `.pi-subagents/artifacts/outputs/*/context.md` / `plan.md` / `worker-handoff.md` / `review.md` (any id) are present: read the most recent of each, skip completed steps, and resume from the next one. If anything looks ambiguous, fall back to running from scratch in a fresh worktree — don't try to recover partial states.

## Output

Summarize at the end:

- bead ID and final state
- worktree path and branch
- changed files (high level)
- pre-PR check results (commands + exit codes)
- PR URL
- any open risks or unaddressed review items

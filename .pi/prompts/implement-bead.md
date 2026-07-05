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
- Default contexts: scout/planner/worker/delegate all have `inheritProjectContext: true` and `inheritSkills: false`. `context: "fresh"` overrides both. For the fix worker you want `context: "fork"` so it inherits the bead context you're holding.

## 1. Worktree

Branch name: `<bead-id>/<title-slug>` — kebab-case the title, drop filler words, cap at ~40 chars. Example: `bsm-7en.1/add-typed-event-bus`.

```bash
wt switch --create <branch-name>
```

If the worktree already exists (resumed run), `wt switch <branch-name>` to enter it.

## 2. Claim and read the bead

```bash
bw start "$1" --json
```

If `bw start` refuses (already in_progress, blocked, etc.), fall back to `bw show "$1" --json` to read current state and decide whether to proceed. Keep the JSON in context either way — the planner writes the plan as a comment on this bead, and the reviewer uses the description as the spec source.

For a resumed run, fetch prior plan via `bw show "$1" --only comments`.

## 3. Launch the chain

Launch via `subagent({ chain: [steps...], async: true })`. All steps: `context: "fresh"`, `outputMode: "file-only"`. Do not pass `reads` — `defaultReads` on each agent covers the file handoff (`context.md`, `plan.md`).

Steps in order:

1. **scout** — `agent: "scout"`, `model: "MiniMax-M3:low"`, `output: "context.md"`. Task: "Read `bw show $1 --json` and map the affected area of the codebase: entry points, key types/functions, data flow, files likely to change, constraints/risks. Write findings to `context.md` using the scout output format."

2. **planner** — `agent: "planner"`, `model: "openai-codex/gpt-5.5:high"`, `output: "plan.md"`. Task: "Read `context.md` and `bw show $1 --json`. Produce a concrete implementation plan with numbered tasks, files to modify, new files, dependencies, risks. Add the complete plan as a comment on bead `$1` via `bw comment $1 "<plan>"`. Also write the plan to `plan.md`."

3. **worker** — `agent: "worker"`, `model: "MiniMax-M3:high"`, `skills: ["tdd"]`, `output: "worker-handoff.md"`. Task: "Read `context.md` and `plan.md`, then implement the plan for bead `$1`. Use TDD at pre-agreed seams. Validate with `pnpm dlx ultracite check`, the project's typecheck command, and the relevant test files. Report changed files, validation commands run with exit codes, what was left undone, and any open risks. Do not silently make unapproved product/architecture decisions — escalate via `contact_supervisor` if blocked."

4. **reviewer** — `agent: "delegate"` with `tools: "read, grep, find, ls, bash, edit, write, contact_supervisor, subagent"` (adds `subagent` so the review skill can fan out its parallel axes), `skills: ["review"]`, `model: "openai-codex/gpt-5.5:high"`, `context: "fresh"`, `output: "review.md"`. Task: "Apply the `review` skill to the diff between `main` and `HEAD` on this worktree. Pin the fixed point: `git merge-base main HEAD`. Diff command: `git diff $(git merge-base main HEAD)...HEAD`. Commit list: `git log $(git merge-base main HEAD)..HEAD --oneline`. Spec source: `bw show $1 --json` plus the plan comment on the bead (fetch via `bw show $1 --only comments`). Standards sources: `AGENTS.md`, `oxlint.config.ts`, `oxfmt.config.ts`, and any `CONTRIBUTING.md` / `CODING_STANDARDS.md` if present. Run the two parallel axes (Standards + Spec) per the skill, then write the aggregated report to `review.md`."

Then `wait({ all: true })` (or `wait({ id: <chain-id> })`) before continuing. The chain's file-only outputs give you compact references — `read` each file before acting on it.

## 4. Review and (maybe) fix

Read `review.md`. If both axes report no blockers and only optional/defer items, skip the fix step and go to step 5.

Otherwise launch **one** fix worker (cap is 1 round — do not re-review):

- `agent: "worker"`, `model: "MiniMax-M3:high"`, `skills: ["tdd"]`, `context: "fork"`, `output: "fix-handoff.md"`.
- Task: "Read `context.md`, `plan.md`, and `review.md`. Apply the accepted findings — every Standards violation and every Spec miss/creep/wrong-implementation. Skip items marked optional/defer unless they're trivial. Use TDD when changing behavior. Do not address anything outside the review's accepted set. Validate with `pnpm dlx ultracite check`, typecheck, and tests. Report changed files, validation commands with exit codes, and what was deliberately left undone."

`async: true`, then `wait()`. No second review round.

## 5. Pre-PR checks

Read `package.json` scripts and run what's relevant. At minimum the lint/typecheck/test trio using the project's actual commands (likely `pnpm run` targets, or `pnpm dlx ultracite check` for lint/format). For Tauri projects also run `cargo check` in `src-tauri/` if changes touched Rust.

If any check fails, stop and report — do not push broken code. Do not bypass with `--no-verify` or similar.

## 6. Commit

Load the `commit-message-storyteller` skill. Stage the relevant files (skip generated noise, lockfile-only changes unrelated to your work) and commit.

## 7. Open PR

```bash
gh pr create --base main --title "<bead-id>: <short summary>" --body-file <body-file>
```

Base branch is `main` — if your worktree was branched off something else, adjust. Body should be a normal commit-message-style description. Do **not** mention the bead outside the title.

## 8. Close the bead

```bash
bw close "$1"
```

Only after `gh pr create` succeeded. If PR creation failed, stop and report — do not close the bead.

## Resume (lightweight)

If `$1` is already in_progress, the worktree exists, and `context.md` / `plan.md` / `worker-handoff.md` / `review.md` are present: read them, skip completed steps, and resume from the next one. If anything looks ambiguous, fall back to running from scratch in a fresh worktree — don't try to recover partial states.

## Output

Summarize at the end:
- bead ID and final state
- worktree path and branch
- changed files (high level)
- pre-PR check results (commands + exit codes)
- PR URL
- any open risks or unaddressed review items
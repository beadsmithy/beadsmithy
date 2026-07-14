---
description: V4 - Implement a Beadwork issue end-to-end. Composed step tasks, framework-managed artifact paths, one fix round, commit, open PR, close issue.
---

Implement Beadwork issue `$1` end-to-end.

## Inputs you should know

- `AGENTS.md` is in context. It tells you to run `bw prime` — do so before anything else.
- Project agents exist at `.pi/agents/`: `planner`, `worker`, `reviewer`. The `scout` builtin is also used.
- `bw` commands support `--json`. The `bw` issue tracker is git-native and works in any worktree.
- `subagent` tool shape: `subagent({ chain: [steps...], async: true })` then `wait()`. Per-step fields you may use: `agent`, `task`, `as`, `cwd`, `output`, `outputMode`, `reads`, `progress`, `skill`, `model`. `context`, `tools`, and `skills` (plural) are chain-top-level only — per-step values are rejected by the `ChainItem` schema with "must not have additional properties". `tools:` cannot be passed on the `subagent({...})` call at all; it lives on the agent's frontmatter and is set in the agent file, not at launch time.
- The framework writes `output:` artifacts to `.pi-subagents/artifacts/outputs/<id>/<output>`. For chain steps, the framework prepends `[Read from: <abs>]` and `[Write to: <abs>]` lines to each step's `task` at runtime, based on the step's `reads:` and prior step's `output:`. This mechanism means that you do not need to tell them to read files from previous chained agents.
- The planner has no `bash` tool and cannot run `bw`, `git`, or tests. You run those.
- Async chain recovery: if a subagent pauses for `contact_supervisor`, reply and then `wait()` rather than polling with `status` / `resume`. `resume` can intermittently fail with "intercom target is not registered" or "No running async run with an interrupt-capable pid was found"; `wait()` is the safe fallback.

## Phase 1: Worktree

Branch name: `<issue-id>/<title-slug>` — kebab-case the title, drop filler words, cap at ~40 chars.

**Must-do:**

- Create or resume the worktree via `wt switch --create <branch-name> --no-cd --yes --format json`.
- Capture the worktree path from the JSON response.
- `cd` into the worktree path. Every subsequent shell command and every `subagent({ ... })` call runs from that cwd.

If the worktree already exists (resumed run), `wt switch <branch-name>` returns the path; reuse it.

```bash
wt switch --create <branch-name --no-cd --yes --format json
cd /Users/tomas/projects/beadsmith.bsm-7en.3-render-safe-markdown-descriptions
```

If you skip the `cd`, subagents write artifacts under the wrong tree and the next step can't find them.

## Phase 2: Claim and read the issue

```bash
bw start "$1" --json
```

If `bw start` rejects (issue already in progress), check the `.pi-subagents/artifacts/outputs` directory for contents. If it's not empty, this is a resumed run. Run `bw show "$1" --json` to get the issue definition. Otherwise stop and raise the issue to the user.

## Phase 3: Launch the implementation chain

/run-chain implement-bead -- "$1"

## Phase 4: Commit the worker's changes

In this order:

1. **Post the plan as an issue comment.** `bw comment` takes the body as a positional argument; stdin redirection does not work.

   ```bash
   chain_id=<chain-id-from-launch-result>
   bw comment "$1" "$(cat .pi-subagents/artifacts/outputs/${chain_id}/plan.md)" --json
   ```

2. **Skim `<chain-id>/worker-handoff.md`** for the worker's acceptance report and any open risks. Address worker-escalated blockers before committing, or note them for the user.

3. **Commit the worker's changes.**
   - Load the `commit-message-storyteller` skill.
   - Commit the changes.
   - Capture the commit SHA — the reviewer will need it as the fixed point.

## Phase 5: Launch the reviewer

The reviewer is a separate single-agent run, not part of the implementation chain. It reviews the committed diff, not the worktree.

Reviewer task instruction to pass to subagent:
Review the committed change for Beadwork issue `$1`. Run `bw show $1 --json` to read the implemented issue. Run a diff of the branch (`git diff <commit-sha>~1..HEAD`). The implementation is already committed; do not amend, do not push.

```js
const reviewerRun = subagent({
  agent: "reviewer",
  skill: "review",
  model: "openai-codex/gpt-5.6-terra:high",
  cwd: "<worktree-path>",
  async: true,
  timeoutMs: 1800000,
});
```

Save the async run id from the launch result as `<reviewer-id>`. The report lands at `.pi-subagents/artifacts/outputs/<reviewer-id>/review.md`.

`wait({ id: <reviewer-id> })` before reading it.

## Phase 6: Read the review and (maybe) fix

Read `.pi-subagents/artifacts/outputs/<reviewer-id>/review.md` and determine if there feedback items that should be fixed.

To fix any feedback launch **one** fix worker (cap is 1 round — no re-review). Use the `worker` agent.

You should compose the fixer (worker) task instruction to pass to subagent from the review findings. Make sure to be explicit and exact in what should be fixed. Tell the subagent to not fix anything else than what you have explicitly instructed.

```js
const fixRun = subagent({
  agent: "worker",
  model: "MiniMax-M3:high",
  cwd: "<worktree-path>",
  async: true,
  timeoutMs: 1800000,
});
```

`wait({ id: <fix-run-id> })`. No second review round.

Commit the changes in a new, separate commit.

## Phase 7: Pre-PR rebase and checks

**Step 1: Run the validation commands** the project uses. At minimum: `pnpm run check`, `pnpm exec tsc --noEmit`, `pnpm test`, and (for Tauri) `cargo check` in `src-tauri/` if Rust changed.

**Step 2: Classify findings.**

- Findings in files this issue changed → block the gate. Either fix via a follow-up fix worker (no second review round) or stop and ask the user.
- Pre-existing failures in files this issue did not change → not blockers. Note them in the final summary. Do **not** "fix inline".

**Step 3: Do not bypass** with `--no-verify` or similar.

If you find yourself about to "just fix it inline" for an unrelated failure, stop and ask: is this in a file the issue changed? If no, leave it alone and mention it in the summary.

## Phase 8: Open PR

Push the branch and open the PR:

```bash
git push -u origin <branch-name>
gh pr create --base main --title "<issue-id>: <short summary>" --body-file <body-file>
```

**Must-do for the PR body:**

- Summarize the issue this PR implements.
- Highlight the most important changes (≤ 3 bullets).
- Walk through the implementation at a level a reviewer who has not seen the bead can follow.
- Summarize the test cases added.

Write the body into a scratch file (`scratch/pr-body.md` is the convention) and pass it via `--body-file`. Do not mention the bead ID anywhere outside the title.

If `gh pr create` failed, stop and report. Do not continue to Phase 9.

## Phase 9: Close the issue

```bash
bw close "$1" --json
bw sync
```

Only after `gh pr create` succeeded. `bw sync` can take several minutes on slow remotes; expect up to ~5 minutes. SSH signing warnings from `git push` are non-fatal when the push URL is still printed afterward — do not treat them as failures.

## Resume (lightweight)

If `$1` is already in_progress, the worktree exists, and `.pi-subagents/artifacts/outputs/*/context.md` / `plan.md` / `worker-handoff.md` / `review.md` (any id) are present: list the artifacts dir, read the most recent of each kind, skip completed phases, and resume from the next one. If anything looks ambiguous, fall back to running from scratch in a fresh worktree — do not try to recover partial states.

## Output

Summarize at the end:

- Beadwork issue ID and final state
- worktree path and branch
- changed files (high level)
- pre-PR check results (commands + exit codes)
- PR URL
- any open risks or unaddressed review items
- any pre-existing repo issues encountered and deferred

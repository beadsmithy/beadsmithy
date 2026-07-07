---
name: implement
description: "Implement a piece of work based on a PRD or set of issues."
disable-model-invocation: true
---

Implement the work described by the user in the PRD or issues.

## Phase 1: Worktree

Branch name: `<issue-id>/<title-slug>` — kebab-case the title, drop filler words, cap at ~40 chars.

**Must-do:**

- Create or resume the worktree via `wt switch --create <branch-name> --no-cd --yes --format json`.
- Capture the worktree path from the JSON response.
- `cd` into the worktree path.

If the worktree already exists (resumed run), `wt switch <branch-name>` returns the path; reuse it.

```bash
wt switch --create <branch-name --no-cd --yes --format json
cd /Users/tomas/projects/beadsmith.bsm-7en.3-render-safe-markdown-descriptions
```

## Phase 2: Claim and read the issue

```bash
bw start "$1" --json
```

If `bw start` rejects (issue already in progress), check the `.pi-subagents/artifacts/outputs` directory for contents. If it's not empty, this is a resumed run. Run `bw show "$1" --json` to get the issue definition. Otherwise stop and raise the issue to the user.

## Phase 3: Implement the issue

- Formulate a plan based on the issue description.
- Use /tdd where possible, at pre-agreed seams.
- Run typechecking regularly, single test files regularly, and the full test suite once at the end.

## Phase 4: Commit the changes

- Load the `commit-message-storyteller` skill.
- Commit the changes.

## Phase 5: Review

Use /review to review the work.

Evaluate the review feedback and implement the highest value items.

Commit the post-review changes as a separate commit.

## Phase 6: PR and close issue

Push the branch and create a PR using `gh`.

PR body:

- Summarize the issue this PR implements.
- Highlight the most important changes (≤ 3 bullets).
- Walk through the implementation at a level a reviewer who has not seen the bead can follow.
- Summarize the test cases added.

Write the body into a scratch file (`scratch/pr-body.md` is the convention) and pass it via `--body-file`. Do not mention the bead ID anywhere outside the title.

Finally close the issue.

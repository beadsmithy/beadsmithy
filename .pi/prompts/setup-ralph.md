---
description: Setup a Ralph Wiggum loop
---

Let's setup a Ralph loop for implementing `$1` (and child issues if present). Uf you have any questions, ask here inline - do not use any interview/question tools.

- Create a worktree and branch for the implementation. 
- One commit per child issue. Instruct to use `commit-message-storyteller` when committing.
- When all issues are completed, run a reviewer agent using `openai-codex/gpt-5.6-sol:medium`. 
- Fix any issues from the review and make a fix commit.
- When all issues are fixed, create PR using `gh` when everything is complete. 

PR body description:

- Summarize the issue this PR implements.
- Highlight the most important changes (≤ 3 bullets).
- Walk through the implementation at a level a reviewer who has not seen the bead can follow.
- Summarize the test cases added.

When you are done setting up and everything is ready for starting the loop: stop, present current state and wait for go ahead from me.

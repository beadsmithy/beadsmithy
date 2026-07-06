---
name: implement-bead
description: Implement a Beadwork issue through the main scout → planner → worker chain.
---

## scout

phase: Context
label: Scout issue context
as: codebaseContext
model: MiniMax-M3:low
outputMode: file-only

Scout the codebase for Beadwork issue `{task}`.
Run `bw show {task} --json`, then explore the affected area: entry points, key types/functions, data flow, cross-domain interaction, likely change files, constraints, and risks.
Write findings to output, with the full `bw show {task} --json` output at the top under exactly: `## Issue description for "{task}" (via bw)`.
Hard constraints: do not edit project/source files; surface ambiguities instead of guessing.

## planner

phase: Planning
label: Plan implementation
as: implementationPlan
model: openai-codex/gpt-5.5:high
outputMode: file-only

Plan the implementation of Beadwork issue `{task}`.
The read the context, path is supplied at runtime.
Hard constraints: do not make code changes; surface underspecified requirements instead of guessing.

## worker

phase: Implementation
label: Implement issue
as: workerHandoff
model: MiniMax-M3:high
output: worker-handoff.md
outputMode: file-only

Implement Beadwork issue `{task}`.
Read the plan and context, paths are supplied at runtime.
Use TDD.
Validate with `pnpm run check`, `pnpm exec tsc --noEmit`, and `pnpm test` where feasible.
Write to output: changed files, validation commands with exit codes, what was left undone, and open risks.
Hard constraints: do not commit; do not edit files unrelated to this issue; surface, don't fix, pre-existing repo lint/format failures; escalate unapproved product/architecture decisions via `contact_supervisor`.

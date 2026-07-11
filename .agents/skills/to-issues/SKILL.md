---
name: to-issues
description: Break a plan, spec, or PRD into independently-grabbable issues on the project issue tracker using tracer-bullet vertical slices.
disable-model-invocation: true
---

# To Issues

Break a plan into independently-grabbable issues using vertical slices (tracer bullets).

The issue tracker and triage label vocabulary should have been provided to you — run `/setup-matt-pocock-skills` if not.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes an issue reference (issue number, URL, or path) as an argument, fetch it from the issue tracker and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Issue titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the plan into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests) — vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each issue its **blocking edges** — the other issues that must complete before it can start. A issue with no blockers can start immediately.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change — rename a column, retype a shared symbol — whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own issue blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a issue blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify issue — green is promised only there.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories this addresses (if the source material has them)

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct — does each issue only depend on issues that genuinely gate it?
- Should any issues be merged or split further?

Iterate until the user approves the breakdown.

### 5. Publish the issues to the issue tracker

For each approved slice, publish a new issue to the issue tracker. Use the issue body template below. These issues are considered ready for AFK agents, so publish them with the correct triage label unless instructed otherwise.

Publish issues in dependency order (blockers first) so you can reference real issue identifiers when configuring the dependency graph.

#### Good Description Properties

1. **Self-contained** — Never need to refer back to original plan
2. **Self-documenting** — Future you can understand it
3. **Verbose** — More detail is better than less
4. **Actionable** — Clear what to do

#### Description Checklist

- [ ] Background explains WHY
- [ ] Technical approach explains HOW
- [ ] Success criteria define DONE
- [ ] Test plan ensures QUALITY
- [ ] Considerations prevent SURPRISES

Do NOT close or modify any parent issue.

<issue-template>

## Background

Why this exists, context

## What to build

A concise description of this vertical slice. The end-to-end behaviour this ticket makes work, from the user's perspective — not layer-by-layer implementation.

## Technical Approach

How to implement

## Considerations

Edge cases, risks

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Test Plan

- Unit + integration tests
- E2E tests (if applicable)

</issue-template>

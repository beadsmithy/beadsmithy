# Issue tracker: Beadwork

Issues, PRDs, epics, dependencies, and work state for this repo live in beadwork and are managed with the `bw` CLI.

## Conventions

- Run `bw prime` before starting work.
- Issues live on the `beadwork` branch and use the `bsm-XYZ` ID prefix.
- Status values are `open`, `in_progress`, `closed`, and `deferred`.
- Priorities are `P0` through `P4`; the default is `P2`.
- Epics have children through `--parent`.
- Dependencies are recorded with `bw dep add <blocker> blocks <blocked>`.
- `bw ready` is the source of truth for the next unblocked work.

## When a skill says "publish to the issue tracker"

Create beadwork issues with `bw create`. Use tasks for single pieces of work, epics for multi-step plans, and child issues for independently landable slices.

## When a skill says "fetch the relevant ticket"

Use `bw show <id>` for a specific issue, `bw list` for broader issue state, and `bw ready` for the next unblocked work.

## Pull requests

External pull requests are not a triage surface for this repo. Triage and planning should go through beadwork issues.

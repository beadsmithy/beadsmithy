# Use Beadwork CLI views for Ready and Blocked

## Context

Beadsmith shows Beadwork issues through several issue list views. Some views, such as All, Open, In Progress, Closed, and Deferred, can be represented directly from the issue data returned by `bw list --all --json` because they correspond to stored issue status or the complete workspace issue set.

Ready and Blocked are different. They are workflow views whose membership depends on Beadwork rules, not only on fields visible in a single issue record. Ready can account for effective blockers, expired deferrals, subtree behavior, and Beadwork's own ordering. Blocked can account for unresolved blockers according to Beadwork's current rules. Reimplementing those rules in Beadsmith would reduce CLI calls, but it would also create a second place where Beadwork workflow semantics could drift.

## Decision

We will load Ready from `bw ready --json` and Blocked from `bw blocked --json`. Beadsmith will treat those commands as the authoritative source for membership and ordering of the Ready and Blocked issue list views.

We will continue to load All from `bw list --all --json`. Status-specific views will be local slices of All because they reflect stored issue status rather than derived workflow rules.

## Status

Accepted.

## Consequences

Beadsmith will add a small amount of Tauri/RPC and CLI integration surface for the Ready and Blocked views. Startup loading for the issue explorer will run more than one Beadwork command so that switching views can be local and immediate after load.

Beadsmith will not need to duplicate Beadwork's readiness or blocking algorithms in React. When Beadwork changes those rules, Beadsmith should follow the CLI behavior automatically instead of silently diverging.

If any required issue loading command fails, the issue explorer will fail as a whole for this slice. Beadsmith will not fall back to a local approximation of Ready or Blocked, because an approximate answer would be worse than an explicit loading failure.

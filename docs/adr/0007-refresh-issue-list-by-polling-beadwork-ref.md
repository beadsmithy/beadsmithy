# Refresh issues by polling the Beadwork ref

## Status

Accepted.

## Context

Beadwork stores issue data on a git orphan branch named `beadwork`, scoped to the fully qualified ref `refs/heads/beadwork`. There is no issues file in the working tree. External actors — other terminals running `bw`, coding agents, `bw sync` — can change Beadwork at any time while Beadsmith is open.

Beadsmith's frontend currently loads the Issue List exactly once on mount. The glossary calls the Issue List "a live collection" but the code is a snapshot. The user wants the list to actually be live: automatic refresh, no manual button.

The "data changed" signal is the SHA at `refs/heads/beadwork`. If the SHA moves, the data moved. A `notify` watcher over `.git/refs/heads/beadwork` and `.git/packed-refs` is the lower-latency alternative, but git refs may be loose or packed, can be atomically replaced, and watcher event delivery is unreliable on WSL2, network mounts, and other virtualization layers — VS Code and Sublime Merge both have documented cases of missed ref events. A missed watcher event leaves Beadsmith stale forever; polling self-heals on the next tick. Lazygit recently shipped a 2-second polling refresh for the same "coding agents changing git in the background" problem (jesseduffield/lazygit PR #5662, commits `7c22c52` and `3050303`), which validates the pattern for a TUI/UI client watching local repo state. A `bw watch` command in Beadwork would be architecturally cleanest — Beadwork owns its own change detection — but it requires new upstream work and would still need a reconciliation step on the Beadsmith side for process death and startup gaps.

The Ready view is time-sensitive in addition to data-sensitive: a deferred Issue becomes Ready when its `defer_until` boundary passes, without a new Beadwork commit. Pure data-change polling therefore misses a class of legitimate view changes. This is captured in the glossary entry for **Ready**.

## Decision

We will add a single in-process poller in the Rust backend, bound to the Current Workspace:

1. Every ~2 seconds, we will run `git -C <workspace> rev-parse --verify refs/heads/beadwork^{commit}` and compare the result to the last observed SHA. The fully qualified ref avoids ambiguity.
2. On SHA change, we will run the existing Beadwork loaders (`bw list --all --json`, `bw ready --json`, `bw blocked --json`) single-flight, then emit a Tauri event carrying the new `IssueExplorerData` and the observed SHA. If a reload is already in flight and a new change is observed, we will mark dirty and re-run once after the active load completes if the ref still differs.
3. In parallel, we will run a low-cadence time-driven refresh (once per minute) so deferred Issues correctly transition into Ready when their `defer_until` boundary passes, even when the ref does not move.
4. We will refresh once on window focus events (`WindowEvent::Focused`) so returning to the app is always fresh.
5. We will treat up to 5 consecutive failures (~10 seconds at 2s polling) as transient: keep the last good state, do not surface to the user. After 5, we will drop to the existing failure UI.
6. On workspace switch (per ADR-0006), we will tear down the old poller, start a new one for the new workspace, and let the first poll tick fire the initial load (no last-seen SHA → comparison fails → reload triggered).
7. We will not ship a manual refresh button.

The frontend will listen for the Tauri event and atomically replace its `IssueExplorerLoadState`. The user will see no indicator; the list updates in place. The initial-load spinner stays for the first-ever load of a session; subsequent refreshes are silent.

## Consequences

The Issue List becomes truly live in the glossary's sense. Robustness across loose refs, packed refs, atomic ref updates, and worktree common git dirs is delegated to `git` itself, because Beadsmith resolves the ref through `git` rather than reaching into `.git/refs/...` directly.

Cost: ~30 `git rev-parse` subprocess calls per minute per watched workspace, plus up to 3 `bw` calls per change. Acceptable on a desktop app watching one workspace. Worst-case refresh latency is ~2 seconds plus loader time, plus the 60-second tick for time-driven Ready transitions. Imperceptible to humans.

Beadsmith now depends on a `git` binary in addition to `bw`. ADR-0003 established `bw` as the structured-output integration surface; this ADR extends that surface to `git` for one specific purpose (a ref-tip probe). The structured-output contract with `bw` is unchanged.

The frontend replacement model means the user has no visual signal that data is current or stale. If that becomes a UX problem, a heartbeat indicator can be added later without changing this design. Polling does not provide per-issue deltas; the frontend receives the full refreshed state each time.

Follow-up work flagged for later ADRs:

- The current loader pipeline runs three `bw` subprocesses per refresh. A single `bw state --json` or backend aggregation could collapse this.
- Polling interval is hard-coded at 2 seconds. Configurability is a future concern.

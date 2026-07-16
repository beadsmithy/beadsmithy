# WebDriver end-to-end: Issue explorer and Workspace management

This is the WebDriver end-to-end suite for the Issue explorer path and the
final Workspace-management acceptance gate. It launches the real, built
Beadsmith desktop binary and drives it through WebdriverIO, proving real
Beadwork `Issue` data flows from the Rust `bw` adapter -> TauRPC boundary
-> Effect service -> React. The suite also proves workspace selection,
restoration, atomic switching, invalid-target preservation, isolated store
hygiene, and the typed `TauRPC__switch_workspace` / `TauRPC__cancel_workspace`
paths against the assembled binary.

Unit tests (`cargo test`, `pnpm test`) already cover each layer in isolation.
This suite exists because those can all pass while the actual desktop launch
still fails -- e.g. a missing capability permission, a broken TauRPC binding,
a workspace resolution bug that only shows up when the app is actually
running, or a stale store path reused across scenarios.

## Running it

```sh
# Build the debug binary once (rebuild after any Rust or frontend change):
pnpm e2e:build

# Run the complete acceptance surface: every scenario in the normal order,
# every scenario in a changed order, then every scenario in the normal
# order again. Reordering and repetition prove the suite has no store
# coupling.
pnpm test:e2e:issue-list

# Or one at a time:
pnpm e2e:issue-list:success
pnpm e2e:issue-list:empty
pnpm e2e:issue-list:atomic-switch
pnpm e2e:issue-list:restoration

# Build + run the issue-list slice in one step (success, empty, atomic-switch, and restoration):
pnpm test:e2e:issue-list

# Build + run the two-launch Markdown settings acceptance:
pnpm test:e2e:settings
```

Requires `bw` on `PATH` (used both to build the disposable fixture workspaces
and by the running app). `pnpm e2e:issue-list:*` fails fast with a clear error
if `bw` isn't found or the debug binary hasn't been built yet.

## Settings persistence suite

The focused Settings suite proves Markdown Typography settings through two
genuine built-desktop launches. It is intentionally not a `browser.refresh()`
test: the first WDIO invocation exits its Tauri process before the second
invocation launches a fresh process.

```sh
# Build the debug binary:
pnpm e2e:build

# Run both sequential phases against one temporary root:
pnpm e2e:settings

# Build + run the settings slice:
pnpm test:e2e:settings
```

`e2e/settings/scripts/run-settings-scenario.ts` creates one temporary root
containing separate `workspace-catalog.json` and `app-settings.json` paths,
plus one populated Workspace from the shared Issue List fixture. It passes
those paths to both phases through `BEADSMITH_WORKSPACE_STORE_PATH` and
`BEADSMITH_SETTINGS_STORE_PATH`, then removes the Workspace and entire root on
pass or failure. The runner never writes, parses, seeds, or patches either
store file: Phase 1 establishes Workspace state through typed
`TauRPC__switch_workspace` and Settings state through the visible Settings
control.

Phase 1 sets 24px, asserts computed `font-size` on the preview, Issue
description, and Issue comment Markdown articles, and waits for Saved before
the process exits. Phase 2 uses the same stores in a new process, verifies
automatic Current Workspace restoration without another typed switch, verifies
24px settings and rendering, then exercises Reset back to 14px.

The settings config (`wdio.settings.conf.ts`) uses the same embedded
`@wdio/tauri-service` and debug binary as the Issue List suite, captures
backend and frontend logs, and uses the dedicated embedded WebDriver port
`46246` (the Issue List suite uses `46245`). Both ports are preflighted through
the shared `e2e/issue-list/scripts/embedded-webdriver-port.ts` helper.

## Scenarios

All scenarios start from a fresh, scenario-owned, supported
application-data/store location. The harness creates only the temporary
parent directory of the store; the desktop binary creates the actual store
file itself as a side-effect of the typed `switch_workspace` the spec
issues. The developer's normal workspace catalog is fingerprinted before
the run and re-fingerprinted after cleanup; the suite fails if the developer
catalog changed.

- `issues` (`e2e/issue-list/issue-list.success.spec.ts`): the populated
  Workspace A is selected through the typed RPC, sidebar counts and Issue
  List View interactions are asserted against real Beadwork state, and the
  empty Workspace B is used to prove that an invalid typed switch preserves
  the Current Workspace. The same spec exercises the typed
  `TauRPC__retry_workspace_memory` boundary to prove its response shape
  and post-refresh rendering; the renderer-level recovery panel that calls
  `App.retryWorkspaceMemory` is covered in `App.workspace-recovery.test.tsx`.
- `empty` (`e2e/issue-list/issue-list.empty.spec.ts`): the empty Workspace
  B is selected through the typed RPC and the true-empty Issue Explorer
  state is asserted end to end. The spec proves the empty-startup
  invariant (`workspace_state.currentWorkspace === null`) and the missing
  sidebar path before issuing any switch.
- `atomic-switch` (`e2e/issue-list/issue-list.atomic-switch.spec.ts`):
  two distinguishable populated workspaces (A with the original
  `FIXTURE_*` titles; B with `FIXTURE_SECOND_*` markers) are switched
  between through the typed RPC. Both workspaces expose the same explicit
  Beadwork Issue ID (`FIXTURE_SHARED_ID`) with distinct titles and
  description tokens, so the spec can prove that selection, Issue Detail,
  and search query cannot leak from A into B across a committed switch.
  Workspace A's snapshot, shared-ID Issue Detail, and A-only search query
  remain visible while B is Pending; Cancel preserves A; the suite
  deterministically waits beyond the wrapper-introduced
  `BEADSMITH_E2E_COMMAND_DELAY_MS` so the cancelled worker's late
  completion is observed and confirmed to have published nothing;
  subsequent commit to B (clearing prior Detail/search via the
  `workspaceKey` remount); and an invalid typed switch preserves B as
  Current -- including both B's path AND B-only issue data.
- `restoration` (`e2e/issue-list/issue-list.restoration.spec.ts`): the
  restoration acceptance gate. The harness launches **two sequential
  Beadsmith binaries** against the same scenario-owned store. Phase 1
  proves empty startup, selects Workspace A through the typed RPC, and
  asserts the desktop binary persisted A. Phase 2 launches a new real
  Beadsmith binary against the same store and proves A is restored as the
  Current Workspace from persistence alone -- the spec issues no
  `switch_workspace` and reads only what the second binary renders. The
  scenario harness inspects the scenario-owned store between phases as
  verification that the desktop binary is the only writer, not as a
  fixture seed.

## How it works

- **Fixtures** (`e2e/issue-list/fixtures/workspace.ts`): each scenario gets
  throwaway git repositories under the OS temp directory, initialized with
  `bw init` and (for the populated `issues`, `atomic-switch`, and
  `restoration` scenarios) populated with real `bw create`,
  `bw label`, `bw dep add`, `bw close`, `bw defer`, and `bw comment` calls.
  Both populated workspaces expose the same explicit Issue ID
  (`FIXTURE_SHARED_ID`, supplied through Beadwork's supported `bw create
--id` flag) so the cross-workspace interaction tests have a deliberate
  collision. The fixture includes a Ready Issue with a unique search
  token, a Blocked Issue with an unresolved blocker, a Closed Issue, a
  Deferred Issue, and a deliberately colliding shared-ID Issue, so the
  sidebar views and the cross-workspace assertion exercise real
  Beadwork state while the selected detail view has labels, dependency
  context, Markdown description output, and authored comments to render.
  Nothing is committed to this repo and no machine-specific path is baked
  in -- everything is created fresh per run and removed afterward.
- **Scenario harness** (`e2e/issue-list/scripts/run-scenario.ts`): owns
  the full process lifecycle for one named scenario. It creates the
  scenario-owned fixtures, a fresh temporary backend-store path, the
  delayed `bw`/`git` PATH wrappers when applicable, and runs the
  required WDIO phases sequentially. It captures a read-only
  fingerprint of the developer's normal workspace-catalog location before
  launch and re-checks it after cleanup; the suite fails if the developer
  catalog is touched in any way. Workspace creation lives here rather
  than in the wdio config because `@wdio/tauri-service`'s `embedded`
  driver provider spawns a single Beadsmith process for the whole run,
  and WDIO's local runner re-evaluates the config module in more than
  one Node process. Restoration's two phases share one
  scenario-owned store path; every other run gets a fresh store and
  fresh fixture roots.
- **Store-isolation helper**
  (`e2e/issue-list/scripts/store-isolation.ts`): captures and compares
  read-only fingerprints of the developer's normal app-data
  directory/file, inspects the scenario-owned store to prove it was
  created by the desktop binary's typed switch, and asserts that all
  scenario-owned paths have been cleaned up. Failure paths include the
  offending paths so the developer can investigate.
- **wdio config** (`wdio.issue-list.conf.ts`): points
  `@wdio/tauri-service` at the built binary
  (`src-tauri/target/debug/beadsmith`) using the `embedded` driver
  provider, so no external `tauri-driver` install is needed (this is
  also the only provider that works natively on macOS). The suite uses a
  non-default embedded WebDriver port (`46245`) and preflights that port
  before launching so it fails clearly instead of silently attaching to
  a stale debug app. The binary starts with an isolated empty catalog;
  the suite never sets process cwd, never passes a `--workspace` launch
  argument, and never writes the store file from the test side.
  Backend and frontend log capture are both enabled so failures show
  Rust/TauRPC/Effect/UI signals, not just a WebDriver timeout. Spec
  selection is driven by `BEADSMITH_E2E_SCENARIO` and
  `BEADSMITH_E2E_PHASE`.
- **WDIO plugin wiring**: debug builds register both `tauri-plugin-wdio`
  and `tauri-plugin-wdio-webdriver`. `pnpm e2e:build` merges
  `src-tauri/tauri.e2e.conf.json` so `withGlobalTauri` is enabled only
  for the e2e binary, and sets `VITE_BEADSMITH_E2E_WDIO=1`, causing the
  frontend to import `@wdio/tauri-plugin` for that binary only. The WDIO
  permissions live in `src-tauri/capabilities/webdriver-e2e.json`,
  separate from the app's default capability.
- **Specs** (`e2e/issue-list/*.spec.ts`): assert on the native RPC path
  and the rendered DOM. `issue-list.success.spec.ts` first proves empty
  startup, invokes `TauRPC__switch_workspace` directly for the populated
  fixture, then triggers a single renderer-state rehydration
  (`browser.refresh()`) so the next test asserts on the freshly committed
  Current Workspace DOM. It then switches to the true-empty fixture and
  proves an invalid target preserves that Current Workspace.
  `issue-list.empty.spec.ts` explicitly proves empty startup and the
  absent sidebar path before selecting the zero-issue fixture through the
  same typed operation and asserting the true-empty state.
  `issue-list.atomic-switch.spec.ts` exercises the same typed transport
  with two populated workspaces that share an explicit Issue ID, proves
  that A's selection, Issue Detail, and search query survive Pending and
  Cancel, deterministically waits beyond the intentionally delayed
  cancelled worker's completion boundary, commits B, and verifies that
  an invalid typed target preserves B (path AND data).
  `issue-list.restoration.spec.ts` selects A through the typed RPC on
  the first launched binary, then on a second launched binary proves A
  is restored without any seed selection. Direct typed transport is
  intentional: native macOS directory dialogs are not a reliable
  WebDriver surface, while frontend tests cover picker wiring and
  cancellation.

## Why the embedded WebDriver server, not `tauri-driver`

`tauri-plugin-wdio-webdriver` is registered in `src-tauri/src/lib.rs`
behind `#[cfg(debug_assertions)]`, so it's compiled into every debug
build (including this suite's) and never ships in a release binary. It
backs `@wdio/tauri-service`'s `embedded` driver provider, which runs an
in-process W3C WebDriver server -- the official `tauri-driver` only
supports Windows/Linux when driven directly, so `embedded` is the only
option that works natively on macOS.

`tauri-plugin-wdio` is also registered only in debug builds. It enables
`browser.tauri.execute()`, command mocking if a future suite needs it,
and frontend/backend log forwarding for this suite.

## Known upstream issue: pinned `@wdio/native-utils`

`@wdio/tauri-service@1.2.0` pins `@wdio/native-utils@2.4.0` exactly, but
that published version is missing the `installMockSyncOverride` export
it imports, so the service crashes on startup.
`pnpm-workspace.yaml` overrides `@wdio/native-utils` to `2.5.0`, which
restores it. Safe to drop once `@wdio/tauri-service` bumps its own pin.

## Deliberately out of scope

- Broad visual regression coverage.
- Issue mutations.
- Exhaustive search/filter matrices beyond the focused Issue List View
  and local Issue Search happy path.
- The native macOS directory picker is not a reliable WebDriver
  surface, so picker wiring and picker cancellation are covered by the
  frontend unit suite; this WebDriver suite drives all workspace
  selection through the typed `TauRPC__switch_workspace` /
  `TauRPC__cancel_workspace` boundary.

## Atomic workspace-switch: deterministic delay mechanism

The `atomic-switch` scenario needs to observe the renderer's Pending
phase between typed `switch_workspace` invocations and the durable
commit. The backend normally completes the switch in tens of
milliseconds, so without artificial delay the Pending window would be
unobservable.

`e2e/issue-list/scripts/run-scenario.ts` creates a temporary,
scenario-owned PATH prefix for `atomic-switch`. It writes executable
`bw` and `git` shell wrappers into an OS-temporary directory; each
wrapper sleeps for the configured
`BEADSMITH_E2E_COMMAND_DELAY_MS` (1000 ms by default) and then `exec`s
the resolved real executable with its original arguments. The runner
prepends that directory to the environment passed to WDIO/the spawned
desktop app, propagates `BEADSMITH_E2E_COMMAND_DELAY_MS` so the spec
can deterministically wait beyond the cancelled worker's late
completion, and removes the wrappers with the disposable fixtures.
Therefore the delay is outside the production binary and Rust command
runner: release and ordinary debug launches always invoke the real
commands directly.

## Known limitations

- The atomic-switch scenario depends on temporary, scenario-owned PATH
  wrappers controlled by `BEADSMITH_E2E_COMMAND_DELAY_MS`; production
  binaries and application command runners are unaffected.
- The native macOS directory dialog cannot be exercised through
  WebDriver, so picker cancellation is asserted in the frontend unit
  suite instead.
- Typed-RPC reordering races are tested deterministically only at the
  renderer layer (frontend `App.test.tsx`); the desktop scenario
  complements those with full IPC + renderer + Beadwork end-to-end
  coverage of the asynchronous Pending window, Cancel path, and
  restoration across a real binary restart.

## Workspace management is not coupled to launch

Workspace selection lives in the typed `switch_workspace` /
`cancel_workspace` boundary. The binary never reads the launch
working directory, never receives a `--workspace` flag, and never
mutates process `cwd`. Desktop acceptance must always start from a
fresh, scenario-owned, supported store location; the harness only
configures where the binary resolves its store, never seeds behavior by
hand-editing it. ADR 0006 documents the historical rationale; the
verification specification lives in
`docs/research/workspace-management-verification-and-migration.md`.

# WebDriver end-to-end: Issue explorer and selected Issue Detail

This is the WebDriver end-to-end suite for the Issue explorer path. It
launches the real, built Beadsmith desktop binary and drives it through
WebdriverIO, proving real Beadwork `Issue` data flows from the Rust `bw`
adapter -> TauRPC boundary -> Effect service -> React. The success scenario
also selects an Issue row and verifies representative Issue Detail content from
that same combined Issue explorer payload.

Unit tests (`cargo test`, `pnpm test`) already cover each layer in isolation.
This suite exists because those can all pass while the actual desktop launch
still fails -- e.g. a missing capability permission, a broken TauRPC binding,
or a workspace resolution bug that only shows up when the app is actually
running.

## Running it

```sh
# Build the debug binary once (rebuild after any Rust or frontend change):
pnpm e2e:build

# Run all scenarios against it:
pnpm e2e:issue-list:all

# Or one at a time:
pnpm e2e:issue-list:success
pnpm e2e:issue-list:empty
pnpm e2e:issue-list:atomic-switch

# Build + run the issue-list slice in one step (success, empty, and atomic-switch):
pnpm test:e2e:issue-list
```

Requires `bw` on `PATH` (used both to build the disposable fixture workspaces
and by the running app). `pnpm e2e:issue-list:*` fails fast with a clear error
if `bw` isn't found or the debug binary hasn't been built yet.

## Scenarios

- `issues` (`e2e/issue-list/issue-list.success.spec.ts`): the populated
  Workspace A is selected through the typed RPC, sidebar counts and Issue
  List View interactions are asserted against real Beadwork state, and the
  empty Workspace B is used to prove that an invalid typed switch preserves
  the Current Workspace. The same spec exercises the typed
  `TauRPC__retry_workspace_memory` boundary to prove its response shape
  and post-refresh rendering; the renderer-level recovery panel that calls
  `App.retryWorkspaceMemory` is covered in `App.test.tsx`.
- `empty` (`e2e/issue-list/issue-list.empty.spec.ts`): the empty Workspace B
  is selected through the typed RPC and the true-empty Issue Explorer state
  is asserted end to end.
- `atomic-switch` (`e2e/issue-list/issue-list.atomic-switch.spec.ts`):
  bsm-kia.4 atomic workspace-switch coverage. Two distinguishable populated
  workspaces (A with the original `FIXTURE_*` titles; B with `FIXTURE_SECOND_*`
  markers) are switched between through the typed RPC. The spec asserts that
  Workspace A's Issue Explorer snapshot, Issue Detail, and local Issue
  Search query remain visible while Workspace B is Pending; that Cancel
  preserves A without committing B; that a subsequent commit swaps the
  Issue Explorer snapshot to B (clearing prior Detail/search via the
  `workspaceKey` remount); and that an invalid typed switch preserves B as
  Current.

## How it works

- **Fixtures** (`e2e/issue-list/fixtures/workspace.ts`): each scenario gets
  throwaway git repositories under the OS temp directory, initialized with
  `bw init` and (for the populated `issues` and `atomic-switch` scenarios)
  populated with real `bw create`,
  `bw label`, `bw dep add`, `bw close`, `bw defer`, and `bw comment` calls. The
  fixture includes a Ready Issue with a unique search token, a Blocked Issue
  with an unresolved blocker, a Closed Issue, and a Deferred Issue, so the
  sidebar views exercise real Beadwork state while the selected detail view has
  labels, dependency context, Markdown description output, and authored
  comments to render. Nothing is committed to this repo and no
  machine-specific path is baked in -- everything is created fresh per run and
  removed afterward.
- **Scenario runner** (`e2e/issue-list/scripts/run-scenario.ts`): creates a
  populated Workspace A, a true-empty fixture, and a fresh temporary
  backend-store path for every scenario; `atomic-switch` also creates its
  distinguishable populated Workspace B. It launches `wdio` with those paths
  and removes all temporary data on pass or fail. The runner never writes the
  store file;
  fixtures are selected only through the normal typed `switch_workspace` RPC.
  Workspace creation lives here rather than in the wdio config because
  `@wdio/tauri-service`'s `embedded` driver provider spawns a single Beadsmith
  process for the whole run, and WDIO's local runner re-evaluates the config
  module in more than one Node process.
- **wdio config** (`wdio.issue-list.conf.ts`): points `@wdio/tauri-service` at
  the built binary (`src-tauri/target/debug/beadsmith`) using the `embedded`
  driver provider, so no external `tauri-driver` install is needed (this is
  also the only provider that works natively on macOS). The suite uses a
  non-default embedded WebDriver port (`46245`) and preflights that port before
  launching so it fails clearly instead of silently attaching to a stale debug
  app. The binary starts with an isolated empty catalog; it receives no
  `--workspace` launch argument and never changes process cwd. Backend and
  frontend log capture are both enabled so failures show Rust/TauRPC/Effect/UI
  signals, not just a WebDriver timeout.
- **WDIO plugin wiring**: debug builds register both `tauri-plugin-wdio` and
  `tauri-plugin-wdio-webdriver`. `pnpm e2e:build` merges
  `src-tauri/tauri.e2e.conf.json` so `withGlobalTauri` is enabled only for the
  e2e binary, and sets `VITE_BEADSMITH_E2E_WDIO=1`, causing the frontend to
  import `@wdio/tauri-plugin` for that binary only. The WDIO permissions live
  in `src-tauri/capabilities/webdriver-e2e.json`, separate from the app's
  default capability.
- **Specs** (`e2e/issue-list/*.spec.ts`): assert on the native RPC path and
  the rendered DOM. `issue-list.success.spec.ts` first proves empty startup,
  invokes `TauRPC__switch_workspace` directly for the populated fixture, then
  reloads the renderer through its normal backend-state startup path before
  verifying sidebar counts, Issue List Views, local search, and Issue Detail.
  It then switches to the true-empty fixture and proves an invalid target
  preserves that Current Workspace. `issue-list.empty.spec.ts` selects the
  zero-issue fixture through the same typed operation before asserting the
  true-empty state. Direct typed transport is intentional: native macOS
  directory dialogs are not a reliable WebDriver surface, while frontend tests
  cover picker wiring and cancellation.

## Why the embedded WebDriver server, not `tauri-driver`

`tauri-plugin-wdio-webdriver` is registered in `src-tauri/src/lib.rs` behind
`#[cfg(debug_assertions)]`, so it's compiled into every debug build (including
this suite's) and never ships in a release binary. It backs
`@wdio/tauri-service`'s `embedded` driver provider, which runs an in-process
W3C WebDriver server -- the official `tauri-driver` only supports
Windows/Linux when driven directly, so `embedded` is the only option that
works natively on macOS.

`tauri-plugin-wdio` is also registered only in debug builds. It enables
`browser.tauri.execute()`, command mocking if a future suite needs it, and
frontend/backend log forwarding for this suite.

## Known upstream issue: pinned `@wdio/native-utils`

`@wdio/tauri-service@1.2.0` pins `@wdio/native-utils@2.4.0` exactly, but that
published version is missing the `installMockSyncOverride` export it imports,
so the service crashes on startup. `pnpm-workspace.yaml` overrides
`@wdio/native-utils` to `2.5.0`, which restores it. Safe to drop once
`@wdio/tauri-service` bumps its own pin.

## Deliberately out of scope

- Broad visual regression coverage.
- Issue mutations.
- Exhaustive search/filter matrices beyond the focused Issue List View and
  local Issue Search happy path.
- The native macOS directory picker is not a reliable WebDriver surface, so
  picker wiring and picker cancellation are covered by the frontend unit
  suite; this WebDriver suite drives all workspace selection through the
  typed `TauRPC__switch_workspace` / `TauRPC__cancel_workspace` boundary.

## Atomic workspace-switch: deterministic delay mechanism

The `atomic-switch` scenario needs to observe the renderer's Pending phase
between typed `switch_workspace` invocations and the durable commit. The
backend normally completes the switch in tens of milliseconds, so without
artificial delay the Pending window would be unobservable.

`e2e/issue-list/scripts/run-scenario.ts` creates a temporary, scenario-owned
PATH prefix for `atomic-switch`. It writes executable `bw` and `git` shell
wrappers into an OS-temporary directory; each wrapper sleeps for the
configured `BEADSMITH_E2E_COMMAND_DELAY_MS` (1000 ms by default) and then
`exec`s the resolved real executable with its original arguments. The runner
prepends that directory to the environment passed to WDIO/the spawned desktop
app, then removes it with the disposable fixtures. Therefore the delay is
outside the production binary and Rust command runner: release and ordinary
debug launches always invoke the real commands directly.

## Known limitations

- The atomic-switch scenario depends on temporary, scenario-owned PATH
  wrappers controlled by `BEADSMITH_E2E_COMMAND_DELAY_MS`; production
  binaries and application command runners are unaffected.
- The native macOS directory dialog cannot be exercised through WebDriver,
  so picker cancellation is asserted in the frontend unit suite instead.
- Typed-RPC reordering races are tested deterministically only at the
  renderer layer (frontend `App.test.tsx`); the desktop scenario
  complements those with full IPC + renderer + Beadwork end-to-end
  coverage of the asynchronous Pending window and Cancel path.

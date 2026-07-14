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

# Run both scenarios against it:
pnpm e2e:issue-list

# Or one at a time:
pnpm e2e:issue-list:success
pnpm e2e:issue-list:empty

# Build + run both scenarios in one step:
pnpm test:e2e:issue-list
```

Requires `bw` on `PATH` (used both to build the disposable fixture workspaces
and by the running app). `pnpm e2e:issue-list:*` fails fast with a clear error
if `bw` isn't found or the debug binary hasn't been built yet.

## How it works

- **Fixtures** (`e2e/issue-list/fixtures/workspace.ts`): each scenario gets a
  throwaway git repository under the OS temp directory, initialized with
  `bw init` and (for the "issues" scenario) populated with real `bw create`,
  `bw label`, `bw dep add`, `bw close`, `bw defer`, and `bw comment` calls. The
  fixture includes a Ready Issue with a unique search token, a Blocked Issue
  with an unresolved blocker, a Closed Issue, and a Deferred Issue, so the
  sidebar views exercise real Beadwork state while the selected detail view has
  labels, dependency context, Markdown description output, and authored
  comments to render. Nothing is committed to this repo and no
  machine-specific path is baked in -- everything is created fresh per run and
  removed afterward.
- **Scenario runner** (`e2e/issue-list/scripts/run-scenario.ts`): creates a
  populated fixture, a true-empty fixture, and a fresh temporary backend-store
  path for every scenario. It launches `wdio` with those paths and removes all
  temporary data on pass or fail. The runner never writes the store file;
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
- Pending/concurrency presentation: TauRPC workspace selection is synchronous
  today, so a visible pending state requires the separately planned bsm-kia.4
  asynchronous switch work.
- Exhaustive search/filter matrices beyond the focused Issue List View and
  local Issue Search happy path.

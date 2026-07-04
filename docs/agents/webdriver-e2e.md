# WebDriver end-to-end: Issue List

This is the WebDriver end-to-end suite for the Issue List slice (bsm-mq4.5). It
launches the real, built Beadsmith desktop binary and drives it through
WebdriverIO, proving the full stack renders real Beadwork data: Rust `bw`
adapter -> TauRPC boundary -> Effect service -> React.

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
  `bw init` and (for the "issues" scenario) populated with `bw create`/`bw
label`/`bw dep add`. Nothing is committed to this repo and no
  machine-specific path is baked in -- everything is created fresh per run and
  removed afterward.
- **Scenario runner** (`e2e/issue-list/scripts/run-scenario.ts`): creates the
  workspace, launches `wdio` with `BEADSMITH_E2E_WORKSPACE` set, and removes
  the workspace when the run finishes (pass or fail). Workspace creation lives
  here rather than in the wdio config because `@wdio/tauri-service`'s
  `embedded` driver provider spawns a single Beadsmith process for the whole
  run, and WDIO's local runner re-evaluates the config module in more than one
  Node process -- so anything stateful at config-module scope would run more
  than once and desync from the already-launched app.
- **wdio config** (`wdio.issue-list.conf.ts`): points `@wdio/tauri-service` at
  the built binary (`src-tauri/target/debug/beadsmith`) using the `embedded`
  driver provider, so no external `tauri-driver` install is needed (this is
  also the only provider that works natively on macOS). The suite uses a
  non-default embedded WebDriver port (`46245`) and preflights that port before
  launching so it fails clearly instead of silently attaching to a stale debug
  app. The workspace path is passed as a `--workspace <path>` launch argument,
  which `src-tauri/src/workspace.rs` uses to switch the process's current
  directory before Beadsmith starts -- the same directory the `issues` adapter
  and RPC layer already read from (ADR-0003). Backend and frontend log capture
  are both enabled so failures show Rust/TauRPC/Effect/UI signals, not just a
  WebDriver timeout.
- **WDIO plugin wiring**: debug builds register both `tauri-plugin-wdio` and
  `tauri-plugin-wdio-webdriver`. `pnpm e2e:build` merges
  `src-tauri/tauri.e2e.conf.json` so `withGlobalTauri` is enabled only for the
  e2e binary, and sets `VITE_BEADSMITH_E2E_WDIO=1`, causing the frontend to
  import `@wdio/tauri-plugin` for that binary only. The WDIO permissions live
  in `src-tauri/capabilities/webdriver-e2e.json`, separate from the app's
  default capability.
- **Specs** (`e2e/issue-list/*.spec.ts`): assert on the native RPC path and
  the rendered DOM. `issue-list.success.spec.ts` first invokes
  `TauRPC__list_issues` through `browser.tauri.execute()` as a direct
  command sanity check, then waits for the fixture issue's row (matched by
  title in its `aria-label`), asserts its label and blocking-dependency text,
  and asserts the sidebar's reported workspace path matches the launched
  fixture. `issue-list.empty.spec.ts` asserts the true-empty state renders
  (and that neither the failure nor the populated-list state does) for a
  workspace with zero issues.

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

- Full regression coverage for workspace switching, search, filters, issue
  detail, or mutations -- this suite covers the Issue List slice only.

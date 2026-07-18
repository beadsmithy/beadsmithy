# Workspace management verification

Companion to ADR 0006. Defines the layered acceptance evidence that
proves the current Workspace service is correct end to end and tracks
the operational rules a desktop acceptance suite must enforce.

## Acceptance evidence

Workspace management is complete only when each layer proves the part
it owns.

### Rust unit tests

- The workspace state service validates with a candidate working
  directory and stores the Git root, not a selected subdirectory.
- `CommandRunner` receives an explicit cwd; all three Beadwork view
  commands use it and no production workspace lookup calls
  `env::current_dir`.
- Catalog rules: 100-entry cap, exact-path re-add, success-only MRU
  promotion, unavailable retention, and local-only removal.
- The switch state machine proves validation failure, load failure,
  persistence failure, startup restore failure, and success. Only
  success changes Current Workspace.
- Generation tests prove a stale first request cannot publish or
  persist after a newer request succeeds.

### RPC and frontend integration tests

- Generated TauRPC bindings expose workspace state and
  switch/retry/remove operations; issue-loading operations carry no
  caller-supplied workspace path.
- The frontend keeps the prior Issue Explorer snapshot while a Pending
  Workspace validates or loads.
- Invalid paths render inline selector feedback; load/persistence
  failures retain the old view and show a dismissible retry banner.
- Startup with no successful restore renders the empty chooser. A
  valid-but-unloadable stored entry remains retryable, not Current.
- Removing Current Workspace clears the current view instead of
  selecting another catalog entry.

### Real desktop WebDriver acceptance (current)

The desktop acceptance gate is the only place the assembled binary,
Tauri store plugin, native dialog capability, typed RPC contract, and
React renderer are exercised together. It also proves that scenario
isolation prevents store coupling between runs.

1. Launch the debug binary against a scenario-owned, supported
   test-only store path. The binary must start from an empty chooser;
   no `--workspace` argument is passed; the launch working directory
   is never used to pick the Current Workspace.
2. Prove empty startup explicitly: `TauRPC__workspace_state` reports
   `currentWorkspace === null` and the sidebar exposes no committed
   path before any selection is issued.
3. Create two disposable, initialized Beadwork repositories with
   distinguishable issue fixtures. Both repositories deliberately
   expose the same explicit Beadwork Issue ID
   (`FIXTURE_SHARED_ID`) so the cross-workspace test has a real,
   non-coincidental collision.
4. Invoke the typed `switch_workspace` transport the product uses for
   repository A, and assert A's path and issue data render.
5. Switch to repository B and assert B replaces A only after its full
   load. The prior snapshot must remain visible while B is pending,
   with A's selected Issue Detail and local Issue Search query
   preserved.
6. Cancel the pending B and wait beyond the scenario-owned
   `BEADSMITH_E2E_COMMAND_DELAY_MS` so the cancelled worker's late
   completion is observed and confirmed not to publish. A's snapshot,
   shared-ID Issue Detail, and search query must still belong to A.
7. Commit B; assert that A's selection and search query clear before
   B's interaction begins; assert B's same-ID Issue is neither
   implicitly selected nor filtered by A's leftover query.
8. Attempt an invalid directory while B is Current; assert the inline
   validation feedback and that both B's path AND B-only issue data
   remain rendered (no retry banner).
9. Restart or reconstruct app state from the scenario-owned store
   alone. The second binary launch must show A as Current without any
   seed selection. This is the only place a process restart is used
   as lifecycle proof; renderer reloads elsewhere are renderer-state
   rehydration.
10. Reorder the scenarios and repeat the suite to prove there is no
    store coupling. After cleanup, the developer's normal Beadsmith
    workspace-catalog fingerprint must be unchanged.

The direct typed transport in WebDriver is deliberate: native macOS
directory dialogs are not a reliable WebDriver surface, while the real
frontend's picker calls the same typed backend operation. Frontend
integration tests cover the picker-control wiring; the desktop suite
proves the real binary, persistence, backend operation, TauRPC, and
rendered state compose correctly.

## Operational rules for the desktop suite

- Each scenario owns a fresh, scenario-only store path. The harness
  only creates the temporary parent directory and the absolute path
  supplied via `BEADSMITH_WORKSPACE_STORE_PATH`; the desktop binary
  creates the actual store file as a side-effect of the typed
  `switch_workspace` the spec issues.
- The developer's normal workspace-catalog location is fingerprinted
  before the run and re-checked after cleanup. The suite fails
  loudly if the developer catalog was touched.
- Restoration is the only scenario that reuses a store path across
  phases. Every other scenario -- and every repeated or reordered run
  -- gets a new store and new fixture roots.
- The native picker is not driven through WebDriver; native-picker
  wiring and cancellation stay in frontend integration tests.

## Documentation and ADR reconciliation

- ADR 0006 records the historical rationale for removing
  process-cwd and the `--workspace` launch override from the
  workspace-resolution path. The architecture decision is unchanged;
  this document records the operational evidence the binary now
  provides against that decision.
- The current `src-tauri/src/workspace.rs` module comment, this
  document, and `docs/agents/webdriver-e2e.md` together describe the
  Workspace service as it exists today: backend-owned, typed-RPC
  driven, and store-backed. Comments, e2e configuration, and
  operational documentation no longer describe cwd or `--workspace`
  as Workspace selection.
- No new ADR is required: the test layers and migration follow the
  already accepted workspace-management decision rather than
  introducing a new hard-to-reverse trade-off.

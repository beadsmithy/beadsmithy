# Workspace-management verification and migration

Resolution for [Specify workspace-management verification and migration](bsm-muz.5).

## Acceptance evidence

Workspace management is complete only when each layer proves the part it owns.

### Rust unit tests

- The workspace state service validates with a candidate working directory and stores the Git root, not a selected subdirectory.
- `CommandRunner` receives an explicit cwd; all three Beadwork view commands use it and no production workspace lookup calls `env::current_dir`.
- Catalog rules: 100-entry cap, exact-path re-add, success-only MRU promotion, unavailable retention, and local-only removal.
- The switch state machine proves validation failure, load failure, persistence failure, startup restore failure, and success. Only success changes Current Workspace.
- Generation tests prove a stale first request cannot publish or persist after a newer request succeeds.

### RPC and frontend integration tests

- Generated TauRPC bindings expose workspace state and switch/retry/remove operations; issue-loading operations carry no caller-supplied workspace path.
- The frontend keeps the prior Issue Explorer snapshot while a Pending Workspace validates or loads.
- Invalid paths render inline selector feedback; load/persistence failures retain the old view and show a dismissible retry banner.
- Startup with no successful restore renders the empty chooser. A valid-but-unloadable stored entry remains retryable, not Current.
- Removing Current Workspace clears the current view instead of selecting another catalog entry.

### Real desktop WebDriver acceptance

The slice requires real desktop coverage, not renderer-only tests:

1. Launch the debug binary with no workspace startup override and assert the empty chooser.
2. Create two disposable, initialized Beadwork repositories with distinguishable issue fixtures.
3. Invoke the same typed `switch_workspace` transport used by the UI for repository A, then assert A's path and issue data render.
4. Switch to repository B and assert B replaces A only after its full load. The prior snapshot must remain visible while B is pending.
5. Attempt an invalid directory while B is Current; assert the inline failure and that B's path/issue data remain visible.
6. Restart or reconstruct app state from the persisted catalog and assert the last successfully Current Workspace restores through the normal load path.

The direct typed transport in WebDriver is deliberate: native macOS directory dialogs are not a reliable WebDriver surface, while the real frontend's picker calls the same typed backend operation. Frontend integration tests cover the picker-control wiring; the desktop suite proves the real binary, persistence, backend operation, TauRPC, and rendered state compose correctly.

## E2E migration

The current Issue List WebDriver suite passes `--workspace <path>` at process launch and relies on `workspace.rs` changing the process cwd. Migrate it as follows:

- Remove `src-tauri/src/workspace.rs`, its registration from `lib.rs`, the `--workspace` argument, and the e2e environment variable that exists only to supply that argument.
- Keep the fixture factory, but make the workspace-management runner create two named disposable repositories and make both paths available to the specs as test inputs.
- Start the binary empty. Use the normal workspace-switch RPC to select fixture A and fixture B; never write the plugin-store file directly and never mutate the process cwd.
- Retain the existing Issue List success and empty scenarios as regression coverage, but seed them through the official workspace-switch path before their existing assertions. The "empty" fixture validates true-empty data after a successful workspace selection.
- Update `docs/agents/webdriver-e2e.md`, `wdio.issue-list.conf.ts`, `e2e/issue-list/scripts/run-scenario.ts`, and any test names/comments that describe the launch override.

## Documentation and ADR reconciliation

- ADR 0006 remains the governing architecture decision and is now supported by the transaction specification and this verification specification.
- Remove stale process-cwd and `--workspace` statements from code comments, the e2e guide, and tests as part of implementation.
- No new ADR is required: the test layers and migration follow the already accepted workspace-management decision rather than introducing a new hard-to-reverse trade-off.

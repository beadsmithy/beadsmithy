# Workspace lifecycle edge semantics

Research for [Decide workspace lifecycle edge semantics](bsm-kia.10).

## Startup restoration responsiveness (#22)

### Evidence

`BeadsmithApiImpl::initialize_workspace` constructs the backend workspace service and calls `restore_current` synchronously before publishing the runtime: `src-tauri/src/rpc.rs:211-228`. The call is inside the Tauri `setup` hook, after the store, dialog, and other plugins are registered and before `run` returns from setup: `src-tauri/src/lib.rs:27-53`.

The remembered path is initially provisional. `WorkspaceService::from_store` loads and validates persisted memory but leaves `current_workspace` empty while retaining an internal restoration candidate: `src-tauri/src/workspace.rs:186-212` and `src-tauri/src/workspace.rs:568-581`. `restore_current` starts a fresh request and sends that candidate through `complete_selection`: `src-tauri/src/workspace.rs:233-250`. The normal selection transaction validates with `bw config list` and `git rev-parse --show-toplevel`: `src-tauri/src/workspace.rs:285-305` and `src-tauri/src/workspace.rs:613-678`; it then loads All, Ready, and Blocked views: `src-tauri/src/workspace.rs:307-313` and `src-tauri/src/workspace.rs:711-727`; and only publishes Current after the final durable save succeeds: `src-tauri/src/workspace.rs:315-320` and `src-tauri/src/workspace.rs:341-382`.

This is a bounded local-repository operation: one Beadwork validation command, one Git-root lookup, and three Beadwork list commands. The startup test confirms that a remembered Current is not exposed until the normal transaction succeeds: `src-tauri/src/workspace.rs:1185-1210`. An invalid remembered workspace remains in the catalog but never becomes Current: `src-tauri/src/workspace.rs:959-984`.

Because restoration runs in Tauri setup, the renderer cannot call `switch_workspace` until setup has completed. There is therefore no user-visible startup generation race to coordinate. Once the renderer is available, a manual selection supersedes any still-deferred candidate because `begin_selection` clears `restoration_candidate`: `src-tauri/src/workspace.rs:226-231`. The frontend then calls `switch_workspace` from `selectWorkspace`: `src/App.tsx:317-335`.

When no workspace restores, the backend state has `current_workspace: None`; the renderer shows the empty chooser rather than an Issue Explorer: `src/App.tsx:492-520`. The selector also displays “No workspace selected” and offers the folder picker: `src/components/WorkspaceSelector.tsx:206-219`. The picker defaults to Current, then the first available catalog entry, then the operating-system default: `src/components/WorkspaceSelector.tsx:19-47` and `src/components/WorkspaceSelector.test.tsx:19-47`. Cancelling the native picker is a no-op and does not call `switch_workspace`: `src/App.test.tsx:424-452`.

### Decision

Retain synchronous startup restoration. It uses the same validate → load → persist transaction as a user selection, completes before renderer interaction, and keeps the backend's startup contract aligned with the accepted workspace-management decision in ADR-0006. For a single-user local desktop application, this avoids adding a separate deferred-loading state machine and startup race handling for a bounded local operation.

### Alternatives rejected

- **Asynchronous deferred restoration:** rejected because it would make startup selection and restoration compete for generations and would require additional loading/ownership UI, while setup currently prevents the renderer from issuing a competing switch.
- **A bounded-feedback startup spinner:** rejected as speculative. No observed slow path currently justifies introducing a second startup presentation state.

If a real slow path is observed later, especially on a network filesystem, revisit the responsiveness decision. That is a future investigation only; no asynchronous restoration or spinner is introduced here.

## Cancel after failure (#5)

### Evidence

The `cancel_workspace` TauRPC handler records whether a real Pending request exists, calls `cancel_pending`, and emits the resulting state: `src-tauri/src/rpc.rs:492-516`. The state-machine operation bumps `generation` only when `pending_workspace` is present. It always clears Pending, `retry_workspace`, and `error`, clears the deferred restoration candidate, and never calls `store.save`: `src-tauri/src/workspace.rs:385-417`.

The backend comments define Cancel as abandoning transient switch interaction. A real Pending cancellation invalidates late work by incrementing the generation; a call with no Pending preserves the generation while clearing transient failure presentation: `src-tauri/src/workspace.rs:394-405`.

The frontend exposes Cancel only while `pendingWorkspace` exists: `src/App.tsx:466-472` and `src/components/WorkspaceSelector.tsx:318-347`. Its caller is a backend RPC, not a local banner operation: `src/App.tsx:295-311`. The no-Pending behavior is covered by `cancel_pending_with_no_pending_workspace_is_a_noop`: `src-tauri/src/workspace.rs:1411-1430`. The interaction with retryable failure state is covered by `cancel_pending_clears_retry_workspace`: `src-tauri/src/workspace.rs:1715-1743`.

Dismiss is different. The failure banner invokes a local callback: `src/components/WorkspaceSelector.tsx:80-115`. `dismissSwitchError` only records the current generation in React state: `src/App.tsx:412-421`; banner visibility consults that local marker without changing backend state: `src/components/WorkspaceSelector.tsx:318-347`. The frontend test verifies that Dismiss hides the banner while preserving the catalog and Current Workspace: `src/App.test.tsx:642-707`.

### Decision

Keep the current Cancel contract and document it as: **abandon the transient switch interaction**. Cancel increments the generation only for a real Pending request, always clears Pending/retry/error presentation, and never persists. If called with no Pending but with retry/error state, it is safe and idempotent: it clears that transient backend presentation without changing the generation or durable workspace memory.

Keep Dismiss as a purely local UI action. It suppresses the current failure banner for its generation but does not acknowledge, clear, or mutate backend workspace state.

### Alternatives rejected

- **Strict no-op when no Pending exists:** rejected because retry/error state would then only be dismissible through local UI state; the backend would retain a transient failure indefinitely unless another operation happened to clear it.
- **Remove or restrict the RPC:** rejected as needless churn. The operation is already part of the generated TauRPC contract and is required for real Pending cancellation; changing it would not improve the state semantics.

## Typed stale-error handling in the renderer (#6/#17)

### Evidence

`selectWorkspace` catches every rejected `switch_workspace` promise and calls `refreshWorkspaceState`; it does not inspect or narrow the rejected error: `src/App.tsx:317-335`. `refreshWorkspaceState` obtains authoritative `workspace_state()` and feeds it through `applyTransition`: `src/App.tsx:244-251`.

The typed backend error includes `StaleGeneration`: `src-tauri/src/workspace.rs:98-117`. `WorkspaceError::stale` supplies the machine-readable kind, message, and `retryable: false`: `src-tauri/src/workspace.rs:132-139`. `ensure_current` emits it when a request no longer owns the current generation: `src-tauri/src/workspace.rs:440-452`; selection checks the generation before commands, and durable commits check it before and after saving: `src-tauri/src/workspace.rs:285-292` and `src-tauri/src/workspace.rs:362-382`.

The generated binding exposes the variant as `staleGeneration`: `src/rpc/bindings.ts:105-113`. TauRPC `Result<T, E>` failures reject the frontend promise and throw: `node_modules/.pnpm/taurpc@1.8.1/node_modules/taurpc/README.md:151-156`. The renderer therefore receives a transport rejection, but currently treats all rejected switch RPCs uniformly.

The backend does not publish stale failure transitions or mutate state for stale completions. `finish_switch_failure` emits only when `fail_request` accepts the request; a stale request returns the error without emission: `src-tauri/src/rpc.rs:74-93`. The test `stale_switch_completion_emits_neither_failure_nor_success_transition` verifies that only the original Pending transition remains: `src-tauri/src/rpc.rs:1362-1403`. The lower-level test also verifies that a stale request runs no commands: `src-tauri/src/workspace.rs:1118-1140`.

The renderer applies one generation-guarded path to both transition events and typed RPC results. `applyTransition` rejects older generations and terminal same-generation replays: `src/App.tsx:172-205`. It also promotes a successful snapshot only when the returned issue data matches the returned Current Workspace: `src/App.tsx:205-239`. Transition events are emitted as Pending before commands and success after durable Current commit, with failure transitions only for current requests: `src-tauri/src/rpc.rs:347-425`. The event listener uses the same handler: `src/App.tsx:292-315`.

Retryable load and final-save failures are retained as retryable backend state. `fail_request` sets `retry_workspace` for `LoadFailed` and `StoreSaveFailed`: `src-tauri/src/workspace.rs:499-528`. The corresponding tests cover both load and final-save failures: `src-tauri/src/workspace.rs:1576-1627`. The renderer classifies those two kinds in `isRetryableSwitchFailureKind`: `src/workspace-switch-failure.ts:1-7`; `applyTransition` marks the failure generation terminal: `src/App.tsx:231-239`; and the selector displays the Retry banner when the retry target exists: `src/components/WorkspaceSelector.tsx:318-347`.

The renderer tests cover the resulting behavior: a rejected load switch surfaces the banner, `Retry` replays the retained path, and a delayed same-generation Pending event cannot erase the banner: `src/App.test.tsx:642-778` and `src/App.test.tsx:994-1086`.

### Decision

Do not special-case `staleGeneration` in the renderer. Keep the uniform rejected-switch path that refreshes typed workspace state.

This is safe because stale completions do not mutate backend state or emit a stale transition, and the refresh is applied through the same generation guard as every other state update. If a newer request has already committed, the refreshed state is older than or equal to the accepted generation and is dropped. Otherwise, the refresh reflects the authoritative winning request's state. In neither case can the renderer accept stale workspace data.

### Alternatives rejected

- **Narrow the rejected transport payload and skip refresh for `staleGeneration`:** rejected because it couples renderer control flow to the transport representation of a rejection for no user-visible benefit. The existing generation-guarded refresh already preserves correctness; skipping it would only remove a harmless state round trip.

## Recommendation / follow-up

No behavior change is warranted. Retain synchronous startup restoration, the current Cancel/Dismiss distinction, and uniform renderer handling of rejected switch RPCs.

The single deferred follow-up is to revisit synchronous restoration only if a real slow path—such as a network filesystem—demonstrates that startup responsiveness is materially affected. No spinner, deferred restore, or alternate startup state is implemented by this record.

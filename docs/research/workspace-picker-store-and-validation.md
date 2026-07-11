# Workspace picker, store, and validation capabilities

Research for [Research workspace picker, store, and Beadwork validation capabilities](bsm-muz.1).

## Current project baseline

- `src-tauri/Cargo.lock` resolves `tauri` to **2.11.3**.
- Neither dialog nor store plugin is currently installed. The main-window capability only grants `core:default` and `opener:default`.
- The accepted workspace ADR requires a native picker, `tauri-plugin-store`, and validation through `bw config list`.

## Native directory picker

Tauri's v2 dialog plugin exposes `open({ directory: true, multiple: false })` as an asynchronous native directory picker. It resolves to one path or `null` when the user cancels; on desktop the result is a filesystem path. `defaultPath` is available for the remembered-location affordance.

The dialog plugin must be registered in Rust and its frontend permission enabled in the main-window capability. The smallest relevant capability is `dialog:allow-open`; `dialog:default` is broader. The returned path is added to Tauri's frontend filesystem/asset scope only for the current process. That temporary scope is unnecessary for this feature when the frontend passes the path straight back to a backend command, but it must not be mistaken for durable workspace permission.

Sources: [Dialog guide](https://v2.tauri.app/plugin/dialog/), [dialog JS API](https://v2.tauri.app/reference/javascript/dialog/).

## Durable local storage

`tauri-plugin-store` is a supported persistent JSON key-value store. In Rust, `StoreExt::store(path)` creates or loads the named store and returns the already-loaded instance for the same resolved path. `set` mutates memory; an explicit `save()` gives a synchronous success/failure boundary. The plugin also saves loaded stores on a graceful app exit, but that is not an atomic-switch durability guarantee.

For Beadsmith, keep the store backend-owned, use one versioned file such as `workspace-catalog.json`, and call `save()` as part of a successful catalog/Current Workspace commit. Persist JSON values only; do not give the frontend store access unless it needs an independently owned setting. This keeps Current Workspace state behind the RPC boundary and avoids a capability grant that the feature does not need.

The currently published `tauri-plugin-store` 2.4.3 declares compatibility with `tauri ^2.10`; it is therefore compatible with the project's resolved Tauri 2.11.3. Pinning the plugin to the Cargo-resolved version is preferable to assuming an unverified JavaScript package version. The Rust dependency alone is enough for the intended backend-owned catalog.

Sources: [Store guide](https://v2.tauri.app/plugin/store/), [StoreExt API](https://docs.rs/tauri-plugin-store/latest/tauri_plugin_store/trait.StoreExt.html), [plugin crate metadata](https://docs.rs/tauri-plugin-store/latest/tauri_plugin_store/).

## Beadwork validation and canonical identity

`bw config list` requires an initialized Beadwork store. The vendored Beadwork source shows that every store-required command first discovers Git from the supplied directory, then rejects repositories without the Beadwork branch, and rejects unsupported repository schema versions. It reports non-Git directories as `not a git repository` and uninitialized repositories as `beadwork not initialized. Run: bw init`.

Crucially, repository discovery walks upward from the supplied path. `bw config list` can therefore succeed for a selected subdirectory, while `RepoDir()` identifies the canonical Git repository root. A valid Workspace must be the canonical root, so validation must return that root and compare it to the selected path after path canonicalization. The UI must not store a successful subdirectory selection as its own Workspace.

The validation command is read-only. It produces plain `key=value` lines rather than JSON in the vendored implementation, so success and the returned root should be modeled independently: validate with `bw config list` executed using `Command::current_dir(candidate)`, and determine the canonical root with a dedicated Git-root operation in the same backend validation boundary. Do not parse configuration output as a workspace identity.

## Specification implications

1. The picker may offer any directory; validation—not picker filtering—decides eligibility.
2. Canonicalize and validate first, then deduplicate/catalog/switch using the canonical Git-root path.
3. Treat cancellation as no operation; keep invalid-directory errors distinct from load failures after validation.
4. Persist only after a target has validated and loaded successfully. Store-save failure is a switch failure: retain the old Current Workspace and surface a retryable error rather than claiming a durable switch.
5. The implementation must add the Rust dialog and store dependencies, register both plugins, and add dialog permission only if the picker is invoked from the frontend.

## Evidence inspected in this repository

- `docs/adr/0006-workspace-management-and-switching.md`
- `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/capabilities/default.json`
- `docs/research/infra/beadwork/cmd/bw/helpers.go`
- `docs/research/infra/beadwork/cmd/bw/config.go`
- `docs/research/infra/beadwork/internal/repo/repo.go`

# Reference Source Checkouts

This directory holds **reference-only** checkouts of upstream libraries that
Beadsmith depends on (or plans to depend on). They exist so that humans and AI
coding agents can read the untranspiled upstream source while working on
Beadsmith — for understanding library behavior, debugging boundary issues, and
checking APIs against the real implementation rather than published type
declarations alone.

These are **not** vendored dependencies.

- Application code must **not** import from anything under this directory.
- Beadsmith consumes these libraries through normal package-manager
  dependencies (`pnpm` for TypeScript packages, `Cargo` for Rust crates).
  The trees here are pinned snapshots kept for reading, not for resolution.
- Each checkout is a plain source tree with its `.git` directory and any
  generated dependency/build/cache artifacts removed. They are not git
  submodules and are not kept in sync automatically; updating a reference is a
  deliberate commit that updates the provenance block below.

## Why reference source is separated from app code

Per [ADR-0004](../../adr/0004-standardize-on-taurpc-and-effect.md) and
`bsm-mq4.1`, large reference-source diffs are intentionally kept on their own
bead so they don't obscure functional application changes. Adding or updating a
reference checkout should be its own commit; do not mix it with runtime app
code.

## Checkouts

### `beadwork/`

Pre-existing reference checkout of the Beadwork CLI source
(`github.com/jallum/beadwork`), used as the primary reference for the `bw`
issue tracker that Beadsmith is built on top of. Added in an earlier commit;
its own provenance was not recorded at the time and should be backfilled
separately.

### `taurpc/`

Reference checkout of **TauRPC**, the typed Tauri RPC layer standardized on by
ADR-0004. Beadsmith consumes it through the `taurpc` Cargo crate and the
`@taurpc/taurpc` npm package published from this repo.

| field        | value                                                        |
| ------------ | ------------------------------------------------------------ |
| upstream     | https://github.com/MatsDK/TauRPC                             |
| commit       | `f6f6b745d1e240fb27c491dda5827f8092e9c839`                   |
| commit date  | 2026-06-29                                                   |
| fetched      | 2026-06-30                                                   |
| release tag  | none published at this commit (pinned by SHA)                |
| license      | MIT OR Apache-2.0 (`LICENSE_MIT`, `LICENSE_APACHE-2.0`)      |

Excluded from the checkout: `.git` directory. No `node_modules`/`dist`/build
artifacts were present in the upstream tree at this commit (they are
gitignored upstream).

### `effect/`

Reference checkout of **Effect**, the TypeScript effect/service layer
standardized on by ADR-0004. Beadsmith consumes it through the `effect` npm
package published from this monorepo.

| field        | value                                                        |
| ------------ | ------------------------------------------------------------ |
| upstream     | https://github.com/Effect-TS/effect                          |
| commit       | `3e59443be029e99d2b457bb43f682feb5ebcd2e0`                   |
| commit date  | 2026-06-29                                                   |
| fetched      | 2026-06-30                                                   |
| release tag  | pinned by SHA; latest visible tag at fetch was `effect@v2.0.0-next.62` (pre-release line) |
| license      | MIT (`LICENSE`)                                              |

Excluded from the checkout: `.git` directory. This is a pnpm monorepo; no
`node_modules`/`dist`/build/cache artifacts were present in the upstream tree
at this commit (they are gitignored upstream). The checkout includes the full
`packages/` workspace source plus tests, which is intentional — tests are
useful reference for understanding library behavior.

Known large **checked-in** generated source files (kept to preserve fidelity
with the upstream tree; not local build artifacts):

- `packages/platform/src/internal/httpApiScalar.ts` (~3.2M)
- `packages/platform/src/internal/httpApiSwagger.ts` (~1.9M)
- `packages/ai/openai/src/Generated.ts` (~791K)

The core `packages/effect/` package that Beadsmith consumes per ADR-0004
contains none of these.

## Updating a reference checkout

1. Shallow-clone the upstream repo at the desired commit/tag.
2. Copy the source tree into `docs/research/infra/<name>/` **without** the
   `.git` directory, and without any generated dependency/build/cache folders
   (`node_modules`, `dist`, `build`, `.turbo`, `.cache`, `coverage`, `target`,
   etc.).
3. Update the provenance table above: upstream URL, commit SHA (or release
   tag), commit date, fetch date, and license.
4. Commit on its own bead, referencing the issue that scopes the update.

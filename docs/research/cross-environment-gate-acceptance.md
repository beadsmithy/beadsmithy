# Cross-environment gate acceptance receipt

**Issue:** bsm-9n1.7 (epic bsm-9n1 — centralize Beadsmith quality gates on mise)
**Date:** 2026-08-28
**Platform:** macOS arm64 (Apple Silicon). No other platform was verified; see
[Limitations](#limitations).

## Verdict

`mise run gate` is the single mergeability gate and every repository-owned
execution surface (interactive shell, minimal git-hook shell, Lefthook,
Worktrunk pre-merge) reaches the same mise task graph. One configuration bug
was found and fixed during acceptance (lefthook glob engine); one
machine-level limitation was found and recorded (stale global lefthook
shadowing).

## Tool identity matrix

All resolved through `mise x` in a fresh worktree provisioned by the
Worktrunk pre-start pipeline (`mise trust` → `mise install` →
`mise x -- pnpm install --frozen-lockfile`):

| Tool    | Required         | Observed                      | Source                                                   |
| ------- | ---------------- | ----------------------------- | -------------------------------------------------------- |
| mise    | >= 2026.8.12     | 2026.8.12 macos-arm64         | host install (`~/.local/bin/mise`)                       |
| node    | 24.13.0          | v24.13.0                      | `mise.toml` `[tools]`                                    |
| pnpm    | 11.23.0          | 11.23.0                       | `package.json` `packageManager` (idiomatic version file) |
| rustc   | 1.97.1           | 1.97.1 (8bab26f4f 2026-07-14) | `mise.toml` `[tools]`, rustup `default` profile          |
| rustfmt | (with toolchain) | 1.9.0-stable                  | same rustup profile                                      |
| clippy  | (with toolchain) | 0.1.97                        | same rustup profile                                      |

## Acceptance matrix

1. **Clean checkout — PASS.** A fresh Worktrunk worktree ran the pre-start
   pipeline (trust, install, frozen-lockfile `pnpm install`) with no manual
   steps, and `mise run gate` exited 0 (frontend check, typecheck, unit
   tests, rustfmt check, clippy, rust tests).
2. **Tool identity — PASS.** See the matrix above; every binary resolved
   from mise-managed paths.
3. **Minimal git-hook shell — PASS.** A scratch commit with
   `env -i HOME="$HOME" PATH="/usr/bin:/bin" git commit ...` ran the full
   pre-commit hook set: lefthook resolved to the repository-pinned
   node_modules binary (2.1.9), and `scripts/mise-exec.sh` resolved mise via
   the `$HOME/.local/bin/mise` fallback. Separately verified:
   `MISE_BIN` pointing at a non-executable path exits 75, an unresolvable
   mise exits 75, and a valid `MISE_BIN` is honored. No silent fallback to
   system tools — resolution failure is loud and distinguishable (75).
4. **Staged behavior — PASS (after fix, see below).** Malformed staged
   `.ts` and `.rs` files (root-level and nested) were fixed by the hook
   adapters and re-staged (`stage_fixed`); an unstaged malformed file was
   not modified; a staged file under `docs/research/infra/**` was excluded
   and left byte-identical. React Doctor ran and remained advisory — the
   commit succeeds regardless of its findings, and a mise-resolution
   failure (75) prints a skip hint instead of blocking.
5. **Worktrunk — PASS.** A disposable worktree (`acceptance/gate-probe`)
   ran the pre-start setup unattended, and `wt hook pre-merge` executed the
   canonical gate to exit 0.
6. **Failure propagation — PASS.** With a deliberate type/lint error
   injected into the disposable worktree, `mise run gate` exited 2 and
   `wt hook pre-merge` exited 2 with `pre-merge command failed: gate`,
   blocking the merge. The disposable worktree and branch were removed
   afterwards.

## Finding fixed during acceptance: lefthook glob engine

Lefthook 2.x defaults to the `gobwas` glob engine, in which the `/` in
`**/*.ts` is literal — so `**/*.ts` never matches files at the repository
root. Root-level staged files silently skipped every pre-commit job.
`lefthook.yml` now sets `glob_matcher: doublestar` (standard `**`
semantics: zero or more directories), verified against root-level and
nested staged files plus the `docs/research/infra/**` and
`.agents/skills/**` exclusions.

## Limitations

- **Stale global lefthook shadows the pinned binary in interactive
  shells.** Lefthook's generated `pre-commit` hook prefers a `lefthook`
  found on `PATH` over the repository-pinned node_modules binary. A machine
  with lefthook 1.x installed globally (observed: homebrew lefthook 1.6.16)
  silently runs zero jobs against this repository's v2 (`jobs:`) config —
  the commit succeeds with no checks. This cannot be fixed from the
  repository because the generated hook's resolution order is not
  configurable. Mitigations, in order of preference:
  1. Remove or upgrade the global lefthook to 2.x (`brew upgrade lefthook`).
  2. Export `LEFTHOOK_BIN` pointing at the repository binary.
  3. Rely on the merge backstop: Worktrunk's pre-merge gate runs the full
     `mise run gate` regardless of what happened at commit time.
     Minimal shells (git GUIs, `env -i`) are unaffected — they fall through to
     the pinned binary.
- **Single platform.** All evidence above is macOS arm64. mise, lefthook,
  and Worktrunk are cross-platform, but no Linux or Windows run was
  performed; treat those as unverified rather than broken.
- **`scratch/` is globally git-ignored** on the maintainer's machine, so
  local scratch content never invalidates clean-checkout acceptance; the
  repository itself does not adopt `scratch/` as source.

## Recorded decisions (carried from the epic)

- **Clippy decision:** `rust:clippy` runs with `--all-targets -- -D
warnings`; warnings are denied, and the task is part of the gate
  (bsm-9n1.3).
- **Build decision:** the gate intentionally excludes the Vite/Tauri
  application build. The gate is a code-quality gate; application builds
  are covered by the e2e scenario pipelines (`e2e:build`) and packaging
  (bsm-9n1.3). `build` remains a package.json application command.
- **React Doctor** is advisory-only at commit time by design; the blocking
  gate tasks are not weakened to accommodate it.
- Hooks never auto-trust `mise.toml`; trust is an explicit per-checkout
  user action (`mise trust`, run by Worktrunk pre-start after user approval
  of the hook commands).

## Devin handoff

Devin's environment configuration is external to this repository (the
in-repo `.devin/config.json` is only an exec-permission allowlist and
already contains `Exec(mise)`). It could not be changed from this issue.

- **Owner:** Tomas Thor Jonsson — the environment lives in the Devin web
  app and requires his access.
- **Required settings:**
  - Provide mise >= 2026.8.12 (install during environment setup if absent).
  - Setup/maintenance: `mise trust && mise install`, then install
    dependencies with the frozen lockfile. Do **not** use
    `pnpm --ignore-workspace` — `pnpm-workspace.yaml` carries the
    `@wdio/native-utils` override and the build-script allow policy that
    the workspace install depends on.
  - Test command: `mise run gate`.
  - Remove the separate Rust test command — `rust:test` is in the gate.
  - Build command: keep or drop per Devin's needs; per the build decision
    above the gate does not build the app, so a separate build command is
    not redundant with the test command.
  - Keep the startup `bw prime`.
- **Pending action:** Tomas applies the settings above in the Devin
  environment and re-runs one session to confirm `mise run gate` executes
  there. Tracked on issue bsm-9n1.7 until done.

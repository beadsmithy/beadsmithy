/**
 * Canonical lint/format ignore policy for this repository.
 *
 * `oxlint.config.ts` and `oxfmt.config.ts` both consume these arrays so the
 * vendored/generated exclusions are defined exactly once. Lefthook's
 * `exclude` entries in lefthook.yml are trigger-level performance filters
 * only — this module is the policy, not the hook configuration.
 */

// Vendored/generated content that isn't ours to lint or reformat:
// upstream source snapshots and vendored agent skills.
export const VENDORED_IGNORES = [
  "docs/research/infra/**",
  ".agents/skills/**",
] as const;

// Files that must not be reformatted but are still linted (with targeted
// rule overrides in oxlint.config.ts where needed).
export const FORMAT_ONLY_IGNORES = ["src/rpc/bindings.ts"] as const;

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

// Gitignored agent/human working space. It is never committed, but
// Worktrunk's post-start hook copies ignored files into every new
// worktree, so without this exclusion the mergeability check would fail
// on scratch content that isn't part of the change under review.
export const SCRATCH_IGNORES = ["scratch/**"] as const;

// Files that must not be reformatted but are still linted (with targeted
// rule overrides in oxlint.config.ts where needed).
export const FORMAT_ONLY_IGNORES = [
  "src/rpc/bindings.ts",
  ".pi/chains/implement-bead.chain.md",
] as const;

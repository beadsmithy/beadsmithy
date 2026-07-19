import { useEffect } from "react";
import type { DependencyList } from "react";

export type EffectCleanup = () => void;
// oxlint-disable-next-line typescript/no-invalid-void-type
export type ExternalLifecycleResult = EffectCleanup | undefined | void;
export type ExternalLifecycleEffect = () => ExternalLifecycleResult;

const isEffectCleanup = (
  value: ExternalLifecycleResult
): value is EffectCleanup => typeof value === "function";

/**
 * Runs an external-system lifecycle with the supplied React dependency
 * contract. The lifecycle is re-created after a dependency changes and the
 * previous cleanup runs before the new lifecycle starts.
 *
 * This is the dependency-aware counterpart to `useMountEffect`. It is kept as
 * the single policy seam for the project's no-direct-useEffect rule; callers
 * still have to choose an explicit lifecycle abstraction rather than hiding a
 * raw effect in a component.
 */
export const useExternalLifecycle = (
  effect: ExternalLifecycleEffect,
  dependencies: DependencyList
): void => {
  // The helper intentionally forwards the caller's dependency contract. The
  // exhaustive-deps rule cannot infer dependencies captured by a callback
  // parameter, so the helper's interface makes that contract explicit.
  // oxlint-disable react-hooks/exhaustive-deps
  // oxlint-disable-next-line eslint-js/no-restricted-syntax
  useEffect(() => {
    const result = effect();
    return isEffectCleanup(result) ? result : undefined;
  }, dependencies);
  // oxlint-enable react-hooks/exhaustive-deps
};

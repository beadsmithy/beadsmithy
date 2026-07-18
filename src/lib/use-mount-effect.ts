import { useEffect } from "react";

type EffectCleanup = () => void;
// oxlint-disable-next-line typescript/no-invalid-void-type
type MountEffectResult = EffectCleanup | undefined | void;

const isEffectCleanup = (value: MountEffectResult): value is EffectCleanup =>
  typeof value === "function";

/**
 * Run an effect exactly once when the component mounts and clean up via
 * the returned teardown function on unmount.
 *
 * `useMountEffect` is the documented escape hatch for the project's
 * "no direct `useEffect`" lint policy. It is reserved for genuine
 * external-system lifecycles (Tauri subscriptions, imperative DOM
 * integration, etc.) that cannot be expressed as derived state, an
 * event handler, a remount boundary, or a data-fetching hook. The
 * no-use-effect Oxlint rule is suppressed only at the call site below.
 */
export const useMountEffect = (effect: () => MountEffectResult): void => {
  // The eslint/oxlint-disable directives below keep the
  // react-hooks/exhaustive-deps rule from warning about the
  // intentionally-empty dependency list — this hook exists to run
  // `effect` exactly once on mount.
  // oxlint-disable-next-line no-use-effect/no-direct-use-effect
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const result = effect();
    return isEffectCleanup(result) ? result : undefined;
  }, []);
};

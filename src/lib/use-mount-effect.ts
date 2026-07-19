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
  // Keep each directive adjacent to the rule it suppresses: the official
  // eslint-js selector reports the call below, while the React Hooks rule
  // checks the intentionally-empty dependency list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // oxlint-disable-next-line eslint-js/no-restricted-syntax
  useEffect(() => {
    const result = effect();
    return isEffectCleanup(result) ? result : undefined;
  }, []);
};

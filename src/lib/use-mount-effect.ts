import type { ExternalLifecycleEffect } from "./use-external-lifecycle";
import { useExternalLifecycle } from "./use-external-lifecycle";

/**
 * Run an external-system lifecycle exactly once when the component mounts and
 * clean up via the returned teardown function on unmount.
 *
 * `useMountEffect` is the documented mount-only escape hatch for the
 * project's "no direct `useEffect`" lint policy. It is reserved for genuine
 * external-system lifecycles (Tauri subscriptions, imperative DOM
 * integration, etc.) that cannot be expressed as derived state, an event
 * handler, a remount boundary, or a data-fetching hook. Reactive lifecycles
 * must use `useExternalLifecycle` with their real dependencies instead.
 */
export const useMountEffect = (effect: ExternalLifecycleEffect): void => {
  useExternalLifecycle(effect, []);
};

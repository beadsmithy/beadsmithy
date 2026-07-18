/**
 * Vitest stub for `@wdio/globals`.
 *
 * The WebDriver helper modules import `browser`, `expect`, and `$`
 * from `@wdio/globals`, which is normally injected at runtime by the
 * WebdriverIO runtime. Under vitest, we only exercise the pure
 * selector / formatter helpers in those modules -- the wdio-bound
 * lambdas and assertion helpers are covered end-to-end by the wdio
 * specs -- so this stub provides just enough shape for the modules to
 * load without crashing.
 *
 * Aliased to `@wdio/globals` by `vitest.config.ts`.
 */

export const browser: Record<string, never> = {};
export const expect: Record<string, never> = {};
export const $: (...args: unknown[]) => unknown = () => null;
export const $$: (...args: unknown[]) => unknown = () => null;

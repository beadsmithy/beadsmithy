/**
 * Post-validation failures retain a known target and surface the selector's
 * retry banner. Validation and Git-root failures remain inline picker errors.
 */
export const isRetryableSwitchFailureKind = (
  kind: string | null | undefined
): boolean => kind === "loadFailed" || kind === "storeSaveFailed";

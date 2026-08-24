export interface NavigationIntentState {
  generation: number;
  workspacePath: string | null;
}

export interface NavigationIntentRef {
  current: NavigationIntentState;
}

export const INITIAL_NAVIGATION_INTENT: NavigationIntentState = {
  generation: 0,
  workspacePath: null,
};

export const beginNavigationIntent = (
  intentRef: NavigationIntentRef,
  workspacePath: string | null
): number => {
  const generation = intentRef.current.generation + 1;
  intentRef.current = { generation, workspacePath };
  return generation;
};

export const isCurrentNavigationIntent = (
  intentRef: NavigationIntentRef,
  generation: number
): boolean => intentRef.current.generation === generation;

export const finishNavigationIntent = (
  intentRef: NavigationIntentRef,
  generation: number
): void => {
  if (isCurrentNavigationIntent(intentRef, generation)) {
    intentRef.current.workspacePath = null;
  }
};

export const transitionMatchesNavigationIntent = (
  intentRef: NavigationIntentRef,
  currentWorkspacePath: string | null,
  pendingWorkspacePath: string | null
): boolean => {
  const targetPath = intentRef.current.workspacePath;
  return (
    targetPath === null ||
    targetPath === currentWorkspacePath ||
    targetPath === pendingWorkspacePath
  );
};

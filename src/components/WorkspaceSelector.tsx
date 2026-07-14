import { FolderOpen, RotateCcw, Trash2, X } from "lucide-react";

import type { Workspace, WorkspaceState } from "../rpc/bindings";

export const workspaceBasename = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/u, "");
  const segments = trimmed.split(/[\\/]/u);
  return segments.pop() || path;
};

/** The native picker starts from a useful known root without changing MRU. */
export const pickerDefaultPath = (
  state: WorkspaceState | null
): string | null => {
  if (
    state?.currentWorkspace !== null &&
    state?.currentWorkspace !== undefined
  ) {
    return state.currentWorkspace.path;
  }

  return (
    state?.catalog.find((workspace) => workspace.availability !== "unavailable")
      ?.path ?? null
  );
};

/** Errors that imply the saved catalog itself cannot be read. Render the
 * full-screen Recovery panel rather than a switch-time banner. */
const isCatalogStorageFailure = (kind: string | undefined): boolean =>
  kind === "storeReadFailed";

/** Errors that surface a dismissible Retry banner for a switch attempt.
 * Validation/git-root failures render inline because they happen before any
 * Current commitment; these happen after a committed catalog retain and are
 * retryable on the same known target. */
const isSwitchRetryableFailure = (kind: string | undefined): boolean =>
  kind === "loadFailed" || kind === "storeSaveFailed";

const WorkspaceEntry = ({
  current,
  onRemove,
  onSelect,
  workspace,
}: {
  current: boolean;
  onRemove: (path: string) => void;
  onSelect: (path: string) => void;
  workspace: Workspace;
}) => {
  const unavailable = workspace.availability === "unavailable";
  const basename = workspaceBasename(workspace.path);
  const availabilityLabel = unavailable
    ? "Unavailable; select to retry"
    : "Available";

  return (
    <li className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-white/5">
      <button
        aria-current={current ? "true" : undefined}
        aria-label={`${basename}, ${workspace.path}, ${availabilityLabel}`}
        className="min-w-0 flex-1 p-1 text-left font-mono text-xs text-text-main"
        onClick={() => onSelect(workspace.path)}
        type="button"
      >
        <span className="block truncate">{basename}</span>
        <span className="block text-[10px] break-all text-muted">
          {workspace.path}
        </span>
        {unavailable ? (
          <span className="block text-[10px] text-red-200">Unavailable</span>
        ) : null}
      </button>
      <button
        aria-label={`Remove ${workspace.path}`}
        className="rounded p-1 text-muted hover:bg-white/5 hover:text-text-main"
        onClick={() => onRemove(workspace.path)}
        type="button"
      >
        <Trash2 aria-hidden="true" className="size-3" />
      </button>
    </li>
  );
};

const SwitchFailureBanner = ({
  errorMessage,
  onDismiss,
  onRetry,
}: {
  errorMessage: string;
  onDismiss: () => void;
  onRetry: () => void;
}) => (
  <div
    aria-label="Switch failed"
    className="mt-2 rounded border border-danger/40 bg-danger/10 p-2"
    data-testid="switch-failure-banner"
    role="alert"
  >
    <div className="flex items-start justify-between gap-2">
      <p className="text-xs leading-5 text-text-main">{errorMessage}</p>
      <button
        aria-label="Dismiss switch failure"
        className="shrink-0 rounded p-0.5 text-muted hover:bg-white/5 hover:text-text-main"
        onClick={onDismiss}
        type="button"
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    </div>
    <div className="mt-2 flex gap-3">
      <button
        className="inline-flex items-center gap-1 text-xs text-primary underline"
        onClick={onRetry}
        type="button"
      >
        Retry
      </button>
    </div>
  </div>
);

const StorageFailureRecoveryPanel = ({
  message,
  onResetMemory,
  onRetryMemory,
}: {
  message: string;
  onResetMemory: () => void;
  onRetryMemory: () => void;
}) => (
  <div
    className="rounded border border-danger/40 bg-danger/10 p-2"
    role="alert"
  >
    <p className="text-xs text-text-main">{message}</p>
    <div className="mt-2 flex gap-3">
      <button
        className="inline-flex items-center gap-1 text-xs text-primary underline"
        onClick={onRetryMemory}
        type="button"
      >
        Retry
      </button>
      <button
        className="inline-flex items-center gap-1 text-xs text-primary underline"
        onClick={onResetMemory}
        type="button"
      >
        <RotateCcw aria-hidden="true" className="size-3" /> Reset local memory
      </button>
    </div>
  </div>
);

const PendingLabel = ({
  pendingPath,
  canCancel,
  onCancel,
}: {
  pendingPath: string;
  canCancel: boolean;
  onCancel: () => void;
}) => (
  <span
    aria-live="polite"
    className="flex items-center gap-2"
    data-pending-path={pendingPath}
  >
    <span>Loading {workspaceBasename(pendingPath)}…</span>
    {canCancel ? (
      <button
        aria-label="Cancel workspace switch"
        className="rounded border border-border-main px-1.5 py-0.5 text-[10px] text-text-main hover:bg-white/5"
        data-testid="cancel-workspace-switch"
        onClick={onCancel}
        type="button"
      >
        Cancel
      </button>
    ) : null}
  </span>
);

const CurrentWorkspacePanel = ({
  catalog,
  current,
  error,
  onChoose,
  onDismissSwitchError,
  onRemove,
  onRetryLastSwitch,
  onSelect,
  showSwitchBanner,
}: {
  catalog: Workspace[];
  current: Workspace | null;
  error: { kind: string; message: string } | null;
  onChoose: () => void;
  onDismissSwitchError?: () => void;
  onRemove: (path: string) => void;
  onRetryLastSwitch?: () => void;
  onSelect: (path: string) => void;
  showSwitchBanner: boolean;
}) => {
  const showInlineError = Boolean(
    error !== null && !isCatalogStorageFailure(error.kind) && !showSwitchBanner
  );
  return (
    <>
      {current ? (
        <div className="font-mono text-xs text-text-main">
          <p className="truncate">{workspaceBasename(current.path)}</p>
          <p className="text-[10px] break-all text-muted">{current.path}</p>
        </div>
      ) : (
        <p className="font-mono text-xs text-muted">No workspace selected</p>
      )}
      <button
        className="mt-2 inline-flex items-center gap-1 rounded border border-border-main px-2 py-1 text-xs text-text-main hover:bg-white/5"
        onClick={onChoose}
        type="button"
      >
        <FolderOpen aria-hidden="true" className="size-3" /> Choose folder
      </button>
      {showInlineError && error ? (
        <p className="mt-2 text-xs text-red-200" role="alert">
          {error.message}
        </p>
      ) : null}
      {showSwitchBanner && error && onRetryLastSwitch ? (
        <SwitchFailureBanner
          errorMessage={error.message}
          onDismiss={() => onDismissSwitchError?.()}
          onRetry={() => onRetryLastSwitch()}
        />
      ) : null}
      {catalog.length > 0 ? (
        <ul aria-label="Known workspaces" className="mt-2 space-y-0.5">
          {catalog.map((workspace) => (
            <WorkspaceEntry
              current={workspace.path === current?.path}
              key={workspace.path}
              onRemove={onRemove}
              onSelect={onSelect}
              workspace={workspace}
            />
          ))}
        </ul>
      ) : null}
    </>
  );
};

const SelectorBody = ({
  canCancel,
  catalog,
  current,
  error,
  onCancel,
  onChoose,
  onDismiss,
  onRemove,
  onResetMemory,
  onRetryLastSwitch,
  onRetryMemory,
  onSelect,
  pendingPath,
  showLoadingLabel,
  showStorageFailure,
  showSwitchBanner,
}: {
  canCancel: boolean;
  catalog: Workspace[];
  current: Workspace | null;
  error: WorkspaceState["error"];
  onCancel: (() => void) | null;
  onChoose: () => void;
  onDismiss: (() => void) | null;
  onRemove: (path: string) => void;
  onResetMemory: () => void;
  onRetryLastSwitch: (() => void) | null;
  onRetryMemory: () => void;
  onSelect: (path: string) => void;
  pendingPath: string | null;
  showLoadingLabel: boolean;
  showStorageFailure: boolean;
  showSwitchBanner: boolean;
}) => (
  <section aria-label="Workspace" className="border-t border-border-main p-3">
    <div className="mb-1 flex items-center justify-between font-mono text-[10px] tracking-wider text-muted uppercase">
      <span>Workspace</span>
      {showLoadingLabel && pendingPath !== null && onCancel !== null ? (
        <PendingLabel
          canCancel={canCancel}
          onCancel={() => onCancel()}
          pendingPath={pendingPath}
        />
      ) : null}
    </div>
    {showStorageFailure ? (
      <StorageFailureRecoveryPanel
        message={error?.message ?? ""}
        onResetMemory={onResetMemory}
        onRetryMemory={onRetryMemory}
      />
    ) : (
      <CurrentWorkspacePanel
        catalog={catalog}
        current={current}
        error={error ?? null}
        onChoose={onChoose}
        onDismissSwitchError={onDismiss ?? undefined}
        onRemove={onRemove}
        onRetryLastSwitch={onRetryLastSwitch ?? undefined}
        onSelect={onSelect}
        showSwitchBanner={showSwitchBanner}
      />
    )}
  </section>
);

const deriveSelectorState = (input: {
  state: WorkspaceState | null;
  switchErrorDismissed: boolean | undefined;
  onCancel: (() => void) | undefined;
  onRetryLastSwitch: (() => void) | undefined;
}) => {
  const current = input.state?.currentWorkspace;
  const pending = input.state?.pendingWorkspace;
  const error = input.state?.error;
  const errorKind = error?.kind;
  const storageFailure = isCatalogStorageFailure(errorKind);
  const switchFailure = isSwitchRetryableFailure(errorKind);
  const showSwitchBanner =
    !storageFailure &&
    switchFailure &&
    input.switchErrorDismissed !== true &&
    input.onRetryLastSwitch !== undefined;
  const pendingPath = pending?.path ?? null;
  const showLoadingLabel = pendingPath !== null;
  const canCancel = input.onCancel !== undefined && pendingPath !== null;
  return {
    canCancel,
    catalog: input.state?.catalog ?? [],
    current: current ?? null,
    error,
    pendingPath,
    showLoadingLabel,
    showSwitchBanner,
    storageFailure,
  };
};

export const WorkspaceSelector = ({
  onCancel,
  onChoose,
  onDismissSwitchError,
  onRemove,
  onResetMemory,
  onRetryLastSwitch,
  onRetryMemory,
  onSelect,
  state,
  switchErrorDismissed,
}: {
  onCancel?: () => void;
  onChoose: () => void;
  onDismissSwitchError?: () => void;
  onRemove: (path: string) => void;
  onResetMemory: () => void;
  onRetryLastSwitch?: () => void;
  onRetryMemory: () => void;
  onSelect: (path: string) => void;
  state: WorkspaceState | null;
  switchErrorDismissed?: boolean;
}) => {
  const view = deriveSelectorState({
    onCancel,
    onRetryLastSwitch,
    state,
    switchErrorDismissed,
  });

  return (
    <SelectorBody
      canCancel={view.canCancel}
      catalog={view.catalog}
      current={view.current}
      error={view.error ?? null}
      onCancel={onCancel ?? null}
      onChoose={onChoose}
      onDismiss={onDismissSwitchError ?? null}
      onRemove={onRemove}
      onResetMemory={onResetMemory}
      onRetryLastSwitch={onRetryLastSwitch ?? null}
      onRetryMemory={onRetryMemory}
      onSelect={onSelect}
      pendingPath={view.pendingPath}
      showLoadingLabel={view.showLoadingLabel}
      showStorageFailure={view.storageFailure}
      showSwitchBanner={view.showSwitchBanner}
    />
  );
};

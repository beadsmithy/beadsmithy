import { FolderOpen, RotateCcw, Trash2 } from "lucide-react";

import type { Workspace, WorkspaceState } from "../rpc/bindings";

export const workspaceBasename = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/u, "");
  const segments = trimmed.split(/[\\/]/u);
  return segments[segments.length - 1] || path;
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
  const label = unavailable
    ? `${workspaceBasename(workspace.path)} (Unavailable)`
    : workspaceBasename(workspace.path);

  return (
    <li className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-white/5">
      <button
        aria-current={current ? "true" : undefined}
        className="min-w-0 flex-1 truncate p-1 text-left font-mono text-xs text-text-main disabled:text-muted"
        onClick={() => onSelect(workspace.path)}
        title={workspace.path}
        type="button"
      >
        {label}
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

export const WorkspaceSelector = ({
  onChoose,
  onRemove,
  onResetMemory,
  onRetryMemory,
  onSelect,
  state,
}: {
  onChoose: () => void;
  onRemove: (path: string) => void;
  onResetMemory: () => void;
  onRetryMemory: () => void;
  onSelect: (path: string) => void;
  state: WorkspaceState | null;
}) => {
  const storageFailure =
    state?.error?.kind === "storeReadFailed" ||
    state?.error?.kind === "storeSaveFailed";
  const current = state?.currentWorkspace;

  return (
    <section aria-label="Workspace" className="border-t border-border-main p-3">
      <div className="mb-1 flex items-center justify-between font-mono text-[10px] tracking-wider text-muted uppercase">
        <span>Workspace</span>
        {state?.pendingWorkspace ? <span>Loading…</span> : null}
      </div>
      {storageFailure ? (
        <div
          className="rounded border border-danger/40 bg-danger/10 p-2"
          role="alert"
        >
          <p className="text-xs text-text-main">{state.error?.message}</p>
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
              <RotateCcw aria-hidden="true" className="size-3" /> Reset local
              memory
            </button>
          </div>
        </div>
      ) : (
        <>
          {current ? (
            <p
              className="truncate font-mono text-xs text-text-main"
              title={current.path}
            >
              {workspaceBasename(current.path)}
            </p>
          ) : (
            <p className="font-mono text-xs text-muted">
              No workspace selected
            </p>
          )}
          <button
            className="mt-2 inline-flex items-center gap-1 rounded border border-border-main px-2 py-1 text-xs text-text-main hover:bg-white/5"
            onClick={onChoose}
            type="button"
          >
            <FolderOpen aria-hidden="true" className="size-3" /> Choose folder
          </button>
          {state?.error ? (
            <p className="mt-2 text-xs text-red-200" role="alert">
              {state.error.message}
            </p>
          ) : null}
          {state && state.catalog.length > 0 ? (
            <ul aria-label="Known workspaces" className="mt-2 space-y-0.5">
              {state.catalog.map((workspace) => (
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
      )}
    </section>
  );
};

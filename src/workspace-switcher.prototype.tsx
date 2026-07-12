// PROTOTYPE — Three Current Workspace switcher variations on the existing app,
// switchable with ?prototype=workspace-switcher&variant=A.
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

type PrototypeScenario =
  | "empty"
  | "ready"
  | "validating"
  | "validation-error"
  | "load-error"
  | "removed";
type PrototypeVariant = "A" | "B" | "C";

const VARIANTS: Record<PrototypeVariant, string> = {
  A: "Inline selector",
  B: "Workspace drawer",
  C: "Status dock",
};

const SCENARIOS: Record<PrototypeScenario, string> = {
  empty: "No workspace",
  ready: "Catalog open",
  validating: "Validating",
  "validation-error": "Validation error",
  "load-error": "Load error",
  removed: "Removed current",
};

const workspaceName = "beadsmith";
const workspacePath = "/Users/tomas/projects/beadsmith";

const readSearchParam = <T extends string>(key: string, fallback: T): T =>
  (new URLSearchParams(window.location.search).get(key) as T | null) ?? fallback;

const updateSearchParams = (changes: Record<string, string>): void => {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(changes)) {
    url.searchParams.set(key, value);
  }
  window.history.replaceState({}, "", url);
};

const WorkspaceRow = ({
  active = false,
  unavailable = false,
}: {
  active?: boolean;
  unavailable?: boolean;
}) => (
  <div
    className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left ${
      active
        ? "border-accent/60 bg-accent/10"
        : "border-border-main bg-background/40"
    } ${unavailable ? "opacity-60" : ""}`}
  >
    <FolderOpen className="size-4 shrink-0 text-accent" />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm text-text-main">
        {unavailable ? "old-project" : workspaceName}
      </span>
      <span className="block truncate font-mono text-[10px] text-muted">
        {unavailable ? "/Users/tomas/projects/old-project" : workspacePath}
      </span>
    </span>
    {active ? <span className="size-1.5 rounded-full bg-success" /> : null}
    {unavailable ? <AlertTriangle className="size-3.5 text-danger" /> : null}
  </div>
);

const EmptyWorkspace = () => (
  <div className="rounded-lg border border-dashed border-border-main bg-background/30 px-4 py-5 text-center">
    <FolderOpen className="mx-auto mb-2 size-5 text-muted" />
    <p className="text-sm font-medium text-text-main">No Current Workspace</p>
    <p className="mt-1 text-xs leading-5 text-muted">
      Choose a Beadwork repository to begin.
    </p>
    <button
      className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-background"
      type="button"
    >
      <Plus className="size-3.5" />
      Choose folder
    </button>
  </div>
);

const ValidationFailure = () => (
  <div className="rounded-md border border-danger/50 bg-danger/10 p-3">
    <div className="flex gap-2">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
      <p className="text-xs leading-5 text-text-main">
        This directory is not a Beadwork workspace. Choose a Git repository
        initialized with Beadwork.
      </p>
    </div>
  </div>
);

const LoadFailure = () => (
  <div className="rounded-md border border-danger/50 bg-danger/10 p-3">
    <div className="flex gap-2">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
      <p className="min-w-0 flex-1 text-xs leading-5 text-text-main">
        Could not load issues. Your previous workspace is still shown.
      </p>
      <button
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border-main px-2 text-xs text-text-main"
        type="button"
      >
        <RotateCcw className="size-3" />
        Retry
      </button>
    </div>
  </div>
);

const InlineSelector = ({ scenario }: { scenario: PrototypeScenario }) => (
  <section className="space-y-3 p-4">
    <p className="font-mono text-[10px] tracking-wider text-muted uppercase">
      Current Workspace
    </p>
    {scenario === "empty" || scenario === "removed" ? <EmptyWorkspace /> : null}
    {scenario === "validating" ? (
      <div className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-3 text-sm text-text-main">
        <LoaderCircle className="size-4 animate-spin text-accent" />
        Validating {workspaceName}…
      </div>
    ) : null}
    {scenario === "validation-error" ? <ValidationFailure /> : null}
    {scenario === "ready" || scenario === "load-error" ? (
      <>
        <button
          className="flex w-full items-center gap-2 rounded-md border border-accent/60 bg-accent/10 px-2.5 py-2 text-left"
          type="button"
        >
          <FolderOpen className="size-4 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-text-main">{workspaceName}</span>
            <span className="block truncate font-mono text-[10px] text-muted">
              {workspacePath}
            </span>
          </span>
          <ChevronDown className="size-4 text-muted" />
        </button>
        {scenario === "load-error" ? <LoadFailure /> : null}
        <div className="space-y-1.5 border-l border-border-main pl-3">
          <p className="font-mono text-[10px] text-muted uppercase">Remembered</p>
          <WorkspaceRow active />
          <WorkspaceRow unavailable />
          <button
            className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-muted hover:text-text-main"
            type="button"
          >
            <Plus className="size-3.5" />
            Choose another folder
          </button>
        </div>
      </>
    ) : null}
  </section>
);

const WorkspaceDrawer = ({ scenario }: { scenario: PrototypeScenario }) => (
  <section className="flex h-full flex-col border-l border-border-main bg-surface-container-low px-4 py-5">
    <div className="mb-5 flex items-center justify-between">
      <div>
        <p className="text-sm font-semibold text-text-main">Workspaces</p>
        <p className="mt-0.5 text-xs text-muted">Choose what Beadsmith shows</p>
      </div>
      <button
        aria-label="Choose another folder"
        className="grid size-8 place-items-center rounded-md border border-border-main text-muted hover:text-text-main"
        type="button"
      >
        <Plus className="size-4" />
      </button>
    </div>
    {scenario === "empty" || scenario === "removed" ? <EmptyWorkspace /> : null}
    {scenario === "validation-error" ? <ValidationFailure /> : null}
    {scenario === "validating" ? (
      <div className="flex items-center gap-2 py-3 text-sm text-text-main">
        <LoaderCircle className="size-4 animate-spin text-accent" />
        Checking folder…
      </div>
    ) : null}
    {scenario === "ready" || scenario === "load-error" ? (
      <div className="space-y-2">
        <WorkspaceRow active />
        <WorkspaceRow unavailable />
        {scenario === "load-error" ? <LoadFailure /> : null}
      </div>
    ) : null}
    <div className="mt-auto border-t border-border-main pt-4">
      <button
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs text-muted hover:bg-white/5 hover:text-danger"
        type="button"
      >
        <Trash2 className="size-3.5" />
        Remove selected workspace
      </button>
    </div>
  </section>
);

const StatusDock = ({ scenario }: { scenario: PrototypeScenario }) => (
  <section className="m-3 rounded-lg border border-border-main bg-surface-container p-3">
    <div className="mb-3 flex items-start gap-2">
      <span className="mt-1 grid size-7 place-items-center rounded-md bg-accent/15 text-accent">
        <FolderOpen className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted">Current Workspace</span>
        <span className="block truncate text-sm font-medium text-text-main">
          {scenario === "empty" || scenario === "removed" ? "None selected" : workspaceName}
        </span>
      </span>
      <button aria-label="Workspace actions" className="text-muted" type="button">
        <MoreHorizontal className="size-4" />
      </button>
    </div>
    {scenario === "empty" || scenario === "removed" ? <EmptyWorkspace /> : null}
    {scenario === "validating" ? (
      <div className="flex items-center gap-2 rounded-md bg-background/50 px-3 py-2 text-xs text-text-main">
        <LoaderCircle className="size-3.5 animate-spin text-accent" />
        Checking Beadwork setup…
      </div>
    ) : null}
    {scenario === "validation-error" ? <ValidationFailure /> : null}
    {scenario === "ready" || scenario === "load-error" ? (
      <>
        <p className="truncate font-mono text-[10px] text-muted">{workspacePath}</p>
        <div className="mt-3 flex gap-2">
          <button
            className="h-8 flex-1 rounded-md border border-border-main text-xs text-text-main"
            type="button"
          >
            Switch
          </button>
          <button
            className="h-8 flex-1 rounded-md border border-border-main text-xs text-muted"
            type="button"
          >
            Remove
          </button>
        </div>
        {scenario === "load-error" ? <div className="mt-3"><LoadFailure /></div> : null}
      </>
    ) : null}
  </section>
);

const PrototypeBar = ({
  scenario,
  setScenario,
  variant,
  setVariant,
}: {
  scenario: PrototypeScenario;
  setScenario: (scenario: PrototypeScenario) => void;
  variant: PrototypeVariant;
  setVariant: (variant: PrototypeVariant) => void;
}) => {
  const variantKeys = Object.keys(VARIANTS) as PrototypeVariant[];
  const cycle = (direction: -1 | 1): void => {
    const nextIndex = (variantKeys.indexOf(variant) + direction + variantKeys.length) % variantKeys.length;
    setVariant(variantKeys[nextIndex]);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable=true]")) {
        return;
      }
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-white/20 bg-zinc-950 px-2 py-2 shadow-2xl">
      <button aria-label="Previous prototype variant" className="grid size-8 place-items-center rounded-md text-text-main hover:bg-white/10" onClick={() => cycle(-1)} type="button">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-42 text-center font-mono text-[11px] text-text-main">
        {variant} — {VARIANTS[variant]}
      </span>
      <button aria-label="Next prototype variant" className="grid size-8 place-items-center rounded-md text-text-main hover:bg-white/10" onClick={() => cycle(1)} type="button">
        <ChevronRight className="size-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-white/15" />
      <label className="sr-only" htmlFor="prototype-scenario">Prototype scenario</label>
      <select
        className="h-8 rounded-md border border-white/20 bg-zinc-900 px-2 text-[11px] text-text-main"
        id="prototype-scenario"
        onChange={(event) => setScenario(event.target.value as PrototypeScenario)}
        value={scenario}
      >
        {Object.entries(SCENARIOS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </div>
  );
};

export const WorkspaceSwitcherPrototype = () => {
  const [variant, setVariant] = useState<PrototypeVariant>(() => readSearchParam("variant", "A"));
  const [scenario, setScenario] = useState<PrototypeScenario>(() => readSearchParam("scenario", "ready"));

  const changeVariant = (nextVariant: PrototypeVariant): void => {
    updateSearchParams({ variant: nextVariant });
    setVariant(nextVariant);
  };
  const changeScenario = (nextScenario: PrototypeScenario): void => {
    updateSearchParams({ scenario: nextScenario });
    setScenario(nextScenario);
  };

  const control = variant === "A" ? <InlineSelector scenario={scenario} /> : variant === "B" ? <WorkspaceDrawer scenario={scenario} /> : <StatusDock scenario={scenario} />;

  return (
    <main className="flex h-screen bg-background font-primary text-text-main">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border-main bg-surface">
        <div className="flex h-12 items-center px-4 text-sm font-semibold">Beadwork</div>
        <div className="flex-1 p-3 text-sm text-muted">Existing Issue Explorer context</div>
        {variant === "A" ? <div className="border-t border-border-main">{control}</div> : null}
      </aside>
      <section className="flex-1 p-10">
        <p className="font-mono text-xs text-muted uppercase">Prototype only</p>
        <h1 className="mt-2 text-2xl font-semibold">Current Workspace control</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted">Compare how workspace choice, failure, retry, and removal feel against the surrounding Issue Explorer.</p>
      </section>
      {variant === "B" ? <aside className="w-80">{control}</aside> : null}
      {variant === "C" ? <aside className="w-80 border-l border-border-main bg-surface">{control}</aside> : null}
      <PrototypeBar scenario={scenario} setScenario={changeScenario} setVariant={changeVariant} variant={variant} />
    </main>
  );
};

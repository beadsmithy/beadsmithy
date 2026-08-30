import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronLeft, ChevronRight, PanelLeft } from "lucide-react";

interface TitlebarProps {
  backDisabled?: boolean;
  backLabel?: string | null;
  forwardDisabled?: boolean;
  forwardLabel?: string | null;
  onBack?: () => void;
  onForward?: () => void;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
}

export const Titlebar = ({
  backDisabled = true,
  backLabel = null,
  forwardDisabled = true,
  forwardLabel = null,
  onBack,
  onForward,
  onToggleSidebar,
  sidebarCollapsed,
}: TitlebarProps) => (
  <header className="border-border-main bg-surface flex h-10 shrink-0 items-center border-b select-none">
    <div className="flex items-center gap-2 pr-2 pl-3">
      <button
        aria-label="Close"
        className="size-3 rounded-full bg-red-500 hover:bg-red-400"
        onClick={async () => {
          try {
            await getCurrentWindow().close();
          } catch {
            // The window may already be closing; no UI recovery is possible.
          }
        }}
        type="button"
      />
      <button
        aria-label="Minimize"
        className="size-3 rounded-full bg-yellow-500 hover:bg-yellow-400"
        onClick={async () => {
          try {
            await getCurrentWindow().minimize();
          } catch {
            // A native window failure has no recoverable UI state.
          }
        }}
        type="button"
      />
      <button
        aria-label="Maximize"
        className="size-3 rounded-full bg-green-500 hover:bg-green-400"
        onClick={async () => {
          try {
            await getCurrentWindow().toggleMaximize();
          } catch {
            // A native window failure has no recoverable UI state.
          }
        }}
        type="button"
      />
    </div>

    <div className="ml-3 flex items-center gap-1" data-issue-navigation>
      <button
        aria-label={backLabel === null ? "Back" : `Back to ${backLabel}`}
        className="text-muted hover:text-text-main flex size-7 items-center justify-center rounded transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={backDisabled}
        onClick={onBack}
        title={backLabel === null ? "Back" : `Back to ${backLabel}`}
        type="button"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </button>
      <button
        aria-label={
          forwardLabel === null ? "Forward" : `Forward to ${forwardLabel}`
        }
        className="text-muted hover:text-text-main flex size-7 items-center justify-center rounded transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={forwardDisabled}
        onClick={onForward}
        title={forwardLabel === null ? "Forward" : `Forward to ${forwardLabel}`}
        type="button"
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
    </div>

    <button
      aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-pressed={!sidebarCollapsed}
      className="text-muted hover:text-text-main ml-4 flex size-7 items-center justify-center rounded transition-colors hover:bg-white/5"
      onClick={onToggleSidebar}
      type="button"
    >
      <PanelLeft className="size-4" />
    </button>

    <div className="flex-1 self-stretch" data-tauri-drag-region />
  </header>
);

import { getCurrentWindow } from "@tauri-apps/api/window";
import { PanelLeft, PanelLeftOpen } from "lucide-react";

interface TitlebarProps {
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
}

export const Titlebar = ({
  onToggleSidebar,
  sidebarCollapsed,
}: TitlebarProps) => {
  const SidebarIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeft;

  return (
    <header className="flex h-10 shrink-0 items-center border-b border-border-main bg-surface select-none">
      <div className="flex items-center gap-2 pr-2 pl-3">
        <button
          aria-label="Close"
          className="size-3 rounded-full bg-red-500 hover:bg-red-400"
          onClick={() => void getCurrentWindow().close()}
          type="button"
        />
        <button
          aria-label="Minimize"
          className="size-3 rounded-full bg-yellow-500 hover:bg-yellow-400"
          onClick={() => void getCurrentWindow().minimize()}
          type="button"
        />
        <button
          aria-label="Maximize"
          className="size-3 rounded-full bg-green-500 hover:bg-green-400"
          onClick={() => void getCurrentWindow().toggleMaximize()}
          type="button"
        />
      </div>

      <button
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-pressed={!sidebarCollapsed}
        className="ml-4 flex size-7 items-center justify-center rounded text-muted transition-colors hover:bg-white/5 hover:text-text-main"
        onClick={onToggleSidebar}
        type="button"
      >
        <SidebarIcon className="size-4" />
      </button>

      <div className="flex-1 self-stretch" data-tauri-drag-region />
    </header>
  );
};

import {
  CheckCircle2,
  CircleSlash,
  Clock,
  FileText,
  Folder,
  Inbox,
  PlayCircle,
  Search,
} from "lucide-react";

export default function App() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background font-primary text-text-main antialiased">
      {/* Left Sidebar */}
      <nav className="flex w-60 shrink-0 flex-col border-r border-border-main bg-surface">
        <div className="flex h-12 items-center px-4 text-[14px] font-semibold">
          <Folder className="mr-2 size-4 text-accent" />
          <span>Beadwork</span>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          <div className="px-4 py-2 font-mono text-[10px] tracking-wider text-muted uppercase">
            Views
          </div>
          <div className="px-2">
            <button className="flex w-full items-center rounded-md bg-white/5 px-2 py-1.5 text-sm text-primary disabled:opacity-100">
              <Inbox className="mr-2 size-4 text-muted" />
              All
            </button>
            <button
              disabled
              className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:bg-white/5 hover:text-text-main"
            >
              <CheckCircle2 className="mr-2 size-4" />
              Ready
            </button>
            <button
              disabled
              className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:bg-white/5 hover:text-text-main"
            >
              <CircleSlash className="mr-2 size-4" />
              Blocked
            </button>
          </div>

          <div className="px-4 py-2 pt-6 font-mono text-[10px] tracking-wider text-muted uppercase">
            States
          </div>
          <div className="px-2">
            <button
              disabled
              className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:bg-white/5 hover:text-text-main"
            >
              <div className="mr-2 size-4 rounded-full border border-muted" />
              Open
            </button>
            <button
              disabled
              className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:bg-white/5 hover:text-text-main"
            >
              <PlayCircle className="mr-2 size-4" />
              In-Progress
            </button>
            <button
              disabled
              className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:bg-white/5 hover:text-text-main"
            >
              <CheckCircle2 className="mr-2 size-4" />
              Closed
            </button>
            <button
              disabled
              className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:bg-white/5 hover:text-text-main"
            >
              <Clock className="mr-2 size-4" />
              Deferred
            </button>
          </div>
        </div>

        <div className="border-t border-border-main p-4">
          <div className="mb-1 flex items-center justify-between font-mono text-[10px] tracking-wider text-muted uppercase">
            <span>Current Directory</span>
            <span className="opacity-50">⇄</span>
          </div>
          <div
            className="truncate font-mono text-xs text-text-main"
            title="/Users/dev/work/portal"
          >
            /Users/dev/work/portal
          </div>
        </div>
      </nav>

      {/* Middle Pane: Issue List */}
      <section className="flex w-[320px] shrink-0 flex-col border-r border-border-main bg-background">
        <div className="flex h-14 items-center border-b border-border-main p-2">
          <div className="relative w-full">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              disabled
              type="text"
              placeholder="Search issues..."
              className="w-full rounded-md border border-border-main bg-surface py-1.5 pr-12 pl-9 text-sm text-text-main placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-50"
            />
            <div className="absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border-main px-1.5 py-0.5 font-mono text-[10px] text-muted">
              Cmd+F
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Static Mock Items */}
          <button className="w-full border-b border-border-main p-3 text-left transition-colors hover:bg-surface/50 focus:bg-surface focus:outline-none">
            <div className="mb-1 flex items-center gap-2">
              <div className="size-1.5 rounded-full bg-danger"></div>
              <span className="font-mono text-[12px] text-muted">APP-101</span>
            </div>
            <div className="truncate text-[13px] font-medium text-primary">
              Update authentication flow with new tokens
            </div>
          </button>

          <button className="w-full border-b border-border-main p-3 text-left transition-colors hover:bg-surface/50 focus:bg-surface focus:outline-none">
            <div className="mb-1 flex items-center gap-2">
              <div className="size-1.5 rounded-full bg-success"></div>
              <span className="font-mono text-[12px] text-muted">APP-102</span>
            </div>
            <div className="truncate text-[13px] font-medium text-text-main">
              Refactor dashboard grid layout
            </div>
          </button>

          <button className="w-full border-b border-border-main p-3 text-left transition-colors hover:bg-surface/50 focus:bg-surface focus:outline-none">
            <div className="mb-1 flex items-center gap-2">
              <div className="size-1.5 rounded-full border border-muted"></div>
              <span className="font-mono text-[12px] text-muted">APP-103</span>
            </div>
            <div className="truncate text-[13px] font-medium text-text-main">
              Implement skeleton loaders for lists
            </div>
          </button>

          <button className="w-full border-b border-border-main p-3 text-left transition-colors hover:bg-surface/50 focus:bg-surface focus:outline-none">
            <div className="mb-1 flex items-center gap-2">
              <div className="size-1.5 rounded-full bg-success"></div>
              <span className="font-mono text-[12px] text-muted">SYS-042</span>
            </div>
            <div className="truncate text-[13px] font-medium text-text-main">
              Migrate local database schema
            </div>
          </button>
        </div>
      </section>

      {/* Right Pane: Issue Detail (Empty State) */}
      <main className="flex flex-1 flex-col items-center justify-center bg-background p-8">
        <div className="mb-6 flex size-16 items-center justify-center rounded-2xl border border-border-main bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <FileText className="size-8 text-muted" strokeWidth={1.5} />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-primary">
          No issue selected
        </h2>
        <p className="max-w-sm text-center text-sm text-muted">
          Select an issue from the list to view its details, or use{" "}
          <span className="mx-1 inline-flex items-center justify-center rounded border border-border-main bg-surface px-1.5 py-0.5 font-mono text-[10px]">
            Cmd+K
          </span>{" "}
          to find something specific.
        </p>
      </main>
    </div>
  );
}

import { RotateCcw } from "lucide-react";

import { MarkdownContent } from "../components/MarkdownContent";
import type { AppSettingsHookState } from "./app-settings";

const PREVIEW_MARKDOWN = [
  "## Preview typography",
  "",
  "This is **prose** with *emphasis* and a [safe link](https://example.com).",
  "",
  "- unordered one",
  "- unordered two",
  "",
  "1. ordered one",
  "2. ordered two",
  "",
  "> A blockquote for checking rhythm.",
  "",
  "Inline `code` here.",
  "",
  "```ts",
  "const sample = true;",
  "```",
  "",
  "| col | val |",
  "|-----|-----|",
  "| a   | 1   |",
].join("\n");

const DEFAULT_FONT_SIZE_PX = 14;

interface SettingsPageProps {
  className?: string;
  onDraftChange: (value: string) => void;
  onReset: () => void;
  onRetry: () => void;
  state: AppSettingsHookState;
}

export const SettingsPage = ({
  className,
  onDraftChange,
  onReset,
  onRetry,
  state,
}: SettingsPageProps) => {
  const inputId = "markdown-font-size";
  const helpId = "markdown-font-size-help";
  const errorId = "markdown-font-size-error";
  const statusId = "markdown-font-size-status";

  const { validationError } = state;
  const { saveError } = state;
  const { loadWarning } = state;

  const isResetDisabled =
    state.draft === String(DEFAULT_FONT_SIZE_PX) &&
    state.appliedFontSizePx === DEFAULT_FONT_SIZE_PX &&
    state.confirmedFontSizePx === DEFAULT_FONT_SIZE_PX &&
    loadWarning === null &&
    saveError === null;

  const statusText = (() => {
    if (state.loadStatus === "loading") {
      return "Loading settings…";
    }

    if (saveError) {
      return `Not saved: ${saveError.message}`;
    }

    if (validationError) {
      return state.saveStatus === "saved" ? "Saved" : "";
    }

    if (state.saveStatus === "saving") {
      return "Saving…";
    }

    if (state.saveStatus === "saved") {
      return "Saved";
    }

    return "";
  })();

  const describedBy = [helpId];
  if (validationError) {
    describedBy.push(errorId);
  }

  return (
    <main
      aria-label="Settings"
      className={`bg-background flex-1 overflow-y-auto ${className ?? ""}`}
    >
      <div className="mx-auto max-w-100 px-6 py-8">
        <h1 className="text-primary text-lg font-semibold">Settings</h1>

        <section className="mt-6">
          <h2 className="text-muted font-mono text-[10px] tracking-wider uppercase">
            Markdown Typography
          </h2>
          <p className="text-muted mt-1 text-sm">
            The base size for issue descriptions and comments across all
            workspaces.
          </p>

          <div className="mt-4">
            <label className="sr-only" htmlFor={inputId}>
              Base font size in pixels
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  aria-describedby={describedBy.join(" ")}
                  aria-invalid={state.validationError !== null}
                  className="border-border-main bg-surface text-text-main focus:border-accent h-10 w-full [appearance:textfield] rounded-md border px-3 py-2 pr-10 text-sm focus:outline-none disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  disabled={state.loadStatus === "loading"}
                  id={inputId}
                  max={72}
                  min={8}
                  onChange={(event) => onDraftChange(event.target.value)}
                  step={1}
                  type="number"
                  value={state.draft}
                />
                <span
                  aria-hidden="true"
                  className="text-muted absolute top-1/2 right-3 -translate-y-1/2 text-sm"
                >
                  px
                </span>
              </div>
              <button
                aria-label="Reset font size to 14 px"
                className="border-border-main bg-surface text-text-main inline-flex h-10 items-center gap-1 rounded-md border px-3 text-sm hover:bg-white/5 disabled:opacity-50"
                disabled={isResetDisabled}
                onClick={onReset}
                type="button"
              >
                <RotateCcw className="size-3" />
                Reset
              </button>
            </div>

            <p className="text-muted mt-2 text-xs" id={helpId}>
              Enter a whole number from 8 to 72 px.
            </p>

            {validationError ? (
              <p className="mt-2 text-xs text-red-200" id={errorId}>
                {validationError}
              </p>
            ) : null}

            <output
              aria-live="polite"
              className="text-muted mt-2 flex min-h-5 items-center gap-2 text-xs"
              id={statusId}
            >
              <span>{statusText}</span>
              {saveError ? (
                <button
                  aria-label="Retry saving font size"
                  className="text-primary underline"
                  onClick={onRetry}
                  type="button"
                >
                  Retry
                </button>
              ) : null}
            </output>
          </div>

          {loadWarning ? (
            <output
              aria-live="polite"
              className="border-danger/40 bg-danger/10 text-text-main mt-4 block rounded border p-2 text-xs"
            >
              {loadWarning.message} Enter a valid value or Reset to repair.
            </output>
          ) : null}

          <div
            aria-label="Typography preview"
            className="border-border-main bg-surface mt-6 rounded-md border p-4"
          >
            <MarkdownContent
              ariaLabel="Markdown typography preview"
              fontSizePx={state.appliedFontSizePx}
              markdown={PREVIEW_MARKDOWN}
            />
          </div>
        </section>
      </div>
    </main>
  );
};

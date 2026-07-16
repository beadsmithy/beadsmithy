import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AppSettingsHookState } from "./app-settings";
import { SettingsPage } from "./SettingsPage";

const baseState = (
  overrides: Partial<AppSettingsHookState> = {}
): AppSettingsHookState => ({
  appliedFontSizePx: 14,
  confirmedFontSizePx: 14,
  draft: "14",
  loadStatus: "loaded",
  loadWarning: null,
  saveError: null,
  saveStatus: "saved",
  validationError: null,
  ...overrides,
});

const renderPage = (state: AppSettingsHookState = baseState()) => {
  const onDraftChange = vi.fn();
  const onReset = vi.fn();
  const onRetry = vi.fn();

  const result = render(
    <SettingsPage
      onDraftChange={onDraftChange}
      onReset={onReset}
      onRetry={onRetry}
      state={state}
    />
  );

  return { ...result, onDraftChange, onReset, onRetry };
};

describe("SettingsPage", () => {
  it("renders the Settings heading and Markdown Typography section", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Markdown Typography" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/base size for issue descriptions/iu)
    ).toBeInTheDocument();
  });

  it("shows the current draft in the number input with a px suffix", () => {
    renderPage(baseState({ appliedFontSizePx: 24, draft: "24" }));

    const input = screen.getByRole("spinbutton");
    expect(input).toHaveValue(24);
    expect(screen.getByText("px")).toBeInTheDocument();
  });

  it("calls onDraftChange when the input value changes", () => {
    const { onDraftChange } = renderPage();

    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "20" } });

    expect(onDraftChange).toHaveBeenCalledWith("20");
  });

  it("exposes aria-invalid and the validation error when state has one", () => {
    renderPage(
      baseState({
        appliedFontSizePx: 14,
        draft: "abc",
        validationError: "Font size must be a whole number from 8 to 72 px.",
      })
    );

    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("Font size must be a whole number from 8 to 72 px.")
    ).toBeInTheDocument();
  });

  it("renders the preview using the applied font size", () => {
    const { container } = renderPage(
      baseState({ appliedFontSizePx: 24, draft: "24" })
    );

    const previewArticle = container.querySelector(
      "[aria-label='Typography preview'] article"
    );
    expect(previewArticle).toHaveStyle({ fontSize: "24px" });
  });

  it("disables Reset when already at the default with no warning or error", () => {
    renderPage(baseState());

    expect(screen.getByRole("button", { name: /reset/iu })).toBeDisabled();
  });

  it("enables Reset when a load warning is present", () => {
    renderPage(
      baseState({
        loadWarning: {
          kind: "malformed",
          message: "Saved settings are malformed.",
        },
        saveStatus: "idle",
      })
    );

    expect(screen.getByRole("button", { name: /reset/iu })).toBeEnabled();
  });

  it("calls onReset when the Reset button is clicked", async () => {
    const user = userEvent.setup();
    const { onReset } = renderPage(
      baseState({
        appliedFontSizePx: 24,
        draft: "24",
        loadWarning: {
          kind: "malformed",
          message: "Saved settings are malformed.",
        },
        saveStatus: "idle",
      })
    );

    await user.click(screen.getByRole("button", { name: /reset/iu }));

    expect(onReset).toHaveBeenCalled();
  });

  it("shows the saving and saved status text", () => {
    const { rerender } = renderPage(baseState({ saveStatus: "saving" }));

    expect(screen.getByText("Saving…")).toBeInTheDocument();

    rerender(
      <SettingsPage
        onDraftChange={vi.fn()}
        onReset={vi.fn()}
        onRetry={vi.fn()}
        state={baseState({ saveStatus: "saved" })}
      />
    );

    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("renders a save error with a Retry button and calls onRetry", async () => {
    const user = userEvent.setup();
    const { onRetry } = renderPage(
      baseState({
        appliedFontSizePx: 24,
        draft: "24",
        saveError: {
          kind: "storeSaveFailed",
          message: "disk full",
        },
        saveStatus: "idle",
      })
    );

    expect(screen.getByText(/Not saved: disk full/iu)).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /retry/iu });
    expect(retryButton).toBeInTheDocument();

    await user.click(retryButton);

    expect(onRetry).toHaveBeenCalled();
  });

  it("announces status updates through a polite live region", () => {
    renderPage(baseState({ saveStatus: "saved" }));

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
  });

  it("shows a load warning with repair guidance", () => {
    renderPage(
      baseState({
        loadWarning: {
          kind: "storeReadFailed",
          message: "Saved settings could not be read.",
        },
        saveStatus: "idle",
      })
    );

    expect(
      screen.getByText(/Saved settings could not be read/iu)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/enter a valid value or reset to repair/iu)
    ).toBeInTheDocument();
  });
});

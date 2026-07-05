import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("renders a Markdown paragraph as visible text and not as raw punctuation", () => {
    render(
      <MarkdownContent markdown="Hello world." openExternalLink={vi.fn()} />
    );

    expect(screen.getByText("Hello world.").tagName).toBe("P");
  });

  it("renders Markdown and GFM features in the existing dark developer-tool style", () => {
    const markdown = [
      "# Title",
      "",
      "A paragraph with **bold** and *italic*.",
      "",
      "## Subheading",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "Inline `code` here.",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "| col | val |",
      "|-----|-----|",
      "| a   | 1   |",
      "",
      "- [x] done",
      "- [ ] todo",
      "",
      "~~struck~~ through.",
    ].join("\n");

    const { container } = render(
      <MarkdownContent markdown={markdown} openExternalLink={vi.fn()} />
    );

    const article = container.querySelector("article");
    expect(article).not.toBeNull();

    // Headings
    expect(
      within(article as HTMLElement).getByRole("heading", {
        level: 1,
        name: "Title",
      })
    ).toBeInTheDocument();
    expect(
      within(article as HTMLElement).getByRole("heading", {
        level: 2,
        name: "Subheading",
      })
    ).toBeInTheDocument();

    // Bold + italic
    expect(within(article as HTMLElement).getByText("bold").tagName).toBe(
      "STRONG"
    );
    expect(within(article as HTMLElement).getByText("italic").tagName).toBe(
      "EM"
    );

    // Lists
    const [unorderedList, orderedList] = within(
      article as HTMLElement
    ).getAllByRole("list");
    expect(unorderedList.tagName).toBe("UL");
    expect(within(unorderedList).getByText("one")).toBeInTheDocument();
    expect(within(unorderedList).getByText("two")).toBeInTheDocument();
    expect(orderedList.tagName).toBe("OL");
    expect(within(orderedList).getByText("first")).toBeInTheDocument();
    expect(within(orderedList).getByText("second")).toBeInTheDocument();

    // Inline code + code block
    expect(within(article as HTMLElement).getByText("code").tagName).toBe(
      "CODE"
    );
    expect(
      within(article as HTMLElement).getByText("const x = 1;")
    ).toBeInTheDocument();

    // Table (header is th)
    const table = within(article as HTMLElement).getByRole("table");
    expect(within(table).getByText("col")).toBeInTheDocument();
    expect(within(table).getByText("a")).toBeInTheDocument();

    // Task list checkbox
    expect(
      within(article as HTMLElement).getByRole("checkbox", { checked: true })
    ).toBeInTheDocument();
    expect(
      within(article as HTMLElement).getByRole("checkbox", { checked: false })
    ).toBeInTheDocument();

    // Task list checkboxes receive the dark-theme styling so they match the
    // rest of the Markdown chrome rather than the browser default.
    const [checkedCheckbox, uncheckedCheckbox] = within(
      article as HTMLElement
    ).getAllByRole("checkbox");
    for (const checkbox of [checkedCheckbox, uncheckedCheckbox]) {
      expect(checkbox).toHaveClass("size-4");
      expect(checkbox).toHaveClass("accent-accent");
      expect(checkbox).toHaveClass("border-border-main");
      expect(checkbox).toHaveClass("bg-surface");
      expect(checkbox).toHaveClass("rounded-sm");
      expect(checkbox).toHaveAttribute("type", "checkbox");
    }
    expect(checkedCheckbox).toBeChecked();
    expect(uncheckedCheckbox).not.toBeChecked();

    // Strikethrough
    expect(within(article as HTMLElement).getByText("struck").tagName).toBe(
      "DEL"
    );
  });

  it("does not render raw HTML from Markdown source", () => {
    const { container } = render(
      <MarkdownContent
        markdown={
          '<script>window.__pwned = true;</script>\n<img src=x onerror="window.__pwned = true;" />'
        }
        openExternalLink={vi.fn()}
      />
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(
      (window as unknown as { __pwned?: boolean }).__pwned
    ).toBeUndefined();
  });

  it("calls the injected opener for http Markdown links and never navigates the webview", async () => {
    const user = userEvent.setup();
    const openExternalLink = vi.fn();

    render(
      <MarkdownContent
        markdown="See [the docs](https://example.com/docs) for more."
        openExternalLink={openExternalLink}
      />
    );

    const link = screen.getByRole("link", { name: "the docs" });

    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    await user.click(link);

    expect(openExternalLink).toHaveBeenCalledTimes(1);
    expect(openExternalLink).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("calls the injected opener for GFM bare HTTPS autolinks", async () => {
    const user = userEvent.setup();
    const openExternalLink = vi.fn();

    render(
      <MarkdownContent
        markdown={"Visit https://example.com today."}
        openExternalLink={openExternalLink}
      />
    );

    const link = screen.getByRole("link", { name: "https://example.com" });

    await user.click(link);

    expect(openExternalLink).toHaveBeenCalledTimes(1);
    expect(openExternalLink).toHaveBeenCalledWith("https://example.com");
  });

  it("calls the injected opener for GFM bare HTTP autolinks", async () => {
    const user = userEvent.setup();
    const openExternalLink = vi.fn();

    render(
      <MarkdownContent
        markdown={"See http://example.com/plain."}
        openExternalLink={openExternalLink}
      />
    );

    const link = screen.getByRole("link", { name: "http://example.com/plain" });

    await user.click(link);

    expect(openExternalLink).toHaveBeenCalledTimes(1);
    expect(openExternalLink).toHaveBeenCalledWith("http://example.com/plain");
  });

  it("renders non-HTTP links as inert visible text without a link role", () => {
    const cases: { expectedText: string; markdown: string }[] = [
      {
        expectedText: "the readme",
        markdown: "Read [the readme](./README.md).",
      },
      {
        expectedText: "the section",
        markdown: "Jump to [the section](#section).",
      },
      {
        expectedText: "bsm-7en.2",
        markdown: "See [bsm-7en.2](bsm-7en.2).",
      },
      {
        expectedText: "support",
        markdown: "Email [support](mailto:support@example.com).",
      },
      {
        expectedText: "click",
        markdown: "[click](javascript:alert(1))",
      },
      {
        expectedText: "src/issues/IssueExplorer.tsx",
        markdown: "Look at `src/issues/IssueExplorer.tsx` for the code.",
      },
      {
        expectedText: "bsm-7en.2",
        markdown: "Mention bsm-7en.2 in plain text.",
      },
    ];

    for (const { markdown, expectedText } of cases) {
      const { unmount } = render(
        <MarkdownContent markdown={markdown} openExternalLink={vi.fn()} />
      );

      // No <a> element anywhere in the rendered output.
      expect(
        screen.queryByRole("link", { name: expectedText }),
        `unexpected <a> for "${markdown}"`
      ).toBeNull();

      // The visible text is still present somewhere in the rendered document.
      expect(document.body.textContent).toContain(expectedText);

      unmount();
    }
  });

  it("does not render the opener-related target/rel when the URL is inert", () => {
    render(
      <MarkdownContent
        markdown="[safe](./README.md)"
        openExternalLink={vi.fn()}
      />
    );

    // No anchor element exists at all.
    expect(document.querySelector("a")).toBeNull();
  });
});

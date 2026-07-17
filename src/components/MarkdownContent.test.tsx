import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MarkdownContent } from "./MarkdownContent";

vi.mock("./mermaid/MermaidDiagram", () => ({
  MermaidDiagram: ({ source }: { source: string }) => (
    <div data-source={source} data-testid="mermaid-diagram">
      {source}
    </div>
  ),
}));

describe("MarkdownContent", () => {
  it("renders a Markdown paragraph as visible text and not as raw punctuation", () => {
    render(
      <MarkdownContent markdown="Hello world." openExternalLink={vi.fn()} />
    );

    expect(screen.getByText("Hello world.").tagName).toBe("P");
  });

  it("applies an optional accessible name to the article seam", () => {
    render(
      <MarkdownContent
        ariaLabel="Issue description"
        markdown="Hello world."
        openExternalLink={vi.fn()}
      />
    );

    expect(
      screen.getByRole("article", { name: "Issue description" })
    ).toBeInTheDocument();
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

  it("renders a mermaid fenced block as a Mermaid diagram with the unchanged source", () => {
    const source = "graph TD;\n  A-->B";
    const markdown = `\`\`\`mermaid\n${source}\n\`\`\``;

    // Descriptions and comments share this seam, so proving one path proves
    // both.
    const { container } = render(
      <MarkdownContent
        ariaLabel="Issue description"
        markdown={markdown}
        openExternalLink={vi.fn()}
      />
    );

    const diagram = screen.getByTestId("mermaid-diagram");
    expect(diagram).toHaveAttribute("data-source", source);

    // The Mermaid block is not wrapped in the ordinary code-block chrome.
    expect(container.querySelector("pre")).toBeNull();
  });

  it("renders non-mermaid fenced code as an ordinary code block, not a diagram", () => {
    const markdown = ["```ts", "const x = 1;", "```"].join("\n");

    const { container } = render(
      <MarkdownContent markdown={markdown} openExternalLink={vi.fn()} />
    );

    expect(screen.queryByTestId("mermaid-diagram")).toBeNull();
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(
      within(pre as HTMLElement).getByText("const x = 1;")
    ).toBeInTheDocument();
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

  it("defaults the article base size to 14px when fontSizePx is omitted", () => {
    const { container } = render(
      <MarkdownContent markdown="Hello." openExternalLink={vi.fn()} />
    );

    const article = container.querySelector("article");
    expect(article).not.toBeNull();
    expect(article).toHaveStyle({ fontSize: "14px" });
  });

  it("applies explicit fontSizePx values to the article style", () => {
    for (const fontSizePx of [8, 24, 72]) {
      const { container, unmount } = render(
        <MarkdownContent
          fontSizePx={fontSizePx}
          markdown="Hello."
          openExternalLink={vi.fn()}
        />
      );

      const article = container.querySelector("article");
      expect(article).toHaveStyle({ fontSize: `${fontSizePx}px` });
      unmount();
    }
  });

  it("scales headings, inline code, fenced code, and table headers proportionally from the base", () => {
    const markdown = [
      "# Title",
      "",
      "Inline `code`.",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "| col | val |",
      "|-----|-----|",
      "| a   | 1   |",
    ].join("\n");

    const { container } = render(
      <MarkdownContent markdown={markdown} openExternalLink={vi.fn()} />
    );

    const h1 = container.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1).toHaveClass("text-[1.4286em]");
    expect(h1).toHaveClass("leading-[1.4]");

    const inlineCode = screen.getByText("code");
    expect(inlineCode.tagName).toBe("CODE");
    expect(inlineCode).toHaveClass("text-[0.85em]");

    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre).toHaveClass("text-[0.8571em]");
    expect(pre).toHaveClass("[&>code]:text-[1em]");

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table).toHaveClass("text-[1em]");

    expect(table).toHaveClass("[&_th]:text-[0.7143em]");
  });

  it("uses proportional line heights for body text and lists", () => {
    const markdown = "A paragraph.\n\n- one\n- two";
    const { container } = render(
      <MarkdownContent markdown={markdown} openExternalLink={vi.fn()} />
    );

    const paragraph = container.querySelector("p");
    expect(paragraph).not.toBeNull();
    expect(paragraph).toHaveClass("leading-[1.7143]");

    const list = container.querySelector("ul");
    expect(list).not.toBeNull();
    expect(list).toHaveClass("leading-[1.7143]");
  });

  it("retains horizontal overflow behavior for fenced code and tables at large sizes", () => {
    const markdown = [
      "```",
      "x",
      "```",
      "",
      "| col | val |",
      "|-----|-----|",
      "| a   | 1   |",
    ].join("\n");

    const { container } = render(
      <MarkdownContent
        fontSizePx={72}
        markdown={markdown}
        openExternalLink={vi.fn()}
      />
    );

    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre).toHaveClass("overflow-x-auto");

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table).toHaveClass("w-full");
  });
});

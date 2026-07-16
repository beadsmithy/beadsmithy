import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderMermaid } from "./mermaid-renderer";
import { MermaidDiagram } from "./MermaidDiagram";

vi.mock("./mermaid-renderer", () => ({
  renderMermaid: vi.fn(),
}));

const mockedRenderMermaid = vi.mocked(renderMermaid);

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  const result: Deferred<T> = {
    promise: Promise.resolve() as Promise<T>,
    reject: () => {},
    resolve: () => {},
  };

  // oxlint-disable-next-line promise/avoid-new
  result.promise = new Promise<T>((resolve, reject) => {
    result.resolve = resolve;
    result.reject = reject;
  });

  return result;
};

beforeEach(() => {
  mockedRenderMermaid.mockReset();
});

describe("MermaidDiagram", () => {
  it("shows the Diagram tab by default and mounts the rendered SVG on success", async () => {
    mockedRenderMermaid.mockResolvedValue(
      '<svg data-testid="diagram-svg"></svg>'
    );

    render(<MermaidDiagram source="graph TD; A-->B" />);

    const diagramTab = screen.getByRole("tab", { name: "Diagram" });
    await waitFor(() =>
      expect(diagramTab).toHaveAttribute("aria-selected", "true")
    );

    expect(await screen.findByTestId("diagram-svg")).toBeInTheDocument();
    expect(document.querySelector("svg")).not.toBeNull();
  });

  it("offers a Source tab that preserves the unchanged Mermaid source", async () => {
    mockedRenderMermaid.mockResolvedValue("<svg></svg>");
    const source = "graph TD;\n  A-->B";

    render(<MermaidDiagram source={source} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Source" }));

    const sourcePanel = screen.getByRole("tabpanel");
    expect(within(sourcePanel).getByText(/A-->B/u)).toBeInTheDocument();
    expect(sourcePanel.textContent).toContain(source);
  });

  it("selects Source and shows the complete error in a banner independent of the active tab", async () => {
    mockedRenderMermaid.mockRejectedValue(
      new Error("Parse error on line 2: unexpected token")
    );

    render(<MermaidDiagram source="broken" />);

    const sourceTab = screen.getByRole("tab", { name: "Source" });
    await waitFor(() =>
      expect(sourceTab).toHaveAttribute("aria-selected", "true")
    );

    const banner = screen.getByText("Parse error on line 2: unexpected token");
    expect(banner).toBeInTheDocument();

    // The banner stays visible even when the reader switches back to Diagram.
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Diagram" }));
    expect(
      screen.getByText("Parse error on line 2: unexpected token")
    ).toBeInTheDocument();
  });

  it("ignores a stale render that completes after the source changes", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    mockedRenderMermaid
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { rerender } = render(<MermaidDiagram source="first" />);
    rerender(<MermaidDiagram source="second" />);

    second.resolve('<svg data-testid="second"></svg>');
    await waitFor(() =>
      expect(document.querySelector('[data-testid="second"]')).not.toBeNull()
    );

    // The stale first render resolving must not replace the current diagram.
    first.resolve('<svg data-testid="first"></svg>');
    await Promise.resolve();
    expect(document.querySelector('[data-testid="first"]')).toBeNull();
    expect(document.querySelector('[data-testid="second"]')).not.toBeNull();
  });

  it("ignores a render that completes after unmount", async () => {
    const pending = deferred<string>();
    mockedRenderMermaid.mockReturnValue(pending.promise);

    const { unmount } = render(<MermaidDiagram source="graph TD; A-->B" />);
    unmount();

    // Resolving after unmount must not throw or attempt a state update.
    pending.resolve("<svg></svg>");
    await expect(pending.promise).resolves.toBe("<svg></svg>");
  });
});

import Panzoom from "@panzoom/panzoom";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderMermaid } from "./mermaid-renderer";
import { MermaidDiagram } from "./MermaidDiagram";

vi.mock("./mermaid-renderer", () => ({
  renderMermaid: vi.fn(),
}));

const createPanzoomMock = vi.hoisted(() => () => ({
  bind: vi.fn(),
  destroy: vi.fn(),
  eventNames: { down: "pointerdown", move: "pointermove", up: "pointerup" },
  getOptions: vi.fn(() => ({})),
  getPan: vi.fn(() => ({ x: 0, y: 0 })),
  getScale: vi.fn(() => 1),
  handleDown: vi.fn(),
  handleMove: vi.fn(),
  handleUp: vi.fn(),
  pan: vi.fn(),
  reset: vi.fn(),
  resetStyle: vi.fn(),
  setOptions: vi.fn(),
  setStyle: vi.fn(),
  zoom: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  zoomToPoint: vi.fn(),
  zoomWithWheel: vi.fn(),
}));

vi.mock("@panzoom/panzoom", () => ({
  default: Object.assign(
    vi.fn(() => createPanzoomMock()),
    {
      defaultOptions: {},
    }
  ),
}));

const mockedRenderMermaid = vi.mocked(renderMermaid);
const mockedPanzoom = vi.mocked(Panzoom);

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

const getLastPanzoomInstance = () => {
  const lastCall = mockedPanzoom.mock.results.at(-1);
  if (lastCall === undefined) {
    throw new Error("No Panzoom instance created");
  }
  return lastCall.value as ReturnType<typeof mockedPanzoom>;
};

beforeEach(() => {
  mockedRenderMermaid.mockReset();
  mockedPanzoom.mockClear();
});

describe("MermaidDiagram", () => {
  it("shows the Diagram tab by default and mounts the rendered SVG on success", async () => {
    mockedRenderMermaid.mockResolvedValue(
      '<svg data-testid="diagram-svg"></svg>'
    );

    const { container } = render(<MermaidDiagram source="graph TD; A-->B" />);

    const diagramTab = screen.getByRole("tab", { name: "Diagram" });
    await waitFor(() =>
      expect(diagramTab).toHaveAttribute("aria-selected", "true")
    );

    expect(await screen.findByTestId("diagram-svg")).toBeInTheDocument();
    expect(document.querySelector("svg")).not.toBeNull();
    expect(mockedPanzoom).toHaveBeenCalledTimes(1);

    const svgElement = container.querySelector("svg");
    expect(mockedPanzoom).toHaveBeenCalledWith(
      svgElement,
      expect.objectContaining({ startScale: 1, startX: 0, startY: 0 })
    );
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

  it("initializes Panzoom on the mounted SVG with a fit-to-container start transform", async () => {
    mockedRenderMermaid.mockResolvedValue(
      '<svg data-testid="diagram-svg"></svg>'
    );

    const { container } = render(<MermaidDiagram source="graph TD; A-->B" />);

    await screen.findByTestId("diagram-svg");

    const svgElement = container.querySelector("svg");
    expect(svgElement).not.toBeNull();
    expect(mockedPanzoom).toHaveBeenCalledWith(
      svgElement,
      expect.objectContaining({
        maxScale: 5,
        minScale: 0.05,
        startScale: 1,
        startX: 0,
        startY: 0,
      })
    );
  });

  it("zooms with the wheel only when Ctrl or Command is held", async () => {
    mockedRenderMermaid.mockResolvedValue(
      '<svg data-testid="diagram-svg"></svg>'
    );

    const { container } = render(<MermaidDiagram source="graph TD; A-->B" />);
    await screen.findByTestId("diagram-svg");

    const viewport = container.querySelector(".mermaid-svg-container");
    expect(viewport).not.toBeNull();

    const instance = getLastPanzoomInstance();

    const zoomEvent = new WheelEvent("wheel", { ctrlKey: true, deltaY: -100 });
    fireEvent(viewport as HTMLElement, zoomEvent);
    expect(instance.zoomWithWheel).toHaveBeenCalledWith(zoomEvent);

    const scrollEvent = new WheelEvent("wheel", { deltaY: 100 });
    fireEvent(viewport as HTMLElement, scrollEvent);
    expect(instance.zoomWithWheel).toHaveBeenCalledTimes(1);
    expect(scrollEvent.defaultPrevented).toBe(false);
  });

  it("exposes accessible buttons for zoom in, zoom out, and reset/fit", async () => {
    mockedRenderMermaid.mockResolvedValue("<svg></svg>");

    render(<MermaidDiagram source="graph TD; A-->B" />);
    await waitFor(() => expect(mockedPanzoom).toHaveBeenCalled());

    const instance = getLastPanzoomInstance();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Zoom in diagram" }));
    expect(instance.zoomIn).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Zoom out diagram" }));
    expect(instance.zoomOut).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("button", { name: "Reset and fit diagram" })
    );
    expect(instance.reset).toHaveBeenCalledTimes(1);
  });

  it("destroys the Panzoom instance when the diagram unmounts", async () => {
    mockedRenderMermaid.mockResolvedValue("<svg></svg>");

    const { unmount } = render(<MermaidDiagram source="graph TD; A-->B" />);
    await waitFor(() => expect(mockedPanzoom).toHaveBeenCalled());

    const instance = getLastPanzoomInstance();
    unmount();

    expect(instance.destroy).toHaveBeenCalled();
  });

  it("destroys the Panzoom instance when the source changes", async () => {
    mockedRenderMermaid.mockResolvedValue("<svg></svg>");

    const { rerender } = render(<MermaidDiagram source="first" />);
    await waitFor(() => expect(mockedPanzoom).toHaveBeenCalledTimes(1));

    const firstInstance = getLastPanzoomInstance();

    rerender(<MermaidDiagram source="second" />);
    await waitFor(() => expect(mockedPanzoom).toHaveBeenCalledTimes(2));

    expect(firstInstance.destroy).toHaveBeenCalled();
  });
});

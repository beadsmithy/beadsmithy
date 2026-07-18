import Panzoom from "@panzoom/panzoom";
import type { PanzoomObject } from "@panzoom/panzoom";
import { Maximize, TriangleAlert, ZoomIn, ZoomOut } from "lucide-react";
import { useId, useRef, useState } from "react";

import { useMountEffect } from "../../lib/use-mount-effect";
import { Alert, AlertDescription, AlertTitle } from "../ui/Alert";
import { renderMermaid } from "./mermaid-renderer";

type RenderState =
  | { status: "loading" }
  | { status: "success"; svg: string }
  | { status: "error"; message: string };

type DiagramTab = "diagram" | "source";

const MAX_SCALE = 5;
const MIN_SCALE = 0.05;

const CONTAINER_CLASSES =
  "mt-3 overflow-hidden rounded-md border border-border-main bg-surface";
const TABLIST_CLASSES =
  "flex gap-1 border-border-main border-b bg-background/40 px-2 pt-2";
const TAB_BASE_CLASSES =
  "rounded-t-md px-3 py-1 font-mono text-[0.7143em] tracking-wider uppercase";
const TAB_ACTIVE_CLASSES = "bg-surface text-text-main";
const TAB_INACTIVE_CLASSES = "text-muted hover:text-text-main";
const DIAGRAM_PANEL_CLASSES =
  "overflow-hidden p-3 [&_svg]:h-auto [&_svg]:max-w-full";
const SOURCE_PRE_CLASSES =
  "overflow-x-auto p-3 font-mono text-[0.8571em] text-text-main";
const STATUS_CLASSES = "p-3 text-[0.85em] text-muted";
const ERROR_ALERT_CLASSES =
  "rounded-none border-x-0 border-b-0 border-t border-destructive/30 px-3 py-2.5";
const ERROR_MESSAGE_CLASSES = "whitespace-pre-wrap font-mono text-[0.8em]";
const VIEWPORT_CLASSES = "relative";
const SVG_CONTAINER_CLASSES = "mermaid-svg-container cursor-move";
const TOOLBAR_CLASSES =
  "absolute top-2 right-2 flex gap-1 rounded-md border border-border-main bg-surface/90 p-1 backdrop-blur";
const TOOLBAR_BUTTON_CLASSES =
  "rounded p-1 text-text-main hover:bg-background focus:outline-none focus:ring-2 focus:ring-accent";

interface FitTransform {
  scale: number;
  x: number;
  y: number;
}

const getFitTransform = (
  container: HTMLElement,
  svg: SVGSVGElement
): FitTransform => {
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  const svgRect = svg.getBoundingClientRect();
  const svgWidth = svgRect.width || svg.clientWidth;
  const svgHeight = svgRect.height || svg.clientHeight;

  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    svgWidth <= 0 ||
    svgHeight <= 0
  ) {
    return { scale: 1, x: 0, y: 0 };
  }

  const scale = Math.min(
    1,
    containerWidth / svgWidth,
    containerHeight / svgHeight
  );
  const x = (containerWidth - svgWidth * scale) / 2;
  const y = (containerHeight - svgHeight * scale) / 2;

  return { scale, x, y };
};

interface MermaidDiagramViewportProps {
  svg: string;
}

/**
 * Mounts the Mermaid-generated SVG through a single controlled boundary and
 * attaches pan/zoom interactions. The SVG string never flows through React
 * children as HTML anywhere else.
 *
 * This component is keyed by the rendered SVG identity (see `MermaidDiagram`)
 * so a new SVG always gets its own mount lifecycle — the parent component
 * does the boundary, and the imperative work below runs exactly once on
 * mount and tears down on unmount. The cleanup removes the wheel
 * listener, destroys Panzoom, clears its ref, and empties the container
 * so the previous diagram cannot survive a source change.
 */
const MermaidDiagramViewport = ({ svg }: MermaidDiagramViewportProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const panzoomRef = useRef<PanzoomObject | null>(null);

  useMountEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    container.innerHTML = svg;
    const svgElement = container.querySelector("svg");
    if (svgElement === null) {
      return;
    }

    let panzoom: PanzoomObject | null = null;

    try {
      const fit = getFitTransform(container, svgElement);
      panzoom = Panzoom(svgElement, {
        maxScale: MAX_SCALE,
        minScale: MIN_SCALE,
        startScale: fit.scale,
        startX: fit.x,
        startY: fit.y,
      });
      panzoomRef.current = panzoom;
    } catch {
      // A pan/zoom failure must not hide the already-rendered diagram or its
      // Source view.
    }

    const handleWheel = (event: WheelEvent) => {
      if (panzoom === null) {
        return;
      }
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      panzoom.zoomWithWheel(event);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
      panzoom?.destroy();
      panzoomRef.current = null;
      container.innerHTML = "";
    };
  });

  const handleZoomIn = () => {
    panzoomRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    panzoomRef.current?.zoomOut();
  };

  const handleResetFit = () => {
    panzoomRef.current?.reset();
  };

  return (
    <div className={VIEWPORT_CLASSES}>
      <div ref={containerRef} className={SVG_CONTAINER_CLASSES} />
      <div
        aria-label="Diagram zoom controls"
        className={TOOLBAR_CLASSES}
        role="toolbar"
      >
        <button
          aria-label="Zoom in diagram"
          className={TOOLBAR_BUTTON_CLASSES}
          onClick={handleZoomIn}
          title="Zoom in diagram"
          type="button"
        >
          <ZoomIn className="size-4" />
        </button>
        <button
          aria-label="Zoom out diagram"
          className={TOOLBAR_BUTTON_CLASSES}
          onClick={handleZoomOut}
          title="Zoom out diagram"
          type="button"
        >
          <ZoomOut className="size-4" />
        </button>
        <button
          aria-label="Reset and fit diagram"
          className={TOOLBAR_BUTTON_CLASSES}
          onClick={handleResetFit}
          title="Reset and fit diagram"
          type="button"
        >
          <Maximize className="size-4" />
        </button>
      </div>
    </div>
  );
};

interface MermaidSourceRenderProps {
  onRendered: (state: RenderState) => void;
  onError: (message: string) => void;
  source: string;
}

/**
 * Renders the supplied Mermaid source for as long as this component is
 * mounted, reporting the result via the `onRendered` / `onError` callbacks.
 *
 * This is a deliberate mount-only boundary: a parent component remounts
 * `MermaidSourceRender` per source identity (via the `key` prop), so the
 * previous in-flight render is naturally canceled by unmount cleanup and
 * stale completions cannot update a newer source instance.
 */
const MermaidSourceRender = ({
  onRendered,
  onError,
  source,
}: MermaidSourceRenderProps) => {
  useMountEffect(() => {
    let active = true;

    void (async () => {
      try {
        const svg = await renderMermaid(source);
        if (!active) {
          return;
        }
        onRendered({ status: "success", svg });
      } catch (error) {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        onError(message);
      }
    })();

    return () => {
      active = false;
    };
  });

  return null;
};

interface MermaidDiagramProps {
  source: string;
}

export const MermaidDiagram = ({ source }: MermaidDiagramProps) => {
  const [render, setRender] = useState<RenderState>({ status: "loading" });
  const [activeTab, setActiveTab] = useState<DiagramTab>("diagram");
  const renderedSourceRef = useRef(source);
  const baseId = useId();
  const diagramTabId = `${baseId}-diagram-tab`;
  const sourceTabId = `${baseId}-source-tab`;
  const diagramPanelId = `${baseId}-diagram-panel`;
  const sourcePanelId = `${baseId}-source-panel`;

  // Reset to the loading view synchronously when the source changes so the
  // reader never sees the previous diagram flash against the new source.
  if (source !== renderedSourceRef.current) {
    renderedSourceRef.current = source;
    setRender({ status: "loading" });
    setActiveTab("diagram");
  }

  const isDiagramActive = activeTab === "diagram";

  return (
    <div className={CONTAINER_CLASSES}>
      <div
        aria-label="Diagram views"
        className={TABLIST_CLASSES}
        role="tablist"
      >
        <button
          aria-controls={diagramPanelId}
          aria-selected={isDiagramActive}
          className={`${TAB_BASE_CLASSES} ${
            isDiagramActive ? TAB_ACTIVE_CLASSES : TAB_INACTIVE_CLASSES
          }`}
          id={diagramTabId}
          onClick={() => setActiveTab("diagram")}
          role="tab"
          type="button"
        >
          Diagram
        </button>
        <button
          aria-controls={sourcePanelId}
          aria-selected={!isDiagramActive}
          className={`${TAB_BASE_CLASSES} ${
            isDiagramActive ? TAB_INACTIVE_CLASSES : TAB_ACTIVE_CLASSES
          }`}
          id={sourceTabId}
          onClick={() => setActiveTab("source")}
          role="tab"
          type="button"
        >
          Source
        </button>
      </div>

      <div
        aria-labelledby={diagramTabId}
        className={DIAGRAM_PANEL_CLASSES}
        hidden={!isDiagramActive}
        id={diagramPanelId}
        role="tabpanel"
      >
        {render.status === "success" ? (
          <MermaidDiagramViewport key={render.svg} svg={render.svg} />
        ) : (
          <p className={STATUS_CLASSES}>
            {render.status === "loading"
              ? "Rendering diagram…"
              : "Diagram unavailable — see Source and the error below."}
          </p>
        )}
      </div>

      <div
        aria-labelledby={sourceTabId}
        hidden={isDiagramActive}
        id={sourcePanelId}
        role="tabpanel"
      >
        <pre className={SOURCE_PRE_CLASSES}>
          <code>{source}</code>
        </pre>
      </div>

      <MermaidSourceRender
        key={source}
        onError={(message) => {
          setRender({ message, status: "error" });
          setActiveTab("source");
        }}
        onRendered={(state) => {
          setRender(state);
          setActiveTab("diagram");
        }}
        source={source}
      />

      {render.status === "error" ? (
        <Alert className={ERROR_ALERT_CLASSES} variant="destructive">
          <TriangleAlert />
          <AlertTitle>Diagram failed to render</AlertTitle>
          <AlertDescription className={ERROR_MESSAGE_CLASSES}>
            {render.message}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
};

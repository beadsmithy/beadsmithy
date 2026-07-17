import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "../ui/Alert";
import { renderMermaid } from "./mermaid-renderer";

type RenderState =
  | { status: "loading" }
  | { status: "success"; svg: string }
  | { status: "error"; message: string };

type DiagramTab = "diagram" | "source";

const CONTAINER_CLASSES =
  "mt-3 overflow-hidden rounded-md border border-border-main bg-surface";
const TABLIST_CLASSES =
  "flex gap-1 border-border-main border-b bg-background/40 px-2 pt-2";
const TAB_BASE_CLASSES =
  "rounded-t-md px-3 py-1 font-mono text-[0.7143em] tracking-wider uppercase";
const TAB_ACTIVE_CLASSES = "bg-surface text-text-main";
const TAB_INACTIVE_CLASSES = "text-muted hover:text-text-main";
const DIAGRAM_PANEL_CLASSES =
  "overflow-auto p-3 [&_svg]:h-auto [&_svg]:max-w-full";
const SOURCE_PRE_CLASSES =
  "overflow-x-auto p-3 font-mono text-[0.8571em] text-text-main";
const STATUS_CLASSES = "p-3 text-[0.85em] text-muted";
const ERROR_ALERT_CLASSES =
  "rounded-none border-x-0 border-b-0 border-t border-destructive/30 px-3 py-2.5";
const ERROR_MESSAGE_CLASSES = "whitespace-pre-wrap font-mono text-[0.8em]";

/**
 * Mounts the Mermaid-generated SVG through a single controlled boundary. The
 * SVG string never flows through React children as HTML anywhere else.
 */
const MermaidSvg = ({ svg }: { svg: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    container.innerHTML = svg;
    return () => {
      container.innerHTML = "";
    };
  }, [svg]);

  return <div ref={containerRef} />;
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

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const svg = await renderMermaid(source);
        if (!active) {
          return;
        }
        setRender({ status: "success", svg });
        setActiveTab("diagram");
      } catch (error) {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setRender({ message, status: "error" });
        setActiveTab("source");
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, [source]);

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
          <MermaidSvg svg={render.svg} />
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

import { useExternalLifecycle } from "../../lib/use-external-lifecycle";
import { renderMermaid } from "./mermaid-renderer";

export type MermaidRenderSuccess = (svg: string) => void;
export type MermaidRenderFailure = (message: string) => void;

/**
 * Render Mermaid source while it is current and report only live results.
 *
 * The hook owns the asynchronous lifecycle and cancellation guard; callers
 * own presentation state. A source or callback identity change tears down the
 * previous lifecycle before starting a new render, so an old promise cannot
 * update the current diagram.
 */
export const useMermaidSourceRender = (
  source: string,
  onRendered: MermaidRenderSuccess,
  onError: MermaidRenderFailure
): void => {
  useExternalLifecycle(() => {
    let active = true;

    void (async () => {
      try {
        const svg = await renderMermaid(source);
        if (active) {
          onRendered(svg);
        }
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
  }, [source, onRendered, onError]);
};

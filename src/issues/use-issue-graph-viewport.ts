import type { Viewport } from "@xyflow/react";
import { useCallback, useState } from "react";

import { useExternalLifecycle } from "../lib/use-external-lifecycle";

export interface IssueGraphViewportState {
  viewport: Viewport | null;
  workspacePath: string | null;
}

export interface IssueGraphViewportResult {
  onViewportChange: (viewport: Viewport) => void;
  viewport: Viewport | null;
}

export const useIssueGraphViewport = (
  workspacePath: string | null
): IssueGraphViewportResult => {
  const [state, setState] = useState<IssueGraphViewportState>({
    viewport: null,
    workspacePath: null,
  });

  useExternalLifecycle(() => {
    setState((current) =>
      current.workspacePath === workspacePath
        ? current
        : { viewport: null, workspacePath }
    );
  }, [workspacePath]);

  const onViewportChange = useCallback(
    (viewport: Viewport): void => {
      if (workspacePath === null) {
        return;
      }
      setState({ viewport, workspacePath });
    },
    [workspacePath]
  );

  return {
    onViewportChange,
    viewport: state.workspacePath === workspacePath ? state.viewport : null,
  };
};

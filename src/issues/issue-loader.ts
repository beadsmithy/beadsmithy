import { Context, Effect } from "effect";

import { createTauRPCProxy } from "../rpc/bindings";
import type { Issue, LoadIssueExplorerDataResponse } from "../rpc/bindings";

export type IssueLoadErrorKind = string;

export interface IssueLoadError {
  kind: IssueLoadErrorKind;
  message: string;
}

export interface IssueExplorerData {
  workspacePath: string;
  /**
   * Backend `WorkspaceState.generation` that owned this snapshot at the
   * moment it was built. The renderer pairs this with the rendered
   * Workspace identity so refresh events for a previous selection cannot
   * silently overwrite the current one.
   */
  workspaceGeneration: number;
  allIssues: Issue[];
  readyIssues: Issue[];
  blockedIssues: Issue[];
}

export type IssueExplorerLoadState =
  | { status: "loading" }
  | ({ status: "success" } & IssueExplorerData)
  | { status: "failure"; error: IssueLoadError };

export interface IssueTransportClient {
  loadIssueExplorerData: () => Promise<LoadIssueExplorerDataResponse>;
}

export class IssueTransport extends Context.Tag("beadsmith/IssueTransport")<
  IssueTransport,
  IssueTransportClient
>() {}

export const ISSUE_EXPLORER_LOADING_STATE: IssueExplorerLoadState = {
  status: "loading",
};

const isIssueLoadError = (cause: unknown): cause is IssueLoadError => {
  if (typeof cause !== "object" || cause === null) {
    return false;
  }

  const maybeError = cause as Partial<IssueLoadError>;

  return (
    typeof maybeError.message === "string" &&
    typeof maybeError.kind === "string"
  );
};

const toIssueLoadError = (cause: unknown): IssueLoadError => {
  if (isIssueLoadError(cause)) {
    return { kind: cause.kind, message: cause.message };
  }

  if (cause instanceof Error && cause.message.length > 0) {
    return { kind: "unknown", message: cause.message };
  }

  return {
    kind: "unknown",
    message: "Beadsmith could not load issues.",
  };
};

const toIssueExplorerSuccessState = (
  response: LoadIssueExplorerDataResponse
): IssueExplorerLoadState => ({
  allIssues: response.allIssues,
  blockedIssues: response.blockedIssues,
  readyIssues: response.readyIssues,
  status: "success",
  workspaceGeneration: response.workspaceGeneration,
  workspacePath: response.workspacePath,
});

export const loadIssueExplorerState = Effect.gen(
  function* loadIssueExplorerStateEffect() {
    const transport = yield* IssueTransport;
    const response = yield* Effect.tryPromise({
      catch: toIssueLoadError,
      try: () => transport.loadIssueExplorerData(),
    });

    return toIssueExplorerSuccessState(response);
  }
).pipe(
  // Effect requires an error-channel callback here; this is not a Promise callback.
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  Effect.catchAll((error) =>
    Effect.succeed<IssueExplorerLoadState>({ error, status: "failure" })
  )
);

export const createTauRpcIssueTransport = (): IssueTransportClient => {
  const rpc = createTauRPCProxy();

  return {
    loadIssueExplorerData: () => rpc.load_issue_explorer_data(),
  };
};

export const loadIssueExplorerStateFromTauRpc = () =>
  Effect.runPromise(
    Effect.provideService(
      loadIssueExplorerState,
      IssueTransport,
      createTauRpcIssueTransport()
    )
  );

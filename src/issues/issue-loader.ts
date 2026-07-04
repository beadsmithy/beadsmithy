import { Context, Effect } from "effect";

import { createTauRPCProxy } from "../rpc/bindings";
import type { Issue, ListIssuesResponse } from "../rpc/bindings";

export type IssueLoadErrorKind = string;

export interface IssueLoadError {
  kind: IssueLoadErrorKind;
  message: string;
}

export type IssueLoadState =
  | { status: "loading" }
  | {
      status: "success";
      workspacePath: string;
      issues: [Issue, ...Issue[]];
    }
  | { status: "empty"; workspacePath: string; issues: [] }
  | { status: "failure"; error: IssueLoadError };

export interface IssueTransportClient {
  listIssues: () => Promise<ListIssuesResponse>;
}

export class IssueTransport extends Context.Tag("beadsmith/IssueTransport")<
  IssueTransport,
  IssueTransportClient
>() {}

export const ISSUE_LOADING_STATE: IssueLoadState = {
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

const toIssueSuccessState = (response: ListIssuesResponse): IssueLoadState => {
  const [firstIssue, ...remainingIssues] = response.issues;

  if (firstIssue === undefined) {
    return {
      issues: [],
      status: "empty",
      workspacePath: response.workspacePath,
    };
  }

  return {
    issues: [firstIssue, ...remainingIssues],
    status: "success",
    workspacePath: response.workspacePath,
  };
};

export const loadIssueState = Effect.gen(function* loadIssueStateEffect() {
  const transport = yield* IssueTransport;
  const response = yield* Effect.tryPromise({
    catch: toIssueLoadError,
    try: () => transport.listIssues(),
  });

  return toIssueSuccessState(response);
}).pipe(
  // Effect requires an error-channel callback here; this is not a Promise callback.
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  Effect.catchAll((error) =>
    Effect.succeed<IssueLoadState>({ error, status: "failure" })
  )
);

export const createTauRpcIssueTransport = (): IssueTransportClient => {
  const rpc = createTauRPCProxy();

  return {
    listIssues: () => rpc.list_issues(),
  };
};

export const loadIssueStateFromTauRpc = () =>
  Effect.runPromise(
    Effect.provideService(
      loadIssueState,
      IssueTransport,
      createTauRpcIssueTransport()
    )
  );

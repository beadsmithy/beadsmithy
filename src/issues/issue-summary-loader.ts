import { Context, Effect } from "effect";

import { createTauRPCProxy } from "../rpc/bindings";
import type { IssueSummary, ListIssueSummariesResponse } from "../rpc/bindings";

export type IssueSummaryLoadErrorKind = string;

export interface IssueSummaryLoadError {
  kind: IssueSummaryLoadErrorKind;
  message: string;
}

export type IssueSummaryLoadState =
  | { status: "loading" }
  | {
      status: "success";
      workspacePath: string;
      issues: [IssueSummary, ...IssueSummary[]];
    }
  | { status: "empty"; workspacePath: string; issues: [] }
  | { status: "failure"; error: IssueSummaryLoadError };

export interface IssueSummaryTransportClient {
  listIssueSummaries: () => Promise<ListIssueSummariesResponse>;
}

export class IssueSummaryTransport extends Context.Tag(
  "beadsmith/IssueSummaryTransport"
)<IssueSummaryTransport, IssueSummaryTransportClient>() {}

export const ISSUE_SUMMARY_LOADING_STATE: IssueSummaryLoadState = {
  status: "loading",
};

const isIssueSummaryLoadError = (
  cause: unknown
): cause is IssueSummaryLoadError => {
  if (typeof cause !== "object" || cause === null) {
    return false;
  }

  const maybeError = cause as Partial<IssueSummaryLoadError>;

  return (
    typeof maybeError.message === "string" &&
    typeof maybeError.kind === "string"
  );
};

const toIssueSummaryLoadError = (cause: unknown): IssueSummaryLoadError => {
  if (isIssueSummaryLoadError(cause)) {
    return { kind: cause.kind, message: cause.message };
  }

  if (cause instanceof Error && cause.message.length > 0) {
    return { kind: "unknown", message: cause.message };
  }

  return {
    kind: "unknown",
    message: "Beadsmith could not load issue summaries.",
  };
};

const toIssueSummarySuccessState = (
  response: ListIssueSummariesResponse
): IssueSummaryLoadState => {
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

export const loadIssueSummaryState = Effect.gen(
  function* loadIssueSummaryStateEffect() {
    const transport = yield* IssueSummaryTransport;
    const response = yield* Effect.tryPromise({
      catch: toIssueSummaryLoadError,
      try: () => transport.listIssueSummaries(),
    });

    return toIssueSummarySuccessState(response);
  }
).pipe(
  // Effect requires an error-channel callback here; this is not a Promise callback.
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  Effect.catchAll((error) =>
    Effect.succeed<IssueSummaryLoadState>({ error, status: "failure" })
  )
);

export const createTauRpcIssueSummaryTransport =
  (): IssueSummaryTransportClient => {
    const rpc = createTauRPCProxy();

    return {
      listIssueSummaries: () => rpc.list_issue_summaries(),
    };
  };

export const loadIssueSummaryStateFromTauRpc = () =>
  Effect.runPromise(
    Effect.provideService(
      loadIssueSummaryState,
      IssueSummaryTransport,
      createTauRpcIssueSummaryTransport()
    )
  );

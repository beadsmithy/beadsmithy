export interface IssueLocation {
  issueId: string;
  workspacePath: string;
}

export type IssueLocationUriError =
  | "empty-issue-id"
  | "invalid-percent-encoding"
  | "invalid-workspace-path"
  | "missing-issue-suffix"
  | "unsupported-scheme";

export type IssueLocationUriResult =
  | { ok: true; value: string }
  | { error: IssueLocationUriError; ok: false };

const SCHEME_PREFIX = "beadsmithy:///";

const encodePathSegment = (segment: string): string =>
  encodeURIComponent(segment);

const decodePathSegment = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

export const generateIssueLocationUri = (
  location: IssueLocation
): IssueLocationUriResult => {
  if (location.issueId.length === 0) {
    return { error: "empty-issue-id", ok: false };
  }
  if (!location.workspacePath.startsWith("/")) {
    return { error: "invalid-workspace-path", ok: false };
  }

  const workspaceSegments = location.workspacePath
    .split("/")
    .slice(1)
    .map(encodePathSegment);
  const encodedWorkspacePath = workspaceSegments.join("/");
  return {
    ok: true,
    value: `${SCHEME_PREFIX}${encodedWorkspacePath}/issue/${encodePathSegment(location.issueId)}`,
  };
};

export const parseIssueLocationUri = (
  uri: string
): IssueLocationUriResult | { ok: true; value: IssueLocation } => {
  if (!uri.startsWith(SCHEME_PREFIX)) {
    return { error: "unsupported-scheme", ok: false };
  }

  const encodedPath = uri.slice(SCHEME_PREFIX.length);
  const encodedSegments = encodedPath.split("/");
  if (
    encodedSegments.length < 3 ||
    encodedSegments.at(-2) !== "issue" ||
    encodedSegments.at(-1)?.length === 0
  ) {
    return { error: "missing-issue-suffix", ok: false };
  }

  const encodedWorkspaceSegments = encodedSegments.slice(0, -2);
  if (encodedWorkspaceSegments.some((segment) => segment.length === 0)) {
    return { error: "invalid-workspace-path", ok: false };
  }

  const decodedSegments = encodedSegments.map(decodePathSegment);
  if (decodedSegments.some((segment) => segment === null)) {
    return { error: "invalid-percent-encoding", ok: false };
  }

  const workspacePath = `/${decodedSegments.slice(0, -2).join("/")}`;
  const issueId = decodedSegments.at(-1) ?? "";
  if (!workspacePath.startsWith("/") || issueId.length === 0) {
    return { error: "invalid-workspace-path", ok: false };
  }

  return { ok: true, value: { issueId, workspacePath } };
};

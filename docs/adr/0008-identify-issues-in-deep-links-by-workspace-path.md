# Identify Issues in deep links by Workspace path

## Context

Beadsmithy needs external links that open a specific Issue. An Issue is scoped to the Current Workspace, and the same Issue ID may exist in more than one Workspace. The current Workspace model stores filesystem paths and has no separate stable identity that can be shared across machines.

The Tauri deep-link plugin can register a custom desktop URI scheme and deliver links both when the application starts and while it is running. A custom scheme avoids the domain-association work required by HTTPS app links. A received path may be unknown, unavailable, or not yet canonicalized as the Workspace's Git root, so accepting a link must use the existing Workspace-selection validation and catalog behavior.

## Decision

We will identify an Issue Location with an absolute Workspace path and an Issue ID in the custom `beadsmithy` URI scheme. The canonical form is:

```text
beadsmithy:///absolute/workspace/path/issue/<issue-id>
```

The URI parser will percent-encode and decode path segments, support platform-specific absolute paths, and resolve the received path through the same validation used by Workspace selection before comparing it with the Current Workspace or changing the Workspace Catalog. Version one targets macOS and Linux; Windows support is optional and must not delay those platforms.

When the target Workspace differs from the Current Workspace, or there is no Current Workspace, Beadsmithy will ask for confirmation before switching. Accepting uses the normal Workspace-selection flow, including adding an unknown path to the Workspace Catalog. Declining makes no catalog or selection change and discards the request. The application will focus an existing window instead of opening a second instance, and a newer valid deep link replaces a pending confirmation request.

## Status

Accepted.

## Consequences

The link is self-contained and unambiguous, but it is local-machine-specific and exposes a filesystem path. Deep-link and single-instance integration become part of desktop packaging, and the parser must handle absolute Unix and Windows paths, percent encoding, symlinks, and the final `/issue/<issue-id>` boundary. Invalid links can be rejected without changing Workspace state; a valid Workspace with a missing Issue can still be selected and rendered as an Issue-not-found state.

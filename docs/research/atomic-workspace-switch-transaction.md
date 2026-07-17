# Atomic Current Workspace switch transaction

Resolution for [Specify the atomic workspace-switch transaction](bsm-muz.4).

## Boundary and ownership

The backend owns both the Workspace Catalog and the optional Current Workspace. The frontend may pass a candidate directory only to the workspace-switch command; it must never pass a workspace path to issue-list loading RPCs. Every `bw` subprocess instead receives the backend-selected workspace through `Command::current_dir(workspace_path)`.

The `CommandRunner` seam takes an explicit working directory. The issues adapter takes that directory as an argument for every All, Ready, and Blocked command. `env::current_dir`, runtime `set_current_dir`, and the `--workspace` launch override were removed from the workspace-resolution path; the boundary doc `docs/agents/webdriver-e2e.md` and the verification research note record that the binary now selects workspaces only through the typed `switch_workspace` transport.

## Known and Current Workspaces

- A **known Workspace** is a validated root in the persisted Workspace Catalog. It may be available or unavailable and need not be Current.
- **Current Workspace** exists only when Beadsmith has a fully loaded Issue Explorer snapshot for it.
- A **Pending Workspace** is a validated candidate currently loading. It is never exposed as Current.

Validation runs `bw config list` in the candidate directory and discovers the Git root for catalog storage. A selected subdirectory is stored as that root. This version does not add separate symlink canonicalization or alias deduplication beyond ordinary path handling.

After validation succeeds, write the candidate into the known catalog so a valid workspace that later fails to load remains retryable. Do not change `currentWorkspacePath` at this point. A successfully loaded switch then writes `currentWorkspacePath` and the MRU update together in one store save. The catalog is capped at 100 as ADR 0006 specifies.

## Switch algorithm

1. The UI requests `switch_workspace(candidate_path)` and receives a monotonically increasing request generation.
2. The backend marks that candidate Pending, without clearing the existing Current Workspace or Issue Explorer snapshot.
3. Validate the candidate with Beadwork and determine the Git root. If validation fails, show inline picker feedback and leave all persisted/current state unchanged.
4. Persist the validated root in the known catalog. If that save fails, show a retryable persistence error and do not load or switch.
5. Load All, Ready, and Blocked from Beadwork using the candidate root. Each load result is checked against the latest request generation after every asynchronous boundary.
6. If the request is stale, discard its outcome silently. A later selection wins even if the earlier subprocess eventually completes.
7. If loading fails and an old Current Workspace exists, retain its Issue Explorer snapshot and show a dismissible, retryable banner. Keep the newly validated candidate in the catalog. If no Current Workspace exists, retain the candidate as retryable but show the empty chooser rather than presenting a failed workspace as Current.
8. If loading succeeds, persist the new `currentWorkspacePath` and MRU update together in one store save. Persistence failure is a switch failure: retain the old Current Workspace and its snapshot; show a retryable error; do not present the new data as current.
9. Only after the store commit succeeds may the backend publish the new Current Workspace and its complete Issue Explorer snapshot to the frontend.

## Startup restoration

On launch, load the catalog and its remembered last Current Workspace. Attempt restoration through the same transaction, using a fresh generation. It is provisional: a path becomes Current only after validation, all issue views load, and persistence succeeds. A missing path remains an Unavailable Workspace; a valid path with a load failure remains a retryable known Workspace. Both leave the app without a Current Workspace.

## UI and error semantics

- The compact inline sidebar selector is the Workspace control.
- While a switch is pending, it identifies the pending candidate but the Issue Explorer continues to display the old Current Workspace snapshot.
- Invalid-directory feedback is inline in the selector.
- Load and persistence failures with an old snapshot use a dismissible banner with retry; they do not replace the Issue Explorer with an error screen.
- Removing Current Workspace clears it and shows the empty chooser. Removing a known Workspace is local-only and needs no confirmation.

## Required RPC shape

The frontend needs workspace-management operations and a workspace-state response; issue-loading RPCs remain path-free.

- Read workspace state: catalog, optional Current Workspace, optional Pending Workspace, and the current error/banner.
- Switch or retry a candidate Workspace path.
- Remove a known Workspace.
- Load Issue Explorer data for the backend-held Current Workspace only.

The public workspace state must include a generation or equivalent request identity so the frontend can reject stale switch events. The backend remains the final guard and must reject stale results before persistence or publication.

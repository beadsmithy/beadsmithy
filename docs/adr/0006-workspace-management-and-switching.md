# Manage workspaces with explicit path threading and persisted backend state

## Status

Accepted.

## Context

Beadsmith initially determined the Current Workspace from the process working directory (`std::env::current_dir`), set once at launch and never changed at runtime. The `bw` subprocess inherited it implicitly. This worked for a single-workspace, launch-from-directory model but blocked workspace switching, persistence, and a picker UI.

To support a workspace switcher with recent workspaces, Beadsmith needs to hold an active workspace in backend state, switch it at runtime, and remember known workspaces across restarts. Several approaches exist, each in tension with the others. Changing the process cwd at runtime (`env::set_current_dir`) is the minimal code change, but Rust's cwd is process-global — concurrent code during a switch could see the wrong directory. Relaunching the app with a `--workspace` flag sidesteps runtime switching entirely but kills all UI state. Having the frontend hold the active workspace and pass it to every RPC call keeps the backend stateless, but pollutes the RPC contract with a path parameter on every call and requires frontend bootstrapping on launch. Threading the workspace path explicitly through each `bw` subprocess call while keeping the active workspace as backend state avoids the global-state race and keeps the RPC contract clean, at the cost of making the backend stateful and adding a persistence dependency.

## Decision

We will thread the workspace path explicitly through each `bw` subprocess call via `Command::new("bw").current_dir(workspace_path)` instead of relying on process-global cwd. The backend will hold the active workspace in memory and persist it (along with the recent-workspaces list) using `tauri-plugin-store`.

We will remove process cwd entirely from the workspace resolution path. On launch, the backend will read the last active workspace from the store. If no valid workspace is stored, the frontend will show an empty state prompting the user to add one. The `--workspace` CLI flag and `workspace.rs` override module will be removed. E2e tests will write to the store through the official API rather than using a startup override.

We will have `switch_workspace` validate the target directory (via `bw config list`) before switching. If validation fails, the active workspace will remain unchanged and the error will surface inline in the picker. `add_workspace` will validate before storing; re-adding an existing path will be a no-op that refreshes its timestamp. The recent-workspaces list will cap at 100 entries and silently evict the oldest when full.

## Consequences

The workspace path becomes an explicit parameter inside the backend rather than ambient process state. The adapter, runner, and RPC layer must thread it through to each `bw` call. The `CommandRunner` seam is the natural extension point for this threading.

The backend gains stateful workspace management (active workspace, recent list) persisted via `tauri-plugin-store`. This is a new dependency and a new category of backend state that must be restored on launch.

Launching Beadsmith from a terminal in a project directory no longer auto-detects the workspace. The user must add the workspace through the picker at least once. Terminal-launch auto-detection could return as a future convenience feature.

E2e test infrastructure changes: tests must populate the store with a workspace path before the app loads issues, using the same API a real user would, instead of passing a `--workspace` CLI flag.

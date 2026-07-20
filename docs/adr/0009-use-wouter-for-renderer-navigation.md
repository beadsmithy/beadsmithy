# Use Wouter for renderer navigation

## Context

Beadsmithy needs browser-like Back and Forward navigation for Issue selections and Issue List View changes, while preserving real anchor behavior for Issue rows and Issue References. It also needs deep links to enter the same renderer state and query parameters for Issue List Views and search. The existing application keeps these concerns in local React state, so a hand-written History API adapter and a larger routing framework were both possible alternatives.

Wouter provides a small React router with `<Router>`, `<Route>`, `<Link>`, `useLocation()`, and `useSearchParams()`. Its browser location hook observes History API changes and supports push, replace, and history state. It does not understand Tauri deep-link events, Workspace confirmation or switching, Issue resolution, or Beadsmithy's navigation failure rules.

## Decision

We will use Wouter's full React navigation surface for internal, same-origin renderer routes. The Issue Explorer will use `/issues` for no selected Issue and `/issues/<issue-id>` for an Issue Detail; `view` and `search` query parameters carry the Issue List View and search context. Settings will also be a route, but entering and leaving it will use replacement semantics so it does not create an Issue Navigation Entry.

Wouter will own URL observation, route matching, anchor semantics, and renderer-level push/replace behavior. Beadsmithy will own the semantic Issue Navigation Entry policy and coordinate Wouter with Workspace and Issue state. An Issue Navigation Entry stores the Workspace path, Issue ID when present, Issue List View, search query, and a monotonic navigation index in `history.state`; the Workspace path is intentionally not repeated in visible query parameters.

Selecting an Issue or changing an Issue List View or status pushes an entry. Editing search replaces the current entry and preserves the selected Issue even when its row is filtered out. A view or status change that excludes the selected Issue creates an entry without a selection. Back and Forward may restore another Workspace without confirmation; a failed switch preserves the current state and shows an error. Issue data is always re-resolved from Beadwork, so a removed Issue remains routed and renders an Issue-not-found state. Issue navigation history is session-only and does not restore scroll positions.

## Status

Accepted.

## Consequences

Wouter removes the need to maintain a general-purpose router or manually reproduce anchor and History API behavior. Issue rows and Issue References can use real `<Link>` elements with keyboard and modifier-click semantics, while query updates can use the library's replace support.

The application still needs a domain navigation coordinator for Tauri deep-link delivery, confirmation dialogs, Workspace switching, Issue resolution, navigation failures, Back and Forward commands, and the toolbar's enabled state. Internal renderer URLs are readable but not independently sufficient to identify a Workspace after a fresh start; the external `beadsmithy:///...` link remains the durable, self-contained form. Wouter becomes a runtime dependency, and the app must keep its route and `history.state` contract aligned with the Beadsmithy glossary and ADR 0008.

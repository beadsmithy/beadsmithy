# Beadsmith

Beadsmith is a desktop client for browsing and managing Beadwork projects without becoming a second issue tracker.

## Language

**Issue**:
A Beadwork issue loaded from the current workspace. Beadsmith may present an Issue through different views, but Beadwork remains the source of truth.
_Avoid_: Local issue, cached issue, Beadsmith issue

**Issue List**:
A live collection of Issues read from the current workspace. Beadsmith may reshape it for presentation, but Beadwork remains the source of truth.
_Avoid_: Local issue store, fixture list, cached database

**Issue Detail**:
The selected Issue's readable view: title, concise metadata, Markdown description, dependency context, and read-only comments when present. It is a view of Beadwork issue data, not a separate Beadsmith document.
_Avoid_: Detail document, local issue page, cached issue body

**Issue Search**:
A local, case-insensitive token search over Issue ID, title, and description within the selected Issue List View. Every search token must match for an Issue to remain visible.
_Avoid_: Global search, comment search, server search

**Issue List View**:
A selectable lens that chooses which Issues the Issue List shows. Issue List Views include All Issues, Ready, Blocked, and status-specific views; they may overlap because they answer different Beadwork questions.
_Avoid_: Combined filter, faceted filter, tab

**Issue Status**:
A Beadwork-stored lifecycle value for an Issue, such as `open`, `in_progress`, `closed`, or `deferred`. Beadsmith may display humanized labels such as "In Progress", but status-specific Issue List Views match the stored Beadwork status value.
_Avoid_: State, view state, readiness

**All Issues**:
Every Beadwork issue in the current workspace across Beadwork's stored statuses.
_Avoid_: Actionable issues, default list, open issues, ready issues, blocked issues

**Ready**:
The Beadwork-authored view of Issues available to work next. Membership is computed from stored data and the current time — a deferred Issue becomes Ready when its `defer_until` boundary passes, without a new Beadwork commit. Beadsmith treats Beadwork's ready calculation as authoritative instead of reimplementing readiness rules.
_Avoid_: Locally ready, unblocked open issue

**Blocked**:
The Beadwork-authored view of Issues that cannot proceed because of unresolved blockers. Beadsmith treats Beadwork's blocked calculation as authoritative instead of reimplementing blocking rules.
_Avoid_: Locally blocked, has dependencies

**Workspace**:
A local directory initialized as a Beadwork workspace that Beadsmith has been configured to show. Each Workspace has a user-visible name and a filesystem path. Beadsmith remembers Workspaces across restarts.
_Avoid_: Project, repository, folder, directory (when referring to the Beadsmith concept)

**Current Workspace**:
The Workspace whose Beadwork issues Beadsmith is currently showing. The user selects the Current Workspace from their known Workspaces.
_Avoid_: Active workspace, selected folder

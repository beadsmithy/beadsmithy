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

**All Issues**:
Every Beadwork issue in the current workspace across Beadwork's stored statuses. Ready and blocked are derived views that may be built from issue status and dependency data.
_Avoid_: Actionable issues, default list, open issues, ready issues, blocked issues

**Current Workspace**:
The local directory whose Beadwork issues Beadsmith is currently showing.
_Avoid_: Project setting, saved workspace, selected folder

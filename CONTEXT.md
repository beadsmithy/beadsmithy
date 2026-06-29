# Beadsmith

Beadsmith is a desktop client for browsing and managing Beadwork projects without becoming a second issue tracker.

## Language

**Issue List**:
A live collection of Beadwork issues read from the current workspace. Beadsmith may reshape it for presentation, but Beadwork remains the source of truth.
_Avoid_: Local issue store, fixture list, cached database

**All Issues**:
Every Beadwork issue in the current workspace across Beadwork's stored statuses. Ready and blocked are derived views that may be built from issue status and dependency data.
_Avoid_: Actionable issues, default list, open issues, ready issues, blocked issues

**Current Workspace**:
The local directory whose Beadwork issues Beadsmith is currently showing.
_Avoid_: Project setting, saved workspace, selected folder

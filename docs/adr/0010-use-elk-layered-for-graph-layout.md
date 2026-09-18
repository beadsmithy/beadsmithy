# Use ELK Layered for Graph Mode layout

Graph Mode uses ELK Layered with both parent and blocker relationships as its production layout engine because the existing Dagre hierarchy-only layout allowed blocker routes to pass through unrelated Issue cards. Dagre remains available as a deterministic fallback and comparison baseline; the deliberate consequence is that blocker relationships may influence Issue placement, while the semantic projection still treats explicit `parent` and `blockedBy` fields as authoritative.

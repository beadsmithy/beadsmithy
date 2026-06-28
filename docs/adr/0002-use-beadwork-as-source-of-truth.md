# Use Beadwork as the source of truth

## Status

Accepted.

## Context

Beadsmith exists to manage Beadwork projects. Beadwork already defines issues, statuses, dependencies, comments, attachments, sync behavior, and git-backed storage.

Beadsmith could maintain its own database or normalized copy of issue state, but that would create a second source of truth. Any second model would need to track Beadwork schema changes, resolve drift, and decide which system wins when values differ.

## Decision

Treat Beadwork as the source of truth for issue data and workflow state. Beadsmith may cache or reshape Beadwork data for UI responsiveness, but durable issue state stays in Beadwork.

## Consequences

Beadsmith does not need a separate issue storage model, sync protocol, or conflict-resolution scheme. The UI can show the same state that agents and command-line users see through Beadwork.

Beadsmith's domain model is constrained by Beadwork's model. New UI features must either map cleanly to Beadwork concepts or remain local presentation state.

Beadsmith must handle Beadwork version and schema changes. If Beadwork changes terminology, output shape, or storage behavior, Beadsmith may need integration updates.

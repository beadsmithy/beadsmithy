# Standardize on TauRPC and Effect

## Status

Accepted.

## Context

Beadsmith's React frontend needs to call privileged Rust functionality through a typed Tauri boundary, while keeping async loading, failure, and dependency wiring explicit in frontend code. The default Tauri `invoke` API is flexible, but it leaves more of the cross-boundary contract and error modeling to local convention.

## Decision

Use TauRPC as the standard typed RPC layer for Tauri commands and Effect as the standard TypeScript effect/service layer for frontend integration code. New frontend-to-Rust app functionality should follow this pattern instead of calling raw Tauri commands directly from React components.

Keep upstream TauRPC and Effect source checkouts under `docs/research/` only as reference material when useful. Application code should still consume them through normal package-manager dependencies.

## Consequences

The frontend/native boundary has a stronger typed contract and a single async/error-handling style. The trade-off is that early slices need some setup work before the first issue list renders, and future code should preserve the TauRPC plus Effect pattern rather than introducing parallel integration styles.

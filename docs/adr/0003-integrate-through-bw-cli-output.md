# Integrate through structured bw CLI output

## Status

Accepted.

## Context

Beadwork stores issues on a git orphan branch using JSON files, marker files, attachments, and replayable commit-message intents. Beadsmith could read that git tree directly, or it could invoke the `bw` command-line interface and consume structured output.

Direct git-tree access would avoid subprocess calls and could be optimized for UI reads. It would also require Beadsmith to understand Beadwork's storage layout, marker semantics, schema versions, attachment behavior, and sync replay rules.

The `bw` CLI is the existing supported interface for Beadwork operations. Core commands expose structured output.

## Decision

Integrate with Beadwork by invoking `bw` commands and consuming structured output such as JSON or JSONL. Do not make direct git-tree access the primary integration path.

Beadsmith should not parse prompt text, TTY output, or rendered guidance as a stable app API.

## Consequences

Beadsmith can rely on Beadwork to own its storage layout, schema handling, mutation rules, and sync behavior. This keeps Beadsmith's integration surface smaller and reduces the risk of corrupting Beadwork state.

The `bw` executable and its structured output become an application dependency. Beadsmith must discover or configure the binary, run commands in the correct workspace, handle subprocess failures, and treat output schemas as compatibility contracts.

Some UI operations may be slower or less incremental than direct tree reads. If performance becomes a problem, Beadsmith can add local caching or request better structured `bw` output before taking ownership of Beadwork internals.

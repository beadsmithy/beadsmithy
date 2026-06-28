# Use Tauri and React for the desktop app

## Status

Accepted.

## Context

Beadsmith is a desktop client for browsing and managing local Beadwork projects. It needs a responsive UI for dense issue navigation. It also needs controlled access to local paths, process execution, and desktop packaging.

A pure web app would not fit the local repository access and native packaging needs. A fully native UI would make the interface slower to build and change than the existing React and Vite stack.

## Decision

Build Beadsmith as a Tauri desktop app with a React and TypeScript frontend. React owns the UI. Local system access goes through explicit Tauri/Rust commands instead of direct React code.

## Consequences

Beadsmith can ship as a local desktop app while still using web UI tools. React can focus on layout, state, and rendering. System integration stays behind a smaller native command surface.

The app now has a frontend/native boundary that needs deliberate design. Filesystem access, process execution, and other privileged operations need typed command contracts and error handling across the Tauri bridge.

Packaging, Tauri capabilities, and webview security settings become part of the architecture. The app also depends on both the JavaScript and Rust toolchains during development.

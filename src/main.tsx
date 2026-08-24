import React from "react";
import ReactDOM from "react-dom/client";
import { Router } from "wouter";

import App from "./App";
import { WorkspaceServiceProvider } from "./workspaces/workspace-service";

const installWdioPlugin = async (): Promise<void> => {
  if (import.meta.env.VITE_BEADSMITH_E2E_WDIO === "1") {
    await import("@wdio/tauri-plugin");
  }
};

void (async () => {
  await installWdioPlugin();

  ReactDOM.createRoot(document.querySelector("#root") as HTMLElement).render(
    <Router>
      <React.StrictMode>
        <WorkspaceServiceProvider>
          <App />
        </WorkspaceServiceProvider>
      </React.StrictMode>
    </Router>
  );
})();

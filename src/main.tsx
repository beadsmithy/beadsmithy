import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";

const installWdioPlugin = async (): Promise<void> => {
  if (import.meta.env.VITE_BEADSMITH_E2E_WDIO === "1") {
    await import("@wdio/tauri-plugin");
  }
};

void (async () => {
  await installWdioPlugin();

  ReactDOM.createRoot(document.querySelector("#root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
})();

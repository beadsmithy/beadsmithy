import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

if (typeof ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    private observing = false;

    observe(): void {
      this.observing = !this.observing;
    }

    unobserve(): void {
      this.observing = false;
    }

    disconnect(): void {
      this.observing = false;
    }
  };
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

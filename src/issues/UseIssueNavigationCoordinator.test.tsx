import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "wouter";
import { useHistoryState } from "wouter/use-browser-location";

import {
  parseIssueExplorerRoute,
  serializeIssueExplorerRoute,
} from "./issue-navigation";
import { useIssueNavigationCoordinator } from "./use-issue-navigation-coordinator";

const routeA = { issueId: "bsm-a", search: "", viewId: "all" as const };
const routeB = { issueId: "bsm-b", search: "", viewId: "all" as const };
const routeC = { issueId: "bsm-c", search: "", viewId: "all" as const };

const NavigationHarness = () => {
  const [location, navigate] = useLocation();
  const currentHistoryState = useHistoryState<unknown>();
  const coordinator = useIssueNavigationCoordinator({
    currentHistoryState,
    currentWorkspacePath: "/workspace",
    isSettingsRoute: false,
    issueRoute: parseIssueExplorerRoute(location),
    navigate,
  });

  return (
    <div>
      <output data-testid="location">{location}</output>
      <output data-testid="entry">
        {coordinator.currentNavigationEntry?.issueId ?? "none"}
      </output>
      <output data-testid="workspace">
        {coordinator.currentNavigationEntry?.workspacePath ?? "none"}
      </output>
      <output data-testid="index">{coordinator.currentNavigationIndex}</output>
      <button
        onClick={() => coordinator.navigateIssueRoute(routeA, false)}
        type="button"
      >
        Push A
      </button>
      <button
        onClick={() => coordinator.navigateIssueRoute(routeB, true)}
        type="button"
      >
        Replace B
      </button>
      <button
        onClick={() => coordinator.navigateIssueRoute(routeC, false)}
        type="button"
      >
        Push C
      </button>
      <button
        onClick={() =>
          coordinator.navigateIssueRoute(routeC, true, "/workspace-next")
        }
        type="button"
      >
        Replace C State
      </button>
    </div>
  );
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useIssueNavigationCoordinator", () => {
  it("observes push, replace, traversal, and same-path state replacement through Wouter", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    render(<NavigationHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("index")).toHaveTextContent("0")
    );
    expect(screen.getByTestId("location")).toHaveTextContent("/issues");

    screen.getByRole("button", { name: "Push A" }).click();
    await waitFor(() => {
      expect(screen.getByTestId("entry")).toHaveTextContent("bsm-a");
      expect(screen.getByTestId("index")).toHaveTextContent("1");
    });

    screen.getByRole("button", { name: "Replace B" }).click();
    await waitFor(() => {
      expect(screen.getByTestId("entry")).toHaveTextContent("bsm-b");
      expect(screen.getByTestId("index")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      serializeIssueExplorerRoute(routeB)
    );

    screen.getByRole("button", { name: "Push C" }).click();
    await waitFor(() => {
      expect(screen.getByTestId("entry")).toHaveTextContent("bsm-c");
      expect(screen.getByTestId("index")).toHaveTextContent("2");
    });

    window.history.back();
    await waitFor(() => {
      expect(screen.getByTestId("entry")).toHaveTextContent("bsm-b");
      expect(screen.getByTestId("index")).toHaveTextContent("1");
    });

    window.history.forward();
    await waitFor(() => {
      expect(screen.getByTestId("entry")).toHaveTextContent("bsm-c");
      expect(screen.getByTestId("index")).toHaveTextContent("2");
    });

    screen.getByRole("button", { name: "Replace C State" }).click();
    await waitFor(() =>
      expect(screen.getByTestId("workspace")).toHaveTextContent(
        "/workspace-next"
      )
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      serializeIssueExplorerRoute(routeC)
    );

    const popstateSubscriptions = addEventListener.mock.calls.filter(
      ([eventName]) => eventName === "popstate"
    );
    expect(popstateSubscriptions).toHaveLength(2);
  });
});

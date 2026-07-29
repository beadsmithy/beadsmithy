import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  RefreshFailureBanner,
  selectBannerFailure,
} from "./RefreshFailureBanner";
import type { RefreshFailure } from "../refresh-health";

const failure = (overrides: Partial<RefreshFailure>): RefreshFailure => ({
  errorKind: "refProbe",
  failureRevision: 1,
  message: "boom",
  transient: true,
  ...overrides,
});

describe("RefreshFailureBanner", () => {
  it("renders nothing when no failure is supplied", () => {
    const { container } = render(<RefreshFailureBanner failure={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the canonical copy for a transient ref-probe failure", () => {
    render(
      <RefreshFailureBanner
        failure={failure({ errorKind: "refProbe", failureRevision: 5 })}
      />
    );
    const banner = screen.getByTestId("refresh-failure-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveAttribute("data-failure-kind", "refProbe");
    expect(banner).toHaveAttribute("data-failure-revision", "5");
    expect(banner.textContent).toContain(
      "Automatic refresh is failing while checking Beadwork changes."
    );
    // Diagnostic detail is no longer rendered for the end user.
    expect(banner.textContent).not.toContain("failureRevision");
  });

  it("renders distinct copy for missing git", () => {
    render(
      <RefreshFailureBanner
        failure={failure({
          errorKind: "missingGit",
          failureRevision: 1,
          transient: false,
        })}
      />
    );
    expect(screen.getByTestId("refresh-failure-banner").textContent).toContain(
      "Automatic refresh needs git on PATH to detect Beadwork changes."
    );
  });

  it("renders distinct copy for missing bw", () => {
    render(
      <RefreshFailureBanner
        failure={failure({
          errorKind: "missingBw",
          failureRevision: 1,
          transient: false,
        })}
      />
    );
    expect(screen.getByTestId("refresh-failure-banner").textContent).toContain(
      "Automatic refresh needs bw on PATH to read Beadwork data."
    );
  });

  it("renders distinct copy for not-a-Beadwork-Workspace", () => {
    render(
      <RefreshFailureBanner
        failure={failure({
          errorKind: "notBeadworkWorkspace",
          failureRevision: 1,
          transient: false,
        })}
      />
    );
    expect(screen.getByTestId("refresh-failure-banner").textContent).toContain(
      "This Workspace is no longer a Beadwork Workspace."
    );
  });
});

describe("selectBannerFailure", () => {
  it("returns null when both slots are empty", () => {
    expect(
      selectBannerFailure({ refProbe: null, loader: null })
    ).toBeNull();
  });

  it("prefers a structural failure over a transient failure", () => {
    const structural = failure({
      errorKind: "missingGit",
      failureRevision: 1,
      transient: false,
    });
    const transient = failure({
      errorKind: "refProbe",
      failureRevision: 9,
      transient: true,
    });
    expect(
      selectBannerFailure({ refProbe: transient, loader: structural })
    ).toEqual(structural);
    expect(
      selectBannerFailure({ refProbe: structural, loader: transient })
    ).toEqual(structural);
  });

  it("within the same category, prefers the highest failureRevision", () => {
    const older = failure({ errorKind: "refProbe", failureRevision: 3 });
    const newer = failure({ errorKind: "refProbe", failureRevision: 5 });
    expect(
      selectBannerFailure({ refProbe: older, loader: newer })
    ).toEqual(newer);
    expect(
      selectBannerFailure({ refProbe: newer, loader: older })
    ).toEqual(newer);
  });
});

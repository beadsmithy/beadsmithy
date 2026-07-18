// scripts/oxlint-plugin/no-use-effect-plugin.test.mjs
//
// Focused unit coverage for the load-bearing helpers in
// `no-use-effect-plugin.mjs`. The plugin's behavior is exercised in-tree
// by the lint suite, but this fixture pins the disable-directive walker
// and the import-scoped detection so future changes don't silently
// regress them.

import { describe, expect, it } from "vitest";

import {
  collectDisableDirectives,
  fileImportsReactUseEffect,
  isReactUseEffectCallee,
  resolveSuppressedLineIndex,
} from "./no-use-effect-plugin.mjs";

const line = (text, lineNumber) => ({
  loc: { end: { line: lineNumber }, start: { line: lineNumber } },
  type: "Line",
  value: text,
});

const SOURCE_LINES = [
  'import { useEffect } from "react";',
  "",
  "function useMountEffect(effect) {",
  "  // oxlint-disable-next-line no-use-effect/no-direct-use-effect",
  "  // eslint-disable-next-line react-hooks/exhaustive-deps",
  "  useEffect(() => effect(), []);",
  "}",
];

const LINE_START_INDICES = (() => {
  const offsets = [0];
  let total = 0;
  for (const entry of SOURCE_LINES) {
    total += entry.length + 1;
    offsets.push(total);
  }
  return offsets;
})();

describe("isReactUseEffectCallee", () => {
  it("matches a direct `useEffect(...)` call", () => {
    expect(
      isReactUseEffectCallee({
        callee: { name: "useEffect", type: "Identifier" },
      })
    ).toBe(true);
  });

  it("rejects identifiers other than `useEffect`", () => {
    expect(
      isReactUseEffectCallee({
        callee: { name: "useLayoutEffect", type: "Identifier" },
      })
    ).toBe(false);
  });

  it("rejects missing callees", () => {
    expect(isReactUseEffectCallee({ callee: null })).toBe(false);
    expect(isReactUseEffectCallee({})).toBe(false);
  });
});

describe("fileImportsReactUseEffect", () => {
  it('detects a named import of `useEffect` from "react"', () => {
    const program = {
      body: [
        {
          source: { value: "react" },
          specifiers: [
            {
              imported: { name: "useEffect" },
              type: "ImportSpecifier",
            },
          ],
          type: "ImportDeclaration",
        },
      ],
    };
    expect(fileImportsReactUseEffect(program)).toBe(true);
  });

  it("returns false when `useEffect` is not imported", () => {
    const program = {
      body: [
        {
          source: { value: "react" },
          specifiers: [
            {
              imported: { name: "useState" },
              type: "ImportSpecifier",
            },
          ],
          type: "ImportDeclaration",
        },
      ],
    };
    expect(fileImportsReactUseEffect(program)).toBe(false);
  });

  it("returns false when there are no imports", () => {
    expect(fileImportsReactUseEffect({ body: [] })).toBe(false);
  });
});

describe("resolveSuppressedLineIndex", () => {
  it("returns the next non-comment line for a bare directive", () => {
    const comments = [
      line(" oxlint-disable-next-line no-use-effect/no-direct-use-effect", 4),
    ];
    expect(resolveSuppressedLineIndex(comments[0], comments)).toBe(5);
  });

  it("skips intervening `eslint-disable-next-line` comments", () => {
    const comments = [
      line(" oxlint-disable-next-line no-use-effect/no-direct-use-effect", 4),
      line(" eslint-disable-next-line react-hooks/exhaustive-deps", 5),
    ];
    expect(resolveSuppressedLineIndex(comments[0], comments)).toBe(6);
  });

  it("skips an intervening oxlint-disable targeting a different rule", () => {
    const comments = [
      line(" oxlint-disable-next-line no-use-effect/no-direct-use-effect", 4),
      line(" oxlint-disable-next-line no-restricted-syntax", 5),
    ];
    expect(resolveSuppressedLineIndex(comments[0], comments)).toBe(6);
  });

  it("stops at the next oxlint-disable directive that also targets our rule", () => {
    const comments = [
      line(" oxlint-disable-next-line no-use-effect/no-direct-use-effect", 4),
      line(" oxlint-disable-next-line no-use-effect/no-direct-use-effect", 5),
    ];
    expect(resolveSuppressedLineIndex(comments[0], comments)).toBe(5);
  });
});

describe("collectDisableDirectives", () => {
  it("builds a [start, end] range covering the suppressed line", () => {
    const comments = [
      line(" oxlint-disable-next-line no-use-effect/no-direct-use-effect", 4),
      line(" eslint-disable-next-line react-hooks/exhaustive-deps", 5),
    ];
    const ranges = collectDisableDirectives(comments, LINE_START_INDICES);
    expect(ranges).toEqual([[LINE_START_INDICES[5], LINE_START_INDICES[6]]]);
  });

  it("ignores directives that target a different rule", () => {
    const comments = [
      line(" oxlint-disable-next-line no-restricted-syntax", 4),
    ];
    expect(collectDisableDirectives(comments, LINE_START_INDICES)).toEqual([]);
  });

  it("returns no ranges when lineStartIndices is missing", () => {
    const comments = [
      line(" oxlint-disable-next-line no-use-effect/no-direct-use-effect", 4),
    ];
    expect(collectDisableDirectives(comments, null)).toEqual([]);
  });
});

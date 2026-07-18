// scripts/oxlint-plugin/no-use-effect-plugin.mjs
//
// Local JS ESLint plugin loaded by Oxlint (via `jsPlugins`) that flags direct
// React `useEffect(...)` calls so the no-use-effect policy can be staged
// (warning) and later promoted to an error. The plugin matches the
// CallExpression shape used by Oxlint's JS plugin runtime.
//
// The plugin only flags calls that import `useEffect` from the "react"
// package — it intentionally allows any other identifier named `useEffect`
// so unrelated helpers are untouched. The wrapper hook itself
// (src/lib/use-mount-effect.ts) is the only narrowly scoped suppression;
// `oxlint-disable-next-line no-use-effect/no-direct-use-effect` directives
// are honored at the wrapper implementation site.

const REACT_PACKAGE = "react";

const RULE_NAME = "no-use-effect/no-direct-use-effect";
const MESSAGE_ID = "noDirectUseEffect";
const MESSAGE = [
  "Direct React `useEffect` is forbidden by the no-use-effect policy.",
  "Use derived state, an event handler, a `key`/remount boundary, a",
  "data-fetching hook, or the documented `useMountEffect` escape hatch",
  "in src/lib/use-mount-effect.ts instead.",
].join(" ");

const DISABLE_DIRECTIVE_REGEX =
  /^\s*oxlint-disable-next-line(?:\s+(?<rules>[A-Za-z0-9_/,\-\s]+))?$/u;
const ESLINT_DISABLE_REGEX = /^\s*\/?\s*eslint-disable/u;
const BLANK_LINE_REGEX = /^\s*$/u;

const isOxLintDisableDirective = (text) =>
  DISABLE_DIRECTIVE_REGEX.test(text ?? "");

const isEslintDisable = (text) => ESLINT_DISABLE_REGEX.test(text ?? "");

const isBlankLineComment = (text) => BLANK_LINE_REGEX.test(text ?? "");

const directiveTargetsOurRule = (commentText) => {
  const match = commentText.match(DISABLE_DIRECTIVE_REGEX);
  if (!match) {
    return false;
  }
  const list = (match.groups.rules ?? "").trim();
  if (list.length === 0) {
    return false;
  }
  return list
    .split(",")
    .map((entry) => entry.trim())
    .includes(RULE_NAME);
};

const resolveSuppressedLineIndex = (comment, comments) => {
  // The directive suppresses the first non-comment token on the line
  // immediately following the directive, but the suppression must still
  // apply when one or more unrelated line comments (for example an
  // eslint-disable for a different rule) sit between the directive and
  // the suppressed token. Walk forward line by line, skipping any line
  // that hosts a non-directive line comment, until we reach the
  // suppressed line.
  const startLine = comment.loc?.end?.line ?? 0;
  const commentLinesWithDirective = new Set();
  const commentLinesWithEslintDisable = new Set();
  const ownIndex = comments.indexOf(comment);
  for (let i = ownIndex + 1; i < comments.length; i += 1) {
    const next = comments[i];
    if (next.type !== "Line") {
      break;
    }
    const nextText = next.value ?? "";
    if (isOxLintDisableDirective(nextText)) {
      break;
    }
    if (isEslintDisable(nextText)) {
      commentLinesWithEslintDisable.add(next.loc?.start?.line ?? -1);
      continue;
    }
    if (isBlankLineComment(nextText)) {
      continue;
    }
    commentLinesWithDirective.add(next.loc?.start?.line ?? -1);
  }
  const skipLines = new Set([
    ...commentLinesWithEslintDisable,
    ...commentLinesWithDirective,
  ]);
  for (let candidate = startLine + 1; ; candidate += 1) {
    if (skipLines.has(candidate)) {
      continue;
    }
    return candidate;
  }
};

const collectDisableDirectives = (comments, lineStartIndices) => {
  if (!Array.isArray(lineStartIndices)) {
    return [];
  }
  const disabledRanges = [];
  for (const comment of comments) {
    if (comment.type !== "Line") {
      continue;
    }
    const text = comment.value ?? "";
    if (!directiveTargetsOurRule(text)) {
      continue;
    }
    const suppressedLineIndex = resolveSuppressedLineIndex(comment, comments);
    // `suppressedLineIndex` is 1-indexed (matching `loc.end.line`),
    // and `lineStartIndices` is 0-indexed (index 0 is the offset of
    // source line 1). Translate accordingly.
    const suppressedLineStart = lineStartIndices[suppressedLineIndex - 1];
    if (suppressedLineStart === undefined) {
      continue;
    }
    const followingLineStart =
      lineStartIndices[suppressedLineIndex] ?? Number.MAX_SAFE_INTEGER;
    disabledRanges.push([suppressedLineStart, followingLineStart]);
  }
  return disabledRanges;
};

const isInDisabledRange = (node, disabledRanges) => {
  const start = node.start ?? node.range?.[0];
  if (start === undefined) {
    return false;
  }
  return disabledRanges.some(
    ([rangeStart, rangeEnd]) => start >= rangeStart && start <= rangeEnd
  );
};

const isReactUseEffectCallee = (node) => {
  const { callee } = node;
  if (callee === null || callee === undefined) {
    return false;
  }
  return callee.type === "Identifier" && callee.name === "useEffect";
};

const fileImportsReactUseEffect = (program) => {
  const sources = program.body ?? [];
  for (const node of sources) {
    if (node.type !== "ImportDeclaration") {
      continue;
    }
    if (node.source.value !== REACT_PACKAGE) {
      continue;
    }
    for (const specifier of node.specifiers ?? []) {
      if (
        specifier.type === "ImportSpecifier" &&
        specifier.imported?.name === "useEffect"
      ) {
        return true;
      }
    }
  }
  return false;
};

const noDirectUseEffectRule = {
  create(context) {
    let reactUseEffectImported = false;
    let disabledRanges = [];
    const sourceCode =
      typeof context.sourceCode === "object" &&
      context.sourceCode !== null &&
      "getAllComments" in context.sourceCode
        ? context.sourceCode
        : null;
    return {
      CallExpression(node) {
        if (!reactUseEffectImported) {
          return;
        }
        if (!isReactUseEffectCallee(node)) {
          return;
        }
        if (isInDisabledRange(node, disabledRanges)) {
          return;
        }
        context.report({ messageId: MESSAGE_ID, node });
      },
      Program(node) {
        reactUseEffectImported = fileImportsReactUseEffect(node);
        const comments = sourceCode?.getAllComments?.() ?? node.comments ?? [];
        const lineStartIndices = sourceCode?.lineStartIndices ?? null;
        disabledRanges = collectDisableDirectives(comments, lineStartIndices);
      },
    };
  },
  meta: {
    docs: {
      description:
        "Disallow direct React `useEffect` calls in favor of the documented replacement patterns.",
    },
    messages: {
      [MESSAGE_ID]: MESSAGE,
    },
    schema: [],
    type: "problem",
  },
};

const plugin = {
  meta: { name: "no-use-effect" },
  rules: {
    "no-direct-use-effect": noDirectUseEffectRule,
  },
};

export default plugin;

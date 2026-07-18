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
// (src/lib/use-mount-effect.ts) is the only narrowly scoped suppression once
// the escape hatch is introduced.

const REACT_PACKAGE = "react";

const MESSAGE_ID = "noDirectUseEffect";
const MESSAGE = [
  "Direct React `useEffect` is forbidden by the no-use-effect policy.",
  "Use derived state, an event handler, a `key`/remount boundary, a",
  "data-fetching hook, or the documented `useMountEffect` escape hatch",
  "in src/lib/use-mount-effect.ts instead.",
].join(" ");

const isReactUseEffectCallee = (node) => {
  const { callee } = node;
  if (callee === null || callee === undefined) {
    return false;
  }
  if (callee.type !== "Identifier" || callee.name !== "useEffect") {
    return false;
  }
  // `React.useEffect(...)` form is intentionally ignored here — the
  // migration spec is focused on the named-import style used in this
  // codebase.
  return true;
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
    return {
      CallExpression(node) {
        if (!reactUseEffectImported) {
          return;
        }
        if (!isReactUseEffectCallee(node)) {
          return;
        }
        context.report({ messageId: MESSAGE_ID, node });
      },
      Program(node) {
        reactUseEffectImported = fileImportsReactUseEffect(node);
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

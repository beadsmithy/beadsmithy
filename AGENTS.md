# Beadsmith

I'm building this app for myself. It's not in production and scale doesn't matter. Architecture and code quality still matters a lot.

This project is building a desktop client for [beadwork](https://github.com/jallum/beadwork), a git-native work management tool for humans and AI coding agents.

# Repo Structure

This repo is structured with the decisions in `docs/adr/`, the thinking/planning/research in `docs/research/`,
and the building in `src/` and `scr-tauri/`.

```
beadsmith/                              # meta-operating layer (you are here)
├── AGENTS.md                          # (this) operating doc: what we're building + how this repo is run
│
└── research/                          # thinking: notes, specs, oss repos, and investigations feed projects/
    ├── DESIGN.md                      # design system and design tokens
    ├── PRD.md                         # product overview and initial direction
    ├── adr/                          # final architectural decision records
    ├── design/                        #   product, design
    │   └── mockups/                   #     visual mockups for UI
    └── infra/                         #   reference OSS libs
         └── beadwork/                  #     beadwork source code (vendored)
```

## Work Management

This project also uses `bw` (beadwork) for tracking work, which persists to git — plans, progress, and decisions survive compaction, session
boundaries, and context loss.

ALWAYS run `bw prime` before starting work. Without it, you're missing workflow context, current state, and repo hygiene warnings. Work
done without priming often conflicts with in-progress changes.

Committing, closing issues, and syncing are part of completing a task — not separate actions requiring additional permission.

## Agent skills

### Issue tracker

Issues are tracked in beadwork via `bw`; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

The triage vocabulary uses the default canonical labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo with domain context at root `CONTEXT.md` when present and ADRs in `docs/adr/`. See `docs/agents/domain.md`.

### WebDriver end-to-end testing

Slice-level user-path proof (launches the real built desktop binary, not a renderer-only or mocked test) lives in per-slice `wdio.*.conf.ts` files at the repo root plus `e2e/`. See `docs/agents/webdriver-e2e.md` for the Issue List slice's suite, how to run it, and its known upstream caveats.

<important if="writing frontend react or typescript code">
## Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

### Quick Reference

- **Format code**: `pnpm dlx ultracite fix`
- **Check for issues**: `pnpm dlx ultracite check`
- **Diagnose setup**: `pnpm dlx ultracite doctor`

Oxlint + Oxfmt (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

### Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

#### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

#### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

#### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

#### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

#### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

#### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

#### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

#### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

#### Framework-Specific Guidance

**React 19+:**

- Use ref as a prop instead of `React.forwardRef`

---

### Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

### When Oxlint + Oxfmt Can't Help

Oxlint + Oxfmt's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Oxlint + Oxfmt can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code
</important>

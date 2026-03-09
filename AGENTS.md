## Available Scripts

This project uses **Bun** as the runtime and package manager.

Developers and AI agents should use **`bun`** and **`bunx`** when running scripts or executing packages. Other tools such as **npm**, **pnpm**, **npx**, and **pnpx** should not be used directly.

AI agents should use the following scripts during development. All scripts are run with `bun run`.

* **`dev`**
  Starts the application in development mode with file watching.

* **`build`**
  Compiles the TypeScript project into the `dist` directory.

* **`typecheck`**
  Runs TypeScript type checking without emitting files.

* **`lint`**
  Runs Biome to check the codebase for linting issues.

* **`lint:fix`**
  Runs Biome and automatically fixes issues where possible.

* **`format`**
  Formats the codebase using Biome.

* **`test`**
  Runs the test suite.

* **`test:watch`**
  Runs tests in watch mode.

* **`test:coverage`**
  Runs tests with coverage reporting enabled.

---

## General Notes

* **Always verify changes before finishing a task.**

  Before completing any implementation, ensure the codebase is in a valid state by running the development checks:

  ```bash
  bun run typecheck
  bun run lint
  bun run test
  ```

  If any command fails, fix the issue before proceeding. Code changes should not leave the repository with failing type checks, lint errors, or broken tests.

* **Use Zod for runtime validation and safe type narrowing.**
  We use **Zod v4**, which has different APIs than Zod v3. Reference the LLM-friendly documentation:
  [https://zod.dev/llms.txt](https://zod.dev/llms.txt)

* **Prefer guard clauses over nested conditionals.**
  Use early returns to keep control flow simple, readable, and easier to reason about.

* **Readability trumps performance.**
  In almost every case, code should be optimized for clarity, maintainability, and ease of reasoning before raw performance. We should be able to return to a piece of code months later and understand it quickly without having to unravel cleverness, hidden control flow, or unnecessary complexity.

  Do not introduce difficult or overly clever code to save a few milliseconds unless there is a clearly demonstrated performance need. Premature optimization is rarely worth the maintenance cost.

  Performance does matter, but it should be addressed intentionally. Start with clear, readable code. Optimize only when a real bottleneck has been identified, and prefer changes that preserve readability as much as possible.

* **Use proper logger levels.**
  Use `Logger` from `@nestjs/common`.
  Available levels: `log`, `fatal`, `error`, `warn`, `debug`, `verbose`.

  Choose levels intentionally:

  * `error` for failures requiring investigation
  * `warn` for unexpected but recoverable conditions
  * `log` for meaningful lifecycle events
  * `debug` and `verbose` for diagnostic information

* **Don’t reinvent the wheel.**
  If a well-maintained open source solution exists, prefer it over building our own. Mature libraries have already been battle-tested, expose edge cases we would otherwise discover the hard way, and reduce complexity in our codebase.

* **Don’t fight TypeScript.**
  Avoid `any` and unnecessary `as` assertions. These bypass the type system and usually indicate missed opportunities for proper validation or type narrowing.

  Prefer `unknown` for untyped data and use runtime validation (such as Zod) to narrow types safely. Let TypeScript infer types whenever possible, and use `satisfies` when validating object shapes.

  The main exception is in **test files**, where `any`, assertions, and looser typing are sometimes a necessary evil.

* **Validate at system boundaries.**
  Any data coming from outside our system should be treated as untrusted until proven otherwise. That includes request bodies, query params, headers, environment variables, database results, webhooks, and third-party API responses.

  Validate external data as close to the boundary as possible, then work with trusted, narrowed types throughout the rest of the code. This keeps unsafe assumptions localized and prevents validation logic from leaking across the codebase.

* **Prefer pure functions when possible.**
  Functions are easier to understand, test, and reuse when they are predictable. A pure function takes inputs, returns an output, and does not depend on hidden state or produce side effects.

  Not everything can be pure, but we should isolate side effects like logging, database writes, network calls, and filesystem access to the edges of the system. Keep core business logic as pure as possible.

* **Prefer a single parameter object for complex function inputs.**
  Functions with multiple parameters, optional values, or unclear positional meaning should generally accept a single parameter object instead of multiple positional arguments.

  This removes parameter ordering concerns and makes call sites more self-documenting. It also makes optional parameters easier to add without breaking existing usages.

  This pattern mirrors the style commonly used in React APIs and leads to clearer, more maintainable code.

* **Make illegal states unrepresentable.**
  Use TypeScript’s type system to model the domain so invalid combinations are difficult or impossible to express. If a state should never exist in the application, the type system should help prevent it from being constructed in the first place.

  Prefer discriminated unions, constrained schemas, and explicit domain models over loose objects with optional fields everywhere. The more correctness we can encode into types and validation, the fewer runtime bugs we leave lying around.

* **Only test code we control.**
  We should not write tests that simply validate the behavior of third-party libraries. Those libraries already have their own test suites, and duplicating that effort provides little value.

  Instead, test **our business logic** and how external libraries are used within it. If a library is deeply integrated into our logic, testing that integration is reasonable. Testing the library itself is not.

* **Use JSDoc to improve developer experience.**
  Good JSDoc acts as built-in documentation and makes code easier to understand through editor hover hints. It should clarify intent, parameters, return values, and edge cases where necessary.

  Avoid overusing it. Not every line of code needs documentation. Focus on public APIs, complex logic, and anything that benefits from additional context.

  Write JSDoc as if we were building a third-party library. The goal is to make our code easy for other developers to understand and use without digging through implementation details.

* **Prefer immutability.**
  Mutable state and hidden side effects make systems harder to reason about and significantly harder to debug. When data changes unexpectedly, tracing the source of a bug becomes difficult.

  Prefer immutable patterns where data is transformed into new values rather than modified in place. This makes behavior more predictable, simplifies reasoning about code, and makes issues easier to isolate during debugging.

  Not every situation requires strict immutability, but it should be the default approach for application logic.

* **Choose commit types intentionally.**
  This project uses **Conventional Commits** to drive automated releases and changelog generation. The commit type you choose influences how releases are versioned.

  When writing a commit, consider the actual impact of the change and select the type that accurately represents it. Commit messages should reflect the real effect of the change, not just the files that were modified.

  Because commit types influence version bumps and changelog entries, choosing the correct type is important for keeping our release history accurate and meaningful.

* **Do not use decorative section divider comments.**
  Avoid visual separator comments such as banner-style or ruler-style comments used to divide sections of a file.

  Examples of disallowed patterns:

  ```ts
  // ── E2E tests ─────────────────────────────────────────
  // ===== Utilities ======================================
  // ------------------------------------------------------
  ```

  These comments add visual noise and rarely provide meaningful context. Prefer clear function names, smaller modules, and well-structured code instead.

  This frames the rule around **maintainability**, not just preference, which helps AI agents follow it more reliably.
<!-- builderai-document
type: coding-standards
version: 1
-->

# Coding standards

## Language and types

- TypeScript strict mode is mandatory. Do not use `any`, non-null assertions, or unsafe casts to bypass
  a type error; narrow or validate the value.
- Prefer small named types at boundaries. Infer local implementation types when they remain clear.
- Model finite states with discriminated unions rather than boolean combinations.
- Use `unknown` for untrusted values and validate before use.
- Use `import type` for type-only imports.

## Modules and dependencies

- Organize product code by capability, not by technical file type.
- Keep route files thin and move reusable domain behavior into the owning feature.
- Prefer platform and framework capabilities before adding a dependency.
- A new runtime dependency requires a maintenance, license, size, security, and alternatives review.
- Do not reach into another module's internals; expose an intentional public contract.

## React and Next.js

- Prefer Server Components. Use Client Components only for interaction, effects, or browser APIs.
- Keep state as close as possible to the component that owns it; derive values instead of syncing
  duplicate state through effects.
- Use semantic HTML first, preserve keyboard navigation, and provide visible focus states.
- Treat route handlers and Server Actions as untrusted network boundaries.
- Avoid unbounded dynamic rendering, waterfalls, and large client bundles; measure before optimizing.

## Errors and observability

- Reject invalid input early with actionable, non-sensitive messages.
- Preserve error causes internally and translate errors once at the boundary.
- Never log secrets, credentials, tokens, full request bodies, or sensitive personal data.
- Structured events use stable names and include correlation context when available.

## Testing

- Test externally observable behavior, not implementation details.
- Unit tests cover domain decisions and edge cases; integration tests cover adapters and boundaries;
  browser tests cover only critical user journeys.
- Every bug fix includes a regression test when practical.
- Tests are deterministic: no real network, clock, random source, or shared mutable state without an
  explicit controlled test double.
- Coverage thresholds are a floor, not evidence of test quality.

## Naming and style

- Components and exported types use `PascalCase`; functions and variables use `camelCase`; constants
  use `UPPER_SNAKE_CASE` only when truly immutable and global.
- Names describe business intent. Avoid vague terms such as `data`, `helper`, `manager`, or `utils`.
- One module should have one reason to change. Split on responsibility, not arbitrary line counts.
- Comments explain constraints or rationale; code explains mechanics.
- ESLint and Prettier are authoritative. Do not suppress a rule without a local rationale.

## Git and review

- Keep commits focused and use imperative subjects.
- Pull requests explain intent, scope, risk, validation, and operational impact.
- Never mix broad refactoring with behavior changes unless separation is impractical and documented.
- Review for correctness, security, accessibility, failure modes, tests, and maintainability—not only
  formatting.

## Definition of done

A change is done when acceptance criteria are met; `npm run ci` passes; tests, documentation, security
considerations, accessibility, telemetry, migrations, and rollback are addressed as applicable; and
no unresolved high-severity review finding remains.

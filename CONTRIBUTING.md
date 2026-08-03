# Contributing to BuilderAI

Thank you for contributing to BuilderAI! This document outlines the guidelines, standards, and processes for contributing to this project.

## Project Overview

BuilderAI is a trustworthy, model-independent software engineering platform grounded in durable project context. The core architecture is designed to be independent of AI models, vendors, UI frameworks, databases, and delivery platforms.

The canonical source of mutable project state is `project-brain.json`. All changes to the project must respect the Project Constitution and the architectural boundaries defined in the documentation.

## Development Setup

To set up the development environment:

1. **Prerequisites**: Ensure you have Node.js (v18+ recommended) and npm installed.
2. **Install Dependencies**: Run `npm install` to install the required dependencies.
3. **Run Quality Gates**: Run `npm run ci` (or the equivalent verification script) to run linter, formatter, and tests.
4. **Local Development**: Use `npm run dev` to start the local development server for the workspace UI.

## Coding Standards

We enforce strict coding standards to maintain a high-quality, secure, and robust codebase:

- **Language and Types**: TypeScript strict mode is mandatory. Never use `any`, non-null assertions, or unsafe casts. Model finite states with discriminated unions.
- **Architecture**: Keep domain logic framework-independent. Organize code by capability, not by technical file type.
- **React and Next.js**: Prefer Server Components. Use Client Components only for interaction, effects, or browser APIs. Treat route handlers and Server Actions as untrusted network boundaries.
- **Errors and Observability**: Reject invalid input early with actionable, non-sensitive messages. Never log secrets, credentials, or sensitive personal data.
- **Testing**: Test externally observable behavior, not implementation details. Tests must be deterministic (no real network, clock, or random source without controlled test doubles).

## Branch Naming Convention

Branches should be named using the following patterns:

- `feature/<task-id>-<short-description>` (e.g., `feature/workspace-842a-add-contributing`)
- `bugfix/<task-id>-<short-description>`
- `chore/<short-description>`

Always include the relevant task ID if applicable.

## Commit Message Convention

We follow structured, imperative commit messages:

- **Format**: `<type>(<scope>): <subject>`
- **Types**:
  - `feat`: A new feature
  - `fix`: A bug fix
  - `docs`: Documentation changes
  - `style`: Code style changes (formatting, missing semi-colons, etc.)
  - `refactor`: Code changes that neither fix a bug nor add a feature
  - `test`: Adding or correcting tests
  - `chore`: Maintenance tasks, dependency updates, etc.
- **Subject**: Use the imperative, present tense (e.g., "add contributing guide" instead of "added contributing guide").

## Pull Request Checklist

Before submitting a pull request, please ensure you have completed the following:

- [ ] The canonical `project-brain.json` has been parsed and updated if necessary.
- [ ] All TypeScript types are strictly defined and compile without errors.
- [ ] All unit and integration tests pass successfully.
- [ ] Code formatting and linting checks pass (`npm run ci`).
- [ ] The change is within the declared ownership boundaries.
- [ ] No secrets, credentials, or sensitive data are exposed.
- [ ] The pull request description clearly explains the intent, scope, risk, validation, and operational impact.

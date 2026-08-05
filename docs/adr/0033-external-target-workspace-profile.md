# ADR-0033: External target workspace project profile

## Status

Accepted

## Context

Trusted-local workspace prepare validates project context through the Blueprint Reader, which
requires BuilderAI's full governance document stack and `project-brain.json`. Existing application
repositories such as Zyro.lk fail with `PROJECT_CONTEXT_INVALID` before useful development can
begin.

## Decision

Introduce a workspace project profile with two values:

- `BUILDERAI_SELF` (default): existing strict Blueprint Reader validation unchanged.
- `EXTERNAL_TARGET`: deterministic bootstrap contract requiring `.builderai/target-project.json`,
  `docs/architecture.md`, `docs/project-constitution.md`, `docs/ai-rules.md`, and root
  `package.json`.

Select the profile with `BUILDERAI_WORKSPACE_PROJECT_PROFILE`. External-target validation replaces
BuilderAI-specific document requirements but still fails closed when bootstrap context is missing or
malformed. Optional target `project-brain.json` is honored; otherwise a synthetic brain is derived
from the manifest.

Filesystem containment, protected-path enforcement, scope, preservation, authorization, and apply
protections are unchanged.

## Consequences

- Operators can onboard an existing repository in under one hour using committed bootstrap templates.
- BuilderAI self-governance remains strict by default.
- Verification still requires package metadata for build/test discovery.
- Hosted production onboarding, OAuth/SSO, and full-stack indexing remain future checkpoints.

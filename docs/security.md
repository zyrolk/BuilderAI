# Security baseline

## Purpose

Security is a release property, not a final review phase. This baseline applies to code, infrastructure,
dependencies, data handling, and operations. It will be refined through feature-level threat models.

## Initial threat model

Protected assets include user identity, authorization state, application and audit data, secrets,
source and build integrity, and service availability. Initial adversaries include unauthenticated
internet users, compromised accounts, malicious dependencies, insiders exceeding authorized use, and
automated abuse. Trust boundaries exist at the browser/server interface, CI, deployment platform,
future identity and data services, and every third-party integration.

## Mandatory controls

### Identity and authorization

- Select identity technology only after requirements are defined; do not build custom authentication.
- Enforce authorization server-side on every protected read and mutation, deny by default, and test
  cross-tenant and privilege-escalation cases.
- Use secure, `HttpOnly`, `SameSite` cookies for browser sessions and require reauthentication for
  sensitive operations where appropriate.

### Input, output, and browser security

- Validate size, shape, type, and allowed values at every trust boundary.
- Rely on React escaping; sanitize explicitly approved rich content with a maintained library.
- Apply anti-CSRF controls to cookie-authenticated mutations and rate limits to abuse-prone endpoints.
- Baseline response headers are configured in `next.config.ts`. Add a tested Content Security Policy
  before third-party scripts or user-authenticated production flows are introduced.
- Restrict uploads by content, size, storage location, and malware policy before enabling them.

### Blueprint Reader trust boundary

- Treat every discovered document as untrusted input and validate its format, declared type, version,
  required sections, and canonical schema before using its content.
- Resolve filesystem reads under an explicitly configured project root and reject traversal outside it.
- Report malformed or conflicting content; do not execute, interpolate, repair, or fetch content named
  by project documentation.
- Apply size, file-count, nesting-depth, and processing-time limits before accepting remote or
  user-controlled project archives. Local repository reading does not authorize uploads or remote access.

### Context Package trust boundary

- Validate canonical state and Blueprint Reader output before selecting context; reject conflicts rather
  than choosing one source silently.
- Accept only safe repository-relative source paths. Source snapshots are data and must never be
  executed, imported dynamically, fetched, or treated as instructions.
- Enforce character, file, and document limits before a Context Package crosses a consumer boundary.
  Mandatory governance content cannot be truncated to satisfy a limit.
- Treat source content as potentially secret-bearing. Creating a Context Package does not authorize
  logging, persistence, network transmission, or disclosure to another service.
- Future consumers must accept only the validated Context Package contract rather than independently
  reading canonical state, documentation, or repository files.

### Secrets and data

- Store secrets in the deployment platform's secret manager, never in Git or `NEXT_PUBLIC_` variables.
- Rotate exposed credentials immediately; removing them from a later commit is insufficient.
- Classify data before collection. Minimize fields, access, retention, replication, and log exposure.
- Encrypt traffic with TLS and use managed encryption at rest. Define deletion, export, backup, and
  restoration behavior before storing user data.

### Dependencies and supply chain

- Install from the committed lockfile with `npm ci` in CI.
- Review runtime dependencies and automated update pull requests; do not auto-merge blindly.
- Keep GitHub Actions least-privileged and pin actions to immutable commits when repository governance
  and an update process are established.
- Run dependency, secret, and static analysis in the hosting platform before production launch.
- Generate an SBOM and retain build provenance for production releases.

### Logging and errors

- Return generic external errors and retain diagnostic context only in restricted telemetry.
- Redact tokens, cookies, credentials, personal data, request bodies, and provider payloads.
- Audit security-relevant events with actor, action, target, outcome, timestamp, and correlation ID;
  protect audit integrity and define retention.

## Vulnerability management

Do not report vulnerabilities through public issues. Until a private security contact is configured,
repository owners must enable GitHub private vulnerability reporting before external release. Triage
uses exploitability and impact, not scanner score alone. Critical and high findings block release
unless a time-bounded, owner-approved exception documents compensating controls.

### Active exception: development-only glob expansion advisory

- **Advisory:** `GHSA-mh99-v99m-4gvg`
- **Scope:** `brace-expansion@1.1.17`, transitively used by ESLint plugins. It is absent from the
  production dependency tree and production artifact.
- **Reason:** As of 2026-07-30, the affected 1.x line has no patched release. Moving to ESLint 10 is
  not currently supported by the lint plugins bundled with Next.js 16.2.
- **Compensating controls:** lint receives repository-controlled patterns only; pull requests run in
  time-bounded, least-privileged CI; production audits remain blocking; Dependabot checks weekly.
- **Owner and review:** engineering owner; review by 2026-08-30 or when Next's lint stack supports
  ESLint 10, whichever comes first. Remove the exception immediately when a compatible fix exists.

## Incident response

Before production, assign an incident commander path, security contact, severity model, evidence
retention rules, and customer/legal notification workflow. The response sequence is: detect, contain,
preserve evidence, eradicate, recover, communicate, and conduct a blameless review with tracked actions.

## Release security checklist

- Threat model and authorization matrix updated for the change.
- Trust-boundary validation and negative tests present.
- Secrets, personal data, logging, retention, and deletion reviewed.
- Dependency and CI changes reviewed for supply-chain risk.
- Abuse controls, operational alerts, recovery, and rollback verified.
- No unresolved critical or high security finding.

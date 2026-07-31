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

### AI Provider Adapter trust boundary

- The core provider contract contains no credentials, endpoints, environment access, SDK types, HTTP
  clients, or network behavior. Reject undeclared configuration fields rather than retaining them.
- Validate capability descriptors and configuration when registering a provider. Snapshot descriptors
  and reject identity or capability drift after registration.
- Select only enabled providers whose declared limits and capabilities satisfy the validated request.
  Discovery and selection must not invoke provider behavior.
- Treat every future provider response, diagnostic, artifact, path, usage value, and metadata field as
  untrusted. Enforce exact request identity, output limits, safe relative artifact paths, Prompt
  Package accounting, and required artifact kinds before a response crosses the adapter boundary.
- Core timeout and cancellation contracts do not themselves provide enforcement. A concrete adapter
  must enforce its request deadline and cancellation propagation. Production workflows additionally
  require concurrency limits, payload redaction, authorization, audit policy, and safe failure behavior.

### OpenAI Responses provider trust boundary

- The OpenAI adapter accepts only a validated `AIProviderRequest` containing the Prompt Package. It
  must not read Project Brain state, documentation, source files, environment variables, or secrets
  independently.
- The caller must authorize and classify the Prompt Package before external transmission. Adapter
  configuration sets `store: false`, but production use still requires approved provider retention,
  residency, legal, privacy, and incident-response terms.
- Inject credentials from a server-side secret boundary. Never persist, log, return, place in scalar
  metadata, expose to a client bundle, or include them in provider error messages.
- Keep streaming, background mode, tools, functions, files, images, history, and parallel tool calls
  disabled. SDK and adapter retries remain disabled so retries cannot duplicate disclosure or spend
  outside Execution Engine policy.
- Validate the wire response, completion status, JSON structure, Output Contract, identity, limits,
  artifact kinds, timing, and usage before returning data. Map failures to stable BuilderAI errors
  without exposing raw provider bodies.
- CI uses a deterministic transport double and sends no source or Prompt Package externally. Before
  production release, run a separately authorized minimal smoke test with non-sensitive synthetic
  content and verify account-level retention controls.

### Google Gemini provider trust boundary

- Load `GEMINI_API_KEY` only in the server composition root and inject it into the isolated transport.
  Never log, persist, return, commit, or expose it through `NEXT_PUBLIC_` configuration.
- The local adapter targets the Gemini Developer API from Google AI Studio, not Vertex AI. Do not set
  Vertex configuration for this release profile, and keep provider choice explicit through
  `BUILDERAI_AI_PROVIDER`.
- Send only the already selected and validated Prompt Package. The adapter must not independently read
  Project Brain state, documentation, source, environment variables, or files.
- Free-tier Gemini services may use submitted content to improve Google products. Restrict free-tier
  testing to non-sensitive, non-customer, non-production projects unless approved provider terms and a
  separate privacy/data-processing review permit the disclosure.
- Keep streaming, tools, functions, files, images, history, and SDK retries disabled. Validate the
  candidate completion reason, response text, token usage, JSON structure, Output Contract, identity,
  limits, and artifact kinds before returning a provider-neutral response.
- Map quota, availability, timeout, cancellation, credential/model, and contract failures to the
  existing redacted BuilderAI taxonomy. Never surface raw Google response bodies or SDK errors.
- Free-tier quotas and regional availability are external operational constraints, not BuilderAI
  guarantees. A 429 or unsupported-region response must fail closed; no provider fallback is allowed.

### Prompt Package trust boundary

- Accept only a Context Package that passes its production validator. Prompt composition must not read
  canonical state, documentation, source files, storage, or environment configuration independently.
- Keep prompt sections structured and provider-neutral. Do not interpolate provider syntax, execute
  instructions, resolve external references, fetch content, or invoke tools while building a package.
- Treat documentation and source snapshots as untrusted data. Separate governance instructions from
  contextual content, exclude documents already consumed into another section, and deduplicate exact
  instruction content before packaging.
- Enforce stable section order, mandatory governance/task/safety sections, task and module references,
  exact serialized character budgets, and explicit evidence for every omitted optional section.
- A Prompt Package does not authorize logging, persistence, networking, provider execution, or external
  disclosure. Those actions require separate data classification, authorization, redaction, retention,
  audit, and incident controls.

### Execution Engine trust boundary

- Validate the complete Execution Request, including its Prompt Package, closed policy, scalar metadata,
  timeout, retry, and cancellation contract before creating lifecycle state.
- Treat execution identity and transition history as security-relevant audit evidence. Reject identity,
  revision, attempt, timestamp, history, or state-transition drift; never replace or rewrite history.
- The Executing state is descriptive and performs no provider or tool invocation. Retry delays and
  timeout assessments are decisions only; they do not schedule work, wait, create timers, or enforce a
  deadline. Cancellation tokens are contracts and provide no active cancellation by themselves.
- Accept terminal Results only from validated terminal snapshots. Validate diagnostics, errors, usage,
  metadata, and artifact placeholders as untrusted data; placeholders must never be interpreted as
  files or executable output.
- Before runtime execution is approved, add authorization, idempotency, concurrency limits, bounded
  queues, trusted clocks, active deadline and cancellation enforcement, persistence and recovery,
  redaction, restricted telemetry, audit retention, and safe provider-response handling outside this
  pure core.

### Response Package trust boundary

- Accept only a completed `AIProviderResponse` and its correlated completed `ExecutionResult`. Reject
  identity, usage, artifact-placeholder, completion-state, or shared-metadata drift before extracting
  generated artifacts.
- Treat artifact paths, types, content, diagnostics, warnings, and metadata as untrusted. Permit only
  the closed artifact vocabulary, safe repository-relative POSIX paths, scalar bounded metadata, and
  configured count and UTF-8 byte limits. Detect duplicate paths case-insensitively.
- Normalize before calculating integrity evidence. Verify every artifact against exactly one manifest
  entry containing its normalized path, type, metadata, byte size, and checksum. Checksums detect
  accidental or boundary drift; they are not signatures and provide no producer authenticity.
- Response processing is an in-memory transformation and must not read or write the filesystem, invoke
  Git, run generated content, persist output, send network requests, or emit payload telemetry.
- A valid Response Package does not authorize a project change. Before application is approved, add
  human review, explicit authorization, root-contained path resolution, symlink defense, conflict and
  overwrite policy, secret scanning, atomic writes, rollback, audit evidence, and isolated test
  execution in a separate capability.

### Project Change Plan trust boundary

- Accept only a validated Response Package. Revalidate its structure and correlate every operation to
  one generated artifact and manifest entry by path, type, intent, description, content, UTF-8 size,
  checksum, package version, and execution identity.
- Require explicit Create File, Update File, or Delete File intent. Never infer path existence, apply
  patch syntax, or silently convert an unsupported artifact into an executable operation.
- Reject unsafe paths, case-insensitive aliases, duplicate operation identifiers, conflicting kinds,
  file/tree prefix conflicts, broken references, noncanonical ordering, invalid metadata, and summary
  drift. Preserve destructive and configuration changes as explicit structured risks.
- Planning has no project-state, filesystem, Git, network, build, test, persistence, telemetry, or
  rollback capability. Every plan warns that create, update, and delete preconditions are unverified.
- A valid plan is review evidence, not authorization. Before any operation may run, require current
  project-state validation, explicit human authorization, root and symlink containment, content
  preconditions, protected-path policy, secret scanning, conflict handling, atomic application,
  isolated verification, rollback, Git policy, and durable audit evidence in a separate boundary.

### Safe File Apply trust boundary

- Accept only a Project Change Plan that passes its production validator. Enforce operation limits,
  canonical ordering, duplicate and conflict policy, safe logical paths, metadata, summaries, and
  closed Create File, Update File, and Delete File operations before filesystem inspection.
- Apply mandatory case-insensitive protection to Git internals, environment files, canonical Project
  Brain state, agent governance, and CI workflows. Additional exact, subtree, and prefix rules may
  strengthen but never remove mandatory policy.
- Complete every protected-path and filesystem preflight before the first mutation. Create requires an
  absent target and existing regular parent; update and delete require existing regular files. Reject
  symlinks, other entry kinds, missing targets, invalid parents, and inspection failures with zero
  changes.
- Filesystem adapters must be root scoped, reject symlink traversal at every ancestor, and use
  conditional create-if-absent, update-if-regular-file, and delete-if-regular-file primitives. This
  adapter contract is the final defense against target races after preflight.
- Multi-file apply is not transactional. Stop on the first mutation failure and report Failed or
  Partially Applied without rollback. Never claim atomic success when earlier operations remain on
  disk. Unknown adapter errors must not expose system paths or implementation details.
- The local MVP composition supplies a root-scoped Node adapter with conditional operations and
  containment tests. Authentication, cross-platform conformance, expected-current-content checks,
  locking, recovery and reconciliation, restricted audit evidence, and operator incident procedures
  remain mandatory before remote, shared, or untrusted-project use. The engine does not authorize Git,
  deployment, networking, or subsequent automation.

### Build and Verification trust boundary

- Accept only a File Apply Result that passes its production validator and has Applied status. Invalid,
  Rejected, Failed, and Partially Applied inputs must invoke zero verification ports.
- Keep project validation, dependency validation, build execution, test execution, and time behind
  separate ports. Core must not import a framework, filesystem API, process API, package manager,
  network client, Git client, deployment adapter, provider SDK, or repair capability.
- Execute Project, Dependency, Build, and Test stages once each in fixed order for complete evidence.
  Validate and bound every untrusted adapter result, normalize findings and metadata, and derive overall
  status from stage evidence rather than trusting an adapter summary.
- Translate thrown adapters and malformed output to generic failed-stage evidence. Do not expose command
  lines, system paths, environment values, captured source, test data, stack traces, or raw process
  output through warnings, errors, metadata, or telemetry.
- The local MVP supplies fixed npm runner adapters with project-root containment, no shell, a reduced
  environment, output bounds, active deadlines, safe metadata, and no raw output exposure. They execute
  only trusted project scripts. Before remote or untrusted-project use, require authentication,
  isolated working directories, OS sandboxing, least-privileged identities, CPU and memory limits,
  complete process-tree termination, no-network enforcement, adapter conformance, and restricted audit
  evidence.
- A Passed or Partially Passed report is evidence only. It never authorizes automatic repair, further
  file writes, Git operations, rollback, deployment, networking, or subsequent workflow execution.

### Minimal BuilderAI UI trust boundary

- Load project facts through the canonical Project Brain runtime parser. Do not copy mutable milestones,
  tasks, decisions, architecture ownership, or completion state into browser source or static UI models.
- Browser components may depend only on the typed Workspace Workflow port and existing validated core
  contracts. They must not import or construct provider SDKs, credentials, filesystem adapters, process
  runners, Git clients, deployment clients, or automatic-repair behavior.
- Treat request text and all displayed artifact, path, risk, warning, error, metadata, and conversation
  values as untrusted text. Bound input and output, rely on React escaping, and do not render generated
  HTML, scripts, links, or executable previews without a separately reviewed sanitizer and policy.
- Require an explicit plan-review acknowledgement before invoking apply. Reset approval for every new
  request. Client acknowledgement is a usability checkpoint, not server authorization and must never
  replace identity, project permission, policy validation, or audit evidence.
- Stop before verification when Apply status is not Applied. Preserve available evidence, expose generic
  failures, and never include raw provider, filesystem, command, environment, stack, or process output.
- The shipped workspace fails closed in visible review mode unless explicit local server configuration
  is valid. Live local effects require same-origin loopback JSON, server-side revalidation, an opaque
  expiring server-held plan, explicit acknowledgement, single-flight claim, idempotent completion,
  hardened local adapters, and generic redacted errors. This is not authentication. Before public,
  shared, or multi-instance effects, require identity, project authorization, durable anti-CSRF,
  abuse/rate controls, distributed idempotency and concurrency, restricted audit evidence, recovery,
  and incident procedures.

### MVP v1.0 local runtime trust boundary

- Keep live composition disabled unless `BUILDERAI_LIVE_WORKFLOW_ENABLED` is exactly `true` and every
  required server-only setting passes closed range and syntax validation.
- Accept only loopback same-origin JSON requests of bounded size. Reject remote hosts, missing or
  mismatched origins, non-JSON content, oversized payloads, invalid request text, invalid preparation
  identifiers, missing approval, expired preparations, and concurrent claims before effects.
- Treat browser response and plan objects as display evidence only. Apply the exact server-held
  validated plan addressed by an opaque random identifier; never deserialize a browser plan into the
  effect engine.
- Keep preparations bounded, expiring, and process-local. A restart invalidates them. Completed results
  may replay idempotently; an in-flight duplicate must not execute a second apply.
- Exclude credentials, provider content, source, request bodies, command output, environment values,
  stack traces, and system paths from route errors and structured logs. Correlate only identifier,
  stage, outcome, duration, and stable error code.
- Restrict the release profile to a trusted local operator and trusted target project. Loopback origin
  checks do not authenticate local processes, and trusted npm scripts are privileged code. These limits
  are release blockers for internet-facing, shared, multi-user, or untrusted-project deployment.

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
- **Scope:** `brace-expansion@1.1.17` through `minimatch@3.1.5` in the ESLint toolchain. The full audit
  reports nine affected development packages through this one advisory; the production-only audit is
  clean. The separate `brace-expansion@5.0.8` path is patched.
- **Reason:** As of 2026-07-31, the affected 1.x line has no patched release. npm's suggested major
  ESLint update does not remediate the nested lint-plugin paths, while its suggested Next lint-config
  downgrade is architecturally incompatible with the current Next.js version.
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

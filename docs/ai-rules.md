<!-- builderai-document
type: ai-rules
version: 1
-->

# AI-assisted development rules

These rules govern coding assistants and automated agents working in this repository. They do not
authorize product AI capabilities.

## Required behavior

1. Read the canonical Project Brain, constitution, and six Project Brain policy documents, then the
   repository instructions and relevant supporting documentation, before changing files.
2. Preserve user-owned changes. Inspect Git state and never overwrite unrelated work.
3. Keep work within the stated scope. Ask for a decision when requirements materially affect product,
   architecture, security, cost, or irreversible external state.
4. State assumptions and validate them against repository evidence.
5. Use existing patterns and the smallest sufficient change. Do not add speculative abstractions,
   dependencies, services, or configuration.
6. Treat generated code as untrusted until it has been reviewed, typed, linted, tested, and built.
7. Never fabricate test results, tool output, citations, files, APIs, or completion status.
8. Do not expose secrets or personal data in prompts, logs, fixtures, commits, or responses.
9. Do not weaken security controls, tests, types, or lint rules merely to make a check pass.
10. Record consequential architectural decisions and synchronize memory, progress, tasks, vocabulary,
    and affected documentation.

## Prohibited actions without explicit approval

- Adding an AI model, SDK, provider, prompt, vector store, agent framework, or AI-facing endpoint.
- Sending repository content, customer data, credentials, or production telemetry to an external AI
  service.
- Running destructive commands, rewriting shared history, deploying, publishing packages, changing
  production data, or contacting external users.
- Auto-merging changes or bypassing branch protection and review controls.

## Verification and handoff

Agents must run checks proportionate to the change and report the exact commands and outcomes. If a
check cannot run, report why and the remaining risk. Handoffs summarize files changed, decisions,
known limitations, and the next concrete step.

## Product AI boundary

Product AI is a separate architectural concern. It requires discovery, evaluation criteria, threat
modeling, privacy and provider review, cost controls, human oversight, incident handling, and explicit
approval before implementation. See the AI feature gate in `roadmap.md`.

The Prompt Orchestrator is the only component allowed to transform a validated, size-bounded Context
Package into prompt material. Future adapters must consume only a validated Prompt Package. They may
not receive the source Context Package or independently read Project Brain state, documentation, or
source files. This rule defines a future boundary; it does not authorize an adapter, external
transmission, or product AI implementation.

Provider adapters must implement the versioned `AIProvider` port and expose an immutable capability
descriptor. Core configuration contains only provider-neutral policy; credentials, endpoints, SDK
options, wire models, and implementation settings belong to an approved adapter boundary. Registry
discovery and compatibility checks do not authorize request execution. Every Prompt Package, request,
wire response, structured output, and final response must pass its runtime validators, and response
artifacts remain untrusted data until an approved consumer validates and handles them.

Invocation workflows must enter through the versioned Execution Engine request and transition only
through its legal append-only lifecycle. No adapter may assign execution state or retry independently.
External transmission requires caller authorization and data classification. OpenAI's `store: false`
setting and Gemini's structured-output configuration do not replace provider-retention and privacy
review. The approved adapters are OpenAI Responses and Google Gemini only; configuration selects one
for a local run. No fallback routing, streaming mode, tool, file, image, history, persistence,
telemetry, or automatic workflow is authorized.

Provider output remains untrusted until the Response Processor correlates it with its completed
Execution Result and emits a validated, normalized, integrity-verified Response Package. Future
project-change consumers may receive only that package, not raw provider responses. A Response Package
never authorizes file writes, patch application, code or test execution, Git operations, persistence,
telemetry, or any other project mutation; each effect requires a separately approved and reviewed
capability.

Future project-change consumers must receive only a validated Project Change Plan produced from a
validated Response Package. File operation intent must be explicit; assistants may not infer current
project state or reinterpret patch artifacts as file operations. A plan describes proposed create,
update, and delete operations but never authorizes filesystem access, Git changes, builds, tests,
rollback, persistence, or automatic modification.

Filesystem changes may occur only through the Safe File Apply Engine after caller authorization. The
engine must revalidate the plan, enforce mandatory and configured protected paths, complete all
preflight inspection before mutation, and use only its root-scoped filesystem port. Assistants may not
bypass the port, weaken protected rules, follow symlinks, invoke Git, run builds or tests, or describe a
partially applied result as atomic success.

Project verification may begin only from a validated Applied File Apply Result and must cross the
fixed Verification Engine pipeline. Project, dependency, build, test, and time effects must remain
behind their declared ports; assistants may not invoke framework or process tools from core, omit or
reorder stages, trust adapter output without validation, leak adapter details, or derive report status
independently. A Verification Report is evidence only and never authorizes automatic repair, further
file changes, Git, rollback, deployment, networking, or Sprint 12 work.

Browser interfaces may request and present the existing workflow only through the typed Workspace
Workflow port. They may not construct provider, filesystem, process, Git, deployment, or repair
implementations, duplicate core models, treat a client approval flag as authorization, or fabricate
successful results. Without an approved server composition the interface must remain visibly
disconnected and effect-free. Displayed requests and engine evidence remain untrusted text.

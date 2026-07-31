# ADR-013: Keep the first BuilderAI interface behind a fail-closed workflow port

- **Status:** Accepted
- **Date:** 2026-07-31
- **Owners:** BuilderAI architecture
- **Related:** Sprint 12 Minimal BuilderAI UI

## Context

BuilderAI needs a first dashboard and project workspace over its existing request-to-verification
architecture. The repository deliberately has no production filesystem adapter, build or test runner,
runtime authorization, or hardened server composition. Directly connecting an unauthenticated browser
to provider, filesystem, or process effects would bypass the security boundaries established by earlier
sprints.

## Decision drivers

- Do not modify or duplicate core contracts and business logic.
- Load mutable project facts only through the canonical Project Brain parser.
- Present the complete human request, review, approval, apply, and verification workflow.
- Make approval explicit and prevent apply before acknowledgement.
- Keep provider, credential, filesystem, process, Git, and deployment implementations out of browser
  components.
- Never fabricate a successful workflow when no authorized runtime composition exists.
- Provide responsive, keyboard-accessible, readable evidence views without unnecessary animation.

## Considered options

1. Construct provider and engine services directly in client components.
2. Add unauthenticated server actions with live filesystem and process adapters.
3. Return hard-coded successful results from a browser demo workflow.
4. Build the complete UI against a typed workflow port and fail closed when no runtime is composed.
5. Defer all interface work until production runtime authorization is available.

## Decision

Use option 4. Next.js routes under `src/app` load canonical project facts with
`loadCanonicalProjectBrain` and build a presentation-only view model. Reusable client components under
`src/ui/workspace` own layout, local interaction state, workflow progress, conversation updates,
approval acknowledgement, safe error messages, and result presentation.

The `WorkspaceWorkflowPort` exposes three intentions: prepare a typed Response Package and Project
Change Plan, apply an explicitly approved plan to produce a File Apply Result, and verify an Applied
result to produce a Verification Report. These are existing core contracts; the UI introduces no
alternative engine model or validation policy.

The workspace never calls apply before the user reviews a plan and checks a separate approval
acknowledgement. A non-Applied result stops before verification. Unknown preparation, apply, or
verification failures become generic visible UI failures without exposing implementation details.

No runtime port is composed in the shipped route. It identifies itself as review mode, explains why
execution is disconnected, and disables request execution. Tests inject controlled ports to verify the
complete workflow and presentation without network, provider, filesystem, or process effects.

## Consequences

The interface can evolve independently of core services, and a future authorized server composition
can implement the same port without rewriting components. Canonical project facts cannot drift from
the Project Brain. The full approval and evidence experience is deterministic and testable now.

The shipped workspace cannot execute live project changes. That is intentional rather than a hidden
stub: production effects still require server-only composition, authentication, authorization, CSRF
protection, idempotency, concurrency controls, hardened adapters, safe payload handling, audit evidence,
and recovery procedures.

## Security and privacy impact

Browser code contains no provider SDK, API key, environment lookup, filesystem API, process runner,
Git client, or deployment capability. React renders user and engine text without rich HTML. Request
input is labelled and bounded. Effect controls fail closed without a port, and approval state resets for
every new request.

Future live composition must be server-only and revalidate every request and core object. It must not
trust client approval flags as authorization. Authentication, project-level authorization, anti-CSRF,
rate limits, idempotency, concurrency, redaction, audit integrity, and adapter hardening are release
requirements before enabling this port in production.

## Rollout and reversal

Component tests cover dashboard and workspace rendering, disconnected behavior, labelled input,
keyboard-operable tabs, request preparation, approval gating, apply rejection, verification completion,
safe failure messages, conversation updates, and each evidence panel. Reversal removes `src/ui/workspace`
and the workspace route while leaving every core contract compatible and unchanged.

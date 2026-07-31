# ADR-012: Verify applied projects through one fixed evidence pipeline

- **Status:** Accepted
- **Date:** 2026-07-31
- **Owners:** BuilderAI architecture
- **Related:** Sprint 11 Build and Verification Foundation

## Context

An Applied File Apply Result proves that planned file operations completed, not that the resulting
project, dependency graph, build, or tests are valid. BuilderAI needs complete verification evidence
without coupling core policy to a framework, shell, process API, filesystem, package manager, build
tool, or test runner.

## Decision drivers

- Accept only the existing validated File Apply Result with Applied status.
- Keep every external verification capability and time source behind a narrow port.
- Make stage selection, order, status semantics, normalization, and reporting deterministic.
- Preserve complete evidence when one stage fails or an adapter misbehaves.
- Validate all untrusted adapter output before it crosses the verification boundary.
- Do not add automatic repair, Git, rollback, deployment, networking, or subsequent workflow behavior.

## Considered options

1. Execute framework commands directly from the verification service.
2. Stop on the first failed stage and return an incomplete report.
3. Allow adapters to configure arbitrary stages and assign the overall status.
4. Run a fixed four-stage pipeline through validated ports and derive the report in core.

## Decision

Use option 4. `src/core/verification` accepts unknown input only after the production File Apply Result
validator succeeds and the status is Applied. Invalid, Rejected, Failed, or Partially Applied inputs
invoke no verification port.

The engine runs Project Validation, Dependency Validation, Build Validation, and Test Validation once
each, sequentially, in that exact order. Each capability has a separate port and receives a defensive
context containing the accepted apply result, affected file lists, and scalar metadata. A clock port
supplies controlled duration evidence.

Stage ports return only Passed or Failed plus warnings, errors, and scalar metadata. Core validates
closed structure, bounds, duplicate findings, metadata, and status consistency, then normalizes
finding and metadata order. A thrown adapter error becomes a generic stage execution failure; malformed
output becomes a contract violation. Neither exposes adapter details, and both allow later stages to
run so the report remains complete.

The versioned Verification Report contains every ordered stage result, exact flattened warnings and
errors, total duration, and defensive metadata. Overall status is Passed when all stages pass, Failed
when no stage passes, and Partially Passed for mixed evidence. Runtime validation recomputes those
relationships and rejects report drift.

## Consequences

Core owns deterministic policy and evidence while future framework-specific runners remain replaceable.
Callers always receive complete stage coverage for accepted input, including controlled evidence when
an adapter fails.

Every stage runs after an earlier failure, so evidence completeness can cost more than fail-fast
execution. The stage vocabulary is intentionally closed and requires a versioned architectural change
to evolve. Concrete runners, command selection, sandboxing, active deadlines, process termination,
output capture, authorization, and operational audit are not supplied by this foundation.

## Security and privacy impact

The core imports no filesystem, process, network, Git, deployment, provider, or runner implementation.
It rejects non-Applied inputs before effects and bounds untrusted stage findings and metadata. Generic
adapter failures prevent system paths, command lines, environment data, or captured output from leaking
through the report.

Future runner adapters are privileged execution boundaries. They require explicit authorization,
project-root containment, command allowlists, sandboxing, CPU, memory, output and time limits,
process-tree termination, no-network enforcement, secret redaction, and restricted audit evidence
before production use.

## Rollout and reversal

Tests use controlled port and clock doubles for success, mixed and total failure, ordering, adapter
isolation, input rejection, configuration, result normalization, and report validation. Reversal
removes only `src/core/verification`; File Apply Results and earlier boundaries remain compatible.

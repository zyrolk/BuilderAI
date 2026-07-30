<!-- builderai-document
type: domain-glossary
version: 1
-->

# Domain Glossary Policy

## Canonical record

Live business and technical terms are `domainGlossary.terms` in
[`project-brain.json`](../project-brain.json). This document does not reproduce terms, definitions,
aliases, categories, or timestamps.

## Responsibilities

The glossary provides shared language for requirements, architecture, code, and future tools. Each term
has a stable ID, preferred name, Business or Technical category, definition, and aliases.

## Mutation policy

Glossary changes use `GlossaryService` commands:

- `DEFINE_TERM` appends a new stable term ID.
- `REVISE_TERM` deliberately changes the definition or aliases of an existing ID.

Revise the canonical term before using a materially different meaning elsewhere. Definitions should
describe domain meaning rather than implementation detail and should avoid circular references.

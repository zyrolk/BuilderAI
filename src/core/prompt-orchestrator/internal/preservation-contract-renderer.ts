import type { PreservationContractContent, PreservationInvariant } from '../../update-scope';
import type { UpdateScopeMode } from '../../update-scope';

const INVARIANT_LABELS: Readonly<Record<PreservationInvariant['kind'], string>> = {
  DOM_ID: 'DOM IDs to preserve',
  ARIA_ATTRIBUTE: 'Accessibility attributes to preserve',
  SCRIPT_REFERENCE: 'Script references to preserve',
  STYLESHEET_REFERENCE: 'Stylesheet references to preserve',
  LITERAL_DOM_REFERENCE: 'Literal DOM references to preserve',
  LOCAL_STORAGE_KEY: 'localStorage keys to preserve',
};

export const PRESERVATION_CONTRACT_INSTRUCTIONS = [
  {
    id: 'minimal-delta-source-of-truth',
    text: 'UPDATE_FILE means: return the complete resulting file required by ADR-017. That is CURRENT BASELINE copied verbatim plus the smallest required textual delta—not a semantically equivalent regeneration. The baseline is the source of truth; do not regenerate from scratch.',
  },
  {
    id: 'baseline-copying-discipline',
    text: 'Copy CURRENT BASELINE verbatim first. Change only the exact characters or attributes required by TASK. Unchanged baseline lines must remain byte-for-byte identical; do not reconstruct them from memory or the task description.',
  },
  {
    id: 'formatting-preservation',
    text: 'Do not reformat unchanged lines. Do not change indentation, whitespace, quote style, attribute order, tag style, line wrapping, or blank lines unless TASK explicitly requires it.',
  },
  {
    id: 'immutable-by-default',
    text: 'Everything in CURRENT BASELINE is immutable by default unless the user request requires changing it. Preserve existing DOM IDs, tag names, DOM hierarchy, classes, attributes, aria attributes, aria-label values, text content, headings, header/main/footer structure, blockquote/cite semantics, script/stylesheet references, localStorage keys, literal DOM references, event-hook IDs, and existing behavior unless directly required.',
  },
  {
    id: 'attribute-only-changes',
    text: 'If the task can be completed by adding or modifying attributes on existing elements, modify those elements in place. Do not replace elements, change tags, move them, rename ids/classes, rewrite containers, rewrite headings or unrelated text, or add decorative wrappers.',
  },
  {
    id: 'aria-live-minimal',
    text: 'For aria-live="polite", add only that attribute to the existing counter element. Do not replace or rewrite the element.',
  },
  {
    id: 'aria-labelledby-reuse',
    text: 'For aria-labelledby: reuse existing compatible headings. Add only an id attribute to an existing heading when needed, then add aria-labelledby to the existing section. Do not create replacement heading or container markup, and do not rename or reword headings merely to support aria-labelledby.',
  },
  {
    id: 'button-type-reuse',
    text: 'For existing buttons: add type="button" to each existing button. Preserve the existing button id, class, aria-label, text, and placement.',
  },
  {
    id: 'no-cosmetic-refactor',
    text: 'Do not rename or reorganize elements for cleaner, more semantic, modern, or stylistic reasons. Touch the minimum necessary files.',
  },
] as const;

const SCOPE_DISCIPLINE: Readonly<Record<Exclude<UpdateScopeMode, 'NONE'>, string>> = {
  HARD: 'The operator explicitly constrained this UPDATE to the preferred paths above. Do not emit UPDATE_FILE artifacts outside this set unless the requested change is impossible without doing so.',
  SOFT: 'Prefer the preferred update paths above and avoid sibling-file changes unless technically necessary.',
};

export function renderPreservationContractText(contract: PreservationContractContent): string {
  const lines: string[] = [];
  lines.push(`Update scope mode: ${contract.scope.mode}`);
  if (contract.scope.preferredUpdatePaths.length > 0) {
    lines.push(`Preferred update paths: ${contract.scope.preferredUpdatePaths.join(', ')}`);
  }
  if (contract.scope.preferredMaximumUpdateOperations !== undefined) {
    lines.push(
      `Preferred maximum update operations: ${contract.scope.preferredMaximumUpdateOperations}`,
    );
  }
  if (contract.scope.mode !== 'NONE') {
    lines.push(SCOPE_DISCIPLINE[contract.scope.mode]);
  }

  lines.push('');
  lines.push('Minimal-delta UPDATE rules:');
  for (const instruction of PRESERVATION_CONTRACT_INSTRUCTIONS) {
    lines.push(`- ${instruction.text}`);
  }

  for (const baseline of contract.baselines) {
    lines.push('');
    lines.push(`CURRENT BASELINE — ${baseline.logicalPath}`);
    lines.push(baseline.content);
  }

  if (contract.invariants.length > 0) {
    lines.push('');
    lines.push('Preservation invariants:');
    for (const invariant of contract.invariants) {
      lines.push(
        `- ${INVARIANT_LABELS[invariant.kind]} (${invariant.logicalPath}): ${invariant.values.join(', ')}`,
      );
    }
  }

  return lines.join('\n');
}

export function renderScopeDisciplineText(mode: UpdateScopeMode): string | undefined {
  return mode === 'NONE' ? undefined : SCOPE_DISCIPLINE[mode];
}

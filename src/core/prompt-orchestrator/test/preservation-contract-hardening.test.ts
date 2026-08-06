import { describe, expect, it } from 'vitest';

import { ContextBuilderService } from '../../context-builder';
import { createContextInput } from '../../context-builder/test/context-builder.fixture';
import { loadSmokeAtelierGoldenBaseline } from '../../change-planner/test/fixtures/smoke-atelier-golden-fixture';
import {
  PRESERVATION_CONTRACT_INSTRUCTIONS,
  renderPreservationContractText,
  renderScopeDisciplineText,
} from '../internal/preservation-contract-renderer';
import { PrepareScopeService } from '../../update-scope';
import { MemoryWorkspaceBaselinePort } from '../../update-scope/test/workspace-baseline.fixture';
import { PromptOrchestratorService } from '../services/prompt-orchestrator.service';

const SMOKE_BASELINE_HTML = loadSmokeAtelierGoldenBaseline();

const ACCESSIBILITY_REQUEST =
  'Improve the existing counter page accessibility with the smallest possible change. Add aria-live="polite" to the counter value, add appropriate aria-labelledby relationships to the existing counter and quote sections, and ensure the existing buttons explicitly use type="button". Preserve all existing functionality, DOM IDs, aria-labels, text, quote content, localStorage behavior, script/style references, layout, and styling. Prefer modifying index.html only. Do not redesign or refactor unrelated code.';

describe('PRESERVATION_CONTRACT minimal-delta hardening (ADR-031 Slice 3)', () => {
  const prepareScope = new PrepareScopeService();
  const orchestrator = new PromptOrchestratorService();

  it('includes canonical minimal-delta rules in template instructions', () => {
    const texts = PRESERVATION_CONTRACT_INSTRUCTIONS.map(({ text }) => text).join('\n');
    expect(texts).toContain('smallest required textual delta');
    expect(texts).toContain('not a semantically equivalent regeneration');
    expect(texts).toContain('Copy CURRENT BASELINE verbatim first');
    expect(texts).toContain('byte-for-byte identical');
    expect(texts).toContain('Do not reformat unchanged lines');
    expect(texts).toContain('aria-live="polite"');
  });

  it('renders HARD scope discipline and smoke-atelier baseline for accessibility request', () => {
    const resolution = prepareScope.resolve({
      taskText: ACCESSIBILITY_REQUEST,
      sourcePaths: ['index.html', 'assets/app.js', 'assets/styles.css', 'assets/quotes.json'],
      baselinePort: new MemoryWorkspaceBaselinePort({
        'index.html': SMOKE_BASELINE_HTML,
      }),
    });

    expect(resolution.scopePlan.mode).toBe('HARD');
    expect(resolution.scopePlan.preferredUpdatePaths).toEqual(['index.html']);
    expect(resolution.preservationContract).toBeDefined();

    const rendered = renderPreservationContractText(resolution.preservationContract!);
    expect(rendered).toContain('Update scope mode: HARD');
    expect(rendered).toContain('Preferred update paths: index.html');
    expect(rendered).toContain('Do not emit UPDATE_FILE artifacts outside this set');
    expect(rendered).toContain('CURRENT BASELINE — index.html');
    expect(rendered).toContain('id="counter-value"');
    expect(rendered).toContain('id="increment-counter"');
    expect(rendered).toContain('id="reset-counter"');
    expect(rendered).toContain('id="next-quote"');
    expect(rendered).toContain('Minimal-delta UPDATE rules');
    expect(rendered).toContain('modify those elements in place');
    expect(rendered).not.toContain('process.env');
  });

  it('places hardened PRESERVATION_CONTRACT after TASK in prompt package', async () => {
    const resolution = prepareScope.resolve({
      taskText: ACCESSIBILITY_REQUEST,
      sourcePaths: ['index.html', 'assets/app.js', 'assets/styles.css'],
      baselinePort: new MemoryWorkspaceBaselinePort({
        'index.html': SMOKE_BASELINE_HTML,
      }),
    });
    const context = await new ContextBuilderService().build(await createContextInput());
    const prompt = await orchestrator.build({
      context,
      preservationContract: resolution.preservationContract,
    });

    const kinds = prompt.sections.map(({ kind }) => kind);
    expect(kinds.indexOf('PRESERVATION_CONTRACT')).toBeGreaterThan(kinds.indexOf('TASK'));
    expect(kinds.indexOf('PRESERVATION_CONTRACT')).toBeLessThan(kinds.indexOf('RULES'));

    const preservation = prompt.sections.find(({ kind }) => kind === 'PRESERVATION_CONTRACT');
    expect(preservation?.kind).toBe('PRESERVATION_CONTRACT');
    if (preservation?.kind !== 'PRESERVATION_CONTRACT') throw new Error('expected preservation');
    const body = preservation.instructions.find(
      ({ id }) => id === 'preservation-contract-body',
    )?.text;
    expect(body).toContain('smallest required textual delta');
    expect(body).toContain('increment-counter');
    expect(body).toContain('assets/app.js');
  });

  it('renders SOFT scope guidance without HARD rejection language', () => {
    expect(renderScopeDisciplineText('SOFT')).toContain('Prefer the preferred update paths');
    expect(renderScopeDisciplineText('NONE')).toBeUndefined();
  });

  it('reports bounded prompt size impact for smoke accessibility fixture', async () => {
    const resolution = prepareScope.resolve({
      taskText: ACCESSIBILITY_REQUEST,
      sourcePaths: ['index.html', 'assets/app.js', 'assets/styles.css'],
      baselinePort: new MemoryWorkspaceBaselinePort({
        'index.html': SMOKE_BASELINE_HTML,
      }),
    });
    const context = await new ContextBuilderService().build(await createContextInput());
    const without = await orchestrator.build({ context });
    const withContract = await orchestrator.build({
      context,
      preservationContract: resolution.preservationContract,
    });

    expect(withContract.budget.characters).toBeGreaterThan(without.budget.characters);
    expect(withContract.budget.characters - without.budget.characters).toBeLessThan(10_000);
  });
});

describe('Golden smoke-atelier accessibility prompt contract (ADR-031 Slice 3)', () => {
  it('makes index.html-only surgical delta unambiguous without hard-coding provider output', () => {
    const resolution = new PrepareScopeService().resolve({
      taskText: ACCESSIBILITY_REQUEST,
      sourcePaths: ['index.html', 'assets/app.js', 'assets/styles.css'],
      baselinePort: new MemoryWorkspaceBaselinePort({
        'index.html': SMOKE_BASELINE_HTML,
      }),
    });

    const rendered = renderPreservationContractText(resolution.preservationContract!);
    expect(rendered).toContain('Preferred update paths: index.html');
    expect(rendered).toContain('id="counter-value"');
    expect(rendered).toContain('aria-label="Increment counter"');
    expect(rendered).toContain('aria-label="Reset counter to zero"');
    expect(rendered).toContain('aria-label="Show next quote"');
    expect(rendered).toContain('add type="button" to each existing button');
    expect(rendered).toContain('adding or modifying attributes on existing elements');
    expect(rendered).toContain('aria-labelledby');
    expect(rendered).toContain('CURRENT BASELINE — index.html');
  });
});

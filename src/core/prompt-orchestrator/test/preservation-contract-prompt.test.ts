import { describe, expect, it } from 'vitest';

import { ContextBuilderService } from '../../context-builder';
import { createContextInput } from '../../context-builder/test/context-builder.fixture';
import { PrepareScopeService } from '../../update-scope';
import { MemoryWorkspaceBaselinePort } from '../../update-scope/test/workspace-baseline.fixture';
import { PromptOrchestratorService } from '../services/prompt-orchestrator.service';

const SMOKE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <link rel="stylesheet" href="assets/styles.css">
  </head>
  <body>
    <button id="counter-button" aria-label="Counter">0</button>
    <script src="assets/app.js"></script>
  </body>
</html>`;

const SMOKE_JS = `
const button = document.getElementById('counter-button');
let count = Number(localStorage.getItem('atelier_counter') ?? '0');
button.addEventListener('click', () => {
  count += 1;
  localStorage.setItem('atelier_counter', String(count));
  button.textContent = String(count);
});
`;

describe('PRESERVATION_CONTRACT prompt rendering', () => {
  const orchestrator = new PromptOrchestratorService();
  const prepareScope = new PrepareScopeService();

  it('places PRESERVATION_CONTRACT after TASK and before RULES with baseline content', async () => {
    const resolution = prepareScope.resolve({
      taskText: 'Modify index.html only to improve accessibility.',
      sourcePaths: ['index.html', 'assets/app.js', 'assets/styles.css'],
      baselinePort: new MemoryWorkspaceBaselinePort({
        'index.html': SMOKE_HTML,
        'assets/app.js': SMOKE_JS,
      }),
    });
    const context = await new ContextBuilderService().build(await createContextInput());
    const prompt = await orchestrator.build({
      context,
      preservationContract: resolution.preservationContract,
    });

    const kinds = prompt.sections.map(({ kind }) => kind);
    const taskIndex = kinds.indexOf('TASK');
    const preservationIndex = kinds.indexOf('PRESERVATION_CONTRACT');
    const rulesIndex = kinds.indexOf('RULES');
    expect(taskIndex).toBeGreaterThanOrEqual(0);
    expect(preservationIndex).toBeGreaterThan(taskIndex);
    expect(rulesIndex).toBeGreaterThan(preservationIndex);

    const preservation = prompt.sections.find(({ kind }) => kind === 'PRESERVATION_CONTRACT');
    expect(preservation?.kind).toBe('PRESERVATION_CONTRACT');
    if (preservation?.kind !== 'PRESERVATION_CONTRACT') throw new Error('expected preservation');
    const body = preservation.instructions.find(
      ({ id }) => id === 'preservation-contract-body',
    )?.text;
    expect(body).toContain('CURRENT BASELINE — index.html');
    expect(body).toContain('counter-button');
    expect(body).toContain('assets/app.js');
    expect(body).toContain('assets/styles.css');
    expect(body).toContain('smallest required textual delta');
  });

  it('omits PRESERVATION_CONTRACT for inactive scope workflows', async () => {
    const context = await new ContextBuilderService().build(await createContextInput());
    const prompt = await orchestrator.build({ context });
    expect(prompt.sections.map(({ kind }) => kind)).not.toContain('PRESERVATION_CONTRACT');
  });

  it('includes localStorage preservation invariant for smoke JS baseline', () => {
    const resolution = prepareScope.resolve({
      taskText: 'Fix JavaScript counter behavior.',
      sourcePaths: ['assets/app.js'],
      baselinePort: new MemoryWorkspaceBaselinePort({ 'assets/app.js': SMOKE_JS }),
    });

    expect(
      resolution.preservationContract?.invariants.some(
        (invariant) =>
          invariant.kind === 'LOCAL_STORAGE_KEY' && invariant.values.includes('atelier_counter'),
      ),
    ).toBe(true);
  });
});

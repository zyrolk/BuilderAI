import { createHash } from 'node:crypto';

import type { WorkspaceBaselinePort, WorkspaceBaselineSnapshot } from '../ports';
import { ChangePlannerService, ChangePreservationService } from '../services';
import type { WorkspaceVisibilityPort } from '../ports';
import { ChangePlanValidationError } from '../types';
import { ProjectChangePlanValidator } from '../validators';
import {
  createArtifact,
  createConfiguration,
  createResponsePackage,
  operationFrom,
} from './change-planner.fixture';

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function createInMemoryBaseline(files: Record<string, string>): WorkspaceBaselinePort {
  return {
    readTextBaseline(logicalPath: string): WorkspaceBaselineSnapshot | null {
      const raw = files[logicalPath];
      if (raw === undefined) return null;
      const content = normalizeLineEndings(raw);
      const digest = createHash('sha256').update(content, 'utf8').digest('hex');
      return {
        logicalPath,
        content,
        checksum: { algorithm: 'sha256', value: digest },
        sizeBytes: Buffer.byteLength(content, 'utf8'),
      };
    },
  };
}

function fakeVisibility(files: readonly string[]): WorkspaceVisibilityPort {
  return {
    directoryExists: (logicalPath) => logicalPath === '.' || logicalPath.startsWith('assets'),
    fileExists: (logicalPath) => files.includes(logicalPath),
  };
}

const smokeBaselineHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Counter</title>
  <link rel="stylesheet" href="assets/styles.css" />
</head>
<body>
  <main id="app-root" aria-labelledby="counter-heading">
    <h1 id="counter-heading">Counter</h1>
    <p id="counter-value" aria-live="polite">0</p>
    <button id="increment-counter" type="button" aria-label="Increment counter">+1</button>
    <button id="reset-counter" type="button" aria-label="Reset counter">Reset</button>
  </main>
  <script src="assets/app.js"></script>
</body>
</html>
`;

const smokeDestructiveProposalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Counter App</title>
  <link rel="stylesheet" href="assets/styles.css" />
</head>
<body>
  <div id="container">
    <h1>Counter App</h1>
    <span id="count-display">0</span>
    <button id="increment-btn">Increment</button>
  </div>
  <script src="assets/app.js"></script>
</body>
</html>
`;

const smokeSiblingJs = `const valueEl = document.getElementById('counter-value');
const incrementButton = document.getElementById('increment-counter');
const resetButton = document.getElementById('reset-counter');
`;

describe('ChangePlannerService preservation integration (ADR-030 Slice 2)', () => {
  const configuration = createConfiguration();
  const visibility = fakeVisibility(['index.html', 'src/existing.ts', 'assets/app.js']);

  it('preserves legacy behavior when no baseline port is supplied', () => {
    const service = new ChangePlannerService(configuration);
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'src/existing.ts',
          content: 'export const updated = true;\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update existing source' },
        }),
      ]),
      visibility,
    );
    const update = operationFrom(plan);
    expect(update.kind).toBe('UPDATE_FILE');
    if (update.kind !== 'UPDATE_FILE') return;
    expect(update.preservation).toBeUndefined();
    expect(update.baselineContentChecksum).toBeUndefined();
    expect(plan.warnings.some(({ code }) => code.startsWith('PRESERVATION_'))).toBe(false);
  });

  it('enriches UPDATE_FILE operations through ChangePreservationService', () => {
    const preservation = new ChangePreservationService(createConfiguration());
    const baseline = createInMemoryBaseline({ 'src/existing.ts': 'export const same = true;\n' });
    const result = preservation.enrichOperations(
      [
        {
          operationId: 'update:src/existing.ts',
          kind: 'UPDATE_FILE',
          logicalPath: 'src/existing.ts',
          artifactType: 'SOURCE_FILE',
          description: 'No-op update',
          sourceChecksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
          sourceSizeBytes: 27,
          content: 'export const same = true;\n',
        },
      ],
      baseline,
    );
    const update = result.operations[0];
    expect(update?.kind).toBe('UPDATE_FILE');
    if (update?.kind !== 'UPDATE_FILE') return;
    expect(update.preservation?.churnRatio).toBe(0);
    expect(update.baselineContentChecksum?.algorithm).toBe('sha256');
  });

  it('attaches preservation metadata with near-zero churn for identical UPDATE content', () => {
    const content = '<div id="same">unchanged</div>\n';
    const baseline = createInMemoryBaseline({ 'index.html': content });
    const service = new ChangePlannerService(configuration, undefined, baseline);
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'index.html',
          content,
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'No-op update' },
        }),
      ]),
      fakeVisibility(['index.html']),
    );
    const update = operationFrom(plan);
    expect(update.kind).toBe('UPDATE_FILE');
    if (update.kind !== 'UPDATE_FILE') return;
    expect(update.baselineContentChecksum?.algorithm).toBe('sha256');
    expect(update.preservation?.churnRatio).toBe(0);
    expect(update.preservation?.similarityRatio).toBe(1);
    expect(plan.warnings.some(({ code }) => code === 'PRESERVATION_HIGH_CHURN_REWRITE')).toBe(
      false,
    );
  });

  it('does not emit HIGH churn for a small surgical UPDATE', () => {
    const baselineLines = Array.from({ length: 10 }, (_, index) => `line-${index}`).join('\n');
    const proposedLines = baselineLines
      .split('\n')
      .map((line, index) => (index === 4 ? 'line-4-updated' : line))
      .join('\n');
    const baseline = createInMemoryBaseline({ 'src/existing.ts': `${baselineLines}\n` });
    const service = new ChangePlannerService(configuration, undefined, baseline);
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'src/existing.ts',
          content: `${proposedLines}\n`,
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Surgical update' },
        }),
      ]),
      visibility,
    );
    expect(plan.warnings.some(({ code }) => code === 'PRESERVATION_HIGH_CHURN_REWRITE')).toBe(
      false,
    );
    expect(plan.warnings.some(({ code }) => code === 'PRESERVATION_ELEVATED_CHURN')).toBe(false);
  });

  it('emits elevated churn warning for moderate UPDATE churn', () => {
    const baseline = Array.from({ length: 20 }, (_, index) => `line-${index}`).join('\n');
    const proposed = baseline
      .split('\n')
      .map((line, index) => (index >= 8 && index <= 12 ? `${line}-updated` : line))
      .join('\n');
    const baselinePort = createInMemoryBaseline({ 'src/existing.ts': `${baseline}\n` });
    const service = new ChangePlannerService(configuration, undefined, baselinePort);
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'src/existing.ts',
          content: `${proposed}\n`,
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Moderate update' },
        }),
      ]),
      visibility,
    );
    expect(plan.warnings.some(({ code }) => code === 'PRESERVATION_ELEVATED_CHURN')).toBe(true);
    expect(plan.warnings.some(({ code }) => code === 'PRESERVATION_HIGH_CHURN_REWRITE')).toBe(
      false,
    );
  });

  it('emits HIGH churn warning and risk for near-full rewrite UPDATE', () => {
    const baselinePort = createInMemoryBaseline({
      'index.html': smokeBaselineHtml,
      'assets/app.js': smokeSiblingJs,
    });
    const service = new ChangePlannerService(configuration, undefined, baselinePort);
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'index.html',
          content: smokeDestructiveProposalHtml,
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Rewrite HTML' },
        }),
      ]),
      visibility,
    );
    expect(plan.warnings.some(({ code }) => code === 'PRESERVATION_HIGH_CHURN_REWRITE')).toBe(true);
    expect(plan.risks.some(({ code }) => code === 'HIGH_CHURN_REWRITE')).toBe(true);
  });

  it('reports removed HTML ids and aria attributes', () => {
    const baselinePort = createInMemoryBaseline({
      'index.html': smokeBaselineHtml,
      'assets/app.js': smokeSiblingJs,
    });
    const service = new ChangePlannerService(configuration, undefined, baselinePort);
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'index.html',
          content: smokeDestructiveProposalHtml,
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Rewrite HTML' },
        }),
      ]),
      visibility,
    );
    const update = operationFrom(plan);
    expect(update.kind).toBe('UPDATE_FILE');
    if (update.kind !== 'UPDATE_FILE') return;
    expect(update.preservation?.removedHtmlIds).toEqual(
      expect.arrayContaining(['counter-value', 'increment-counter']),
    );
    expect(update.preservation?.removedAccessibilityAttributes).toEqual(
      expect.arrayContaining(['aria-label', 'aria-live', 'aria-labelledby']),
    );
    expect(plan.warnings.some(({ code }) => code === 'PRESERVATION_REMOVED_HTML_ID')).toBe(true);
    expect(plan.warnings.some(({ code }) => code === 'PRESERVATION_REMOVED_ARIA_ATTRIBUTE')).toBe(
      true,
    );
  });

  it('keeps sourceChecksum as proposed content and attaches baseline checksum separately', () => {
    const content = 'export const updated = true;\n';
    const baselinePort = createInMemoryBaseline({
      'src/existing.ts': 'export const baseline = true;\n',
    });
    const service = new ChangePlannerService(configuration, undefined, baselinePort);
    const responsePackage = createResponsePackage([
      createArtifact({
        logicalPath: 'src/existing.ts',
        content,
        metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update existing source' },
      }),
    ]);
    const plan = service.plan(responsePackage, visibility);
    const update = operationFrom(plan);
    expect(update.kind).toBe('UPDATE_FILE');
    if (update.kind !== 'UPDATE_FILE') return;
    expect(update.sourceChecksum).toEqual(responsePackage.manifest.entries[0]?.checksum);
    expect(update.baselineContentChecksum).not.toEqual(update.sourceChecksum);
  });

  it('does not attach preservation metadata to CREATE_FILE or DELETE_FILE operations', () => {
    const baselinePort = createInMemoryBaseline({
      'old/file.ts': 'legacy\n',
      'src/new-file.ts': 'unused\n',
    });
    const service = new ChangePlannerService(configuration, undefined, baselinePort);
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'old/file.ts',
          content: '',
          metadata: { 'change-operation': 'DELETE_FILE', description: 'Delete obsolete source' },
        }),
        createArtifact({
          logicalPath: 'src/created.ts',
          metadata: { 'change-operation': 'CREATE_FILE', description: 'Create source' },
        }),
      ]),
      {
        directoryExists: (logicalPath) =>
          logicalPath === '.' || logicalPath === 'src' || logicalPath.startsWith('assets'),
        fileExists: (logicalPath) => logicalPath === 'old/file.ts',
      },
    );
    for (const operation of plan.changeSet.operations) {
      expect(operation).not.toHaveProperty('preservation');
      expect(operation).not.toHaveProperty('baselineContentChecksum');
    }
  });

  it('keeps the plan valid and emits baseline-unavailable warning when baseline cannot be read', () => {
    const baselinePort = createInMemoryBaseline({});
    const service = new ChangePlannerService(configuration, undefined, baselinePort);
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'src/existing.ts',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update existing source' },
        }),
      ]),
      visibility,
    );
    expect(plan.changeSet.operations).toHaveLength(1);
    expect(plan.warnings.some(({ code }) => code === 'PRESERVATION_BASELINE_UNAVAILABLE')).toBe(
      true,
    );
  });

  it('emits cross-file warning when removed ids are referenced by unchanged sibling JS', () => {
    const baselinePort = createInMemoryBaseline({
      'index.html': smokeBaselineHtml,
      'assets/app.js': smokeSiblingJs,
    });
    const service = new ChangePlannerService(configuration, undefined, baselinePort);
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'index.html',
          content: smokeDestructiveProposalHtml,
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Rewrite HTML' },
        }),
      ]),
      visibility,
    );
    expect(
      plan.warnings.some(({ code }) => code === 'PRESERVATION_CROSS_FILE_REFERENCE_RISK'),
    ).toBe(true);
    expect(plan.risks.some(({ code }) => code === 'PRESERVATION_CROSS_FILE_REFERENCE_RISK')).toBe(
      true,
    );
  });

  it('does not emit cross-file warning when removed ids are not referenced', () => {
    const baselinePort = createInMemoryBaseline({
      'index.html': '<div id="old-id"></div>\n<script src="assets/app.js"></script>\n',
      'assets/app.js': "console.log('no references');\n",
    });
    const service = new ChangePlannerService(configuration, undefined, baselinePort);
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'index.html',
          content: '<div id="new-id"></div>\n<script src="assets/app.js"></script>\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Rename id only' },
        }),
      ]),
      fakeVisibility(['index.html', 'assets/app.js']),
    );
    expect(
      plan.warnings.some(({ code }) => code === 'PRESERVATION_CROSS_FILE_REFERENCE_RISK'),
    ).toBe(false);
  });

  it('enforces maximumCrossFileChecks when discovering sibling JS files', () => {
    const limitedConfiguration = createConfiguration({
      preservation: {
        elevatedChurnThreshold: 0.4,
        highChurnThreshold: 0.7,
        maximumCrossFileChecks: 1,
        maximumListedHtmlIds: 8,
      },
    });
    const baselinePort = createInMemoryBaseline({
      'index.html':
        '<div id="alpha"></div><div id="beta"></div><script src="assets/a.js"></script><script src="assets/b.js"></script>\n',
      'assets/a.js': "document.getElementById('alpha');\n",
      'assets/b.js': "document.getElementById('beta');\n",
    });
    const service = new ChangePlannerService(limitedConfiguration, undefined, baselinePort);
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'index.html',
          content: '<div id="replacement"></div>\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Remove ids' },
        }),
      ]),
      fakeVisibility(['index.html', 'assets/a.js', 'assets/b.js']),
    );
    const update = operationFrom(plan);
    expect(update.kind).toBe('UPDATE_FILE');
    if (update.kind !== 'UPDATE_FILE') return;
    expect(update.preservation?.crossFileReferenceRisks?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it('keeps operation and warning ordering deterministic across repeated plans', () => {
    const baselinePort = createInMemoryBaseline({
      'index.html': smokeBaselineHtml,
      'assets/app.js': smokeSiblingJs,
    });
    const service = new ChangePlannerService(configuration, undefined, baselinePort);
    const responsePackage = createResponsePackage([
      createArtifact({
        logicalPath: 'index.html',
        content: smokeDestructiveProposalHtml,
        metadata: { 'change-operation': 'UPDATE_FILE', description: 'Rewrite HTML' },
      }),
      createArtifact({
        logicalPath: 'src/existing.ts',
        content: 'export const updated = true;\n',
        metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update TS' },
      }),
    ]);
    const first = service.plan(responsePackage, visibility);
    const second = service.plan(structuredClone(responsePackage), visibility);
    expect(second).toEqual(first);
  });

  it('flags Smoke #2 Phase 3 Attempt #2-style destructive HTML rewrite', () => {
    const baselinePort = createInMemoryBaseline({
      'index.html': smokeBaselineHtml,
      'assets/app.js': smokeSiblingJs,
    });
    const service = new ChangePlannerService(configuration, undefined, baselinePort);
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'index.html',
          content: smokeDestructiveProposalHtml,
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Destructive rewrite' },
        }),
      ]),
      visibility,
    );
    expect(plan.warnings.some(({ code }) => code === 'PRESERVATION_HIGH_CHURN_REWRITE')).toBe(true);
    expect(plan.warnings.some(({ code }) => code === 'PRESERVATION_REMOVED_HTML_ID')).toBe(true);
    expect(
      plan.warnings.some(({ code }) => code === 'PRESERVATION_CROSS_FILE_REFERENCE_RISK'),
    ).toBe(true);
  });

  it('does not emit HIGH churn for a surgical accessibility patch fixture', () => {
    const surgicalProposal = smokeBaselineHtml
      .replace(
        'aria-label="Increment counter">+1',
        'aria-label="Increment counter" aria-describedby="counter-help">+1',
      )
      .replace('  </main>', '    <p id="counter-help">Adds one to the counter.</p>\n  </main>');
    const baselinePort = createInMemoryBaseline({ 'index.html': smokeBaselineHtml });
    const service = new ChangePlannerService(configuration, undefined, baselinePort);
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'index.html',
          content: surgicalProposal,
          metadata: {
            'change-operation': 'UPDATE_FILE',
            description: 'Add aria-describedby without rewrite',
          },
        }),
      ]),
      fakeVisibility(['index.html']),
    );
    expect(plan.warnings.some(({ code }) => code === 'PRESERVATION_HIGH_CHURN_REWRITE')).toBe(
      false,
    );
    expect(plan.warnings.some(({ code }) => code === 'PRESERVATION_ELEVATED_CHURN')).toBe(false);
  });
});

describe('ProjectChangePlanValidator preservation metadata', () => {
  const configuration = createConfiguration();
  const validator = new ProjectChangePlanValidator(configuration);

  it('accepts valid optional preservation metadata on UPDATE_FILE operations', () => {
    const baselinePort = createInMemoryBaseline({ 'src/existing.ts': 'baseline\n' });
    const planner = new ChangePlannerService(configuration, undefined, baselinePort);
    const plan = planner.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'src/existing.ts',
          content: 'updated\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update existing source' },
        }),
      ]),
      fakeVisibility(['src/existing.ts']),
    );
    expect(() => validator.validate(plan)).not.toThrow();
  });

  it('rejects malformed preservation metadata', () => {
    const baselinePort = createInMemoryBaseline({ 'src/existing.ts': 'baseline\n' });
    const planner = new ChangePlannerService(configuration, undefined, baselinePort);
    const plan = planner.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'src/existing.ts',
          content: 'updated\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update existing source' },
        }),
      ]),
      fakeVisibility(['src/existing.ts']),
    );
    const operation = plan.changeSet.operations[0];
    expect(operation?.kind).toBe('UPDATE_FILE');
    if (operation?.kind !== 'UPDATE_FILE') return;
    expect(() =>
      validator.validate({
        ...plan,
        changeSet: {
          operations: [
            {
              ...operation,
              preservation: {
                ...operation.preservation,
                findings: [],
                churnRatio: 2,
              },
            },
          ],
        },
      }),
    ).toThrow(ChangePlanValidationError);
  });
});

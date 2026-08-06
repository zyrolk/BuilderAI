import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { MemoryProjectFileSource } from '../../../core/context-builder/test/context-builder.fixture';
import type { ProjectFileSource } from '../../../core/context-builder';
import {
  DeterministicInvestigationAnalyzer,
  InvestigationService,
  type InvestigationConfiguration,
} from '../index';

const ZYRO_FIXTURE_ROOT = path.resolve(
  __dirname,
  '../../../core/target-project/test/fixtures/zyro-style-project',
);

function listFixtureFiles(root: string, prefix = ''): readonly string[] {
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry);
    const relative = prefix.length === 0 ? entry.replace(/\\/g, '/') : `${prefix}/${entry}`;
    if (statSync(absolute).isDirectory()) {
      if (entry === 'node_modules' || entry === '.git') continue;
      files.push(...listFixtureFiles(absolute, relative));
      continue;
    }
    files.push(relative);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export function createZyroStyleInvestigationSource(): ProjectFileSource {
  const files = listFixtureFiles(ZYRO_FIXTURE_ROOT);
  const sourceFiles = files.map((logicalPath) => ({
    path: logicalPath,
    content: readFileSync(path.join(ZYRO_FIXTURE_ROOT, logicalPath), 'utf8'),
  }));
  return new MemoryProjectFileSource(sourceFiles);
}

export function createInvestigationServiceForFixture(
  sourceFiles: ProjectFileSource,
  configuration?: InvestigationConfiguration,
): InvestigationService {
  let tick = 0;
  return new InvestigationService({
    sourceFiles,
    analyzer: new DeterministicInvestigationAnalyzer(),
    clock: { now: () => new Date('2026-08-05T12:00:00.000Z') },
    ids: { generate: () => `investigation-${++tick}` },
    logger: { record: () => undefined },
    ...(configuration === undefined ? {} : { configuration }),
  });
}

export function createLargeInvestigationFixtureSource(fileCount = 30): ProjectFileSource {
  const files = Array.from({ length: fileCount }, (_, index) => ({
    path: `src/generated/file-${String(index).padStart(3, '0')}.ts`,
    content: `export const marker${index} = 'supplier-cancel-processing';\n`,
  }));
  files.push({
    path: 'project-brain.json',
    content: '{"secret":"protected"}\n',
  });
  return new MemoryProjectFileSource(files);
}

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { WorkspaceBaselinePort } from '../../../core/change-planner/ports/workspace-baseline.port';
import type { ProjectFileSource } from '../../../core/context-builder';

export const LOCKED_ACCESSIBILITY_REQUEST =
  'Improve the existing counter page accessibility with the smallest possible change. Add aria-live="polite" to the counter value, add appropriate aria-labelledby relationships to the existing counter and quote sections, and ensure the existing buttons explicitly use type="button". Preserve all existing functionality, DOM IDs, aria-labels, text, quote content, localStorage behavior, script/style references, layout, and styling. Prefer modifying index.html only. Do not redesign or refactor unrelated code.';

export const SMOKE_ATELIER_OPERATOR_REASON =
  'Preserve increment-counter, reset-counter, next-quote; preserve all existing DOM IDs, behavior, text, structure, aria-labels, script/style references, and apply only the requested accessibility attributes. Do not redesign or refactor.';

export const SMOKE_ATELIER_SOURCE_PATHS = [
  'index.html',
  'assets/app.js',
  'assets/styles.css',
  'assets/quotes.json',
] as const;

const SMOKE_ATELIER_ROOT = path.resolve('D:/projects2/smoke-atelier');

function sha256Hex(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function readSmokeAtelierIndexHtml(): string {
  return readFileSync(path.join(SMOKE_ATELIER_ROOT, 'index.html'), 'utf8').replace(/\r\n?/g, '\n');
}

export class SmokeAtelierBaselinePort implements WorkspaceBaselinePort {
  private readonly files: Readonly<Record<string, string>>;

  constructor(indexHtml: string = readSmokeAtelierIndexHtml()) {
    this.files = { 'index.html': indexHtml.replace(/\r\n?/g, '\n') };
  }

  readTextBaseline(logicalPath: string) {
    const content = this.files[logicalPath];
    if (content === undefined) return null;
    const normalized = content.replace(/\r\n?/g, '\n');
    return {
      logicalPath,
      content: normalized,
      checksum: {
        algorithm: 'sha256' as const,
        value: sha256Hex(normalized),
      },
      sizeBytes: Buffer.byteLength(normalized, 'utf8'),
    };
  }
}

export class SmokeAtelierProjectFileSource implements ProjectFileSource {
  constructor(
    private readonly files: Readonly<Record<string, string>> = {
      'index.html': readSmokeAtelierIndexHtml(),
      'assets/app.js': 'const x = 1;\n',
      'assets/styles.css': 'body {}\n',
      'assets/quotes.json': '[]\n',
    },
  ) {}

  async listSourcePaths(): Promise<readonly string[]> {
    return [...SMOKE_ATELIER_SOURCE_PATHS];
  }

  async readSourceFile(logicalPath: string): Promise<string> {
    const content = this.files[logicalPath];
    if (content === undefined) throw new Error(`Missing smoke fixture '${logicalPath}'.`);
    return content;
  }
}

export function createIndexHtmlUpdateProviderResponse(content: string): string {
  return JSON.stringify({
    summary: 'Update index.html accessibility attributes.',
    artifacts: [
      {
        logicalPath: 'index.html',
        type: 'SOURCE_FILE',
        content,
        metadata: {
          description: 'Update index.html accessibility attributes.',
          'change-operation': 'UPDATE_FILE',
        },
      },
    ],
    diagnostics: [],
  });
}

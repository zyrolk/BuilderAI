import type { WorkspaceBaselinePort } from '../../change-planner/ports/workspace-baseline.port';

export class NullWorkspaceBaselinePort implements WorkspaceBaselinePort {
  readTextBaseline(): null {
    return null;
  }
}

export class MemoryWorkspaceBaselinePort implements WorkspaceBaselinePort {
  constructor(private readonly files: Readonly<Record<string, string>>) {}

  readTextBaseline(logicalPath: string) {
    const content = this.files[logicalPath];
    if (content === undefined) return null;
    const normalized = content.replace(/\r\n?/g, '\n');
    return {
      logicalPath,
      content: normalized,
      checksum: {
        algorithm: 'SHA-256' as const,
        value: 'test-checksum',
      },
      sizeBytes: Buffer.byteLength(normalized, 'utf8'),
    };
  }
}

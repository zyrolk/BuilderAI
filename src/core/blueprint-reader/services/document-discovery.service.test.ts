import { REQUIRED_DOCUMENTS } from '../documents';
import { DocumentDiscoveryService } from './document-discovery.service';

describe('DocumentDiscoveryService', () => {
  const service = new DocumentDiscoveryService();
  const requiredPaths = REQUIRED_DOCUMENTS.map(({ path }) => path);

  it('discovers every required document and reports unknown documents', () => {
    const report = service.discover([...requiredPaths, 'docs/notes.md']);

    expect(report.documents).toHaveLength(REQUIRED_DOCUMENTS.length);
    expect(report.missing).toEqual([]);
    expect(report.duplicates).toEqual([]);
    expect(report.unknown).toEqual(['docs/notes.md']);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_DOCUMENT', severity: 'WARNING' }),
    );
  });

  it('reports missing and duplicate documents and prefers the expected path', () => {
    const paths = requiredPaths.filter((path) => path !== 'docs/roadmap.md');
    const report = service.discover([...paths, 'archive/project-blueprint.md']);

    expect(report.missing.map(({ kind }) => kind)).toEqual(['roadmap']);
    expect(report.duplicates).toEqual([
      {
        kind: 'project-blueprint',
        paths: ['archive/project-blueprint.md', 'docs/project-blueprint.md'],
      },
    ]);
    expect(report.documents.find(({ kind }) => kind === 'project-blueprint')?.actualPath).toBe(
      'docs/project-blueprint.md',
    );
    expect(report.diagnostics.filter(({ severity }) => severity === 'ERROR')).toHaveLength(2);
  });

  it('normalizes paths and accepts a uniquely relocated required document', () => {
    const paths = requiredPaths.map((path) =>
      path === 'docs/roadmap.md' ? '.\\policies\\roadmap.md' : path,
    );

    expect(service.discover(paths).documents.find(({ kind }) => kind === 'roadmap')).toEqual({
      kind: 'roadmap',
      expectedPath: 'docs/roadmap.md',
      actualPath: 'policies/roadmap.md',
      format: 'MARKDOWN',
    });
  });
});

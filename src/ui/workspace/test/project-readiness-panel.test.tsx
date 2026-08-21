import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ExternalTargetReadiness } from '../../../application/workspace/external-target-readiness';
import { ProjectReadinessPanel } from '../project-readiness-panel';

function readiness(overrides: Partial<ExternalTargetReadiness> = {}): ExternalTargetReadiness {
  return {
    schemaVersion: 1,
    profile: 'EXTERNAL_TARGET',
    projectId: 'proj-1',
    projectName: 'Demo Project',
    projectRootDisplay: '/tmp/demo',
    runtimeConnected: true,
    status: 'READY',
    indexedFileCount: 12,
    sourceRoots: ['src', 'app', 'lib', 'server', 'client', 'packages', 'apps', 'services', 'extra'],
    testRoots: ['tests'],
    governanceDocuments: ['docs/project-constitution.md'],
    protectedAreas: [{ path: '.env', classification: 'NEVER_EXPOSE' }],
    verification: {
      build: true,
      test: true,
      lint: false,
      typecheck: true,
      format: false,
      devServer: true,
      browserVerification: false,
    },
    warnings: [],
    blockers: [],
    ...overrides,
  };
}

describe('ProjectReadinessPanel', () => {
  it('renders ready status with truncated source roots and verification flags', () => {
    render(<ProjectReadinessPanel readiness={readiness()} />);
    expect(screen.getByText('Demo Project')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
    expect(screen.getByText('Build available')).toBeInTheDocument();
    expect(screen.getByText('Lint unavailable')).toBeInTheDocument();
    expect(screen.getByText('Format unavailable')).toBeInTheDocument();
    expect(screen.getByText('tests')).toBeInTheDocument();
    expect(screen.getByText('.env')).toBeInTheDocument();
  });

  it('renders warnings and blockers with optional remediation', () => {
    render(
      <ProjectReadinessPanel
        readiness={readiness({
          status: 'READY_WITH_WARNINGS',
          sourceRoots: ['src'],
          testRoots: [],
          protectedAreas: [],
          warnings: [
            {
              code: 'MISSING_LOCKFILE',
              message: 'No lockfile.',
              severity: 'WARNING',
              remediation: 'Add package-lock.json',
            },
            {
              code: 'NO_REMEDIATION',
              message: 'Warning only.',
              severity: 'WARNING',
            },
          ],
          blockers: [],
        })}
      />,
    );
    expect(screen.getByText('Ready with warnings')).toBeInTheDocument();
    expect(screen.getByText('MISSING_LOCKFILE')).toBeInTheDocument();
    expect(screen.getByText('Add package-lock.json')).toBeInTheDocument();
  });

  it('renders blocked status and blocker remediation', () => {
    render(
      <ProjectReadinessPanel
        readiness={readiness({
          status: 'BLOCKED',
          sourceRoots: ['src'],
          testRoots: [],
          protectedAreas: [],
          verification: {
            build: false,
            test: false,
            lint: false,
            typecheck: false,
            format: false,
            devServer: false,
            browserVerification: false,
          },
          warnings: [],
          blockers: [
            {
              code: 'NO_PACKAGE_JSON',
              message: 'Missing package.json.',
              severity: 'BLOCKER',
              remediation: 'Create package.json',
            },
            {
              code: 'FATAL',
              message: 'Hard blocker.',
              severity: 'BLOCKER',
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Build unavailable')).toBeInTheDocument();
    expect(screen.getByText('Create package.json')).toBeInTheDocument();
    expect(screen.getByText('Hard blocker.')).toBeInTheDocument();
  });
});

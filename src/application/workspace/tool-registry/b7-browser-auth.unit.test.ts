/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import { readWorkspaceRequestSecurityEvidence } from '../../../infrastructure/workspace/workspace-request-security';
import { createControlledLocalBrowserService } from './create-b7-browser-registry';

describe('ADR-043 browser authorization evidence', () => {
  it('keeps browserObservationApproved distinct from soft auto-approve and Git approved', () => {
    const soft = readWorkspaceRequestSecurityEvidence(
      new Request('http://localhost'),
      {},
      'INVESTIGATE',
    );
    expect(soft.operatorApproved).toBe(true);
    expect(soft.browserObservationApproved).toBe(false);

    const gitApproved = readWorkspaceRequestSecurityEvidence(
      new Request('http://localhost'),
      { approved: true },
      'GIT_WRITE',
    );
    expect(gitApproved.operatorApproved).toBe(true);
    expect(gitApproved.browserObservationApproved).toBe(false);

    const browserApproved = readWorkspaceRequestSecurityEvidence(
      new Request('http://localhost'),
      { browserObservationApproved: true, approved: false },
      'BROWSER_OBSERVE',
    );
    expect(browserApproved.operatorApproved).toBe(false);
    expect(browserApproved.browserObservationApproved).toBe(true);
  });

  it('authorizes BROWSER_OBSERVE only with browserObservationApproved in TRUSTED_LOCAL and PROTECTED', () => {
    const trusted = new WorkspaceAuthorizationService({
      profile: 'TRUSTED_LOCAL',
      projectId: 'builder-ai',
      principalId: 'local-operator',
    });
    expect(
      trusted.authorize({
        profile: 'TRUSTED_LOCAL',
        principal: { principalId: 'local-operator', projectId: 'builder-ai' },
        action: 'BROWSER_OBSERVE',
        evidence: { operatorApproved: true, browserObservationApproved: false },
      }).code,
    ).toBe('BROWSER_OPERATOR_APPROVAL_REQUIRED');
    expect(
      trusted.authorize({
        profile: 'TRUSTED_LOCAL',
        principal: { principalId: 'local-operator', projectId: 'builder-ai' },
        action: 'BROWSER_OBSERVE',
        evidence: { operatorApproved: false, browserObservationApproved: true },
      }).outcome,
    ).toBe('AUTHORIZED');

    const protectedService = new WorkspaceAuthorizationService({
      profile: 'PROTECTED',
      projectId: 'builder-ai',
      principalId: 'op-1',
      accessToken: 'token',
      csrfToken: 'csrf',
    });
    expect(
      protectedService.authorize({
        profile: 'PROTECTED',
        principal: { principalId: 'op-1', projectId: 'builder-ai' },
        action: 'BROWSER_OBSERVE',
        evidence: {
          bearerToken: 'token',
          csrfToken: 'csrf',
          operatorApproved: true,
          browserObservationApproved: false,
        },
      }).code,
    ).toBe('BROWSER_OPERATOR_APPROVAL_REQUIRED');
    expect(
      protectedService.authorize({
        profile: 'PROTECTED',
        principal: { principalId: 'op-1', projectId: 'builder-ai' },
        action: 'BROWSER_OBSERVE',
        evidence: {
          bearerToken: 'token',
          csrfToken: 'csrf',
          operatorApproved: false,
          browserObservationApproved: true,
        },
      }).outcome,
    ).toBe('AUTHORIZED');
  });

  it('creates default ControlledLocalBrowserService composition helper', () => {
    const service = createControlledLocalBrowserService({ workflowDeadlineMs: 1_000 });
    const catalog = service.listCatalog();
    expect(catalog.routes.length).toBeGreaterThan(0);
    expect(catalog.acceptsAbsoluteUrls).toBe(false);
    expect(catalog.downloadsAllowed).toBe(false);
  });
});

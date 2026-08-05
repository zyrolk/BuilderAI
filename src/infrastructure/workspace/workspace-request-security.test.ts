import { assertAuthorizedWorkspaceRequest } from './workspace-request-security';
import type { WorkspaceSecurityConfiguration } from '../../application/workspace/workspace-authorization.types';

const PROTECTED: WorkspaceSecurityConfiguration = {
  profile: 'PROTECTED',
  projectId: 'builder-ai',
  accessToken: 'access-token',
  csrfToken: 'csrf-token',
  principalId: 'workspace-operator',
};

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/workspace/prepare', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ request: 'do something' }),
  });
}

describe('workspace request security', () => {
  it('allows trusted-local prepare without bearer credentials', () => {
    expect(() =>
      assertAuthorizedWorkspaceRequest({
        security: {
          profile: 'TRUSTED_LOCAL',
          projectId: 'builder-ai',
          principalId: 'local-operator',
        },
        request: request(),
        body: { request: 'do something' },
        action: 'PREPARE',
      }),
    ).not.toThrow();
  });

  it('rejects protected prepare without anti-forgery evidence', () => {
    expect(() =>
      assertAuthorizedWorkspaceRequest({
        security: PROTECTED,
        request: request({ authorization: 'Bearer access-token' }),
        body: { request: 'do something' },
        action: 'PREPARE',
      }),
    ).toThrow('Anti-forgery validation failed.');
  });

  it('allows protected prepare with valid bearer and CSRF evidence', () => {
    expect(() =>
      assertAuthorizedWorkspaceRequest({
        security: PROTECTED,
        request: request({
          authorization: 'Bearer access-token',
          'x-builderai-csrf-token': 'csrf-token',
        }),
        body: { request: 'do something' },
        action: 'PREPARE',
      }),
    ).not.toThrow();
  });
});

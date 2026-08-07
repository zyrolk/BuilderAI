import {
  classifyManifestProtectedAreaExposure,
  inferManifestProtectedAreaRuleKind,
  ManifestProtectedAreasValidationError,
  normalizeManifestProtectedArea,
  parseManifestProtectedAreas,
  validateManifestProtectedArea,
} from '../manifest-protected-areas';

describe('manifest protected areas', () => {
  it('normalizes Windows and POSIX separators deterministically', () => {
    expect(normalizeManifestProtectedArea('infra\\')).toBe('infra');
    expect(normalizeManifestProtectedArea('./server/secrets/')).toBe('server/secrets');
  });

  it('rejects traversal and malformed protected areas', () => {
    expect(() => validateManifestProtectedArea('../escape', '$.protectedAreas[0]')).toThrow(
      ManifestProtectedAreasValidationError,
    );
    expect(() => validateManifestProtectedArea('secrets/*', '$.protectedAreas[0]')).toThrow(
      ManifestProtectedAreasValidationError,
    );
  });

  it('maps directory and file entries to subtree or exact rules', () => {
    expect(inferManifestProtectedAreaRuleKind('infra', 'infra/')).toBe('SUBTREE');
    expect(inferManifestProtectedAreaRuleKind('server/secrets', 'server/secrets/')).toBe('SUBTREE');
    expect(inferManifestProtectedAreaRuleKind('.env', '.env')).toBe('EXACT');
  });

  it('classifies secret-like areas as never-expose and others as mutation-protected', () => {
    expect(classifyManifestProtectedAreaExposure('secrets')).toBe('NEVER_EXPOSE');
    expect(classifyManifestProtectedAreaExposure('server/secrets')).toBe('NEVER_EXPOSE');
    expect(classifyManifestProtectedAreaExposure('.env')).toBe('NEVER_EXPOSE');
    expect(classifyManifestProtectedAreaExposure('infra')).toBe('MUTATION_PROTECTED');
  });

  it('rejects duplicate protected area paths', () => {
    expect(() => parseManifestProtectedAreas(['infra/', 'infra'])).toThrow(
      ManifestProtectedAreasValidationError,
    );
  });
});

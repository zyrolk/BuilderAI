import {
  TARGET_PROJECT_MANIFEST_SCHEMA_VERSION,
  type TargetProjectManifest,
} from './target-project-manifest.types';
import {
  parseManifestSourceRoots,
  parseManifestStaticSourceRoots,
} from './target-project-source-layout';

export class TargetProjectManifestValidationError extends Error {
  constructor(readonly issues: readonly { readonly path: string; readonly message: string }[]) {
    super(
      issues.length === 0
        ? 'Target project manifest is invalid.'
        : issues.map(({ path, message }) => `${path}: ${message}`).join('; '),
    );
    this.name = 'TargetProjectManifestValidationError';
  }
}

export function parseTargetProjectManifest(value: unknown): TargetProjectManifest {
  const issues: { path: string; message: string }[] = [];
  if (typeof value !== 'object' || value === null) {
    throw new TargetProjectManifestValidationError([{ path: '$', message: 'must be an object' }]);
  }

  const schemaVersion = Reflect.get(value, 'schemaVersion');
  if (schemaVersion !== TARGET_PROJECT_MANIFEST_SCHEMA_VERSION) {
    issues.push({ path: '$.schemaVersion', message: 'must equal 1' });
  }

  const projectId = readIdentifier(Reflect.get(value, 'projectId'), '$.projectId', issues);
  const name = readString(Reflect.get(value, 'name'), '$.name', 200, issues);
  const vision = readString(Reflect.get(value, 'vision'), '$.vision', 4_000, issues);
  const currentMilestone = readString(
    Reflect.get(value, 'currentMilestone'),
    '$.currentMilestone',
    500,
    issues,
  );

  if (issues.length > 0) throw new TargetProjectManifestValidationError(issues);

  let sourceRoots: readonly string[] | undefined;
  let staticSourceRoots: readonly string[] | undefined;
  try {
    const parsedSourceRoots = parseManifestSourceRoots(
      readOptionalStringArray(value, 'sourceRoots', issues),
      'sourceRoots',
    );
    const parsedStaticSourceRoots = parseManifestStaticSourceRoots(
      readOptionalStringArray(value, 'staticSourceRoots', issues),
    );
    if (parsedSourceRoots.length > 0) sourceRoots = parsedSourceRoots;
    if (parsedStaticSourceRoots.length > 0) staticSourceRoots = parsedStaticSourceRoots;
  } catch (error: unknown) {
    issues.push({
      path: '$.sourceRoots',
      message: error instanceof Error ? error.message : 'source layout roots are invalid',
    });
  }
  if (issues.length > 0) throw new TargetProjectManifestValidationError(issues);

  return {
    schemaVersion: TARGET_PROJECT_MANIFEST_SCHEMA_VERSION,
    projectId: projectId!,
    name: name!,
    vision: vision!,
    currentMilestone: currentMilestone!,
    ...(readOptionalArray(value, 'constraints', validateConstraint, issues) === undefined
      ? {}
      : { constraints: readOptionalArray(value, 'constraints', validateConstraint, issues)! }),
    ...(readOptionalStringArray(value, 'protectedAreas', issues) === undefined
      ? {}
      : { protectedAreas: readOptionalStringArray(value, 'protectedAreas', issues)! }),
    ...(readOptionalArray(value, 'folderOwnership', validateFolderOwnership, issues) === undefined
      ? {}
      : {
          folderOwnership: readOptionalArray(
            value,
            'folderOwnership',
            validateFolderOwnership,
            issues,
          )!,
        }),
    ...(sourceRoots === undefined ? {} : { sourceRoots }),
    ...(staticSourceRoots === undefined ? {} : { staticSourceRoots }),
  };
}

function readIdentifier(
  value: unknown,
  path: string,
  issues: { path: string; message: string }[],
): string | undefined {
  if (typeof value !== 'string' || !/^[a-z0-9-]{2,80}$/u.test(value.trim())) {
    issues.push({ path, message: 'must be a lowercase identifier' });
    return undefined;
  }
  return value.trim();
}

function readString(
  value: unknown,
  path: string,
  maxLength: number,
  issues: { path: string; message: string }[],
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    issues.push({ path, message: `must be a non-empty string up to ${maxLength} characters` });
    return undefined;
  }
  return value.trim();
}

function readOptionalStringArray(
  value: object,
  field: string,
  issues: { path: string; message: string }[],
): readonly string[] | undefined {
  const candidate = Reflect.get(value, field);
  if (candidate === undefined) return undefined;
  if (!Array.isArray(candidate)) {
    issues.push({ path: `$.${field}`, message: 'must be an array' });
    return undefined;
  }
  const parsed: string[] = [];
  for (const [index, item] of candidate.entries()) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      issues.push({ path: `$.${field}[${index}]`, message: 'must be a non-empty string' });
      continue;
    }
    parsed.push(item.trim());
  }
  return parsed;
}

function readOptionalArray<T>(
  value: object,
  field: string,
  validate: (
    item: unknown,
    path: string,
    issues: { path: string; message: string }[],
  ) => T | undefined,
  issues: { path: string; message: string }[],
): readonly T[] | undefined {
  const candidate = Reflect.get(value, field);
  if (candidate === undefined) return undefined;
  if (!Array.isArray(candidate)) {
    issues.push({ path: `$.${field}`, message: 'must be an array' });
    return undefined;
  }
  const parsed: T[] = [];
  for (const [index, item] of candidate.entries()) {
    const validated = validate(item, `$.${field}[${index}]`, issues);
    if (validated !== undefined) parsed.push(validated);
  }
  return parsed;
}

function validateConstraint(
  value: unknown,
  path: string,
  issues: { path: string; message: string }[],
) {
  if (typeof value !== 'object' || value === null) {
    issues.push({ path, message: 'must be an object' });
    return undefined;
  }
  const id = readIdentifier(Reflect.get(value, 'id'), `${path}.id`, issues);
  const statement = readString(Reflect.get(value, 'statement'), `${path}.statement`, 2_000, issues);
  const rationale = readString(Reflect.get(value, 'rationale'), `${path}.rationale`, 2_000, issues);
  if (id === undefined || statement === undefined || rationale === undefined) return undefined;
  return { id, statement, rationale };
}

function validateFolderOwnership(
  value: unknown,
  path: string,
  issues: { path: string; message: string }[],
) {
  if (typeof value !== 'object' || value === null) {
    issues.push({ path, message: 'must be an object' });
    return undefined;
  }
  const folderPath = readString(Reflect.get(value, 'path'), `${path}.path`, 300, issues);
  const owner = readString(Reflect.get(value, 'owner'), `${path}.owner`, 200, issues);
  const responsibility = readString(
    Reflect.get(value, 'responsibility'),
    `${path}.responsibility`,
    2_000,
    issues,
  );
  if (folderPath === undefined || owner === undefined || responsibility === undefined) {
    return undefined;
  }
  return { path: folderPath, owner, responsibility };
}

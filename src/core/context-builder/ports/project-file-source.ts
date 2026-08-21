export interface ProjectFileSource {
  listSourcePaths(): Promise<readonly string[]>;
  readSourceFile(path: string): Promise<string>;
}

/**
 * Signals that a source read was denied by a caller-owned confidentiality boundary.
 *
 * The error intentionally does not include the rejected logical path. Callers may use
 * the type to omit inaccessible dependencies without leaking protected path details.
 */
export class ProjectFileSourceAccessDeniedError extends Error {
  constructor() {
    super('Source file access was denied by the workspace confidentiality policy.');
    this.name = 'ProjectFileSourceAccessDeniedError';
  }
}

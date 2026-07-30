export interface ProjectFileSource {
  listSourcePaths(): Promise<readonly string[]>;
  readSourceFile(path: string): Promise<string>;
}

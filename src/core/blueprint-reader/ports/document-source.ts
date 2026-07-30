export interface DocumentSource {
  listDocumentPaths(): Promise<readonly string[]>;
  readDocument(path: string): Promise<string>;
}

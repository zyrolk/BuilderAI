export interface ArtifactChecksumPort {
  readonly algorithm: string;
  checksum(content: string): Promise<string>;
}

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';

import type { ArtifactChecksum } from '../../core/response-processor';

export const DEFAULT_MAXIMUM_BASELINE_BYTES = 524_288;

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function sha256ChecksumOfNormalizedText(content: string): ArtifactChecksum {
  const digest = createHash('sha256').update(content, 'utf8').digest('hex');
  return { algorithm: 'sha256', value: digest };
}

export function utf8Size(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export interface TextBaselineReadResult {
  readonly content: string;
  readonly checksum: ArtifactChecksum;
  readonly sizeBytes: number;
}

export function computeTextBaselineChecksumFromRaw(rawContent: string): ArtifactChecksum | null {
  if (rawContent.includes('\u0000')) return null;
  const content = normalizeLineEndings(rawContent);
  return sha256ChecksumOfNormalizedText(content);
}

export function readTextBaselineFromRawContent(rawContent: string): TextBaselineReadResult | null {
  return readTextBaselineFromRawFile(rawContent, DEFAULT_MAXIMUM_BASELINE_BYTES);
}

function readTextBaselineFromRawFile(
  rawContent: string,
  maximumBaselineBytes: number,
): TextBaselineReadResult | null {
  if (rawContent.includes('\u0000')) return null;

  const content = normalizeLineEndings(rawContent);
  const sizeBytes = utf8Size(content);
  if (sizeBytes > maximumBaselineBytes) return null;

  return {
    content,
    checksum: sha256ChecksumOfNormalizedText(content),
    sizeBytes,
  };
}

export function readTextBaselineFromAbsolutePathSync(
  absolutePath: string,
  maximumBaselineBytes: number = DEFAULT_MAXIMUM_BASELINE_BYTES,
): TextBaselineReadResult | null {
  try {
    const entry = lstatSync(absolutePath);
    if (entry.isSymbolicLink() || !entry.isFile()) return null;
    if (entry.size > maximumBaselineBytes) return null;

    const rawContent = readFileSync(absolutePath, 'utf8');
    return readTextBaselineFromRawFile(rawContent, maximumBaselineBytes);
  } catch {
    return null;
  }
}

export async function readTextBaselineFromAbsolutePath(
  absolutePath: string,
  maximumBaselineBytes: number = DEFAULT_MAXIMUM_BASELINE_BYTES,
): Promise<TextBaselineReadResult | null> {
  try {
    const entry = await lstat(absolutePath);
    if (entry.isSymbolicLink() || !entry.isFile()) return null;
    if (entry.size > maximumBaselineBytes) return null;

    const rawContent = await readFile(absolutePath, 'utf8');
    return readTextBaselineFromRawFile(rawContent, maximumBaselineBytes);
  } catch {
    return null;
  }
}

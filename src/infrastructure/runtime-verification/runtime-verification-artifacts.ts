import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';

import { randomUUID } from 'node:crypto';

export interface RuntimeVerificationArtifactStore {
  readonly rootDirectory: string;
  createScreenshotPath(routePath: string): string;
}

export function createRuntimeVerificationArtifactStore(
  projectRoot: string,
): RuntimeVerificationArtifactStore {
  const builderAiDirectory = path.join(path.resolve(projectRoot), '.builderai');
  mkdirSync(builderAiDirectory, { recursive: true });
  const rootDirectory = mkdtempSync(path.join(builderAiDirectory, 'runtime-verification-'));
  return {
    rootDirectory,
    createScreenshotPath(routePath: string) {
      const safeRoute = routePath.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'root';
      return path.join(rootDirectory, `${safeRoute}-${randomUUID()}.png`);
    },
  };
}

export function screenshotArtifactId(screenshotPath: string, artifactRoot: string): string {
  return path.relative(artifactRoot, screenshotPath).replace(/\\/g, '/');
}

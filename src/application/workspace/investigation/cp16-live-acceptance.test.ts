import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildInvestigationHandoffFeedback } from './investigation-handoff';

const BASE = process.env.BUILDERAI_PROOF_BASE_URL ?? 'http://localhost:3004';
const ORIGIN = BASE;
const INVESTIGATION_REQUEST =
  'Investigate why supplier PRICE_CHANGED comparisons involving Cost Price may not be preserved correctly when supplier sync price, stock, and image update settings are enabled. Find the relevant implementation and regression coverage. Do not change anything.';
const PREPARE_REQUEST =
  'Improve regression coverage for the already-implemented supplier sync settings behavior. Only modify tests/supplierSyncSettings.test.ts. Add a small regression assertion around the existing PRICE_CHANGED comparison behavior when the sync flags remain enabled. Do not modify production source or any other file.';

async function request(
  routePath: string,
  options: { readonly method?: string; readonly body?: string } = {},
): Promise<{ readonly status: number; readonly json: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${routePath}`, {
    method: options.method ?? 'GET',
    headers: {
      Origin: ORIGIN,
      ...(options.body === undefined
        ? {}
        : {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(options.body, 'utf8')),
          }),
    },
    body: options.body,
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json };
}

function zyroGitStatus(): string {
  const zyroRoot = process.env.BUILDERAI_PROJECT_ROOT ?? 'C:/Users/rchi5/Documents/project/zyrolk';
  try {
    return execSync('git status --short', { cwd: zyroRoot, encoding: 'utf8' }).trim();
  } catch (error: unknown) {
    return error instanceof Error ? error.message : 'unavailable';
  }
}

describe.runIf(process.env.CP16_LIVE_PROOF === '1')('CP16 live Zyro acceptance', () => {
  it('READINESS → INVESTIGATE → PREPARE → Gate 2 yields UPDATE_FILE for explicit test-only request', async () => {
    const proof: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      baseUrl: BASE,
      zyroGitStatusPre: zyroGitStatus(),
    };

    const readiness = await request('/api/workspace/readiness');
    proof.readiness = readiness;

    const investigation = await request('/api/workspace/investigate', {
      method: 'POST',
      body: JSON.stringify({ request: INVESTIGATION_REQUEST }),
    });
    expect(investigation.status).toBe(200);

    const report = investigation.json.report as Record<string, unknown>;
    const searchResult = investigation.json.searchResult as Record<string, unknown>;
    const matches = (searchResult.matches as Array<Record<string, unknown>>) ?? [];
    const evidence = (report.evidence as Array<Record<string, unknown>>) ?? [];

    proof.investigation = {
      status: investigation.status,
      investigationId: investigation.json.investigationId,
      bounded: investigation.json.bounded,
      queries: searchResult.queries,
      topSearchPaths: [...new Set(matches.map((match) => String(match.logicalPath)))].slice(0, 12),
      evidence: evidence.map((entry) => ({
        logicalPath: entry.logicalPath,
        claimKind: entry.claimKind,
      })),
      confidence: report.confidence,
      summary: report.summary,
      metadata: report.metadata,
    };

    const handoff = buildInvestigationHandoffFeedback({
      sourceInvestigationId: String(investigation.json.investigationId),
      priorRequestSummary: INVESTIGATION_REQUEST,
      investigationSummary: String(report.summary ?? ''),
      ...(report.suggestedFixScope === undefined
        ? {}
        : { suggestedFixScope: String(report.suggestedFixScope) }),
      ...(report.likelyRootCause === undefined
        ? {}
        : { likelyRootCause: String(report.likelyRootCause) }),
      sourcePaths: (investigation.json.repositorySourcePaths as string[]) ?? [],
      requestText: INVESTIGATION_REQUEST,
      queries: (searchResult.queries as string[]) ?? [],
      evidence: evidence as never,
      searchMatches: matches as never,
      hypotheses: (report.hypotheses as never[]) ?? [],
      affectedAreas: (report.affectedAreas as string[]) ?? [],
    });

    proof.handoff = {
      pathHints: handoff.pathHints,
      existingPathHints: handoff.existingPathHints,
      candidatePathHints: handoff.candidatePathHints,
    };

    const prepare = await request('/api/workspace/prepare', {
      method: 'POST',
      body: JSON.stringify({
        request: PREPARE_REQUEST,
        iterationFeedback: handoff,
      }),
    });

    const changePlan = prepare.json.changePlan as Record<string, unknown> | undefined;
    const changeSet = changePlan?.changeSet as Record<string, unknown> | undefined;
    const operations = (changeSet?.operations as Array<Record<string, unknown>>) ?? [];
    const gate2Review = prepare.json.gate2Review as Record<string, unknown> | undefined;
    const operationDiffs = (gate2Review?.operationDiffs as Array<Record<string, unknown>>) ?? [];
    const responseMetadata = (prepare.json.responsePackage as Record<string, unknown> | undefined)
      ?.metadata as Record<string, unknown> | undefined;

    proof.prepare = {
      status: prepare.status,
      preparationId: prepare.json.preparationId,
      prepareContextSelection: prepare.json.prepareContextSelection,
      totalOperations: (changePlan?.summary as Record<string, unknown> | undefined)
        ?.totalOperations,
      operations: operations.map((operation) => ({
        kind: operation.kind,
        logicalPath: operation.logicalPath,
      })),
      gate2Paths: operationDiffs.map((diff) => ({
        logicalPath: diff.logicalPath,
        format: diff.format,
      })),
      responseMetadata,
      error: prepare.status === 200 ? undefined : prepare.json,
    };

    proof.createFileOnExistingPath = operations.some(
      (operation) =>
        operation.kind === 'CREATE_FILE' &&
        handoff.existingPathHints.includes(String(operation.logicalPath)),
    );
    proof.zyroGitStatusPost = zyroGitStatus();
    proof.applyCalls = 0;
    proof.compactRetryUsed =
      (prepare.json.prepareContextSelection as Record<string, unknown> | undefined)
        ?.compactRetryUsed ?? false;

    const outputPath = path.resolve(process.cwd(), '.builderai/cp16-live-proof-result.json');
    writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');

    expect(investigation.status).toBe(200);
    expect(handoff.pathHints.length).toBeGreaterThan(0);
    expect(handoff.existingPathHints).toContain('tests/supplierSyncSettings.test.ts');
    expect(prepare.status).toBe(200);
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.every((operation) => operation.kind === 'UPDATE_FILE')).toBe(true);
    expect(
      operations.every(
        (operation) => operation.logicalPath === 'tests/supplierSyncSettings.test.ts',
      ),
    ).toBe(true);
    expect(proof.createFileOnExistingPath).toBe(false);
    expect(operationDiffs.length).toBeGreaterThan(0);
    expect(prepare.json.prepareContextSelection).toBeDefined();
  }, 600_000);
});

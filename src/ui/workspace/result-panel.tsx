'use client';

import type { Gate2ReviewProjection } from '../../application/workspace/gate2-review';
import type { WorkspaceInvestigation } from '../../application/workspace/investigation';
import type {
  ProjectChangePlan,
  ProjectChangeWarning,
  UpdateFileOperation,
} from '../../core/change-planner';
import type { FileApplyResult } from '../../core/file-apply';
import type { ResponsePackage } from '../../core/response-processor';
import type { VerificationDiagnostic, VerificationReport } from '../../core/verification';
import type { RuntimeBrowserVerificationReport } from '../../core/runtime-verification';
import type { KeyboardEvent } from 'react';
import {
  formatPreservationFindingCode,
  hasBaselineUnavailableWarning,
  isHighVisibilityFinding,
  joinBoundedList,
  listPreservationMetricItems,
  preservationSeverityLabel,
} from './change-plan-preservation-display';
import {
  formatFailureCategory,
  summarizeVerificationFailures,
} from './verification-outcome-display';
import {
  appliedWithVerificationFailureHeadline,
  baselineDriftGuidance,
  dependencyChangeGuidance,
  PARTIAL_APPLY_RECOVERY_STEPS,
  partialApplyHeadline,
  partialApplySafetyNotice,
  summarizePartialApplyOperations,
  verificationCommandFailureGuidance,
  verificationInfrastructureGuidance,
  verificationTimeoutGuidance,
} from './operator-recovery-guidance';
import {
  formatBrowserVerificationStatus,
  formatRuntimeServerStatus,
  runtimeBrowserVerificationFailed,
} from './runtime-browser-verification-display';
import {
  changePlanTouchesLockfile,
  changePlanTouchesPackageJson,
  hasBaselineDriftApplyFailure,
  isAppliedWithVerificationFailure,
  isPartialApplyOutcome,
} from './verification-outcome-display';
import { Gate2DiffView } from './gate2-diff-view';
import { InvestigationReportView } from './investigation-report-view';
import styles from './workspace.module.css';
import { RESULT_PANEL_TABS, type ResultPanelTab } from './workspace.types';

const TAB_LABELS: Readonly<Record<ResultPanelTab, string>> = {
  RESPONSE_PACKAGE: 'Response Package',
  CHANGE_PLAN: 'Change Plan',
  DIFF: 'Diff',
  INVESTIGATION: 'Investigation',
  APPLY_RESULT: 'Apply Result',
  VERIFICATION_REPORT: 'Verification Report',
};

interface ResultPanelProps {
  readonly activeTab: ResultPanelTab;
  readonly onTabChange: (tab: ResultPanelTab) => void;
  readonly responsePackage?: ResponsePackage;
  readonly changePlan?: ProjectChangePlan;
  readonly gate2Review?: Gate2ReviewProjection;
  readonly investigation?: WorkspaceInvestigation;
  readonly onSaveInvestigationMemory?: () => void;
  readonly investigationMemorySaveState?: 'idle' | 'saving' | 'saved' | 'error';
  readonly applyResult?: FileApplyResult;
  readonly verificationReport?: VerificationReport;
  readonly runtimeBrowserVerificationReport?: RuntimeBrowserVerificationReport;
}

export function ResultPanel({
  activeTab,
  onTabChange,
  responsePackage,
  changePlan,
  gate2Review,
  investigation,
  onSaveInvestigationMemory,
  investigationMemorySaveState,
  applyResult,
  verificationReport,
  runtimeBrowserVerificationReport,
}: ResultPanelProps) {
  return (
    <aside className={styles.resultsPanel} aria-labelledby="results-title">
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>Execution evidence</p>
          <h2 id="results-title">Results</h2>
        </div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Workflow results">
        {RESULT_PANEL_TABS.map((tab) => (
          <button
            className={activeTab === tab ? styles.activeTab : styles.tab}
            id={`tab-${tab.toLowerCase()}`}
            key={tab}
            role="tab"
            type="button"
            aria-controls={`panel-${tab.toLowerCase()}`}
            aria-selected={activeTab === tab}
            tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => onTabChange(tab)}
            onKeyDown={(event) => handleTabKeyDown(event, tab, onTabChange)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div
        className={styles.tabPanel}
        id={`panel-${activeTab.toLowerCase()}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab.toLowerCase()}`}
      >
        {activeTab === 'RESPONSE_PACKAGE' && (
          <ResponsePackageView responsePackage={responsePackage} />
        )}
        {activeTab === 'CHANGE_PLAN' && <ChangePlanView changePlan={changePlan} />}
        {activeTab === 'DIFF' && <Gate2DiffView gate2Review={gate2Review} />}
        {activeTab === 'INVESTIGATION' && (
          <InvestigationReportView
            investigation={investigation}
            onSaveToMemory={onSaveInvestigationMemory}
            memorySaveState={investigationMemorySaveState}
          />
        )}
        {activeTab === 'APPLY_RESULT' && (
          <ApplyResultView applyResult={applyResult} changePlan={changePlan} />
        )}
        {activeTab === 'VERIFICATION_REPORT' && (
          <VerificationReportView
            applyResult={applyResult}
            verificationReport={verificationReport}
            runtimeBrowserVerificationReport={runtimeBrowserVerificationReport}
          />
        )}
      </div>
    </aside>
  );
}

function UpdatePreservationSection({
  operation,
  warnings,
}: {
  readonly operation: UpdateFileOperation;
  readonly warnings: readonly ProjectChangeWarning[];
}) {
  const unavailableWarning = hasBaselineUnavailableWarning(warnings, operation.operationId);
  if (operation.preservation === undefined) {
    if (unavailableWarning === undefined) return null;
    return (
      <section
        className={styles.preservationUnavailable}
        aria-labelledby={`preservation-unavailable-${operation.operationId}`}
      >
        <h4 id={`preservation-unavailable-${operation.operationId}`}>Preservation analysis</h4>
        <p>
          <strong>Baseline unavailable:</strong> {unavailableWarning.message}
        </p>
      </section>
    );
  }

  const preservation = operation.preservation;
  const metricItems = listPreservationMetricItems(
    preservation,
    operation.baselineContentChecksum,
    operation.sourceChecksum,
  );
  const summaryId = `preservation-summary-${operation.operationId}`;

  return (
    <section className={styles.preservationSummary} aria-labelledby={summaryId}>
      <h4 id={summaryId}>Preservation summary</h4>
      <dl className={styles.preservationMetrics}>
        {metricItems.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {preservation.findings.length > 0 && (
        <div className={styles.preservationFindings}>
          <h5>Preservation findings</h5>
          <ul>
            {preservation.findings.map((finding) => (
              <li
                key={`${finding.code}-${finding.message}`}
                className={
                  isHighVisibilityFinding(finding)
                    ? styles.preservationFindingHigh
                    : styles.preservationFinding
                }
              >
                <strong>{preservationSeverityLabel(finding.severity)}</strong>
                <span>{formatPreservationFindingCode(finding.code)}</span>
                <p>{finding.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {joinBoundedList(preservation.removedHtmlIds) !== undefined && (
        <p className={styles.preservationDetail}>
          <strong>Removed HTML ids:</strong> {joinBoundedList(preservation.removedHtmlIds)}
        </p>
      )}
      {joinBoundedList(preservation.removedAccessibilityAttributes) !== undefined && (
        <p className={styles.preservationDetail}>
          <strong>Removed aria attributes:</strong>{' '}
          {joinBoundedList(preservation.removedAccessibilityAttributes)}
        </p>
      )}
      {preservation.crossFileReferenceRisks !== undefined &&
        preservation.crossFileReferenceRisks.length > 0 && (
          <div className={styles.preservationDetail}>
            <strong>Cross-file reference risks:</strong>
            <ul>
              {preservation.crossFileReferenceRisks.map((risk) => (
                <li key={`${risk.removedId}-${risk.referencingLogicalPath}`}>
                  Removed id <code>{risk.removedId}</code> referenced in{' '}
                  <code>{risk.referencingLogicalPath}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
    </section>
  );
}

function ResponsePackageView({ responsePackage }: { readonly responsePackage?: ResponsePackage }) {
  if (!responsePackage) {
    return <EmptyResult message="Response evidence will appear after the request is processed." />;
  }
  return (
    <div className={styles.resultContent}>
      <ResultSummary
        items={[
          ['Artifacts', responsePackage.generatedArtifacts.length],
          ['Total bytes', responsePackage.manifest.totalSizeBytes],
          ['Warnings', responsePackage.warnings.length],
        ]}
      />
      <h3>Artifact manifest</h3>
      {responsePackage.manifest.entries.length === 0 ? (
        <p className={styles.muted}>No generated artifacts.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th scope="col">Path</th>
                <th scope="col">Type</th>
                <th scope="col">Size</th>
              </tr>
            </thead>
            <tbody>
              {responsePackage.manifest.entries.map((entry) => (
                <tr key={entry.logicalPath}>
                  <td>
                    <code>{entry.logicalPath}</code>
                  </td>
                  <td>{formatLabel(entry.type)}</td>
                  <td>{entry.sizeBytes} B</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChangePlanView({ changePlan }: { readonly changePlan?: ProjectChangePlan }) {
  if (!changePlan) {
    return <EmptyResult message="A reviewable plan will appear before approval is requested." />;
  }
  const dependencyChange =
    changePlanTouchesPackageJson(changePlan) || changePlanTouchesLockfile(changePlan);
  return (
    <div className={styles.resultContent}>
      {dependencyChange && (
        <section className={styles.operatorGuidance} role="status">
          <h3>Dependency change</h3>
          <p>{dependencyChangeGuidance()}</p>
        </section>
      )}
      <ResultSummary
        items={[
          ['Create', changePlan.summary.filesCreated.length],
          ['Update', changePlan.summary.filesUpdated.length],
          ['Delete', changePlan.summary.filesDeleted.length],
        ]}
      />
      <h3>Proposed operations</h3>
      <ol className={styles.operationList}>
        {changePlan.changeSet.operations.map((operation) => (
          <li key={operation.operationId}>
            <span className={styles.operationKind}>{formatLabel(operation.kind)}</span>
            <code>{operation.logicalPath}</code>
            <p>{operation.description}</p>
            {operation.kind === 'UPDATE_FILE' && (
              <UpdatePreservationSection operation={operation} warnings={changePlan.warnings} />
            )}
          </li>
        ))}
      </ol>
      {changePlan.risks.length > 0 && (
        <section className={styles.findings} aria-labelledby="plan-risks-title">
          <h3 id="plan-risks-title">Risks</h3>
          {changePlan.risks.map((risk) => (
            <p key={`${risk.code}-${risk.message}`}>
              <strong>{risk.severity}:</strong> {risk.message}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}

function ApplyResultView({
  applyResult,
  changePlan,
}: {
  readonly applyResult?: FileApplyResult;
  readonly changePlan?: ProjectChangePlan;
}) {
  if (!applyResult) {
    return <EmptyResult message="No filesystem action occurs before explicit approval." />;
  }

  const partialApply = isPartialApplyOutcome(applyResult);
  const baselineDrift = hasBaselineDriftApplyFailure(applyResult);
  const dependencyChange =
    changePlanTouchesPackageJson(changePlan) || changePlanTouchesLockfile(changePlan);
  const partialSummary = partialApply ? summarizePartialApplyOperations(applyResult) : undefined;

  return (
    <div className={styles.resultContent}>
      <StatusHeading label="Apply status" status={formatLabel(applyResult.status)} />
      {partialApply && (
        <section className={styles.operatorGuidance} role="status" aria-live="polite">
          <h3>Partial apply warning</h3>
          <p>{partialApplyHeadline()}</p>
          <p>{partialApplySafetyNotice()}</p>
          {partialSummary !== undefined && (
            <ResultSummary
              items={[
                ['Applied operations', partialSummary.appliedCount],
                ['Failed operations', partialSummary.failedCount],
                ['Skipped paths', partialSummary.skippedCount],
              ]}
            />
          )}
          <h4>Recovery checklist</h4>
          <ol className={styles.recoveryChecklist}>
            {PARTIAL_APPLY_RECOVERY_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      )}
      {baselineDrift && (
        <section className={styles.operatorGuidance} role="status">
          <h3>Baseline drift</h3>
          <p>{baselineDriftGuidance()}</p>
        </section>
      )}
      {dependencyChange && (
        <section className={styles.operatorGuidance} role="status">
          <h3>Dependency change</h3>
          <p>{dependencyChangeGuidance()}</p>
        </section>
      )}
      <ResultSummary
        items={[
          ['Created', applyResult.createdFiles.length],
          ['Updated', applyResult.updatedFiles.length],
          ['Deleted', applyResult.deletedFiles.length],
        ]}
      />
      <PathGroup title="Created files" paths={applyResult.createdFiles} />
      <PathGroup title="Updated files" paths={applyResult.updatedFiles} />
      <PathGroup title="Deleted files" paths={applyResult.deletedFiles} />
      <PathGroup title="Skipped files" paths={applyResult.skippedFiles} />
      <Findings title="Apply errors" findings={applyResult.errors} />
    </div>
  );
}

function VerificationReportView({
  verificationReport,
  applyResult,
  runtimeBrowserVerificationReport,
}: {
  readonly verificationReport?: VerificationReport;
  readonly applyResult?: FileApplyResult;
  readonly runtimeBrowserVerificationReport?: RuntimeBrowserVerificationReport;
}) {
  if (!verificationReport && !runtimeBrowserVerificationReport) {
    return (
      <EmptyResult message="Verification evidence appears after an eligible apply result (applied or partially applied)." />
    );
  }

  const failureSummary =
    verificationReport === undefined
      ? { categories: [], failedStages: [], primaryCategory: undefined, primaryLabel: undefined }
      : summarizeVerificationFailures(verificationReport);
  const appliedVerificationFailure = isAppliedWithVerificationFailure(
    applyResult,
    verificationReport,
  );
  const browserVerificationFailed = runtimeBrowserVerificationFailed(
    runtimeBrowserVerificationReport,
  );

  return (
    <div className={styles.resultContent}>
      {verificationReport !== undefined && (
        <StatusHeading
          label="Verification status"
          status={formatLabel(verificationReport.status)}
        />
      )}
      {runtimeBrowserVerificationReport !== undefined && (
        <RuntimeBrowserVerificationView report={runtimeBrowserVerificationReport} />
      )}
      {browserVerificationFailed && (
        <section className={styles.operatorGuidance} role="status" aria-live="polite">
          <h3>Browser verification failed</h3>
          <p>
            The dev server and browser checks did not pass. Review runtime and route evidence below
            before requesting correction.
          </p>
        </section>
      )}
      {appliedVerificationFailure && (
        <section className={styles.operatorGuidance} role="status" aria-live="polite">
          <h3>Applied with verification failure</h3>
          <p>{appliedWithVerificationFailureHeadline()}</p>
          <p>
            Files were already written to disk. Review stages below before requesting correction.
          </p>
        </section>
      )}
      {verificationReport !== undefined && failureSummary.primaryLabel !== undefined && (
        <section className={styles.operatorGuidance} role="status">
          <h3>Failure classification</h3>
          <p>
            Primary category: <strong>{failureSummary.primaryLabel}</strong>
          </p>
          {failureSummary.categories.length > 1 && (
            <ul>
              {failureSummary.categories.map((category) => (
                <li key={category}>{formatFailureCategory(category)}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      {verificationReport !== undefined && (
        <div className={styles.stageList}>
          {verificationReport.stages.map((stage) => (
            <article key={stage.stage} className={styles.stageResult}>
              <div>
                <h3>{formatLabel(stage.stage)}</h3>
                <p>{stage.durationMs} ms</p>
              </div>
              <span className={statusClass(stage.status)}>{formatLabel(stage.status)}</span>
              <StageFailureGuidance stage={stage} failureSummary={failureSummary} />
              <StageMetadata metadata={stage.metadata} compact={stage.status === 'PASSED'} />
              <StageDiagnostic diagnostic={stage.diagnostic} stageStatus={stage.status} />
              <Findings title="Errors" findings={stage.errors} compact />
              <Findings title="Warnings" findings={stage.warnings} compact />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function RuntimeBrowserVerificationView({
  report,
}: {
  readonly report: RuntimeBrowserVerificationReport;
}) {
  return (
    <section className={styles.stageList} aria-labelledby="runtime-browser-verification">
      <h3 id="runtime-browser-verification">Runtime browser verification</h3>
      <ResultSummary
        items={[
          ['Overall', formatLabel(report.status)],
          ['Duration', `${report.durationMs} ms`],
        ]}
      />
      <article className={styles.stageResult}>
        <div>
          <h4>Runtime server</h4>
          <p>{report.server.startupDurationMs} ms startup</p>
        </div>
        <span className={statusClass(report.server.status)}>
          {formatRuntimeServerStatus(report.server.status)}
        </span>
        {report.server.url !== undefined && (
          <p className={styles.muted}>
            URL: <code>{report.server.url}</code>
          </p>
        )}
        {report.server.httpStatus !== undefined && (
          <p className={styles.muted}>HTTP {report.server.httpStatus}</p>
        )}
      </article>
      <article className={styles.stageResult}>
        <div>
          <h4>Browser</h4>
          <p>{report.browser.durationMs} ms</p>
        </div>
        <span className={statusClass(report.browser.status)}>
          {formatBrowserVerificationStatus(report.browser.status)}
        </span>
        <ResultSummary
          items={[
            ['Console errors', report.browser.consoleErrorCount],
            ['Page exceptions', report.browser.pageExceptionCount],
            ['Failed requests', report.browser.failedRequestCount],
          ]}
        />
      </article>
      {report.browser.routes.map((route) => (
        <article key={route.path} className={styles.stageResult}>
          <div>
            <h4>{route.path}</h4>
            <p>{route.durationMs} ms</p>
          </div>
          <span className={statusClass(route.status)}>{formatLabel(route.status)}</span>
          {route.pageTitle !== undefined && (
            <p className={styles.muted}>Title: {route.pageTitle}</p>
          )}
          {route.httpStatus !== undefined && (
            <p className={styles.muted}>HTTP {route.httpStatus}</p>
          )}
          {route.consoleErrors.length > 0 && (
            <Findings
              title="Console"
              findings={route.consoleErrors.map(({ message }) => ({
                code: 'CONSOLE',
                message,
              }))}
              compact
            />
          )}
          {route.failedRequests.length > 0 && (
            <Findings
              title="Network"
              findings={route.failedRequests.map(({ url, status, failureText }) => ({
                code: status === undefined ? 'NETWORK' : `HTTP_${status}`,
                message: failureText ?? url,
              }))}
              compact
            />
          )}
          {route.screenshotArtifactId !== undefined && (
            <p className={styles.muted}>
              Screenshot: <code>{route.screenshotArtifactId}</code>
            </p>
          )}
        </article>
      ))}
    </section>
  );
}

function ResultSummary({
  items,
}: {
  readonly items: readonly (readonly [string, string | number])[];
}) {
  return (
    <dl className={styles.resultSummary}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusHeading({ label, status }: { readonly label: string; readonly status: string }) {
  return (
    <div className={styles.statusHeading}>
      <p>{label}</p>
      <strong>{status}</strong>
    </div>
  );
}

function PathGroup({
  title,
  paths,
}: {
  readonly title: string;
  readonly paths: readonly string[];
}) {
  if (paths.length === 0) return null;
  return (
    <section className={styles.pathGroup}>
      <h3>{title}</h3>
      <ul>
        {paths.map((path) => (
          <li key={path}>
            <code>{path}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StageFailureGuidance({
  stage,
  failureSummary,
}: {
  readonly stage: VerificationReport['stages'][number];
  readonly failureSummary: ReturnType<typeof summarizeVerificationFailures>;
}) {
  if (
    stage.status !== 'FAILED' &&
    stage.status !== 'TIMEOUT' &&
    stage.status !== 'PROCESS_FAILED'
  ) {
    return null;
  }
  const hasTimeout = stage.errors.some(({ code }) => code === 'VERIFICATION_COMMAND_TIMEOUT');
  const hasInfrastructure = stage.errors.some(({ code }) =>
    ['STAGE_EXECUTION_FAILED', 'STAGE_CONTRACT_VIOLATION', 'DEPENDENCY_VALIDATION_FAILED'].includes(
      code,
    ),
  );
  let guidance = verificationCommandFailureGuidance();
  if (hasTimeout) guidance = verificationTimeoutGuidance();
  else if (hasInfrastructure) guidance = verificationInfrastructureGuidance();
  else if (failureSummary.primaryCategory === 'VERIFICATION_COMMAND_TIMEOUT') {
    guidance = verificationTimeoutGuidance();
  } else if (failureSummary.primaryCategory === 'VERIFICATION_INFRASTRUCTURE_FAILURE') {
    guidance = verificationInfrastructureGuidance();
  }
  return (
    <p className={styles.investigationMeta} role="note">
      {guidance}
    </p>
  );
}

/**
 * Renders the safe, already-bounded scalar stage metadata (e.g. exit code, output byte count,
 * truncation flag) that `VerificationStageResult` already carries. This never contains raw command
 * output, command lines, system paths, environment values, or stack traces — the underlying contract
 * (ADR-012, docs/security.md) restricts stage metadata to bounded `string | number | boolean` scalars
 * only, so there is nothing further to redact or bound here (P1-8).
 */
function StageMetadata({
  metadata,
  compact = false,
}: {
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
  readonly compact?: boolean;
}) {
  const entries = Object.entries(metadata).filter(([key]) =>
    compact ? !['output-bytes', 'output-truncated'].includes(key) : true,
  );
  if (entries.length === 0) return null;
  return (
    <dl className={styles.stageMetadata}>
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{formatMetadataKey(key)}</dt>
          <dd>{formatMetadataValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function StageDiagnostic({
  diagnostic,
  stageStatus,
}: {
  readonly diagnostic?: VerificationDiagnostic;
  readonly stageStatus: VerificationReport['stages'][number]['status'];
}) {
  if (
    stageStatus !== 'FAILED' &&
    stageStatus !== 'TIMEOUT' &&
    stageStatus !== 'PROCESS_FAILED' &&
    stageStatus !== 'OUTPUT_LIMIT_EXCEEDED' &&
    stageStatus !== 'POLICY_BLOCKED'
  ) {
    return null;
  }
  if (diagnostic === undefined) return null;
  const stdout = diagnostic.stdoutExcerpt;
  const stderr = diagnostic.stderrExcerpt;
  const hasOutput =
    stdout !== undefined ||
    stderr !== undefined ||
    diagnostic.commandDescriptorId !== undefined ||
    diagnostic.exitCode !== undefined;
  if (!hasOutput) return null;
  return (
    <section className={styles.verificationDiagnostic} aria-label="Verification diagnostics">
      {diagnostic.commandDescriptorId !== undefined && (
        <p className={styles.investigationMeta}>Stage: {diagnostic.commandDescriptorId}</p>
      )}
      {diagnostic.exitCode !== undefined && (
        <p className={styles.investigationMeta}>Exit code: {diagnostic.exitCode}</p>
      )}
      {stdout !== undefined && (
        <details className={styles.diagnosticDetails}>
          <summary>Stdout excerpt</summary>
          <pre className={styles.investigationExcerpt}>{stdout}</pre>
        </details>
      )}
      {stderr !== undefined && (
        <details className={styles.diagnosticDetails} open={stdout === undefined}>
          <summary>Stderr excerpt</summary>
          <pre className={styles.investigationExcerpt}>{stderr}</pre>
        </details>
      )}
      {diagnostic.truncated && (
        <p className={styles.investigationMeta} role="note">
          Diagnostic output was truncated
          {diagnostic.omittedBytes !== undefined
            ? ` (${diagnostic.omittedBytes} bytes omitted).`
            : '.'}
        </p>
      )}
    </section>
  );
}

function formatMetadataKey(key: string): string {
  return key
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatMetadataValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function Findings({
  title,
  findings,
  compact = false,
}: {
  readonly title: string;
  readonly findings: readonly { readonly code: string; readonly message: string }[];
  readonly compact?: boolean;
}) {
  if (findings.length === 0) return null;
  return (
    <section className={compact ? styles.compactFindings : styles.findings}>
      <h4>{title}</h4>
      <ul>
        {findings.map((finding) => (
          <li key={`${finding.code}-${finding.message}`}>
            <strong>{finding.code}</strong> — {finding.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyResult({ message }: { readonly message: string }) {
  return (
    <div className={styles.emptyResult}>
      <span aria-hidden="true">◇</span>
      <p>{message}</p>
    </div>
  );
}

function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function statusClass(status: string): string {
  if (status === 'PASSED' || status === 'SKIPPED') return styles.statusPassed ?? '';
  if (status === 'FAILED' || status === 'PARTIALLY_PASSED') return styles.statusFailed ?? '';
  if (
    status === 'TIMEOUT' ||
    status === 'CANCELLED' ||
    status === 'POLICY_BLOCKED' ||
    status === 'OUTPUT_LIMIT_EXCEEDED' ||
    status === 'PROCESS_FAILED' ||
    status === 'UNAVAILABLE'
  ) {
    return styles.statusFailed ?? '';
  }
  return styles.statusFailed ?? '';
}

function handleTabKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  tab: ResultPanelTab,
  onTabChange: (tab: ResultPanelTab) => void,
): void {
  const currentIndex = RESULT_PANEL_TABS.indexOf(tab);
  let nextIndex: number | undefined;
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % RESULT_PANEL_TABS.length;
  if (event.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + RESULT_PANEL_TABS.length) % RESULT_PANEL_TABS.length;
  }
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = RESULT_PANEL_TABS.length - 1;
  if (nextIndex === undefined) return;
  event.preventDefault();
  const nextTab = RESULT_PANEL_TABS[nextIndex];
  if (!nextTab) return;
  onTabChange(nextTab);
  document.getElementById(`tab-${nextTab.toLowerCase()}`)?.focus();
}

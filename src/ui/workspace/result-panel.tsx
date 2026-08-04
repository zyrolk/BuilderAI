'use client';

import type {
  ProjectChangePlan,
  ProjectChangeWarning,
  UpdateFileOperation,
} from '../../core/change-planner';
import type { FileApplyResult } from '../../core/file-apply';
import type { ResponsePackage } from '../../core/response-processor';
import type { VerificationReport } from '../../core/verification';
import type { KeyboardEvent } from 'react';
import {
  formatPreservationFindingCode,
  hasBaselineUnavailableWarning,
  isHighVisibilityFinding,
  joinBoundedList,
  listPreservationMetricItems,
  preservationSeverityLabel,
} from './change-plan-preservation-display';
import styles from './workspace.module.css';
import { RESULT_PANEL_TABS, type ResultPanelTab } from './workspace.types';

const TAB_LABELS: Readonly<Record<ResultPanelTab, string>> = {
  RESPONSE_PACKAGE: 'Response Package',
  CHANGE_PLAN: 'Change Plan',
  APPLY_RESULT: 'Apply Result',
  VERIFICATION_REPORT: 'Verification Report',
};

interface ResultPanelProps {
  readonly activeTab: ResultPanelTab;
  readonly onTabChange: (tab: ResultPanelTab) => void;
  readonly responsePackage?: ResponsePackage;
  readonly changePlan?: ProjectChangePlan;
  readonly applyResult?: FileApplyResult;
  readonly verificationReport?: VerificationReport;
}

export function ResultPanel({
  activeTab,
  onTabChange,
  responsePackage,
  changePlan,
  applyResult,
  verificationReport,
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
        {activeTab === 'APPLY_RESULT' && <ApplyResultView applyResult={applyResult} />}
        {activeTab === 'VERIFICATION_REPORT' && (
          <VerificationReportView verificationReport={verificationReport} />
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
  return (
    <div className={styles.resultContent}>
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

function ApplyResultView({ applyResult }: { readonly applyResult?: FileApplyResult }) {
  if (!applyResult) {
    return <EmptyResult message="No filesystem action occurs before explicit approval." />;
  }
  return (
    <div className={styles.resultContent}>
      <StatusHeading label="Apply status" status={formatLabel(applyResult.status)} />
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
}: {
  readonly verificationReport?: VerificationReport;
}) {
  if (!verificationReport) {
    return <EmptyResult message="Verification evidence appears after a successful apply result." />;
  }
  return (
    <div className={styles.resultContent}>
      <StatusHeading label="Verification status" status={formatLabel(verificationReport.status)} />
      <div className={styles.stageList}>
        {verificationReport.stages.map((stage) => (
          <article key={stage.stage} className={styles.stageResult}>
            <div>
              <h3>{formatLabel(stage.stage)}</h3>
              <p>{stage.durationMs} ms</p>
            </div>
            <span className={statusClass(stage.status)}>{formatLabel(stage.status)}</span>
            <StageMetadata metadata={stage.metadata} />
            <Findings title="Errors" findings={stage.errors} compact />
            <Findings title="Warnings" findings={stage.warnings} compact />
          </article>
        ))}
      </div>
    </div>
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

/**
 * Renders the safe, already-bounded scalar stage metadata (e.g. exit code, output byte count,
 * truncation flag) that `VerificationStageResult` already carries. This never contains raw command
 * output, command lines, system paths, environment values, or stack traces — the underlying contract
 * (ADR-012, docs/security.md) restricts stage metadata to bounded `string | number | boolean` scalars
 * only, so there is nothing further to redact or bound here (P1-8).
 */
function StageMetadata({
  metadata,
}: {
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}) {
  const entries = Object.entries(metadata);
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

function statusClass(status: 'PASSED' | 'FAILED'): string {
  return status === 'PASSED' ? (styles.statusPassed ?? '') : (styles.statusFailed ?? '');
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

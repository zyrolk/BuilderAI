'use client';

import type {
  Gate2OperationDiff,
  Gate2ReviewProjection,
} from '../../application/workspace/gate2-review';
import {
  GATE2_DIFF_TRUNCATION_MESSAGE,
  GATE2_PROTECTED_DIFF_MESSAGE,
  GATE2_TEXT_DIFF_UNAVAILABLE_MESSAGE,
  GATE2_TOTAL_TRUNCATION_MESSAGE,
} from '../../application/workspace/gate2-review/gate2-review-configuration';
import { abbreviateChecksum } from './change-plan-preservation-display';
import styles from './workspace.module.css';

interface Gate2DiffViewProps {
  readonly gate2Review?: Gate2ReviewProjection;
}

export function Gate2DiffView({ gate2Review }: Gate2DiffViewProps) {
  if (gate2Review === undefined) {
    return (
      <div className={styles.emptyResult} role="status">
        <span aria-hidden="true">?</span>
        <p>A line-level diff will appear after a change plan is prepared.</p>
      </div>
    );
  }

  return (
    <div className={styles.resultContent}>
      {gate2Review.truncated && gate2Review.truncationMessage !== undefined && (
        <section className={styles.operatorGuidance} role="status" aria-live="polite">
          <h3>Diff truncated</h3>
          <p>{gate2Review.truncationMessage ?? GATE2_TOTAL_TRUNCATION_MESSAGE}</p>
        </section>
      )}
      <ol className={styles.diffOperationList}>
        {gate2Review.operationDiffs.map((operationDiff) => (
          <Gate2OperationDiffSection
            key={operationDiff.operationId}
            operationDiff={operationDiff}
          />
        ))}
      </ol>
    </div>
  );
}

function Gate2OperationDiffSection({
  operationDiff,
}: {
  readonly operationDiff: Gate2OperationDiff;
}) {
  const panelId = `gate2-diff-${operationDiff.operationId}`;
  return (
    <li className={styles.diffOperationItem}>
      <details className={styles.diffDetails} open>
        <summary className={styles.diffSummary}>
          <span className={styles.operationKind}>{operationDiff.label}</span>
          <code>{operationDiff.logicalPath}</code>
        </summary>
        <div className={styles.diffBody} id={panelId}>
          <ChecksumMetadata operationDiff={operationDiff} />
          {operationDiff.format === 'PROTECTED' && (
            <p className={styles.diffUnavailable} role="status">
              {GATE2_PROTECTED_DIFF_MESSAGE}
            </p>
          )}
          {operationDiff.format === 'UNAVAILABLE' && (
            <p className={styles.diffUnavailable} role="status">
              {GATE2_TEXT_DIFF_UNAVAILABLE_MESSAGE}
            </p>
          )}
          {operationDiff.format === 'UNIFIED' && operationDiff.unifiedDiff !== undefined && (
            <>
              {operationDiff.truncated && operationDiff.truncationMessage !== undefined && (
                <p className={styles.diffTruncationWarning} role="status">
                  {operationDiff.truncationMessage ?? GATE2_DIFF_TRUNCATION_MESSAGE}
                </p>
              )}
              <pre
                className={styles.unifiedDiffPre}
                aria-label={`Unified diff for ${operationDiff.logicalPath}`}
                tabIndex={0}
              >
                <code>{renderDiffLines(operationDiff.unifiedDiff)}</code>
              </pre>
            </>
          )}
        </div>
      </details>
    </li>
  );
}

function ChecksumMetadata({ operationDiff }: { readonly operationDiff: Gate2OperationDiff }) {
  const items: string[] = [];
  if (operationDiff.baselineContentChecksum !== undefined) {
    items.push(`Baseline ${abbreviateChecksum(operationDiff.baselineContentChecksum)}`);
  }
  if (operationDiff.proposedContentChecksum !== undefined) {
    items.push(`Proposed ${abbreviateChecksum(operationDiff.proposedContentChecksum)}`);
  }
  if (items.length === 0) return null;
  return <p className={styles.diffChecksums}>{items.join(' · ')}</p>;
}

function renderDiffLines(unifiedDiff: string) {
  return unifiedDiff.split('\n').map((line, index) => {
    const className =
      line.startsWith('+') && !line.startsWith('+++')
        ? styles.diffAddedLine
        : line.startsWith('-') && !line.startsWith('---')
          ? styles.diffRemovedLine
          : line.startsWith('@@')
            ? styles.diffHunkHeader
            : styles.diffContextLine;
    return (
      <span className={className} key={`${index}-${line}`}>
        {line.length === 0 ? '\u00A0' : line}
        {'\n'}
      </span>
    );
  });
}

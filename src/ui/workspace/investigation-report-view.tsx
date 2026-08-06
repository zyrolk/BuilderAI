import type { WorkspaceInvestigation } from '../../application/workspace/investigation';
import styles from './workspace.module.css';

interface InvestigationReportViewProps {
  readonly investigation?: WorkspaceInvestigation;
  readonly onSaveToMemory?: () => void;
  readonly memorySaveState?: 'idle' | 'saving' | 'saved' | 'error';
}

export function InvestigationReportView({
  investigation,
  onSaveToMemory,
  memorySaveState = 'idle',
}: InvestigationReportViewProps) {
  if (investigation === undefined) {
    return (
      <div className={styles.emptyResult} role="status">
        <span aria-hidden="true">?</span>
        <p>An investigation report will appear after you run Investigate.</p>
      </div>
    );
  }

  const { report } = investigation;

  return (
    <div className={styles.resultContent}>
      {investigation.bounded && (
        <section className={styles.operatorGuidance} role="status">
          <h3>Bounded investigation</h3>
          <p>
            Repository search and evidence selection were capped by configured limits. Results may
            not reflect the full repository.
          </p>
        </section>
      )}

      <section>
        <h3>Summary</h3>
        <p>{report.summary}</p>
        <p className={styles.investigationMeta}>
          Confidence: <strong>{report.confidence}</strong>
          {' · '}
          Investigation ID: <code>{report.investigationId}</code>
        </p>
      </section>

      {report.likelyRootCause !== undefined && (
        <section>
          <h3>Likely root cause</h3>
          <p>{report.likelyRootCause}</p>
        </section>
      )}

      <section>
        <h3>Hypotheses</h3>
        <ol className={styles.investigationList}>
          {report.hypotheses.map((hypothesis, index) => (
            <li key={`${index}-${hypothesis.summary}`}>
              <p>
                <span className={styles.claimBadge}>{hypothesis.claimKind}</span>{' '}
                {hypothesis.summary}
              </p>
              {hypothesis.supportingEvidencePaths.length > 0 && (
                <p className={styles.investigationMeta}>
                  Evidence paths: {hypothesis.supportingEvidencePaths.join(', ')}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3>Evidence</h3>
        <ol className={styles.investigationList}>
          {report.evidence.map((entry) => (
            <li key={`${entry.logicalPath}-${entry.lineStart ?? 0}-${entry.reason}`}>
              <p>
                <span className={styles.claimBadge}>{entry.claimKind}</span>{' '}
                <code>{entry.logicalPath}</code>
                {entry.lineStart !== undefined ? `:${entry.lineStart}` : ''}
              </p>
              <p>{entry.reason}</p>
              {entry.excerpt !== undefined && (
                <pre className={styles.investigationExcerpt}>{entry.excerpt}</pre>
              )}
            </li>
          ))}
        </ol>
      </section>

      {report.affectedAreas.length > 0 && (
        <section>
          <h3>Affected areas</h3>
          <ul className={styles.investigationList}>
            {report.affectedAreas.map((area) => (
              <li key={area}>
                <code>{area}</code>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.limitations.length > 0 && (
        <section>
          <h3>Limitations</h3>
          <ul className={styles.investigationList}>
            {report.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Recommended next steps</h3>
        <ol className={styles.investigationList}>
          {report.recommendedNextSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      {report.suggestedFixScope !== undefined && (
        <section>
          <h3>Suggested fix scope</h3>
          <p>{report.suggestedFixScope}</p>
        </section>
      )}

      {onSaveToMemory !== undefined && (
        <section className={styles.investigationActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={memorySaveState === 'saving' || memorySaveState === 'saved'}
            onClick={onSaveToMemory}
          >
            {memorySaveState === 'saving'
              ? 'Saving…'
              : memorySaveState === 'saved'
                ? 'Saved to project memory'
                : 'Save to project memory'}
          </button>
          {memorySaveState === 'error' && <p role="alert">Project memory could not be saved.</p>}
        </section>
      )}
    </div>
  );
}

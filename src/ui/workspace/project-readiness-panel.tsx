import type { ExternalTargetReadiness } from '../../application/workspace/external-target-readiness';
import styles from './workspace.module.css';

interface ProjectReadinessPanelProps {
  readonly readiness: ExternalTargetReadiness;
}

export function ProjectReadinessPanel({ readiness }: ProjectReadinessPanelProps) {
  return (
    <div className={styles.sidebarBlock} aria-labelledby="project-readiness-title">
      <p className={styles.eyebrow}>Connected project</p>
      <h2 id="project-readiness-title" className={styles.readinessTitle}>
        {readiness.projectName}
      </h2>
      <p className={styles.projectId}>{readiness.projectId}</p>
      <p className={styles.readinessMeta}>
        <span>Profile: EXTERNAL_TARGET</span>
        <span>Root: {readiness.projectRootDisplay}</span>
        <span>Indexed files: {readiness.indexedFileCount}</span>
      </p>
      <p className={readinessStatusClass(readiness.status)}>
        {readinessStatusLabel(readiness.status)}
      </p>

      <div className={styles.readinessSection}>
        <p className={styles.sidebarLabel}>Source roots</p>
        <ul className={styles.readinessList}>
          {readiness.sourceRoots.slice(0, 8).map((root) => (
            <li key={root}>{root}</li>
          ))}
          {readiness.sourceRoots.length > 8 ? (
            <li>+{readiness.sourceRoots.length - 8} more</li>
          ) : null}
        </ul>
      </div>

      {readiness.testRoots.length > 0 ? (
        <div className={styles.readinessSection}>
          <p className={styles.sidebarLabel}>Test roots</p>
          <ul className={styles.readinessList}>
            {readiness.testRoots.map((root) => (
              <li key={root}>{root}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.readinessSection}>
        <p className={styles.sidebarLabel}>Governance docs</p>
        <ul className={styles.readinessList}>
          {readiness.governanceDocuments.map((docPath) => (
            <li key={docPath}>{docPath}</li>
          ))}
        </ul>
      </div>

      {readiness.protectedAreas.length > 0 ? (
        <div className={styles.readinessSection}>
          <p className={styles.sidebarLabel}>Protected areas</p>
          <ul className={styles.readinessList}>
            {readiness.protectedAreas.map(({ path, classification }) => (
              <li key={path}>
                <span>{path}</span>
                <span className={styles.readinessTag}>{classification}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.readinessSection}>
        <p className={styles.sidebarLabel}>Verification</p>
        <ul className={styles.readinessChecks}>
          <li>{readiness.verification.build ? 'Build available' : 'Build unavailable'}</li>
          <li>{readiness.verification.test ? 'Test available' : 'Test unavailable'}</li>
          <li>{readiness.verification.lint ? 'Lint available' : 'Lint unavailable'}</li>
          <li>
            {readiness.verification.typecheck ? 'Typecheck available' : 'Typecheck unavailable'}
          </li>
        </ul>
      </div>

      {readiness.warnings.length > 0 ? (
        <div className={styles.readinessIssues}>
          <p className={styles.sidebarLabel}>Warnings</p>
          {readiness.warnings.map((issue) => (
            <div key={`${issue.code}:${issue.message}`} className={styles.readinessWarning}>
              <strong>{issue.code}</strong>
              <p>{issue.message}</p>
              {issue.remediation ? (
                <p className={styles.readinessRemediation}>{issue.remediation}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {readiness.blockers.length > 0 ? (
        <div className={styles.readinessIssues}>
          <p className={styles.sidebarLabel}>Blockers</p>
          {readiness.blockers.map((issue) => (
            <div key={`${issue.code}:${issue.message}`} className={styles.readinessBlocker}>
              <strong>{issue.code}</strong>
              <p>{issue.message}</p>
              {issue.remediation ? (
                <p className={styles.readinessRemediation}>{issue.remediation}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function readinessStatusLabel(status: ExternalTargetReadiness['status']): string {
  if (status === 'READY') return 'Ready';
  if (status === 'READY_WITH_WARNINGS') return 'Ready with warnings';
  return 'Blocked';
}

function readinessStatusClass(status: ExternalTargetReadiness['status']): string {
  if (status === 'READY') return styles.readinessReady ?? '';
  if (status === 'READY_WITH_WARNINGS') return styles.readinessWarningStatus ?? '';
  return styles.readinessBlocked ?? '';
}

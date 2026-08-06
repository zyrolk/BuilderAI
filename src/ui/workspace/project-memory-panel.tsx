'use client';

import type { ExternalTargetProjectMemory } from '../../application/workspace/project-memory';
import styles from './workspace.module.css';

interface ProjectMemoryPanelProps {
  readonly memory?: ExternalTargetProjectMemory;
  readonly loading?: boolean;
  readonly error?: string;
}

export function ProjectMemoryPanel({ memory, loading = false, error }: ProjectMemoryPanelProps) {
  if (loading) {
    return (
      <section className={styles.memoryPanel} aria-busy="true">
        <h3>Project Memory</h3>
        <p>Loading durable project memory…</p>
      </section>
    );
  }

  if (error !== undefined) {
    return (
      <section className={styles.memoryPanel} role="alert">
        <h3>Project Memory</h3>
        <p>{error}</p>
      </section>
    );
  }

  if (memory === undefined || memory.projectId === 'unavailable') {
    return (
      <section className={styles.memoryPanel}>
        <h3>Project Memory</h3>
        <p>Durable project memory is available for external target projects only.</p>
      </section>
    );
  }

  const sections = [
    { title: 'Decisions', records: memory.decisions },
    { title: 'Completed Work', records: memory.completedWork },
    { title: 'Investigations', records: memory.investigations },
    { title: 'Findings', records: memory.findings },
  ] as const;

  const totalRecords = sections.reduce((count, section) => count + section.records.length, 0);

  return (
    <section className={styles.memoryPanel}>
      <div className={styles.memoryPanelHeader}>
        <h3>Project Memory</h3>
        <p className={styles.investigationMeta}>
          {totalRecords} record{totalRecords === 1 ? '' : 's'} · updated {memory.updatedAt}
        </p>
      </div>
      {totalRecords === 0 ? (
        <p>No durable project memory has been saved yet.</p>
      ) : (
        sections.map(({ title, records }) =>
          records.length === 0 ? null : (
            <section key={title} className={styles.memorySection}>
              <h4>{title}</h4>
              <ol className={styles.investigationList}>
                {records.map((record) => (
                  <li key={record.id}>
                    <p>{record.summary}</p>
                    <p className={styles.investigationMeta}>
                      {record.category} · {record.source} · {record.updatedAt}
                    </p>
                    {record.supportingPaths.length > 0 && (
                      <p className={styles.investigationMeta}>
                        Paths: {record.supportingPaths.join(', ')}
                      </p>
                    )}
                    {record.tags !== undefined && record.tags.length > 0 && (
                      <p className={styles.investigationMeta}>Tags: {record.tags.join(', ')}</p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ),
        )
      )}
    </section>
  );
}

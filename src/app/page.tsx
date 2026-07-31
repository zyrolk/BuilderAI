import Link from 'next/link';

import { loadCanonicalProjectBrain } from '../core/project-brain';
import styles from './page.module.css';

export default function HomePage() {
  const project = loadCanonicalProjectBrain();
  const latestSprint = project.progressLog.completedSprints.at(-1);
  const doneTasks = project.tasks.filter(({ status }) => status === 'DONE').length;

  return (
    <main className={styles.dashboard}>
      <nav className={styles.nav} aria-label="Primary navigation">
        <Link className={styles.brand} href="/" aria-label="BuilderAI dashboard">
          <span aria-hidden="true">B</span>
          BuilderAI
        </Link>
        <div className={styles.navLinks}>
          <Link aria-current="page" href="/">
            Dashboard
          </Link>
          <Link href="/workspace">Workspace</Link>
        </div>
        <span className={styles.localBadge}>
          <span aria-hidden="true" />
          Local project
        </span>
      </nav>

      <div className={styles.content}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Project dashboard</p>
            <h1>{project.blueprint.name}</h1>
            <p>{project.blueprint.vision}</p>
          </div>
          <Link className={styles.primaryAction} href="/workspace">
            Open project workspace <span aria-hidden="true">→</span>
          </Link>
        </header>

        <section className={styles.stats} aria-label="Project status">
          <StatusCard
            label="Current milestone"
            value={project.progressLog.currentMilestone}
            accent
          />
          <StatusCard
            label="Completed sprints"
            value={project.progressLog.completedSprints.length}
          />
          <StatusCard label="Completed tasks" value={doneTasks} />
          <StatusCard label="Owned modules" value={project.blueprint.folderOwnership.length} />
        </section>

        <div className={styles.dashboardGrid}>
          <section className={styles.architectureCard} aria-labelledby="architecture-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Architecture</p>
                <h2 id="architecture-title">Engine pipeline</h2>
              </div>
              <span>Provider independent core</span>
            </div>
            <ol className={styles.pipeline}>
              {[
                ['01', 'Project Brain', 'Canonical project truth'],
                ['02', 'Context + Prompt', 'Task-scoped orchestration'],
                ['03', 'Provider + Response', 'Validated output package'],
                ['04', 'Change Plan', 'Reviewable file intent'],
                ['05', 'Safe Apply', 'Protected file operations'],
                ['06', 'Verification', 'Build and test evidence'],
              ].map(([number, title, description]) => (
                <li key={number}>
                  <span>{number}</span>
                  <div>
                    <strong>{title}</strong>
                    <p>{description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <aside className={styles.activityCard} aria-labelledby="activity-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Delivery</p>
                <h2 id="activity-title">Latest activity</h2>
              </div>
            </div>
            {latestSprint ? (
              <article className={styles.sprintSummary}>
                <span>Completed sprint</span>
                <h3>{latestSprint.name}</h3>
                <p>{latestSprint.outcome}</p>
                <dl>
                  <div>
                    <dt>Tasks</dt>
                    <dd>{latestSprint.completedTaskIds.length}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>Complete</dd>
                  </div>
                </dl>
              </article>
            ) : (
              <p>No completed sprint has been recorded.</p>
            )}
          </aside>
        </div>

        <section className={styles.workspaceCta} aria-labelledby="workspace-cta-title">
          <div>
            <p className={styles.eyebrow}>Human-controlled workflow</p>
            <h2 id="workspace-cta-title">Plan, review, approve, verify.</h2>
            <p>
              Every project change remains visible and requires an explicit approval checkpoint.
            </p>
          </div>
          <Link href="/workspace">Enter workspace</Link>
        </section>
      </div>
    </main>
  );
}

function StatusCard({
  label,
  value,
  accent = false,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly accent?: boolean;
}) {
  return (
    <article className={accent ? styles.accentCard : styles.statusCard}>
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

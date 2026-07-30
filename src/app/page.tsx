import styles from './page.module.css';

export default function HomePage() {
  return (
    <main className={styles.main}>
      <section className={styles.panel} aria-labelledby="page-title">
        <p className={styles.eyebrow}>Project foundation</p>
        <h1 id="page-title">BuilderAI</h1>
        <p>The engineering baseline is ready. Product capabilities will be added deliberately.</p>
      </section>
    </main>
  );
}

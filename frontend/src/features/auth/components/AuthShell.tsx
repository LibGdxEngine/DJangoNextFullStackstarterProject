import Link from "next/link";
import styles from "./AuthShell.module.css";

export function AuthShell({ title, description, children, footer }: { title: string; description: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <main className={styles.page}>
      <Link href="/" className={styles.brand}>مبصر</Link>
      <section className={styles.card}>
        <header className={styles.header}><h1>{title}</h1><p>{description}</p></header>
        {children}
        <div className={styles.footer}>{footer}</div>
      </section>
    </main>
  );
}

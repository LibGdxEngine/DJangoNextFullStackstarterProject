"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./landing.module.css";

export function ScannerScene() {
  const [paused, setPaused] = useState(false);

  return (
    <div className={`${styles.scene} ${paused ? styles.scenePaused : ""}`}>
      <div className={styles.sceneGlow} aria-hidden="true" />
      <div className={styles.imageFrame}>
        <Image src="/images/mobser-scanner.webp" width={1024} height={1024} priority sizes="(max-width: 900px) 92vw, 48vw" alt="هاتف ذكي يمسح وثيقة عربية" className={styles.scannerImage} />
        <span className={styles.scanLine} aria-hidden="true" />
      </div>
      <div className={styles.resultCard}>
        <span className={styles.resultLabel}><i aria-hidden="true" /> تم استخراج النص</span>
        <p>المعرفة تبدأ بكلمة.</p>
        <span className={styles.resultMeta}>نص عربي قابل للنسخ</span>
        <span className={styles.orbit} aria-hidden="true"><span className={styles.searchIcon}><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.7" /><path d="m15 15 4 4" /></svg></span></span>
      </div>
      <button type="button" className={styles.motionButton} aria-label={paused ? "استئناف حركة المشهد" : "إيقاف حركة المشهد"} aria-pressed={paused} onClick={() => setPaused((current) => !current)}><span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span>{paused ? "تشغيل الحركة" : "إيقاف الحركة"}</button>
    </div>
  );
}

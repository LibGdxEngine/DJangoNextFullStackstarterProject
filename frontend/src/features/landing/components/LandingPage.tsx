"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { ScannerScene } from "./ScannerScene";
import styles from "./landing.module.css";

const navigation = [
  { label: "مبصر", href: "#home" },
  { label: "ما هو نموذج مبصر", href: "#model" },
  { label: "من نحن", href: "#about" },
  { label: "ابدأ الآن", href: "#start" },
  { label: "تواصل معنا", href: "#contact" },
  { label: "خاتمة", href: "#closing" },
];

const steps = [
  { number: "١", icon: "↥", title: "ارفع الصورة", description: "اختر صورة واضحة تحتوي على النص العربي الذي تريد استخراجه." },
  { number: "٢", icon: "⌁", title: "استخرج النص", description: "يعالج مبصر الصورة ويحوّل ما فيها إلى نص عربي قابل للقراءة." },
  { number: "٣", icon: "✓", title: "راجع وانسخ", description: "راجع النتيجة ثم انسخ النص لاستخدامه حيث تحتاج إليه." },
];

export function LandingPage({ contactEmail }: { contactEmail?: string }) {
  const { data: session, status } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  const signedIn = status === "authenticated" && Boolean(session?.backendAuthenticated);
  const primaryHref = signedIn ? "/account" : "/register";
  const primaryLabel = signedIn ? "الانتقال إلى حسابي" : "ابدأ الآن";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.navShell}>
          <a className={styles.brand} href="#home" aria-label="مبصر، العودة إلى بداية الصفحة"><span className={styles.brandMark} aria-hidden="true">م</span><span>مبصر</span></a>
          <nav className={styles.desktopNav} aria-label="التنقل الرئيسي">
            {navigation.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
          </nav>
          <div className={styles.authActions}>
            {signedIn ? <Link className={styles.registerButton} href="/account">حسابي</Link> : <><Link className={styles.loginLink} href="/login">تسجيل الدخول</Link><Link className={styles.registerButton} href="/register">إنشاء حساب</Link></>}
          </div>
          <button className={styles.menuButton} type="button" aria-label={menuOpen ? "إغلاق القائمة" : "فتح القائمة"} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen((current) => !current)}>
            <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
          </button>
        </div>
        <div
          id="mobile-navigation"
          className={`${styles.mobileNav} ${menuOpen ? styles.mobileNavOpen : ""}`}
          aria-hidden={!menuOpen}
          inert={!menuOpen}
        >
          <nav aria-label="التنقل على الهاتف">
            {navigation.map((item) => <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>{item.label}</a>)}
            <div className={styles.mobileAuth}>
              {!signedIn && <Link href="/login" onClick={() => setMenuOpen(false)}>تسجيل الدخول</Link>}
              <Link className={styles.registerButton} href={signedIn ? "/account" : "/register"} onClick={() => setMenuOpen(false)}>{signedIn ? "حسابي" : "إنشاء حساب"}</Link>
            </div>
          </nav>
        </div>
      </header>

      <section id="home" className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}><span /> قراءة عربية بوضوح</div>
          <h1>من الصورة إلى<br /><em>نص عربي</em></h1>
          <p>استخرج النص العربي من صورك، ثم راجعه وانسخه بسهولة. تجربة بسيطة صُممت لتجعل الوصول إلى كلماتك أسرع.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href={primaryHref}>{primaryLabel}<span aria-hidden="true">←</span></Link>
            <a className={styles.secondaryButton} href="#model">اكتشف كيف يعمل</a>
          </div>
          <div className={styles.heroNote}><span className={styles.noteIcon} aria-hidden="true">✓</span>خطوات واضحة ونتيجة قابلة للمراجعة والنسخ</div>
        </div>
        <ScannerScene />
      </section>

      <section id="model" className={styles.modelSection}>
        <div className={styles.sectionIntro}><span className={styles.sectionLabel}>ما هو نموذج مبصر؟</span><h2>ثلاث خطوات تفصل صورتك عن النص</h2><p>مسار مباشر يساعدك على استخراج المحتوى العربي من الصورة والتعامل معه كنص قابل للنسخ.</p></div>
        <div className={styles.stepsGrid}>
          {steps.map((step) => <article key={step.number} className={styles.stepCard}><span className={styles.stepNumber} aria-hidden="true">{step.number}</span><div className={styles.stepIcon} aria-hidden="true">{step.icon}</div><h3>{step.title}</h3><p>{step.description}</p></article>)}
        </div>
      </section>

      <section id="about" className={styles.aboutSection}>
        <div className={styles.aboutArt} aria-hidden="true"><span className={styles.aboutLetter}>م</span><span className={styles.aboutRing} /><span className={styles.aboutDotOne} /><span className={styles.aboutDotTwo} /></div>
        <div className={styles.aboutCopy}><span className={styles.sectionLabel}>من نحن</span><h2>نقرّب النص العربي من الجميع</h2><p>مبصر مشروع يهدف إلى تسهيل التعامل مع النص العربي الموجود داخل الصور، وتحويله إلى محتوى يمكن قراءته ومراجعته واستخدامه من جديد.</p><p>نبني تجربة هادئة ومباشرة، تهتم باللغة العربية وتضع الوضوح وسهولة الاستخدام في المقدمة.</p></div>
      </section>

      <section id="start" className={styles.startSection}>
        <div><span className={styles.lightLabel}>ابدأ الآن</span><h2>كلماتك أقرب مما تتخيّل</h2><p>أنشئ حسابك لتكون مستعدًا عند إطلاق تجربة استخراج النص.</p><small>واجهة استخراج النص قيد التجهيز.</small></div>
        <Link className={styles.lightButton} href={primaryHref}>{primaryLabel}<span aria-hidden="true">←</span></Link>
      </section>

      <section id="contact" className={styles.contactSection}>
        <span className={styles.sectionLabel}>تواصل معنا</span><h2>يسعدنا أن نسمع منك</h2>
        {contactEmail ? <p>للاستفسارات والملاحظات، راسلنا عبر <a href={`mailto:${contactEmail}`} dir="ltr">{contactEmail}</a></p> : <p>نعمل على تجهيز قناة التواصل الرسمية، وسيُعلن عنها هنا قريبًا.</p>}
      </section>

      <footer id="closing" className={styles.footer}>
        <div className={styles.footerTop}>
          <div className={styles.footerBrand}><span className={styles.brandMark} aria-hidden="true">م</span><div><strong>مبصر</strong><p>نحو محتوى عربي أسهل وصولًا واستخدامًا.</p></div></div>
          <nav aria-label="روابط ختامية"><a href="#model">ما هو مبصر؟</a><a href="#about">من نحن</a><a href="#contact">تواصل معنا</a></nav>
          <Link className={styles.footerCta} href={primaryHref}>{signedIn ? "حسابي" : "ابدأ الآن"}</Link>
        </div>
        <div className={styles.footerBottom}><span>© {new Date().getFullYear()} مبصر</span><a href="#home">العودة إلى الأعلى ↑</a></div>
      </footer>
    </main>
  );
}

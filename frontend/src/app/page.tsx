import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  Check,
  Globe2,
  HeartHandshake,
  Languages,
  LineChart,
  LogIn,
  Mic,
  ScrollText,
  Sparkles,
  UserRound,
} from "lucide-react";
import { LogoMark } from "@/components/shells/ShellParts";
import { site } from "@/config/site";
import cover from "../../public/landing/cover.png";

/*
 * Public landing page for international, mostly non-Arabic-speaking families and adults.
 * Always English and left-to-right, whatever locale the app workspaces use.
 */

// The teacher portrait is optional: until public/landing/ahmed-fathy.jpg exists, the arch shows the cover art.
const hasTeacherPhoto = fs.existsSync(path.join(process.cwd(), "public", site.teacher.photo));

const programs = [
  { icon: BookOpen, title: "Quran reading from zero", body: "Noorani Qaida for complete beginners, children and adults alike: letters, vowels and joining, until you read fluently from the mushaf." },
  { icon: Mic, title: "Tajweed & recitation", body: "Correct pronunciation (makharij) and the rules of tajweed, practised aloud every lesson with instant, gentle correction." },
  { icon: ScrollText, title: "Hifz memorisation", body: "A structured memorisation plan with daily revision targets, paced to the student's age and goals." },
  { icon: Languages, title: "Arabic for non-Arabic speakers", body: "Build the Arabic you need to understand what you recite, explained step by step in clear English." },
];

const steps = [
  { title: "Book a free trial", body: "Tell us the student's age, level and time zone, and what you would like to achieve." },
  { title: "Meet your teacher", body: "A 30-minute assessment lesson online. No obligation and no card needed." },
  { title: "Choose a package", body: "Pick 2, 3 or 4 lessons a week and get a fixed weekly timetable that suits your family." },
];

const included = [
  "Private one-to-one lessons, 30 minutes each",
  "A personal plan for every student",
  "Lesson report after every class",
  "Progress tracking for parents",
  "Times across UK, US, Canada, Europe & Gulf time zones",
  "Reschedule with notice from your family dashboard",
];

const faqs = [
  { q: "My child doesn't speak Arabic. Is that a problem?", a: "Not at all. The academy is built for non-Arabic speakers. Lessons are explained in English, and the Arabic needed to read the Quran is taught step by step." },
  { q: "Are lessons suitable for adults?", a: "Yes. Many students are adults starting from zero or returning to the Quran. Lessons are patient, private and judgement-free." },
  { q: "What do we need for lessons?", a: "A laptop or tablet with a camera, headphones and a stable internet connection. You receive the lesson link before each class." },
  { q: "Can siblings share a package?", a: "Each package is per student, because every lesson is one-to-one. Each sibling gets their own timetable and plan." },
  { q: "What if we miss a lesson?", a: "Cancel with enough notice from your family dashboard and the lesson stays on your balance to reschedule." },
];

function Pattern({ className, id }: { className?: string; id: string }) {
  // Eight-point star lattice echoing the geometric motif on the academy cover.
  return (
    <svg aria-hidden className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id={id} width="64" height="64" patternUnits="userSpaceOnUse">
          <rect x="22" y="22" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1" />
          <rect x="22" y="22" width="20" height="20" transform="rotate(45 32 32)" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

function Divider({ className }: { className?: string }) {
  return (
    <div aria-hidden className={`flex items-center gap-3 ${className ?? ""}`}>
      <span className="h-px flex-1 bg-accent-400/60" />
      <svg width="18" height="18" viewBox="0 0 20 20" className="text-accent-600">
        <rect x="5" y="5" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <rect x="5" y="5" width="10" height="10" transform="rotate(45 10 10)" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
      <span className="h-px flex-1 bg-accent-400/60" />
    </div>
  );
}

function TeacherArch() {
  return (
    <figure className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-5 rounded-t-full bg-accent-400/20 blur-2xl" aria-hidden />
      <div className="relative rounded-t-full border border-accent-border bg-brand-50 p-3 shadow-dialog">
        <div className="relative aspect-[4/5] overflow-hidden rounded-t-full bg-brand-100">
          {hasTeacherPhoto ? (
            <Image src={site.teacher.photo} alt={`${site.teacher.name}, ${site.teacher.role}`} fill priority sizes="(min-width: 768px) 384px, 90vw" className="object-cover object-[50%_45%]" />
          ) : (
            <Image src={cover} alt="" fill priority sizes="(min-width: 768px) 384px, 90vw" className="object-cover object-[8%_50%]" />
          )}
        </div>
      </div>
      <figcaption className="relative mx-auto -mt-8 w-[85%] rounded-card border border-line-soft bg-surface px-5 py-3 text-center shadow-popover">
        <p className="text-base font-semibold text-brand-900">{site.teacher.name}</p>
        <p className="text-xs text-muted">{site.teacher.role}, {site.name.en}</p>
      </figcaption>
    </figure>
  );
}

export default function LandingPage() {
  return (
    <div lang="en" dir="ltr" className="min-h-dvh bg-page text-ink">
      <header className="sticky top-0 z-30 border-b border-line-soft bg-page/85 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark />
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold text-brand-900">{site.name.en}</span>
              <span lang="ar" className="block font-arabic text-[11px] text-muted">{site.name.ar}</span>
            </span>
          </Link>
          <div className="hidden items-center gap-6 text-sm text-secondary md:flex">
            <a href="#programs" className="hover:text-brand-800">Programmes</a>
            <a href="#how" className="hover:text-brand-800">How it works</a>
            <a href="#packages" className="hover:text-brand-800">Packages</a>
            <a href="#faq" className="hover:text-brand-800">FAQ</a>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/sign-in" className="hidden h-9 items-center gap-1.5 rounded-control px-3 text-sm font-medium text-secondary hover:bg-subtle sm:inline-flex">
              <LogIn aria-hidden className="size-4" />Sign in
            </Link>
            <a href="#packages" className="inline-flex h-9 items-center rounded-control bg-brand-800 px-4 text-sm font-medium text-white hover:bg-brand-700">
              Free trial
            </a>
          </div>
        </nav>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 via-brand-50 to-brand-100">
          <Pattern id="hero-pattern" className="absolute inset-0 h-full w-full text-accent-400/15" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 py-16 md:grid-cols-[1.15fr_1fr] md:py-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-accent-border bg-surface/80 px-3 py-1 text-xs font-medium text-accent-ink">
                <Globe2 aria-hidden className="size-3.5" />For non-Arabic speakers worldwide
              </p>
              <h1 className="mt-6 font-serif text-4xl font-bold uppercase leading-[1.05] tracking-wide text-brand-800 sm:text-6xl">
                Imam Malek
                <span className="block text-3xl text-accent-600 sm:text-[2.6rem]">Quran Academy</span>
              </h1>
              <p className="mt-3 text-lg font-medium text-brand-950">With {site.teacher.name}</p>
              <Divider className="mt-5 max-w-sm" />
              <p className="mt-5 text-2xl font-semibold text-brand-950">Learn Qur&apos;an &amp; Arabic online</p>
              <p className="mt-3 max-w-xl leading-relaxed text-secondary">
                Private 30-minute lessons for children and adults across the UK, US, Canada, Europe and the Gulf,
                explained in clear English, at fixed weekly times that fit your family.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#packages" className="inline-flex h-12 items-center gap-2 rounded-control bg-brand-800 px-6 text-sm font-semibold text-white shadow-popover hover:bg-brand-700">
                  Book a free trial lesson<ArrowRight aria-hidden className="size-4" />
                </a>
                <a href="#packages" className="inline-flex h-12 items-center rounded-control border border-accent-border bg-surface px-6 text-sm font-semibold text-brand-900 hover:border-accent-400">
                  Packages from ${site.packages[0].price}
                </a>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-secondary">
                {["One-to-one lessons", "No Arabic needed", "Free assessment"].map((item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <Check aria-hidden className="size-4 text-accent-600" />{item}
                  </li>
                ))}
              </ul>
            </div>
            <TeacherArch />
          </div>
        </section>

        {/* Trust strip */}
        <section className="border-y border-line-soft bg-surface">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-8 text-center sm:grid-cols-4">
            {[
              { icon: UserRound, label: "Personal teacher" },
              { icon: CalendarClock, label: "Your time zone" },
              { icon: LineChart, label: "Reports after every class" },
              { icon: HeartHandshake, label: "Patient & child-friendly" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-2">
                <Icon aria-hidden className="size-6 text-accent-600" />
                <span className="text-sm font-medium text-secondary">{label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Programmes */}
        <section id="programs" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-accent-600">Programmes</p>
            <h2 className="mt-2 font-serif text-3xl font-bold text-brand-800">A clear path for every level</h2>
            <p className="mt-3 text-secondary">From the first Arabic letter to memorising whole surahs, each student follows a plan built around their age and goals.</p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {programs.map(({ icon: Icon, title, body }) => (
              <article key={title} className="rounded-card border border-line-soft bg-surface p-6 transition hover:border-accent-border hover:shadow-popover">
                <span className="flex size-11 items-center justify-center rounded-xl bg-brand-100 text-brand-800">
                  <Icon aria-hidden className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold text-brand-950">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Cover banner */}
        <section aria-label={`${site.name.en} with ${site.teacher.name}`} className="mx-auto max-w-6xl px-4">
          <div className="overflow-hidden rounded-class border border-line-soft shadow-popover">
            <Image src={cover} alt={`${site.name.en} with ${site.teacher.name}: learn Qur'an and Arabic online, for non-Arabic speakers worldwide`} sizes="(min-width: 1152px) 1152px, 100vw" className="h-auto w-full" placeholder="blur" />
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-600">How it works</p>
          <h2 className="mt-2 font-serif text-3xl font-bold text-brand-800">Start in three simple steps</h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {steps.map(({ title, body }, i) => (
              <li key={title} className="rounded-card border border-line-soft bg-surface p-6">
                <span className="flex size-10 items-center justify-center rounded-full bg-brand-800 font-serif text-base font-bold text-brand-50">{i + 1}</span>
                <h3 className="mt-4 font-semibold text-brand-950">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Packages */}
        <section id="packages" className="scroll-mt-20 bg-brand-50">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-wider text-accent-600">Packages</p>
              <h2 className="mt-2 font-serif text-3xl font-bold text-brand-800">Simple four-weekly packages</h2>
              <p className="mt-3 text-secondary">Private one-to-one lessons of 30 minutes. Prices in USD, per student, billed every four weeks.</p>
            </div>
            <div className="mt-14 grid items-stretch gap-5 md:grid-cols-3">
              {site.packages.map((pkg) => (
                <article
                  key={pkg.name}
                  className={
                    pkg.recommended
                      ? "relative flex flex-col rounded-class bg-brand-800 p-7 text-white shadow-dialog md:-my-4 md:py-11"
                      : "relative flex flex-col rounded-class border border-line bg-surface p-7"
                  }
                >
                  {pkg.recommended && (
                    <span className="absolute -top-3 left-7 inline-flex items-center gap-1 rounded-full bg-accent-400 px-3 py-1 text-xs font-semibold text-white">
                      <Sparkles aria-hidden className="size-3.5" />Recommended
                    </span>
                  )}
                  <h3 className="font-serif text-xl font-bold">{pkg.name}</h3>
                  <p className={pkg.recommended ? "text-sm text-brand-300" : "text-sm text-muted"}>{pkg.perWeek} lessons per week</p>
                  <p className="mt-6 flex items-baseline gap-1">
                    <span className="text-5xl font-semibold tracking-tight">${pkg.price}</span>
                    <span className={pkg.recommended ? "text-sm text-brand-300" : "text-sm text-muted"}>/ 4 weeks</span>
                  </p>
                  <p className={pkg.recommended ? "mt-1 text-xs text-brand-300" : "mt-1 text-xs text-muted"}>
                    about ${(pkg.price / pkg.lessons).toFixed(2)} per lesson
                  </p>
                  <ul className="mt-6 flex-1 space-y-3 text-sm">
                    {[`${pkg.lessons} lessons every four weeks`, `${pkg.hours} hours of one-to-one teaching`, "30-minute private lessons", "Lesson reports & progress tracking"].map((line) => (
                      <li key={line} className="flex items-start gap-2">
                        <Check aria-hidden className={pkg.recommended ? "mt-0.5 size-4 shrink-0 text-brand-300" : "mt-0.5 size-4 shrink-0 text-accent-600"} />
                        {line}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/sign-in"
                    className={
                      pkg.recommended
                        ? "mt-8 inline-flex h-11 items-center justify-center rounded-control bg-brand-50 text-sm font-semibold text-brand-900 hover:bg-white"
                        : "mt-8 inline-flex h-11 items-center justify-center rounded-control border border-line text-sm font-semibold text-brand-900 hover:border-accent-400"
                    }
                  >
                    Start with a free trial
                  </Link>
                </article>
              ))}
            </div>
            <div className="mx-auto mt-16 max-w-4xl rounded-card border border-line-soft bg-surface p-6 sm:p-8">
              <h3 className="font-semibold text-brand-950">Every package includes</h3>
              <ul className="mt-4 grid gap-3 text-sm text-secondary sm:grid-cols-2">
                {included.map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-600" />{line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20">
          <h2 className="text-center font-serif text-3xl font-bold text-brand-800">Questions parents ask</h2>
          <div className="mt-10 space-y-3">
            {faqs.map(({ q, a }) => (
              <details key={q} className="group rounded-card border border-line-soft bg-surface p-5 open:shadow-popover">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-brand-950">
                  {q}
                  <span aria-hidden className="text-xl leading-none text-accent-600 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="relative overflow-hidden bg-brand-900 text-white">
          <Pattern id="cta-pattern" className="absolute inset-0 h-full w-full text-white/[0.06]" />
          <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-20 text-center">
            <p lang="ar" dir="rtl" className="font-arabic text-2xl text-brand-300">خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ</p>
            <p className="text-sm text-brand-300">&ldquo;The best of you are those who learn the Quran and teach it.&rdquo; (Bukhari)</p>
            <h2 className="max-w-2xl font-serif text-3xl font-bold sm:text-4xl">Give your family a lifelong connection with the Quran</h2>
            <Link href="/sign-in" className="mt-2 inline-flex h-12 items-center gap-2 rounded-control bg-brand-50 px-6 text-sm font-semibold text-brand-900 hover:bg-white">
              Book your free trial<ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line-soft bg-page">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:flex-row">
          <div className="flex items-center gap-2">
            <LogoMark className="size-6" />
            <span>© {new Date().getFullYear()} {site.name.en} · with {site.teacher.name}</span>
          </div>
          <div className="flex gap-5">
            <a href="#packages" className="hover:text-brand-800">Packages</a>
            <a href="#faq" className="hover:text-brand-800">FAQ</a>
            <Link href="/sign-in" className="hover:text-brand-800">Family &amp; staff sign-in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

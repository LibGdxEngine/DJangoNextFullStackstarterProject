/** Identity of the academy this deployment serves (Imam Malek Academy branch). */
export const site = {
  name: { en: "Imam Malek Academy", ar: "أكاديمية الإمام مالك" },
  description: {
    en: "Quran academy management, teacher and family workspaces",
    ar: "إدارة الأكاديمية ومساحات المعلمين والأسر لتحفيظ القرآن الكريم",
  },
  domain: "malek.ic-mobile.tech",
  teacher: { name: "Ahmed Fathy", role: "Founder & lead teacher", photo: "/landing/ahmed-fathy.jpg" },
  /** Private one-to-one lessons, 30 minutes, USD per student per four weeks. Starting prices. */
  packages: [
    { name: "Essential", perWeek: 2, lessons: 8, hours: 4, price: 59, recommended: false },
    { name: "Progress", perWeek: 3, lessons: 12, hours: 6, price: 79, recommended: true },
    { name: "Intensive", perWeek: 4, lessons: 16, hours: 8, price: 99, recommended: false },
  ],
} as const;

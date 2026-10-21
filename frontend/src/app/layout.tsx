import type { Metadata } from "next";
import { Cinzel, IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import SessionProvider from "../components/SessionProvider";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getLocale } from "@/i18n/server";
import { dirOf } from "@/i18n/config";
import { site } from "@/config/site";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
});

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: `${site.name.en} | Learn Qur'an & Arabic Online`,
  description: "Private one-to-one online Quran and Arabic lessons for non-Arabic-speaking children and adults worldwide.",
  applicationName: site.name.en,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      dir={dirOf(locale)}
      className={`${plexSans.variable} ${plexArabic.variable} ${cinzel.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SessionProvider>
          <I18nProvider locale={locale}>
            {children}
          </I18nProvider>
        </SessionProvider>
      </body>
    </html>
  );
}

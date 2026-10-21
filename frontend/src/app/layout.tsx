import type { Metadata } from "next";
import { Readex_Pro } from "next/font/google";
import "./globals.css";
import SessionProvider from "../components/SessionProvider";

const readex = Readex_Pro({
  variable: "--font-readex",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "واصل — موظفك الذكاء الاصطناعي",
    template: "%s · واصل",
  },
  description:
    "واصل موظف ذكاء اصطناعي يعمل في متصفح حقيقي: يجد العملاء ويتواصل معهم، ويدير حملاتك، ويُعدّ العروض والتقارير — من البداية إلى النهاية.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={`${readex.variable} h-full antialiased`}>
      <body className="min-h-full bg-paper text-ink">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}

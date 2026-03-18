import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { SerwistProvider } from "./serwist-provider";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-heebo",
});

export const metadata: Metadata = {
  title: "טירונט",
  description: "מערכת ניהול אימוני טירונות",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    // apple-touch-icon — used by iOS for the home screen icon.
    // appleWebApp alone does not emit this link tag.
    apple: "/icons/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "טירונט",
  },
};

export const viewport: Viewport = {
  themeColor: "#273617",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const messages = await getMessages();

  return (
    <html lang="he" dir="rtl">
      <body className={`${heebo.variable} font-sans antialiased`}>
        <SerwistProvider>
          <NextIntlClientProvider messages={messages}>
            {children}
          </NextIntlClientProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}

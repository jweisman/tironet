import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Toaster } from "@/components/ui/sonner";
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
        {/* Inline splash shown instantly before React/CSS load. Hidden once
            the first child paints. Uses inline styles so it works even when
            stylesheets haven't loaded yet. */}
        <div
          id="app-splash"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#ffffff",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              border: "3px solid #e5e7eb",
              borderTopColor: "#273617",
              borderRadius: "50%",
              animation: "app-splash-spin 0.7s linear infinite",
            }}
          />
          <style
            dangerouslySetInnerHTML={{
              __html: "@keyframes app-splash-spin{to{transform:rotate(360deg)}}",
            }}
          />
        </div>
        <SerwistProvider>
          <NextIntlClientProvider messages={messages}>
            {children}
            <Toaster />
          </NextIntlClientProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}

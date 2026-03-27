import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/contexts/ThemeContext";
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#273617" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1a" },
  ],
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
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <head>
        {/* Inline theme init — runs before paint to set .dark class and avoid flash.
            Reads the user's stored preference from localStorage. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem("tironet:theme")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme:dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${heebo.variable} font-sans antialiased`}>
        {/* Inline splash shown instantly before React/CSS load. Hidden once
            the first child paints. Uses inline styles so it works even when
            stylesheets haven't loaded yet. Colors adapt to dark mode via the
            .dark class set by the inline script above. */}
        <div
          id="app-splash"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `#app-splash{background:#fff}.dark #app-splash{background:#1a1a1a}#app-splash::after{content:"";width:36px;height:36px;border:3px solid #e5e7eb;border-top-color:#273617;border-radius:50%;animation:app-splash-spin .7s linear infinite}.dark #app-splash::after{border-color:#333;border-top-color:#7C9A6D}@keyframes app-splash-spin{to{transform:rotate(360deg)}}`,
          }}
        />
        <SerwistProvider>
          <NextIntlClientProvider messages={messages}>
            <ThemeProvider>
              {children}
              <Toaster />
            </ThemeProvider>
          </NextIntlClientProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}

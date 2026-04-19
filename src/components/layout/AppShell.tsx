"use client";

import { useEffect, useRef } from "react";
import { HelpCircle, LifeBuoy } from "lucide-react";
import Link from "next/link";
import { TabBar } from "./TabBar";
import { Sidebar } from "./Sidebar";
import { UserAvatar } from "./UserAvatar";
import { CyclePicker } from "./CyclePicker";
import { OfflineBanner } from "./OfflineBanner";
import { InstallPrompt } from "./InstallPrompt";
import { SoldierLogo } from "@/components/SoldierLogo";
import { useTourContext } from "@/contexts/TourContext";
export function AppShell({ children }: { children: React.ReactNode }) {
  const headerRef = useRef<HTMLElement>(null);
  const { startCurrentTour } = useTourContext();

  // Dismiss the inline splash screen once the app shell has mounted and
  // painted. This avoids the blank/black gap between splash hide and app
  // render that occurred when SplashDismiss hid it immediately on hydration.
  useEffect(() => {
    performance.mark("appshell-mount");
    requestAnimationFrame(() => {
      const el = document.getElementById("app-splash");
      if (el) el.style.display = "none";
      performance.mark("splash-dismissed");
    });
  }, []);

  // Publish the mobile header height as a CSS variable so child pages
  // can position their own sticky headers below it without DOM queries.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => {
      document.documentElement.style.setProperty(
        "--app-header-height",
        `${el.offsetHeight}px`,
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <OfflineBanner />
      <InstallPrompt />
      {/* Desktop: sidebar on the end (right in RTL) */}
      <Sidebar />

      {/* Main content area — offset from sidebar on desktop, padded for tab bar on mobile */}
      <div className="md:me-64">
        {/* Mobile top bar */}
        <header ref={headerRef} className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <SoldierLogo className="h-7 w-auto text-[#273617] dark:text-[#7C9A6D]" />
            <span className="text-lg font-bold">טירונט</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/support"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted transition-colors"
              aria-label="תמיכה"
            >
              <LifeBuoy size={20} />
            </Link>
            <button
              type="button"
              onClick={startCurrentTour}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted transition-colors"
              aria-label="עזרה"
            >
              <HelpCircle size={20} />
            </button>
            <CyclePicker compact />
            <UserAvatar size={36} />
          </div>
        </header>

        <main className="px-4 py-6 pb-24 md:pb-6">{children}</main>
      </div>

      {/* Mobile: tab bar fixed at bottom */}
      <TabBar />
    </div>
  );
}

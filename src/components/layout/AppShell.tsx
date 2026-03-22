"use client";

import { useEffect } from "react";
import { TabBar } from "./TabBar";
import { Sidebar } from "./Sidebar";
import { UserAvatar } from "./UserAvatar";
import { CyclePicker } from "./CyclePicker";
import { OfflineBanner } from "./OfflineBanner";
import { InstallPrompt } from "./InstallPrompt";
export function AppShell({ children }: { children: React.ReactNode }) {
  // Dismiss the inline splash screen once the app shell has mounted and
  // painted. This avoids the blank/black gap between splash hide and app
  // render that occurred when SplashDismiss hid it immediately on hydration.
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = document.getElementById("app-splash");
      if (el) el.style.display = "none";
    });
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
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <img src="/soldier.svg" alt="" className="h-7 w-auto" />
            <span className="text-lg font-bold">טירונט</span>
          </div>
          <div className="flex items-center gap-2">
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

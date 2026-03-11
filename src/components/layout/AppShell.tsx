"use client";

import { TabBar } from "./TabBar";
import { Sidebar } from "./Sidebar";
import { UserAvatar } from "./UserAvatar";
import { CyclePicker } from "./CyclePicker";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      {/* Desktop: sidebar on the end (right in RTL) */}
      <Sidebar />

      {/* Main content area — offset from sidebar on desktop, padded for tab bar on mobile */}
      <div className="md:me-64">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background px-4 py-3 md:hidden">
          <span className="text-lg font-bold">טירונט</span>
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

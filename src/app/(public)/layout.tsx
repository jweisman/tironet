"use client";

import { useEffect } from "react";
import { InstallPrompt } from "@/components/layout/InstallPrompt";

// Public layout — no app shell, no auth requirement.
// Must dismiss the inline splash spinner (which AppShell handles for
// authenticated routes) so public pages aren't hidden behind it.
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = document.getElementById("app-splash");
      if (el) el.style.display = "none";
    });
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <InstallPrompt />
      <div className="flex-1 flex flex-col">
        {children}
      </div>
    </div>
  );
}

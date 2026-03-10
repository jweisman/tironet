"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, Activity } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/home", icon: Home, labelKey: "home" },
  { href: "/soldiers", icon: Users, labelKey: "soldiers" },
  { href: "/activities", icon: Activity, labelKey: "activities" },
] as const;

export function TabBar() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 border-t border-border bg-background md:hidden">
      <div className="flex">
        {tabs.map(({ href, icon: Icon, labelKey }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 py-3 text-xs transition-colors min-h-[60px]",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 2} />
              <span>{t(labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

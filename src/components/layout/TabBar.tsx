"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, Activity, UserCog, Settings, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { useRequestBadge } from "@/hooks/useRequestBadge";

const staticTabs = [
  { href: "/home", icon: Home, labelKey: "home" as const },
  { href: "/soldiers", icon: Users, labelKey: "soldiers" as const },
  { href: "/activities", icon: Activity, labelKey: "activities" as const },
  { href: "/requests", icon: FileText, labelKey: "requests" as const },
];

export function TabBar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const { data: session } = useSession();
  const requestBadge = useRequestBadge();
  const isAdmin = session?.user?.isAdmin;
  const isCommander = session?.user?.cycleAssignments?.some(
    (a) => a.role === "company_commander" || a.role === "platoon_commander"
  );

  const tabs = [
    ...staticTabs,
    ...(!isAdmin && isCommander
      ? [{ href: "/users", icon: UserCog, label: "מפקדים" }]
      : []),
    ...(isAdmin
      ? [{ href: "/admin", icon: Settings, label: "ניהול" }]
      : []),
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 border-t border-border bg-background md:hidden">
      <div className="flex">
        {tabs.map(({ href, icon: Icon, ...rest }) => {
          const active = pathname.startsWith(href);
          const label = "label" in rest ? rest.label : t(rest.labelKey);
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
              <span className="relative">
                <Icon size={22} strokeWidth={active ? 2.5 : 2} />
                {href === "/requests" && requestBadge > 0 && (
                  <span className="absolute -top-1.5 -end-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                    {requestBadge}
                  </span>
                )}
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

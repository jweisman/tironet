"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, Activity, UserCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";

const staticTabs = [
  { href: "/home", icon: Home, labelKey: "home" as const },
  { href: "/soldiers", icon: Users, labelKey: "soldiers" as const },
  { href: "/activities", icon: Activity, labelKey: "activities" as const },
];

export function TabBar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const { data: session } = useSession();
  const isAdmin = session?.user?.isAdmin;
  const isCommander = session?.user?.cycleAssignments?.some(
    (a) => a.role === "company_commander" || a.role === "platoon_commander"
  );

  const tabs = [
    ...staticTabs,
    ...(!isAdmin && isCommander
      ? [{ href: "/users", icon: UserCog, label: "מפקדים" }]
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
              <Icon size={22} strokeWidth={active ? 2.5 : 2} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

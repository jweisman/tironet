"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, Activity, UserCog, Settings, FileText, BarChart3, Calendar } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { useRequestBadge } from "@/hooks/useRequestBadge";
import { effectiveRole } from "@/lib/auth/permissions";
import { useCycle } from "@/contexts/CycleContext";
import { OverflowMenu, type OverflowItem } from "./OverflowMenu";
import type { Role } from "@/types";

const allTabs = [
  { href: "/home", icon: Home, labelKey: "home" as const },
  { href: "/soldiers", icon: Users, labelKey: "soldiers" as const },
  { href: "/activities", icon: Activity, labelKey: "activities" as const },
  { href: "/requests", icon: FileText, labelKey: "requests" as const },
];

export function TabBar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const { data: session } = useSession();
  const { selectedAssignment } = useCycle();
  const requestBadge = useRequestBadge();
  const isAdmin = session?.user?.isAdmin;
  const selectedRole = selectedAssignment?.role as Role | undefined;
  const isCommander = session?.user?.cycleAssignments?.some(
    (a) => { const r = effectiveRole(a.role as Role); return r === "company_commander" || r === "platoon_commander"; }
  );
  const canSeeCalendar = selectedRole !== "hardship_coordinator";
  const canSeeReports = isCommander || selectedRole === "instructor" || selectedRole === "company_medic" || selectedRole === "hardship_coordinator";
  const canSeeCommanders = isCommander && selectedRole !== "instructor" && selectedRole !== "company_medic" && selectedRole !== "hardship_coordinator";

  // Filter tabs by role
  const staticTabs = allTabs.filter(({ href }) => {
    if (selectedRole === "instructor") return href === "/home" || href === "/activities";
    if (selectedRole === "company_medic" || selectedRole === "hardship_coordinator") return href === "/home" || href === "/requests";
    return true;
  });

  // Build overflow menu items
  const overflowItems: OverflowItem[] = [];

  if (canSeeCalendar) {
    overflowItems.push({ href: "/calendar", icon: Calendar, label: "לוח אירועים", dataTour: "nav-calendar" });
  }

  if (canSeeReports) {
    overflowItems.push({ href: "/reports", icon: BarChart3, label: "דוחות" });
  }

  if (canSeeCommanders) {
    overflowItems.push({ href: "/users", icon: UserCog, label: "מפקדים" });
  }

  // Admin page
  if (isAdmin) {
    overflowItems.push({ href: "/admin", icon: Settings, label: t("admin") });
  }

  // ≤5 total items → show all directly
  // >5 total items → show first 4 + "more" menu
  const totalItems = staticTabs.length + overflowItems.length;
  const maxDirect = totalItems <= 5 ? 5 : 4;
  const availableSlots = Math.max(0, maxDirect - staticTabs.length);
  const promotedItems = overflowItems.slice(0, availableSlots);
  const remainingOverflow = overflowItems.slice(availableSlots);

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-50 border-t border-border bg-background md:hidden"
      style={{ transform: "translateZ(0)" }}
    >
      <div className="flex">
        {staticTabs.map(({ href, icon: Icon, labelKey }) => {
          const active = pathname.startsWith(href);
          const label = t(labelKey);
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
                  <span className="absolute -top-1.5 -end-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                    {requestBadge}
                  </span>
                )}
              </span>
              <span>{label}</span>
            </Link>
          );
        })}

        {promotedItems.map(({ href, icon: Icon, label, dataTour }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              data-tour={dataTour}
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

        {remainingOverflow.length > 0 && (
          <OverflowMenu items={remainingOverflow} />
        )}
      </div>
    </nav>
  );
}

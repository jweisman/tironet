"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, Activity, Settings, LogOut, UserCog, FileText, BarChart3, HelpCircle, LifeBuoy, Calendar } from "lucide-react";
import { useTranslations } from "next-intl";
import { signOutAndClearCaches } from "@/lib/auth/sign-out";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./UserAvatar";
import { useCycle } from "@/contexts/CycleContext";
import { CyclePicker } from "./CyclePicker";
import { useRequestBadge } from "@/hooks/useRequestBadge";
import { effectiveRole } from "@/lib/auth/permissions";
import { SoldierLogo } from "@/components/SoldierLogo";
import { useTourContext } from "@/contexts/TourContext";
import type { Role } from "@/types";

const allNavItems = [
  { href: "/home", icon: Home, labelKey: "home" },
  { href: "/soldiers", icon: Users, labelKey: "soldiers" },
  { href: "/activities", icon: Activity, labelKey: "activities" },
  { href: "/requests", icon: FileText, labelKey: "requests" },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const { data: session } = useSession();
  const { activeCycles, selectedAssignment } = useCycle();
  const requestBadge = useRequestBadge();
  const { startCurrentTour } = useTourContext();
  const isAdmin = session?.user?.isAdmin;
  const selectedRole = selectedAssignment?.role as Role | undefined;
  const isCommander = session?.user?.cycleAssignments?.some(
    (a) => { const r = effectiveRole(a.role as Role); return r === "company_commander" || r === "platoon_commander"; }
  );
  const canSeeCalendar = selectedRole !== "hardship_coordinator";
  const canSeeReports = isCommander || selectedRole === "instructor" || selectedRole === "company_medic" || selectedRole === "hardship_coordinator";
  const canSeeCommanders = isCommander && selectedRole !== "instructor" && selectedRole !== "company_medic" && selectedRole !== "hardship_coordinator";

  // Filter nav items based on role
  const navItems = allNavItems.filter(({ href }) => {
    if (selectedRole === "instructor") return href === "/home" || href === "/activities";
    if (selectedRole === "company_medic" || selectedRole === "hardship_coordinator") return href === "/home" || href === "/requests";
    return true;
  });

  // Deduplicate cycles by id
  const uniqueCycles = activeCycles.filter(
    (a, i, arr) => arr.findIndex((b) => b.cycleId === a.cycleId) === i
  );

  return (
    <aside className="hidden md:flex flex-col fixed inset-y-0 end-0 w-64 border-s border-border bg-background z-40">
      {/* App name */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-border">
        <SoldierLogo className="h-9 w-auto text-[#273617] dark:text-[#7C9A6D]" />
        <span className="text-xl font-bold">טירונט</span>
      </div>

      {/* Cycle picker — only when multiple active cycles */}
      {uniqueCycles.length > 1 && (
        <div className="px-3 py-3 border-b border-border">
          <CyclePicker />
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map(({ href, icon: Icon, labelKey }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon size={18} />
              <span className="flex-1">{t(labelKey)}</span>
              {href === "/requests" && requestBadge > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-white">
                  {requestBadge}
                </span>
              )}
            </Link>
          );
        })}

        {canSeeCalendar && (
          <Link
            href="/calendar"
            data-tour="nav-calendar"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
              pathname.startsWith("/calendar")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Calendar size={18} />
            <span>לוח אירועים</span>
          </Link>
        )}

        {canSeeReports && (
          <Link
            href="/reports"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
              pathname.startsWith("/reports")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <BarChart3 size={18} />
            <span>דוחות</span>
          </Link>
        )}

        {canSeeCommanders && (
          <Link
            href="/users"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
              pathname.startsWith("/users")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <UserCog size={18} />
            <span>מפקדים</span>
          </Link>
        )}

        {isAdmin && (
          <Link
            href="/admin"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
              pathname.startsWith("/admin")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Settings size={18} />
            <span>{t("admin")}</span>
          </Link>
        )}
      </nav>

      {/* User section */}
      <div className="border-t border-border px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <UserAvatar size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {session?.user
                ? `${session.user.givenName} ${session.user.familyName}`.trim()
                : ""}
            </p>
            {session?.user?.rank && (
              <p className="truncate text-xs text-muted-foreground">
                {session.user.rank}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={startCurrentTour}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="עזרה"
          >
            <HelpCircle size={16} />
          </button>
          <Link
            href="/support"
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="תמיכה"
          >
            <LifeBuoy size={16} />
          </Link>
          <button
            type="button"
            onClick={() => signOutAndClearCaches()}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title={t("logout")}
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}

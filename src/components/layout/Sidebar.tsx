"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, Activity, Settings, LogOut, UserCog, FileText, BarChart3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./UserAvatar";
import { useCycle } from "@/contexts/CycleContext";
import { CyclePicker } from "./CyclePicker";
import { useRequestBadge } from "@/hooks/useRequestBadge";
import { effectiveRole } from "@/lib/auth/permissions";
import type { Role } from "@/types";

const navItems = [
  { href: "/home", icon: Home, labelKey: "home" },
  { href: "/soldiers", icon: Users, labelKey: "soldiers" },
  { href: "/activities", icon: Activity, labelKey: "activities" },
  { href: "/requests", icon: FileText, labelKey: "requests" },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const { data: session } = useSession();
  const { activeCycles } = useCycle();
  const requestBadge = useRequestBadge();
  const isAdmin = session?.user?.isAdmin;
  const isCommander = session?.user?.cycleAssignments?.some(
    (a) => { const r = effectiveRole(a.role as Role); return r === "company_commander" || r === "platoon_commander"; }
  );

  // Deduplicate cycles by id
  const uniqueCycles = activeCycles.filter(
    (a, i, arr) => arr.findIndex((b) => b.cycleId === a.cycleId) === i
  );

  return (
    <aside className="hidden md:flex flex-col fixed inset-y-0 end-0 w-64 border-s border-border bg-background z-40">
      {/* App name */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-border">
        <img src="/soldier.svg" alt="" className="h-9 w-auto" />
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
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">
                  {requestBadge}
                </span>
              )}
            </Link>
          );
        })}

        {(isAdmin || isCommander) && (
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

        {!isAdmin && isCommander && (
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
      <div className="border-t border-border px-4 py-4 space-y-3">
        <div className="flex items-center gap-3">
          <UserAvatar size={40} />
          <div className="min-w-0">
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
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <LogOut size={16} />
          <span>{t("logout")}</span>
        </button>
      </div>
    </aside>
  );
}

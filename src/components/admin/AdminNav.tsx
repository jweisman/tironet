"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/admin/cycles", label: "מחזורים" },
  { href: "/admin/structure", label: "מבנה פיקוד" },
  { href: "/admin/activity-types", label: "סוגי פעילות" },
  { href: "/admin/users", label: "משתמשים" },
];

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="border-b mb-6">
      <div className="flex gap-1">
        {links.map((link) => {
          const active = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

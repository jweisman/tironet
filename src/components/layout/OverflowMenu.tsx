"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { EllipsisVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface OverflowItem {
  href: string;
  icon: LucideIcon;
  label: string;
  dataTour?: string;
}

interface OverflowMenuProps {
  items: OverflowItem[];
}

export function OverflowMenu({ items }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const anyActive = items.some((item) => pathname.startsWith(item.href));

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on navigation
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div ref={menuRef} className="relative flex flex-1 flex-col items-center justify-center">
      <button
        type="button"
        data-tour="nav-more"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-1 py-3 text-xs transition-colors min-h-[60px] w-full",
          anyActive
            ? "text-primary"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <EllipsisVertical size={22} strokeWidth={anyActive ? 2.5 : 2} />
        <span>עוד</span>
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 end-0 z-50 min-w-[160px] rounded-lg border border-border bg-background shadow-lg">
          {items.map(({ href, icon: Icon, label }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 text-sm transition-colors first:rounded-t-lg last:rounded-b-lg",
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-foreground hover:bg-muted"
                )}
              >
                <Icon size={18} />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

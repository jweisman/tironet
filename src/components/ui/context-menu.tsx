"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

interface Props {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

export function ContextMenu({ items, position, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState<{ top: number; left: number } | null>(null);

  // Clamp to viewport after measuring the menu
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let top = position.y;
    let left = position.x;
    // Clamp bottom
    if (top + rect.height > window.innerHeight - pad) {
      top = window.innerHeight - rect.height - pad;
    }
    // Clamp right
    if (left + rect.width > window.innerWidth - pad) {
      left = window.innerWidth - rect.width - pad;
    }
    // Clamp left/top
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setAdjusted({ top, left });
  }, [position]);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  const style: React.CSSProperties = {
    position: "fixed",
    top: adjusted?.top ?? position.y,
    left: adjusted?.left ?? position.x,
    zIndex: 100,
    visibility: adjusted ? "visible" : "hidden",
  };

  return (
    <div ref={menuRef} style={style} className="min-w-[160px] rounded-lg border border-border bg-popover shadow-lg py-1 animate-in fade-in-0 zoom-in-95 duration-100">
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          onClick={() => { item.onClick(); onClose(); }}
          className={cn(
            "w-full text-start px-3 py-2 text-sm transition-colors hover:bg-muted",
            item.destructive && "text-destructive",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchInputProps extends Omit<React.ComponentProps<"input">, "onChange" | "value"> {
  value: string;
  onValueChange: (value: string) => void;
  containerClassName?: string;
}

export function SearchInput({
  value,
  onValueChange,
  containerClassName,
  className,
  placeholder,
  ...inputProps
}: SearchInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const hasContent = value.length > 0;

  return (
    <div className={cn("relative", containerClassName)}>
      <Input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn("pe-8", className)}
        {...inputProps}
      />
      {hasContent ? (
        <button
          type="button"
          onClick={() => {
            onValueChange("");
            inputRef.current?.focus();
          }}
          aria-label="נקה חיפוש"
          className="absolute inset-y-0 end-0 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={16} />
        </button>
      ) : (
        <Search
          size={16}
          className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
      )}
    </div>
  );
}

"use client";

import { SerwistProvider as BaseSerwistProvider } from "@serwist/turbopack/react";
import type { ReactNode } from "react";

export function SerwistProvider({ children }: { children: ReactNode }) {
  return (
    <BaseSerwistProvider
      swUrl="/serwist/sw.js"
      disable={process.env.NODE_ENV === "development"}
    >
      {children}
    </BaseSerwistProvider>
  );
}

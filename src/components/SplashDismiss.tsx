"use client";

import { useEffect } from "react";

/** Removes the inline #app-splash overlay once React has hydrated. */
export function SplashDismiss() {
  useEffect(() => {
    const el = document.getElementById("app-splash");
    if (el) el.remove();
  }, []);
  return null;
}

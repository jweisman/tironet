"use client";

import { useEffect, useCallback, useRef } from "react";
import { driver, type DriveStep, type Config } from "driver.js";

const STORAGE_PREFIX = "tironet:tour-seen:";

/** Check whether a tour has been completed for a page. */
function hasSeenTour(page: string): boolean {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${page}`) === "1";
  } catch {
    return false;
  }
}

/** Mark a tour as completed. */
function markTourSeen(page: string) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${page}`, "1");
  } catch {
    // localStorage may be unavailable (e.g. Safari Private Browsing)
  }
}

interface UseTourOptions {
  /** Unique page key used for localStorage tracking */
  page: string;
  /** Tour steps — only steps whose `element` exists in the DOM will be shown */
  steps: DriveStep[];
  /** Extra driver.js config overrides */
  config?: Partial<Config>;
}

/** Extract CSS selectors from steps that target DOM elements. */
function getStepSelectors(steps: DriveStep[]): string[] {
  return steps
    .map((s) => s.element)
    .filter((el): el is string => typeof el === "string");
}

/** Returns true when at least one of the selectors matches an element in the DOM. */
function hasAnyElement(selectors: string[]): boolean {
  return selectors.some((sel) => document.querySelector(sel) !== null);
}

export function useTour({ page, steps, config }: UseTourOptions) {
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);

  const buildDriver = useCallback(() => {
    // Filter to only steps whose target element exists in the DOM
    const availableSteps = steps.filter((step) => {
      if (!step.element) return true; // highlight-less steps always show
      const el =
        typeof step.element === "string"
          ? document.querySelector(step.element)
          : step.element;
      return !!el;
    });

    if (availableSteps.length === 0) return null;

    const d = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      overlayColor: "rgba(0, 0, 0, 0.55)",
      stagePadding: 8,
      stageRadius: 12,
      popoverClass: "tironet-tour-popover",
      nextBtnText: "הבא",
      prevBtnText: "הקודם",
      doneBtnText: "סיום",
      progressText: "{{current}} מתוך {{total}}",
      ...config,
      steps: availableSteps,
      onDestroyStarted: () => {
        markTourSeen(page);
        d.destroy();
      },
    });

    return d;
  }, [steps, page, config]);

  /** Manually start the tour (e.g. from help button click) */
  const startTour = useCallback(() => {
    // Destroy any existing instance
    if (driverRef.current) {
      driverRef.current.destroy();
      driverRef.current = null;
    }
    const d = buildDriver();
    if (d) {
      driverRef.current = d;
      d.drive();
    }
  }, [buildDriver]);

  // Auto-start on first visit: wait for the first tour-targeted element to
  // appear in the DOM rather than using a fixed timeout. This handles slow
  // connections (data takes seconds) and fast ones (data is cached locally)
  // equally well.
  useEffect(() => {
    if (hasSeenTour(page)) return;

    const selectors = getStepSelectors(steps);

    const tryStart = () => {
      if (hasSeenTour(page)) return true; // another tab marked it
      // Only start once at least one data-driven element is in the DOM
      if (selectors.length > 0 && !hasAnyElement(selectors)) return false;
      const d = buildDriver();
      if (d) {
        driverRef.current = d;
        d.drive();
      }
      return true;
    };

    // If elements are already present (cached data), start immediately
    if (tryStart()) return;

    // Otherwise observe DOM mutations until a targeted element appears
    const observer = new MutationObserver(() => {
      if (tryStart()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Safety cap: stop waiting after 10 seconds (e.g. if the page truly has
    // no data). The tour simply won't auto-start — user can still trigger
    // it via the help button.
    const timeout = setTimeout(() => observer.disconnect(), 10_000);

    return () => {
      observer.disconnect();
      clearTimeout(timeout);
    };
  }, [page, steps, buildDriver]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
    };
  }, []);

  return { startTour };
}

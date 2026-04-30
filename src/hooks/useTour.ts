"use client";

import { useEffect, useCallback, useRef } from "react";
import { driver, type DriveStep, type Config } from "driver.js";
import type { VersionedStep } from "@/lib/tour/steps";
import { useUserPreferences } from "@/contexts/UserPreferenceContext";

const STORAGE_PREFIX = "tironet:tour-seen:";

/**
 * Get the highest tour version the user has seen for a page.
 * Handles migration from the old boolean format ("1" → version 1).
 * Returns 0 if the user has never seen the tour.
 */
export function getSeenVersion(page: string): number {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${page}`);
    if (raw === null) return 0;
    const num = parseInt(raw, 10);
    // "1" from legacy boolean format maps to version 1 (correct by design)
    return Number.isNaN(num) ? 0 : num;
  } catch {
    return 0;
  }
}

/** Store the max tour version the user has seen for a page. */
function setSeenVersion(page: string, version: number) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${page}`, String(version));
  } catch {
    // localStorage may be unavailable (e.g. Safari Private Browsing)
  }
}

/** Compute the max version across all steps (defaults to 1). */
export function getMaxVersion(steps: VersionedStep[]): number {
  if (steps.length === 0) return 1;
  return Math.max(...steps.map((s) => s.version ?? 1));
}

interface UseTourOptions {
  /** Unique page key used for localStorage tracking */
  page: string;
  /** Tour steps — only steps whose `element` exists in the DOM will be shown */
  steps: VersionedStep[];
  /** Extra driver.js config overrides */
  config?: Partial<Config>;
  /** Gate auto-start until the page's data is ready (default: true). Useful for
   *  pages that fetch data asynchronously from the server (not PowerSync). */
  ready?: boolean;
}

/** Extract CSS selectors from steps that target DOM elements. */
function getStepSelectors(steps: VersionedStep[]): string[] {
  return steps
    .map((s) => s.element)
    .filter((el): el is string => typeof el === "string");
}

/** Returns true when at least one of the selectors matches a visible element. */
function hasAnyElement(selectors: string[]): boolean {
  return selectors.some((sel) => {
    const all = document.querySelectorAll(sel);
    return Array.from(all).some(
      (el) => (el as HTMLElement).offsetParent !== null || (el as HTMLElement).offsetWidth > 0,
    );
  });
}

/**
 * Filter steps to only those whose target element is visible in the DOM.
 * When both a desktop and mobile variant share the same data-tour
 * attribute, pick the one that is actually rendered (visible).
 */
function resolveVisibleSteps(steps: VersionedStep[]): DriveStep[] {
  return steps
    .map((step) => {
      if (!step.element) return step; // highlight-less steps always show
      if (typeof step.element !== "string") return step;
      const all = document.querySelectorAll(step.element);
      const visible = Array.from(all).find(
        (el) => (el as HTMLElement).offsetParent !== null || (el as HTMLElement).offsetWidth > 0,
      );
      if (!visible) return null;
      return { ...step, element: visible };
    })
    .filter((s): s is DriveStep => s !== null);
}

/**
 * Inject a "חדש" badge into the popover title via onPopoverRender.
 * Wraps any existing onPopoverRender callback.
 */
function addNewBadge(step: DriveStep): DriveStep {
  const originalRender = step.popover?.onPopoverRender;
  return {
    ...step,
    popover: {
      ...step.popover,
      onPopoverRender: (popover, opts) => {
        originalRender?.(popover, opts);
        if (popover.title) {
          const badge = document.createElement("span");
          badge.textContent = "חדש";
          Object.assign(badge.style, {
            display: "inline-block",
            background: "#2563eb",
            color: "#fff",
            fontSize: "0.7rem",
            fontWeight: "700",
            padding: "1px 6px",
            borderRadius: "9999px",
            marginInlineStart: "6px",
            verticalAlign: "middle",
            lineHeight: "1",
          });
          popover.title.appendChild(badge);
        }
      },
    },
  };
}

export function useTour({ page, steps, config, ready = true }: UseTourOptions) {
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);
  const { showTour, loaded: prefsLoaded } = useUserPreferences();

  const maxVersion = getMaxVersion(steps);

  /** Build a driver instance for the full tour (help button — all steps, no badges). */
  const buildFullDriver = useCallback(() => {
    const availableSteps = resolveVisibleSteps(steps);
    if (availableSteps.length === 0) return null;

    const d = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      overlayColor: "rgba(0, 0, 0, 0.6)",
      stagePadding: 12,
      stageRadius: 12,
      popoverClass: "tironet-tour-popover",
      nextBtnText: "הבא",
      prevBtnText: "הקודם",
      doneBtnText: "סיום",
      progressText: "\u200F{{current}} מתוך {{total}}",
      ...config,
      steps: availableSteps,
      onDestroyStarted: () => {
        setSeenVersion(page, maxVersion);
        d.destroy();
      },
    });

    return d;
  }, [steps, page, config, maxVersion]);

  /** Build a driver instance for new steps only (auto-start — with "חדש" badge). */
  const buildNewStepsDriver = useCallback(
    (storedVersion: number) => {
      const newSteps = steps.filter((s) => (s.version ?? 1) > storedVersion);
      const availableSteps = resolveVisibleSteps(newSteps).map(addNewBadge);
      if (availableSteps.length === 0) return null;

      const d = driver({
        showProgress: true,
        animate: true,
        allowClose: true,
        overlayColor: "rgba(0, 0, 0, 0.6)",
        stagePadding: 12,
        stageRadius: 12,
        popoverClass: "tironet-tour-popover",
        nextBtnText: "הבא",
        prevBtnText: "הקודם",
        doneBtnText: "סיום",
        progressText: "\u200F{{current}} מתוך {{total}}",
        ...config,
        steps: availableSteps,
        onDestroyStarted: () => {
          setSeenVersion(page, maxVersion);
          d.destroy();
        },
      });

      return d;
    },
    [steps, page, config, maxVersion],
  );

  /** Manually start the tour (e.g. from help button click) — all steps, no badges. */
  const startTour = useCallback(() => {
    // Destroy any existing instance
    if (driverRef.current) {
      driverRef.current.destroy();
      driverRef.current = null;
    }
    const d = buildFullDriver();
    if (d) {
      driverRef.current = d;
      d.drive();
    }
  }, [buildFullDriver]);

  // Auto-start logic:
  // - First visit (storedVersion === 0): show full tour
  // - Return visit with new steps (storedVersion < maxVersion): show only new steps with badge
  // - Gated by showTour user preference and `ready` flag
  useEffect(() => {
    if (!ready) return; // page data not loaded yet
    if (!prefsLoaded) return; // wait for server preference before deciding
    const storedVersion = getSeenVersion(page);
    if (storedVersion >= maxVersion) return; // already seen everything
    if (!showTour) return; // user opted out of auto-tours

    const selectors =
      storedVersion === 0
        ? getStepSelectors(steps) // first visit: wait for any step element
        : getStepSelectors(steps.filter((s) => (s.version ?? 1) > storedVersion)); // new steps only

    const tryStart = () => {
      if (getSeenVersion(page) >= maxVersion) return true; // another tab marked it
      // Only start once at least one data-driven element is in the DOM
      if (selectors.length > 0 && !hasAnyElement(selectors)) return false;

      const d =
        storedVersion === 0
          ? buildFullDriver() // first visit: full tour
          : buildNewStepsDriver(storedVersion); // return visit: new steps only with badge

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
  }, [page, steps, maxVersion, showTour, prefsLoaded, ready, buildFullDriver, buildNewStepsDriver]);

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

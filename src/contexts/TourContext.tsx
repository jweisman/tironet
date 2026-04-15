"use client";

import { createContext, useContext, useCallback, useRef } from "react";

type StartTourFn = () => void;

interface TourContextValue {
  /** Register the current page's startTour function */
  registerTour: (startFn: StartTourFn) => void;
  /** Unregister (call on unmount) */
  unregisterTour: () => void;
  /** Trigger the current page's tour from the help button */
  startCurrentTour: () => void;
}

const TourContext = createContext<TourContextValue>({
  registerTour: () => {},
  unregisterTour: () => {},
  startCurrentTour: () => {},
});

export function TourProvider({ children }: { children: React.ReactNode }) {
  const startFnRef = useRef<StartTourFn | null>(null);

  const registerTour = useCallback((fn: StartTourFn) => {
    startFnRef.current = fn;
  }, []);

  const unregisterTour = useCallback(() => {
    startFnRef.current = null;
  }, []);

  const startCurrentTour = useCallback(() => {
    startFnRef.current?.();
  }, []);

  return (
    <TourContext.Provider value={{ registerTour, unregisterTour, startCurrentTour }}>
      {children}
    </TourContext.Provider>
  );
}

export function useTourContext() {
  return useContext(TourContext);
}

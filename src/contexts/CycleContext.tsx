"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import type { CycleAssignment } from "@/types";

interface CycleContextValue {
  selectedCycleId: string | null;
  selectedAssignment: CycleAssignment | null;
  setSelectedCycleId: (id: string) => void;
  activeCycles: CycleAssignment[];
  /** true while the session is still loading (cycle state not yet resolved) */
  isLoading: boolean;
}

const CycleContext = createContext<CycleContextValue>({
  selectedCycleId: null,
  selectedAssignment: null,
  setSelectedCycleId: () => {},
  activeCycles: [],
  isLoading: true,
});

export function CycleProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const [selectedCycleId, setSelectedCycleIdState] = useState<string | null>(null);

  const activeCycles = (session?.user?.cycleAssignments ?? []).filter(
    (a) => a.cycleIsActive
  );

  // On mount or when active cycles change: restore from localStorage or auto-select
  useEffect(() => {
    if (activeCycles.length === 0) return;
    const stored = localStorage.getItem("selectedCycleId");
    if (stored && activeCycles.some((a) => a.cycleId === stored)) {
      setSelectedCycleIdState(stored);
    } else if (activeCycles.length === 1) {
      setSelectedCycleIdState(activeCycles[0].cycleId);
      localStorage.setItem("selectedCycleId", activeCycles[0].cycleId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCycles.length]);

  function setSelectedCycleId(id: string) {
    setSelectedCycleIdState(id);
    localStorage.setItem("selectedCycleId", id);
  }

  const selectedAssignment = selectedCycleId
    ? activeCycles.find((a) => a.cycleId === selectedCycleId) ?? null
    : null;

  // Still loading if session hasn't resolved, or if we have cycles but
  // the useEffect hasn't auto-selected yet (selectedCycleId still null).
  const isLoading =
    status === "loading" ||
    (activeCycles.length > 0 && selectedCycleId === null);

  return (
    <CycleContext.Provider
      value={{ selectedCycleId, selectedAssignment, setSelectedCycleId, activeCycles, isLoading }}
    >
      {children}
    </CycleContext.Provider>
  );
}

export function useCycle() {
  return useContext(CycleContext);
}

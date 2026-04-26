"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCycle } from "@/contexts/CycleContext";
import type {
  CalendarData,
  CalendarEvent,
  CalendarFilterCategory,
} from "@/app/api/calendar/route";
import {
  groupEventsByDate,
  getPlatoonColorMap,
  EVENT_TYPE_COLORS,
  visibleTypesToFilters,
  filtersToEventTypes,
  getMonthBounds,
} from "@/lib/calendar/events";
import type { PlatoonColor } from "@/lib/calendar/events";
import { CalendarGrid } from "@/components/reports/calendar/CalendarGrid";
import { CalendarToolbar } from "@/components/reports/calendar/CalendarToolbar";
import { CalendarLegend } from "@/components/reports/calendar/CalendarLegend";
import { CalendarMobileView } from "@/components/reports/calendar/CalendarMobileView";
import { MonthNav } from "@/components/reports/calendar/MonthNav";

export default function CalendarPage() {
  const { selectedCycleId, isLoading: cycleLoading } = useCycle();
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Month navigation — start at current month
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  // Filters
  const [selectedPlatoonId, setSelectedPlatoonId] = useState<string>("all");
  const [enabledFilters, setEnabledFilters] = useState<Set<CalendarFilterCategory>>(new Set());

  // Fetch data
  useEffect(() => {
    if (!selectedCycleId) return;
    setLoading(true);
    const params = new URLSearchParams({ cycleId: selectedCycleId });
    fetch(`/api/calendar?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((d: CalendarData) => {
        setData(d);
        setEnabledFilters(new Set(visibleTypesToFilters(d.visibleTypes)));
      })
      .catch(() => toast.error("שגיאה בטעינת הנתונים"))
      .finally(() => setLoading(false));
  }, [selectedCycleId]);

  // Derived state
  const isMultiPlatoon = (data?.platoons.length ?? 0) > 1;
  const platoonColorMap = useMemo(
    () => getPlatoonColorMap(data?.platoons.map((p) => p.id) ?? []),
    [data?.platoons],
  );

  const visibleFilters = useMemo(
    () => (data ? visibleTypesToFilters(data.visibleTypes) : []),
    [data],
  );

  const enabledEventTypes = useMemo(
    () => filtersToEventTypes(enabledFilters),
    [enabledFilters],
  );

  const filteredEvents = useMemo(() => {
    if (!data) return [];
    return data.events.filter((e) => {
      if (!enabledEventTypes.has(e.type)) return false;
      if (selectedPlatoonId !== "all" && e.platoonId !== selectedPlatoonId) return false;
      return true;
    });
  }, [data, enabledEventTypes, selectedPlatoonId]);

  const eventsByDate = useMemo(() => groupEventsByDate(filteredEvents), [filteredEvents]);

  const todayStr = new Date().toISOString().split("T")[0];

  // Month bounds from all events (not filtered — so navigation range stays stable)
  const { min: minMonth, max: maxMonth } = useMemo(
    () => getMonthBounds(data?.events ?? []),
    [data?.events],
  );

  const viewYM = viewYear * 12 + viewMonth;
  const canGoPrev = viewYM > minMonth.year * 12 + minMonth.month;
  const canGoNext = viewYM < maxMonth.year * 12 + maxMonth.month;

  function goToPrevMonth() {
    if (!canGoPrev) return;
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); }
    else setViewMonth(viewMonth - 1);
  }

  function goToNextMonth() {
    if (!canGoNext) return;
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); }
    else setViewMonth(viewMonth + 1);
  }

  const getColor = useCallback(
    (event: CalendarEvent): PlatoonColor => {
      if (isMultiPlatoon && selectedPlatoonId === "all") {
        return platoonColorMap.get(event.platoonId) ?? EVENT_TYPE_COLORS[event.type];
      }
      return EVENT_TYPE_COLORS[event.type];
    },
    [isMultiPlatoon, selectedPlatoonId, platoonColorMap],
  );

  function handleToggleFilter(filter: CalendarFilterCategory) {
    setEnabledFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) {
        if (next.size <= 1) return prev;
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  }

  async function handleExportPdf() {
    if (!selectedCycleId) return;
    if (!navigator.onLine) {
      toast.error("הפקת דוחות דורשת חיבור לאינטרנט");
      return;
    }
    setPdfLoading(true);
    try {
      const params = new URLSearchParams({ cycleId: selectedCycleId });
      if (selectedPlatoonId !== "all") params.set("platoonId", selectedPlatoonId);
      const typesArr = Array.from(enabledEventTypes);
      if (data && typesArr.length < data.visibleTypes.length) {
        params.set("types", typesArr.join(","));
      }
      const res = await fetch(`/api/calendar/pdf?${params}`);
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `calendar-${data?.cycleName || "report"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("הדוח הופק בהצלחה");
    } catch {
      toast.error("שגיאה בהפקת ה-PDF");
    } finally {
      setPdfLoading(false);
    }
  }

  if (cycleLoading) return null;

  if (!selectedCycleId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-3">
        <p className="text-lg font-medium">בחר מחזור</p>
      </div>
    );
  }

  return (
    <div className="-mx-4 -my-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-background border-b border-border px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold flex-1">לוח אירועים</h1>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={pdfLoading || loading}
            className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {pdfLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Download size={15} />
            )}
            <span className="hidden sm:inline">ייצוא ל-PDF</span>
          </button>
        </div>
        {data && (
          <p className="text-xs text-muted-foreground mt-1">
            מחזור {data.cycleName}
            {data.companyName && ` · ${data.companyName}`}
          </p>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-6 pb-32">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && data && (
          <>
            {/* Toolbar */}
            <CalendarToolbar
              platoons={data.platoons}
              selectedPlatoonId={selectedPlatoonId}
              onPlatoonChange={setSelectedPlatoonId}
              visibleFilters={visibleFilters}
              enabledFilters={enabledFilters}
              onToggleFilter={handleToggleFilter}
              showPlatoonFilter={isMultiPlatoon}
            />

            {/* Legend */}
            {isMultiPlatoon && selectedPlatoonId === "all" ? (
              <CalendarLegend
                mode="platoon"
                platoons={data.platoons}
                colorMap={platoonColorMap}
              />
            ) : (
              <CalendarLegend
                mode="type"
                visibleTypes={Array.from(enabledEventTypes)}
              />
            )}

            {/* Month navigation — shared between mobile and desktop */}
            <MonthNav
              year={viewYear}
              month={viewMonth}
              onPrev={goToPrevMonth}
              onNext={goToNextMonth}
              canGoPrev={canGoPrev}
              canGoNext={canGoNext}
            />

            {/* Mobile: compact dots + day detail list */}
            <div className="md:hidden">
              <CalendarMobileView
                year={viewYear}
                month={viewMonth}
                eventsByDate={eventsByDate}
                getColor={getColor}
                todayStr={todayStr}
              />
            </div>

            {/* Desktop: full grid with event chips */}
            <div className="hidden md:block">
              <CalendarGrid
                year={viewYear}
                month={viewMonth}
                eventsByDate={eventsByDate}
                getColor={getColor}
                todayStr={todayStr}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

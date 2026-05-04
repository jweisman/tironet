"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, WifiOff } from "lucide-react";
import { useSession } from "next-auth/react";
import { useQuery } from "@powersync/react";
import { useCycle } from "@/contexts/CycleContext";
import { useSyncReady } from "@/hooks/useSyncReady";
import { useGoBack } from "@/hooks/useGoBack";
import {
  ActivityDetail,
  type ActivityDetailData,
} from "@/components/activities/ActivityDetail";
import type { ActivityResult, Role } from "@/types";
import { effectiveRole } from "@/lib/auth/permissions";
import { parseScoreConfig, getActiveScores, calculateFailure } from "@/types/score-config";
import { parseDisplayConfig } from "@/types/display-config";

// ---------------------------------------------------------------------------
// SQL queries (PowerSync local SQLite)
// ---------------------------------------------------------------------------

const ACTIVITY_QUERY = `
  SELECT
    a.id, a.name, a.date, a.status, a.is_required, a.notes,
    a.platoon_id, a.cycle_id,
    at.id AS activity_type_id, at.name AS activity_type_name, at.icon AS activity_type_icon,
    at.score_config, at.display_configuration,
    p.name AS platoon_name,
    c.name AS company_name
  FROM activities a
  JOIN activity_types at ON at.id = a.activity_type_id
  JOIN platoons p ON p.id = a.platoon_id
  JOIN companies c ON c.id = p.company_id
  WHERE a.id = ?
`;

const SQUADS_QUERY = `
  SELECT id, name, sort_order
  FROM squads
  WHERE platoon_id = ?
  ORDER BY sort_order ASC, name ASC
`;

const SOLDIERS_QUERY = `
  SELECT id, given_name, family_name, rank, profile_image, status, squad_id, id_number
  FROM soldiers
  WHERE cycle_id = ? AND status = 'active'
  ORDER BY family_name ASC, given_name ASC
`;

const REPORTS_QUERY = `
  SELECT id, soldier_id, result, failed, grade1, grade2, grade3, grade4, grade5, grade6, note
  FROM activity_reports
  WHERE activity_id = ?
`;

interface RawActivity {
  id: string; name: string; date: string; status: string; is_required: number;
  notes: string | null;
  platoon_id: string; cycle_id: string;
  activity_type_id: string; activity_type_name: string; activity_type_icon: string;
  score_config: string | null;
  display_configuration: string | null;
  platoon_name: string; company_name: string;
}
interface RawSquad { id: string; name: string; sort_order: number; }
interface RawSoldier {
  id: string; given_name: string; family_name: string;
  rank: string | null; profile_image: string | null; status: string; squad_id: string;
  id_number: string | null;
}
interface RawReport {
  id: string; soldier_id: string; result: string; failed: number;
  grade1: number | null; grade2: number | null; grade3: number | null;
  grade4: number | null; grade5: number | null; grade6: number | null;
  note: string | null;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ActivityPage() {
  const params = useParams<{ id: string }>();
  const goBack = useGoBack("/activities");
  const searchParams = useSearchParams();

  // The SW caches one HTML shell for all /activities/[id] pages (app shell pattern).
  // Next.js bakes useParams() into the hydration data, so when the SW serves a
  // shell cached from /activities/_ for /activities/<real-uuid>, useParams() returns
  // "_" instead of the real UUID. Read the actual URL after hydration to fix this.
  const [id, setId] = useState(params.id);
  useEffect(() => {
    const match = window.location.pathname.match(/^\/activities\/([^/]+)$/);
    if (match && match[1] !== id) {
      setId(match[1]);
    }
  }, []);
  const initialGapsOnly = searchParams.get("gaps") === "1";

  const { data: session } = useSession();
  const { selectedAssignment } = useCycle();

  const activityParams = useMemo(() => [id], [id]);
  const { data: activityRows, isLoading: activityLoading } = useQuery<RawActivity>(ACTIVITY_QUERY, activityParams);
  const activity = activityRows?.[0] ?? null;

  // Use the assignment for the activity's own cycle, not the globally selected one.
  // A user may have assignments in multiple cycles (e.g. squad_commander in a past
  // cycle, platoon_commander in the current one). Using the global context would
  // produce the wrong role/squad when the selected cycle differs from the activity's.
  const cycleAssignments = session?.user?.cycleAssignments ?? [];
  const activityAssignment = activity
    ? (cycleAssignments.find((a) => a.cycleId === activity.cycle_id) ?? null)
    : selectedAssignment;

  const rawRole = activityAssignment?.role ?? "";
  const role = rawRole ? effectiveRole(rawRole as Role) : "";

  const platoonParams = useMemo(
    () => [activity?.platoon_id ?? ""],
    [activity?.platoon_id]
  );
  const { data: squadsRows } = useQuery<RawSquad>(SQUADS_QUERY, platoonParams);

  const cycleParams = useMemo(
    () => [activity?.cycle_id ?? ""],
    [activity?.cycle_id]
  );
  const { data: soldiersRows } = useQuery<RawSoldier>(SOLDIERS_QUERY, cycleParams);
  const { data: reportsRows } = useQuery<RawReport>(REPORTS_QUERY, activityParams);

  // -------- Build ActivityDetailData from local rows --------
  const data: ActivityDetailData | null = useMemo(() => {
    if (!activity) return null;

    const reportsMap = new Map<string, RawReport>();
    for (const r of reportsRows ?? []) reportsMap.set(r.soldier_id, r);

    const scoreConfig = parseScoreConfig(activity.score_config);
    const activeScores = getActiveScores(scoreConfig);
    const displayConfig = parseDisplayConfig(activity.display_configuration);

    const squadId = activityAssignment?.unitType === "squad" ? activityAssignment.unitId : null;

    const squads = (squadsRows ?? [])
      .filter((sq) => {
        if (role === "squad_commander") return sq.id === squadId;
        return true;
      })
      .map((sq) => {
        const canEdit =
          role === "platoon_commander" ||
          role === "company_commander" ||
          role === "instructor" ||
          (role === "squad_commander" && sq.id === squadId);

        const soldiers = (soldiersRows ?? [])
          .filter((s) => s.squad_id === sq.id)
          .map((s) => {
            const report = reportsMap.get(s.id);
            return {
              id: s.id,
              givenName: s.given_name,
              familyName: s.family_name,
              rank: s.rank,
              profileImage: s.profile_image,
              status: s.status,
              idNumber: s.id_number,
              report: report
                ? (() => {
                    const grades = {
                      grade1: report.grade1 != null ? Number(report.grade1) : null,
                      grade2: report.grade2 != null ? Number(report.grade2) : null,
                      grade3: report.grade3 != null ? Number(report.grade3) : null,
                      grade4: report.grade4 != null ? Number(report.grade4) : null,
                      grade5: report.grade5 != null ? Number(report.grade5) : null,
                      grade6: report.grade6 != null ? Number(report.grade6) : null,
                    };
                    // Recalculate failed on first display from current scores + thresholds.
                    // calculateFailure handles the "no thresholds configured" case internally.
                    const failed = calculateFailure(grades, activeScores, scoreConfig?.failureThreshold).failed;
                    return {
                      id: report.id,
                      result: report.result as ActivityResult,
                      failed,
                      ...grades,
                      note: report.note,
                    };
                  })()
                : { id: null, result: null, failed: false, grade1: null, grade2: null, grade3: null, grade4: null, grade5: null, grade6: null, note: null },
            };
          });

        return { id: sq.id, name: sq.name, canEdit, soldiers };
      });

    const canEditMetadata =
      role === "platoon_commander" ||
      role === "company_commander" ||
      role === "instructor";
    const canEditReports = role !== "";

    return {
      id: activity.id,
      name: activity.name,
      date: activity.date,
      isRequired: Number(activity.is_required) === 1,
      notes: activity.notes,
      activityType: {
        id: activity.activity_type_id,
        name: activity.activity_type_name,
        icon: activity.activity_type_icon,
        activeScores,
        scoreConfig,
        displayConfiguration: displayConfig,
      },
      platoon: {
        id: activity.platoon_id,
        name: activity.platoon_name,
        companyName: activity.company_name,
      },
      role,
      canEditMetadata,
      canEditReports,
      squads,
    };
  }, [activity, squadsRows, soldiersRows, reportsRows, role, activityAssignment]);

  const { showLoading, showEmpty, showConnectionError } = useSyncReady(!!data, activityLoading);

  return (
    <div>
      <div className="mb-2">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1 text-sm text-foreground/70 hover:text-foreground hover:bg-muted rounded-md px-1.5 py-0.5 -ms-1.5 transition-colors"
        >
          <ArrowRight size={18} />
          חזרה לפעילויות
        </button>
      </div>

      {!data && showLoading && (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {!data && showConnectionError && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
          <WifiOff size={28} className="text-muted-foreground mx-auto mb-1" />
          <p className="font-medium">לא ניתן לטעון נתונים</p>
          <p className="text-sm text-muted-foreground">בדוק את החיבור לרשת ונסה שוב.</p>
        </div>
      )}

      {!data && showEmpty && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
          <p className="font-medium text-destructive">הפעילות לא נמצאה</p>
          <Link
            href="/activities"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            חזרה לרשימת הפעילויות
          </Link>
        </div>
      )}

      {data && (
        <ActivityDetail
          key={data.squads.map((s) => s.id).join(",")}
          initialData={data}
          initialGapsOnly={initialGapsOnly}
        />
      )}
    </div>
  );
}

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ActivityDetail, type ActivityDetailData } from "@/components/activities/ActivityDetail";
import { prisma } from "@/lib/db/prisma";
import { getActivityScope } from "@/lib/api/activity-scope";
import type { ActivityResult } from "@/types";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ gaps?: string }>;
}

export default async function ActivityPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { gaps } = await searchParams;
  const initialGapsOnly = gaps === "1";

  let data: ActivityDetailData | null = null;
  let errorMessage: string | null = null;

  try {
    const activity = await prisma.activity.findUnique({
      where: { id },
      include: {
        activityType: { select: { id: true, name: true, icon: true } },
        platoon: {
          select: {
            id: true,
            name: true,
            company: { select: { name: true } },
            squads: {
              orderBy: { sortOrder: "asc" },
              select: {
                id: true,
                name: true,
                soldiers: {
                  where: { status: "active" },
                  orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
                  select: {
                    id: true,
                    givenName: true,
                    familyName: true,
                    rank: true,
                    profileImage: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
        reports: {
          select: {
            id: true,
            soldierId: true,
            result: true,
            grade: true,
            note: true,
          },
        },
      },
    });

    if (!activity) {
      errorMessage = "הפעילות לא נמצאה";
    } else {
      const { scope, error } = await getActivityScope(activity.cycleId);

      if (error || !scope) {
        errorMessage = "אין לך הרשאה לצפות בפעילות זו";
      } else {
        const canSeePlatoon = scope.platoonIds.includes(activity.platoonId);
        if (!canSeePlatoon) {
          errorMessage = "אין לך הרשאה לצפות בפעילות זו";
        } else if (scope.role === "squad_commander" && activity.status === "draft") {
          errorMessage = "אין לך הרשאה לצפות בפעילות זו";
        } else {
          const canEditMetadata = scope.canEditMetadataForPlatoon(activity.platoonId);
          const canEditReports =
            scope.role === "platoon_commander" ||
            scope.role === "company_commander" ||
            scope.role === "admin" ||
            scope.role === "squad_commander";

          const reportsMap = new Map(activity.reports.map((r) => [r.soldierId, r]));

          const squads = activity.platoon.squads
            .filter((squad) => {
              if (scope.role === "squad_commander") return squad.id === scope.squadId;
              return true;
            })
            .map((squad) => {
              const canEdit =
                scope.role === "admin" ||
                scope.role === "platoon_commander" ||
                scope.role === "company_commander" ||
                (scope.role === "squad_commander" && squad.id === scope.squadId);

              return {
                id: squad.id,
                name: squad.name,
                canEdit,
                soldiers: squad.soldiers.map((soldier) => {
                  const report = reportsMap.get(soldier.id);
                  return {
                    id: soldier.id,
                    givenName: soldier.givenName,
                    familyName: soldier.familyName,
                    rank: soldier.rank,
                    profileImage: soldier.profileImage,
                    status: soldier.status,
                    report: report
                      ? {
                          id: report.id,
                          result: report.result as ActivityResult,
                          grade: report.grade ? Number(report.grade) : null,
                          note: report.note,
                        }
                      : { id: null, result: null, grade: null, note: null },
                  };
                }),
              };
            });

          data = {
            id: activity.id,
            name: activity.name,
            date: activity.date.toISOString(),
            status: activity.status as "draft" | "active",
            isRequired: activity.isRequired,
            activityType: activity.activityType,
            platoon: {
              id: activity.platoon.id,
              name: activity.platoon.name,
              companyName: activity.platoon.company.name,
            },
            role: scope.role,
            canEditMetadata,
            canEditReports,
            squads,
          };
        }
      }
    }
  } catch {
    errorMessage = "שגיאה בטעינת הפעילות";
  }

  return (
    <div>
      {/* Back button */}
      <div className="mb-4">
        <Link
          href="/activities"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight size={16} />
          חזרה לפעילויות
        </Link>
      </div>

      {errorMessage && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
          <p className="font-medium text-destructive">{errorMessage}</p>
          <Link
            href="/activities"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            חזרה לרשימת הפעילויות
          </Link>
        </div>
      )}

      {data && <ActivityDetail initialData={data} initialGapsOnly={initialGapsOnly} />}
    </div>
  );
}

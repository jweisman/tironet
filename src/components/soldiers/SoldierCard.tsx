"use client";

import { ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RequestTypeIcon } from "@/components/requests/RequestTypeIcon";
import type { SoldierStatus, RequestType } from "@/types";

export interface SoldierSummary {
  id: string;
  givenName: string;
  familyName: string;
  idNumber: string | null;
  civilianId: string | null;
  rank: string | null;
  status: SoldierStatus;
  profileImage: string | null;
  phone: string | null;
  gapCount: number;
  openRequestCount: number;
  approvedRequestTypes: RequestType[];
}

interface Props {
  soldier: SoldierSummary;
  onClick: () => void;
  dataTour?: string;
}

const STATUS_LABEL: Record<SoldierStatus, string> = {
  active: "פעיל",
  transferred: "הועבר",
  dropped: "נשר",
  injured: "פצוע",
};

const STATUS_VARIANT: Record<
  SoldierStatus,
  "default" | "outline" | "destructive" | "secondary"
> = {
  active: "default",
  transferred: "outline",
  dropped: "destructive",
  injured: "secondary",
};

const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-indigo-500",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash + name.charCodeAt(i)) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[hash];
}

export function SoldierCard({ soldier, onClick, dataTour }: Props) {
  const initials =
    (soldier.givenName[0] ?? "") + (soldier.familyName[0] ?? "");
  const colorClass = getAvatarColor(soldier.givenName + soldier.familyName);
  const statusVariant = STATUS_VARIANT[soldier.status];

  return (
    <button
      data-tour={dataTour}
      type="button"
      onClick={onClick}
      className="relative z-0 flex w-full items-center gap-3 py-3 px-4 text-start transition-colors hover:bg-muted/50 active:bg-muted"
    >
      {/* Avatar */}
      <div
        className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white font-semibold text-sm ${colorClass}`}
      >
        {soldier.profileImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={soldier.profileImage}
            alt={`${soldier.givenName} ${soldier.familyName}`}
            className="h-12 w-12 rounded-full object-cover"
          />
        ) : (
          <span>{initials}</span>
        )}
      </div>

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm leading-none truncate">
            {soldier.familyName} {soldier.givenName}
          </span>
          {soldier.rank && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {soldier.rank}
            </span>
          )}
          {soldier.approvedRequestTypes.length > 0 && (
            <span className="flex items-center gap-0.5 shrink-0">
              {soldier.approvedRequestTypes.map((type, i) => (
                <RequestTypeIcon key={`${type}-${i}`} type={type} size={14} className="text-emerald-600" />
              ))}
            </span>
          )}
        </div>
        {soldier.status !== "active" && (
          <div>
            <Badge variant={statusVariant} className={soldier.status === "injured" ? "bg-amber-100 text-amber-800 border-amber-200" : undefined}>
              {STATUS_LABEL[soldier.status]}
            </Badge>
          </div>
        )}
      </div>

      {/* Indicators + chevron */}
      <div className="flex shrink-0 items-center gap-1.5">
        {soldier.openRequestCount > 0 && (
          <span className="inline-flex h-5 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-800">
            {soldier.openRequestCount} בקשות
          </span>
        )}
        {soldier.gapCount > 0 && (
          <span className="inline-flex h-5 items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 text-xs font-medium text-destructive">
            {soldier.gapCount} פערים
          </span>
        )}
        <ChevronLeft size={16} className="text-muted-foreground" />
      </div>
    </button>
  );
}

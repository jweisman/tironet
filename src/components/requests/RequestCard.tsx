"use client";

import { ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  REQUEST_TYPE_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_VARIANT,
  ASSIGNED_ROLE_LABELS,
} from "@/lib/requests/constants";
import { RequestTypeIcon } from "@/components/requests/RequestTypeIcon";
import { canActOnRequest } from "@/lib/requests/workflow";
import type { RequestType, RequestStatus, Role } from "@/types";

export interface RequestSummary {
  id: string;
  type: RequestType;
  status: RequestStatus;
  assignedRole: Role | null;
  soldierName: string;
  squadId: string;
  squadName: string;
  platoonId: string;
  createdAt: string;
  description: string | null;
  urgent: boolean | null;
}

interface Props {
  request: RequestSummary;
  userRole: Role | "admin";
  onClick: () => void;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RequestCard({ request, userRole, onClick }: Props) {
  const isAssignedToMe =
    request.assignedRole !== null && userRole !== "admin" && canActOnRequest(userRole, request.assignedRole);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 px-4 py-3 text-start hover:bg-muted/50 transition-colors"
    >
      {/* Icon */}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <RequestTypeIcon type={request.type} size={18} />
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {request.soldierName}
          </span>
          {request.urgent && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
              דחוף
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {REQUEST_TYPE_LABELS[request.type]}
          {request.description ? ` · ${request.description}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          {request.squadName} · {formatDate(request.createdAt)}
        </p>
      </div>

      {/* Status / Assignment */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        <Badge variant={REQUEST_STATUS_VARIANT[request.status]} className="text-xs">
          {REQUEST_STATUS_LABELS[request.status]}
        </Badge>
        {request.assignedRole && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              isAssignedToMe
                ? "bg-amber-100 text-amber-800 font-medium"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {isAssignedToMe
              ? "דורש טיפול"
              : `ממתין ל${ASSIGNED_ROLE_LABELS[request.assignedRole]}`}
          </span>
        )}
      </div>

      {/* Chevron */}
      <ChevronLeft size={16} className="shrink-0 text-muted-foreground self-center" />
    </button>
  );
}

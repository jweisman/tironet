import type { RequestType, RequestStatus, Transportation, Role } from "@/types";

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  leave: "בקשת יציאה",
  medical: "רפואה",
  hardship: 'בקשת ת"ש',
};

export const REQUEST_TYPE_ICONS: Record<RequestType, string> = {
  leave: "🚪",
  medical: "🏥",
  hardship: "💪",
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  open: "פתוח",
  approved: "אושר",
  denied: "נדחה",
};

export const TRANSPORTATION_LABELS: Record<Transportation, string> = {
  public_transit: 'תחב"צ',
  shuttle: "שאטל",
  military_transport: "נסיעה צבאית",
  other: "אחר",
};

export const ASSIGNED_ROLE_LABELS: Record<Role, string> = {
  squad_commander: 'מ"כ',
  platoon_commander: 'מ"מ',
  company_commander: 'מ"פ',
};

export const REQUEST_STATUS_VARIANT: Record<
  RequestStatus,
  "default" | "outline" | "destructive" | "secondary"
> = {
  open: "outline",
  approved: "default",
  denied: "destructive",
};

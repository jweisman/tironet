import { DoorOpen, Stethoscope, HandHeart } from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { RequestType, RequestStatus, Transportation, Role } from "@/types";

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  leave: "בקשת יציאה",
  medical: "רפואה",
  hardship: 'בקשת ת"ש',
};

export const REQUEST_TYPE_ICONS: Record<
  RequestType,
  React.ComponentType<LucideProps>
> = {
  leave: DoorOpen,
  medical: Stethoscope,
  hardship: HandHeart,
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
  platoon_sergeant: 'סמ"ח',
  company_commander: 'מ"פ',
  deputy_company_commander: 'סמ"פ',
};

export const REQUEST_STATUS_VARIANT: Record<
  RequestStatus,
  "default" | "outline" | "destructive" | "secondary"
> = {
  open: "outline",
  approved: "default",
  denied: "destructive",
};

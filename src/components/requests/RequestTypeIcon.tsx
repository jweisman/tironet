import { REQUEST_TYPE_ICONS } from "@/lib/requests/constants";
import type { RequestType } from "@/types";

interface Props {
  type: RequestType;
  size?: number;
  className?: string;
}

export function RequestTypeIcon({ type, size = 18, className }: Props) {
  const Icon = REQUEST_TYPE_ICONS[type];
  return <Icon size={size} className={className} />;
}

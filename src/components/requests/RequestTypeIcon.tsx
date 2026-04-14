import { REQUEST_TYPE_ICONS } from "@/lib/requests/constants";
import type { RequestType } from "@/types";

interface Props {
  type: RequestType;
  size?: number;
  className?: string;
  urgent?: boolean;
}

export function RequestTypeIcon({ type, size = 18, className, urgent }: Props) {
  const Icon = REQUEST_TYPE_ICONS[type];
  if (urgent) {
    return (
      <span className="relative inline-flex">
        <Icon size={size} className={className} />
        <span className="absolute -top-0.5 -end-0.5 h-2 w-2 rounded-full bg-destructive" />
      </span>
    );
  }
  return <Icon size={size} className={className} />;
}

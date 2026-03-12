import * as LucideIcons from "lucide-react";
import type { LucideProps } from "lucide-react";

interface Props {
  icon: string;
  name: string;
  size?: number;
  className?: string;
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

export function ActivityTypeIcon({ icon, name, size = 18, className }: Props) {
  const key = toPascalCase(icon) as keyof typeof LucideIcons;
  const Icon = LucideIcons[key] as React.ComponentType<LucideProps> | undefined;

  if (Icon) {
    return <Icon size={size} className={className} />;
  }

  // Fallback: first letter of the type name
  return <span className={className}>{name[0]}</span>;
}

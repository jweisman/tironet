import type { ResultLabels } from "@/types/display-config";

const COLORS = {
  completed: "#22c55e", // green-500
  skipped: "#f59e0b",   // amber-500
  failed: "#ef4444",    // red-500
  na: "#9ca3af",        // gray-400
  missing: "#e5e7eb",   // gray-200
};

export interface PieChartData {
  completed: number;
  skipped: number;
  failed: number;
  na: number;
  missing: number;
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number
) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function PieChart({ data, size = 120 }: { data: PieChartData; size?: number }) {
  const total = data.completed + data.skipped + data.failed + data.na + data.missing;
  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="55" fill="#e5e7eb" />
        <text x="60" y="64" textAnchor="middle" fontSize="14" fill="#9ca3af">
          —
        </text>
      </svg>
    );
  }

  const segments = [
    { value: data.completed, color: COLORS.completed },
    { value: data.skipped, color: COLORS.skipped },
    { value: data.failed, color: COLORS.failed },
    { value: data.na, color: COLORS.na },
    { value: data.missing, color: COLORS.missing },
  ].filter((s) => s.value > 0);

  // Single segment = full circle
  if (segments.length === 1) {
    return (
      <svg width={size} height={size} viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="55" fill={segments[0].color} />
      </svg>
    );
  }

  let currentAngle = 0;
  const paths = segments.map((seg, i) => {
    const angle = (seg.value / total) * 360;
    // Avoid rendering a 360° arc (it collapses to nothing)
    const clampedAngle = Math.min(angle, 359.99);
    const path = describeArc(60, 60, 55, currentAngle, currentAngle + clampedAngle);
    currentAngle += angle;
    return <path key={i} d={path} fill={seg.color} />;
  });

  return (
    <svg width={size} height={size} viewBox="0 0 120 120">
      {paths}
    </svg>
  );
}

// Legend component for use alongside the pie chart
export function PieChartLegend({
  data,
  resultLabels,
}: {
  data: PieChartData;
  resultLabels?: ResultLabels;
}) {
  const items = [
    { label: resultLabels?.completed.label ?? "ביצע", count: data.completed, color: COLORS.completed },
    { label: resultLabels?.skipped.label ?? "לא ביצע", count: data.skipped, color: COLORS.skipped },
    { label: "נכשל", count: data.failed, color: COLORS.failed },
    { label: resultLabels?.na.label ?? "לא רלוונטי", count: data.na, color: COLORS.na },
    { label: "ללא דיווח", count: data.missing, color: COLORS.missing },
  ];

  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {items
        .filter((item) => item.count > 0)
        .map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: item.color }}
            />
            <span>
              {item.label} ({item.count})
            </span>
          </div>
        ))}
    </div>
  );
}

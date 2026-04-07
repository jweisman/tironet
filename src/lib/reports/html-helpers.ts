// ---------------------------------------------------------------------------
// Shared helpers for report HTML rendering (used by activity-summary,
// request-summary, and daily-forum reports)
// ---------------------------------------------------------------------------

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// SVG pie chart helpers
// ---------------------------------------------------------------------------

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

export function renderPieSvg(passed: number, failed: number, na: number): string {
  const total = passed + failed + na;
  if (total === 0) {
    return `<svg width="80" height="80" viewBox="0 0 120 120"><circle cx="60" cy="60" r="55" fill="#e5e7eb"/></svg>`;
  }

  const segments = [
    { value: passed, color: "#22c55e" },
    { value: failed, color: "#ef4444" },
    { value: na, color: "#9ca3af" },
  ].filter((s) => s.value > 0);

  if (segments.length === 1) {
    return `<svg width="80" height="80" viewBox="0 0 120 120"><circle cx="60" cy="60" r="55" fill="${segments[0].color}"/></svg>`;
  }

  let currentAngle = 0;
  const paths = segments.map((seg) => {
    const angle = (seg.value / total) * 360;
    const clamped = Math.min(angle, 359.99);
    const d = describeArc(60, 60, 55, currentAngle, currentAngle + clamped);
    currentAngle += angle;
    return `<path d="${d}" fill="${seg.color}"/>`;
  });

  return `<svg width="80" height="80" viewBox="0 0 120 120">${paths.join("")}</svg>`;
}

// ---------------------------------------------------------------------------
// Date formatting helpers
// ---------------------------------------------------------------------------

export function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Label maps
// ---------------------------------------------------------------------------

export const TYPE_LABELS: Record<string, string> = {
  leave: "בקשת יציאה",
  medical: "רפואה",
  hardship: 'בקשת ת"ש',
};

export const TRANSPORTATION_LABELS: Record<string, string> = {
  public_transit: 'תחב"צ',
  shuttle: "שאטל",
  military_transport: "נסיעה צבאית",
  other: "אחר",
};

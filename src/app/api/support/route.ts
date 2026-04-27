import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { sendEmail } from "@/lib/email/send";

const SUPPORT_EMAIL = "support@tironet.org.il";

const schema = z.object({
  description: z.string().optional(),
  diagnostics: z.record(z.string(), z.unknown()),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Require at least one cycle assignment (don't let uninvited users send support emails)
  const assignments = session.user.cycleAssignments ?? [];
  if (assignments.length === 0 && !session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { description, diagnostics } = parsed.data;
  const user = session.user;
  const userName = `${user.familyName ?? ""} ${user.givenName ?? ""}`.trim() || user.email || user.id;

  const diagHtml = Object.entries(diagnostics)
    .map(([section, data]) => {
      if (typeof data === "object" && data !== null && !Array.isArray(data)) {
        const rows = Object.entries(data as Record<string, unknown>)
          .map(([k, v]) => `<tr><td style="padding:2px 8px;font-weight:600;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:2px 8px;word-break:break-all">${String(v ?? "—")}</td></tr>`)
          .join("");
        return `<h3 style="margin:16px 0 4px;color:#1d4ed8">${section}</h3><table style="font-size:13px;border-collapse:collapse">${rows}</table>`;
      }
      return `<h3 style="margin:16px 0 4px;color:#1d4ed8">${section}</h3><pre style="font-size:12px;background:#f5f5f5;padding:8px;border-radius:4px;overflow-x:auto;white-space:pre-wrap">${JSON.stringify(data, null, 2)}</pre>`;
    })
    .join("");

  await sendEmail({
    to: SUPPORT_EMAIL,
    subject: `[תמיכה] ${userName}${description ? ` — ${description.slice(0, 80)}` : ""}`,
    html: `
      <div dir="rtl" style="font-family:sans-serif;max-width:700px;margin:0 auto;padding:24px">
        <h2 style="color:#1d4ed8">דיווח תמיכה</h2>
        <p><strong>משתמש:</strong> ${userName}</p>
        <p><strong>אימייל:</strong> ${user.email ?? "—"}</p>
        <p><strong>מזהה:</strong> <code>${user.id}</code></p>
        ${description ? `<p><strong>תיאור:</strong></p><p style="background:#f9f9f9;padding:12px;border-radius:6px;white-space:pre-wrap">${description}</p>` : ""}
        <hr style="margin:24px 0;border:none;border-top:1px solid #ddd" />
        <h2 style="color:#1d4ed8">אבחון</h2>
        <div dir="ltr" style="text-align:left">${diagHtml}</div>
      </div>
    `,
  });

  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from "next/server";
import { getPersonalFileScope } from "@/lib/api/personal-file-scope";
import { fetchPersonalFile, renderPersonalFileHtml } from "@/lib/reports/render-personal-file";
import { prisma } from "@/lib/db/prisma";
import { effectiveRole } from "@/lib/auth/permissions";
import type { Role } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar";

const PDF_OPTIONS = {
  format: "A4" as const,
  printBackground: true,
  margin: { top: "15mm", right: "15mm", bottom: "15mm", left: "15mm" },
};

async function generatePdfVercel(html: string): Promise<Uint8Array> {
  const chromium = await import("@sparticuz/chromium-min").then((m) => m.default);
  const puppeteer = await import("puppeteer-core").then((m) => m.default);
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
    headless: true,
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.fonts.ready);
  const pdfBuffer = await page.pdf(PDF_OPTIONS);
  await browser.close();
  return new Uint8Array(pdfBuffer);
}

async function generatePdfLocal(html: string): Promise<Uint8Array> {
  const { chromium: pw } = await import("playwright-core");
  const browser = await pw.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.fonts.ready);
  const pdfBuffer = await page.pdf(PDF_OPTIONS);
  await browser.close();
  return new Uint8Array(pdfBuffer);
}

async function isSoldierInScope(
  role: string,
  unitId: string,
  soldierSquadId: string,
): Promise<boolean> {
  const eRole = effectiveRole(role as Role);
  if (eRole === "squad_commander") return unitId === soldierSquadId;
  if (eRole === "platoon_commander") {
    const squad = await prisma.squad.findUnique({
      where: { id: soldierSquadId },
      select: { platoonId: true },
    });
    return squad?.platoonId === unitId;
  }
  if (eRole === "company_commander") {
    const squad = await prisma.squad.findUnique({
      where: { id: soldierSquadId },
      select: { platoon: { select: { companyId: true } } },
    });
    return squad?.platoon.companyId === unitId;
  }
  return false;
}

export async function GET(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  const soldierId = request.nextUrl.searchParams.get("soldierId");
  if (!cycleId || !soldierId) {
    return NextResponse.json({ error: "cycleId and soldierId are required" }, { status: 400 });
  }

  const { scope, error, user } = await getPersonalFileScope(cycleId);
  if (error) return error;

  // Verify soldier is in scope
  const soldier = await prisma.soldier.findUnique({
    where: { id: soldierId },
    select: { cycleId: true, squadId: true },
  });
  if (!soldier || soldier.cycleId !== cycleId) {
    return NextResponse.json({ error: "Soldier not found" }, { status: 404 });
  }

  const assignment = user!.cycleAssignments.find((a) => a.cycleId === cycleId);
  if (!assignment) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const inScope = await isSoldierInScope(assignment.role, assignment.unitId, soldier.squadId);
  if (!inScope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data = await fetchPersonalFile(cycleId, soldierId);
  if (!data) {
    return NextResponse.json({ error: "Soldier not found" }, { status: 404 });
  }

  const html = renderPersonalFileHtml(data);

  try {
    const isVercel = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    const pdfBytes = isVercel
      ? await generatePdfVercel(html)
      : await generatePdfLocal(html);

    const filename = `personal-file-${data.soldier.familyName}-${data.soldier.givenName}.pdf`;

    return new NextResponse(pdfBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (err) {
    console.error("PDF generation error:", err);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}

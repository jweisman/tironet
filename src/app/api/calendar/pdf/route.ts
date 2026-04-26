import { NextRequest, NextResponse } from "next/server";
import { getCalendarScope } from "@/lib/api/calendar-scope";
import { fetchCalendarData } from "@/lib/calendar/fetch";
import { renderCalendarHtml } from "@/lib/calendar/render";
import { getThreeMonthRange, type CalendarEventType } from "@/lib/calendar/events";

// Vercel Functions: Node.js runtime, 60s max duration
export const runtime = "nodejs";
export const maxDuration = 60;

const CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar";

const PDF_OPTIONS = {
  format: "A4" as const,
  landscape: true,
  printBackground: true,
  margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
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

export async function GET(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const { scope, error } = await getCalendarScope(cycleId);
  if (error) return error;

  const data = await fetchCalendarData(cycleId, scope!);
  if (!data) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  // Optional filters from query params
  const filterPlatoonId = request.nextUrl.searchParams.get("platoonId") ?? undefined;
  const typesParam = request.nextUrl.searchParams.get("types");
  const filterTypes = typesParam
    ? (typesParam.split(",").filter(Boolean) as CalendarEventType[])
    : undefined;

  const { months } = getThreeMonthRange();

  const html = renderCalendarHtml({
    cycleName: data.cycleName,
    companyName: data.companyName,
    events: data.events,
    platoons: data.platoons,
    months,
    visibleTypes: data.visibleTypes,
    filterPlatoonId,
    filterTypes,
  });

  try {
    const isVercel = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    const pdfBytes = isVercel
      ? await generatePdfVercel(html)
      : await generatePdfLocal(html);

    return new NextResponse(pdfBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="calendar.pdf"`,
      },
    });
  } catch (err) {
    console.error("PDF generation error:", err);
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 },
    );
  }
}

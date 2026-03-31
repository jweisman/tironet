import { NextRequest, NextResponse } from "next/server";
import { getReportScope } from "@/lib/api/report-scope";
import {
  fetchActivitySummary,
  renderActivitySummaryHtml,
} from "@/lib/reports/render-activity-summary";

// Vercel Functions: Node.js runtime, 60s max duration
export const runtime = "nodejs";
export const maxDuration = 60;

// Chromium binary URL for @sparticuz/chromium-min (downloads at runtime on Vercel)
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

export async function GET(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const { scope, error } = await getReportScope(cycleId);
  if (error) return error;

  const typesParam = request.nextUrl.searchParams.get("activityTypeIds");
  const activityTypeIds = typesParam ? typesParam.split(",").filter(Boolean) : undefined;

  // Fetch data and render HTML in-process (no separate print route needed)
  const data = await fetchActivitySummary(cycleId, scope!.platoonIds, activityTypeIds);
  if (!data) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  const html = renderActivitySummaryHtml(data);

  try {
    const isVercel = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    const pdfBytes = isVercel
      ? await generatePdfVercel(html)
      : await generatePdfLocal(html);

    return new NextResponse(pdfBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="activity-summary.pdf"`,
      },
    });
  } catch (err) {
    console.error("PDF generation error:", err);
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    );
  }
}

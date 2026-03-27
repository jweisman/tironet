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

async function launchBrowser() {
  // In production (Vercel/Lambda), use puppeteer-core + @sparticuz/chromium-min
  // which downloads the Chromium binary at runtime (avoids Turbopack bundling issues).
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = await import("@sparticuz/chromium-min").then((m) => m.default);
    const puppeteer = await import("puppeteer-core").then((m) => m.default);
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
      headless: true,
    });
  }

  // Local development — use full playwright (already installed for e2e tests)
  const { chromium: pw } = await import("playwright-core");
  return pw.launch({ headless: true });
}

export async function GET(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const { scope, error } = await getReportScope(cycleId);
  if (error) return error;

  // Fetch data and render HTML in-process (no separate print route needed)
  const data = await fetchActivitySummary(cycleId, scope!.platoonIds);
  if (!data) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  const html = renderActivitySummaryHtml(data);

  try {
    const browser = await launchBrowser();
    const page = await browser.newPage();

    // Load HTML directly — avoids cross-process token issues and extra network hop
    // Puppeteer uses "networkidle0", Playwright uses "networkidle"
    const isVercel = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    await page.setContent(html, {
      waitUntil: isVercel ? "networkidle0" : "networkidle",
    });

    // Wait for Google Fonts to load
    await page.waitForFunction(() => document.fonts.ready);

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "15mm", right: "15mm", bottom: "15mm", left: "15mm" },
    });

    await browser.close();

    return new NextResponse(new Uint8Array(pdfBuffer), {
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

#!/usr/bin/env node
/**
 * Generates apple-touch-startup-image PNGs for iOS PWA splash screens.
 * Uses the app icon (public/icon.svg) centered on the brand green background.
 *
 * Usage: node scripts/generate-splash.mjs
 * Output: public/splash/*.png
 */

import sharp from "sharp";
import { mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "public", "splash");
mkdirSync(outDir, { recursive: true });

// All current iOS device screen sizes (portrait only).
// Format: [width, height, pixelRatio, name]
const devices = [
  // iPhones
  [320, 568, 2, "iphone-se-1"],        // SE 1st gen
  [375, 667, 2, "iphone-8"],           // 6/6s/7/8/SE2/SE3
  [414, 736, 3, "iphone-8-plus"],      // 6+/6s+/7+/8+
  [375, 812, 3, "iphone-x"],           // X/XS/11 Pro
  [414, 896, 2, "iphone-xr"],          // XR/11
  [414, 896, 3, "iphone-xs-max"],      // XS Max/11 Pro Max
  [360, 780, 3, "iphone-12-mini"],     // 12 mini/13 mini
  [390, 844, 3, "iphone-12"],          // 12/12 Pro/13/13 Pro/14
  [428, 926, 3, "iphone-14-plus"],     // 12 Pro Max/13 Pro Max/14 Plus
  [393, 852, 3, "iphone-15-pro"],      // 14 Pro/15/15 Pro
  [430, 932, 3, "iphone-15-pro-max"], // 14 Pro Max/15 Plus/15 Pro Max
  [402, 874, 3, "iphone-16-pro"],      // 16 Pro
  [440, 956, 3, "iphone-16-pro-max"], // 16 Pro Max
  // iPads
  [744, 1133, 2, "ipad-mini"],         // iPad mini 6th gen
  [768, 1024, 2, "ipad-9"],            // iPad 9th gen
  [810, 1080, 2, "ipad-10"],           // iPad 10th gen
  [820, 1180, 2, "ipad-air"],          // iPad Air 4/5
  [834, 1194, 2, "ipad-pro-11"],       // iPad Pro 11"
  [1024, 1366, 2, "ipad-pro-12"],      // iPad Pro 12.9"
];

// Brand green — works as a neutral splash in both light and dark mode
const bg = "#273617";

const iconSvg = readFileSync(join(root, "public", "icon.svg"));

async function generateSplash(width, height, ratio, name) {
  const pw = width * ratio;
  const ph = height * ratio;

  // Icon size: ~20% of the shorter dimension
  const iconSize = Math.round(Math.min(pw, ph) * 0.2);

  const iconPng = await sharp(iconSvg)
    .resize(iconSize, iconSize)
    .png()
    .toBuffer();

  const left = Math.round((pw - iconSize) / 2);
  const top = Math.round((ph - iconSize) / 2);

  await sharp({
    create: {
      width: pw,
      height: ph,
      channels: 4,
      background: bg,
    },
  })
    .composite([{ input: iconPng, left, top }])
    .png()
    .toFile(join(outDir, `${name}.png`));
}

console.log("Generating splash screens...");

const tasks = devices.map(([w, h, r, name]) => generateSplash(w, h, r, name));

await Promise.all(tasks);
console.log(`Done — generated ${tasks.length} splash images in public/splash/`);

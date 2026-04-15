import { describe, it, expect } from "vitest";
import { validateProfileImage } from "../validate-image";

describe("validateProfileImage", () => {
  it("returns null for null input", () => {
    expect(validateProfileImage(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(validateProfileImage(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(validateProfileImage("")).toBeNull();
  });

  it("returns error for non-data-URL string", () => {
    expect(validateProfileImage("https://example.com/img.png")).toBe(
      "פורמט תמונה לא תקין",
    );
  });

  it("returns error for malformed data URL (missing base64 prefix)", () => {
    expect(validateProfileImage("data:image/png,raw-data")).toBe(
      "פורמט תמונה לא תקין",
    );
  });

  it("returns null for valid small image", () => {
    // 10 bytes base64 = "AAAAAAAAAA==" → ~8 bytes decoded, well under 250KB
    const small = "data:image/png;base64,AAAAAAAAAA==";
    expect(validateProfileImage(small)).toBeNull();
  });

  it("returns error when image exceeds 250KB", () => {
    // Generate base64 string that decodes to >250KB
    // 250KB = 256000 bytes → base64 length ≈ ceil(256000 * 4/3) ≈ 341334 chars
    const bigBase64 = "A".repeat(350000);
    const big = `data:image/jpeg;base64,${bigBase64}`;
    const result = validateProfileImage(big);
    expect(result).toMatch(/התמונה גדולה מדי/);
    expect(result).toMatch(/מקסימום 250KB/);
  });

  it("returns null for image exactly at 250KB", () => {
    // 250KB = 256000 bytes. base64 length = ceil(256000 * 4/3) = 341334
    // Decoded size = ceil(341334 * 3/4) = 256001... need exact: 256000 * 4/3 = 341333.33
    // Use 341332 chars → decoded = ceil(341332 * 3/4) = 255999 bytes → under limit
    const base64 = "A".repeat(341332);
    const img = `data:image/png;base64,${base64}`;
    expect(validateProfileImage(img)).toBeNull();
  });
});

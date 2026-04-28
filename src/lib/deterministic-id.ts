/**
 * Generate a deterministic UUID from a composite key.
 *
 * Uses SHA-1 to hash the concatenated parts into a UUID v5-style string.
 * This ensures two clients independently creating a row for the same
 * (activityId, soldierId) pair produce the same UUID, preventing orphaned
 * CRUD operations when PowerSync syncs the "winning" row.
 */
export async function deterministicId(...parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join(":"));
  const hash = await crypto.subtle.digest("SHA-1", data);
  const bytes = new Uint8Array(hash);

  // Format as UUID v5: set version (4 bits) and variant (2 bits)
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const hex = Array.from(bytes.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

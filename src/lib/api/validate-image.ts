const MAX_IMAGE_BYTES = 250 * 1024; // 250 KB after base64 decode

/**
 * Validates a base64 profile image string.
 * Returns an error message if invalid, or null if OK.
 */
export function validateProfileImage(profileImage: string | null | undefined): string | null {
  if (!profileImage) return null;

  // Must be a data URL
  const match = profileImage.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) {
    return "פורמט תמונה לא תקין";
  }

  // Check decoded size
  const base64Data = match[1];
  const byteLength = Math.ceil((base64Data.length * 3) / 4);
  if (byteLength > MAX_IMAGE_BYTES) {
    return `התמונה גדולה מדי (${Math.round(byteLength / 1024)}KB). מקסימום 250KB.`;
  }

  return null;
}

import * as XLSX from "xlsx";

function decodeCsvBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  // UTF-8 BOM
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return new TextDecoder("utf-8").decode(buffer);
  }

  // Strict UTF-8 — succeeds for valid UTF-8 (with or without Hebrew); fails on
  // single-byte legacy encodings like Windows-1255, in which case we fall back.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1255").decode(buffer);
  }
}

export function readSpreadsheet(
  buffer: ArrayBuffer,
  fileName: string,
): XLSX.WorkBook {
  if (/\.csv$/i.test(fileName)) {
    return XLSX.read(decodeCsvBuffer(buffer), { type: "string" });
  }
  return XLSX.read(buffer, { type: "array" });
}

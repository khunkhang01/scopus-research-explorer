export type CsvEncoding = "auto" | "utf-8" | "windows-1252" | "utf-16le";

export function decodeCsvBytes(
  bytes: Uint8Array,
  encoding: CsvEncoding = "auto"
): { content: string; encoding: Exclude<CsvEncoding, "auto"> } {
  const selected = encoding !== "auto"
    ? encoding
    : bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : "utf-8";
  try {
    return {
      content: new TextDecoder(selected, { fatal: selected === "utf-8" }).decode(bytes),
      encoding: selected
    };
  } catch {
    return {
      content: new TextDecoder("windows-1252").decode(bytes),
      encoding: "windows-1252"
    };
  }
}

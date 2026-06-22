import { describe, expect, it } from "vitest";
import { decodeCsvBytes } from "../src/domain/csv-encoding";

describe("CSV encoding", () => {
  it("detects a UTF-16 LE BOM", () => {
    const text = "Title,Year\r\nงานวิจัย,2024";
    const body = Buffer.from(text, "utf16le");
    const bytes = new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), body]));
    const decoded = decodeCsvBytes(bytes);
    expect(decoded.encoding).toBe("utf-16le");
    expect(decoded.content).toContain("งานวิจัย");
  });

  it("falls back to Windows-1252 when bytes are invalid UTF-8", () => {
    const decoded = decodeCsvBytes(new Uint8Array([0x54, 0x69, 0x74, 0x6c, 0x65, 0x2c, 0xe9]));
    expect(decoded.encoding).toBe("windows-1252");
    expect(decoded.content).toBe("Title,é");
  });
});

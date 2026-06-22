import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseScopusCsv, splitReferences } from "../src/domain/scopus";

describe("Scopus CSV parsing", () => {
  it("parses BOM, multiline abstract, identifiers, and unknown columns", () => {
    const csv = "\uFEFFTitle,DOI,EID,Year,Abstract,Author Keywords,References,Custom\n" +
      "\"Paper one\",https://doi.org/10.1000/ABC,2-s2.0-1,2024,\"Line one\nLine two\",\"AI; Search\",\"Ref A; Ref B\",kept\n";
    const result = parseScopusCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      title: "Paper one",
      doi: "10.1000/abc",
      eid: "2-s2.0-1",
      year: 2024,
      abstract: "Line one\nLine two",
      authorKeywords: ["AI", "Search"]
    });
    expect(result.rows[0]?.sourceFields.Custom).toBe("kept");
  });

  it("rejects rows without titles", () => {
    const result = parseScopusCsv("Title,DOI\n,10.1/none\n");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("missing Title");
  });

  it("splits semicolon references", () => {
    expect(splitReferences("Ref A; Ref B; Ref C")).toEqual(["Ref A", "Ref B", "Ref C"]);
  });

  it("reports malformed exports without accepting rows missing titles", () => {
    const csv = fs.readFileSync(
      path.resolve("tests/fixtures/malformed-scopus.csv"),
      "utf8"
    );
    const result = parseScopusCsv(csv);
    expect(result.rows.some((row) => row.title === "Valid before malformed")).toBe(true);
    expect(result.errors.some((error) => error.includes("missing Title"))).toBe(true);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

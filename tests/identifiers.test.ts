import { describe, expect, it } from "vitest";
import { normalizeDoi, normalizeTitle, titleYearKey } from "../src/domain/identifiers";

describe("identifier normalization", () => {
  it("normalizes DOI URLs and punctuation", () => {
    expect(normalizeDoi("https://doi.org/10.1000/ABC.123).")).toBe("10.1000/abc.123");
  });

  it("builds stable title/year keys", () => {
    expect(titleYearKey("A Study: of AI!", 2025)).toBe("a study of ai::2025");
    expect(normalizeTitle("  Café—Research  ")).toBe("café research");
  });
});

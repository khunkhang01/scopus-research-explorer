import { describe, expect, it } from "vitest";
import {
  jaccard,
  median,
  normalizeText,
  tokenize,
  tokenizeWithSegmenter
} from "../src/domain/text-analysis";

describe("text analysis", () => {
  it("normalizes unicode and tokenizes English", () => {
    expect(normalizeText("ＡI Research")).toBe("ai research");
    expect(tokenize("The future of AI research")).toEqual(["future", "ai", "research"]);
  });

  it("tokenizes Thai without requiring spaces when Segmenter supports it", () => {
    expect(tokenize("การวิจัยปัญญาประดิษฐ์").length).toBeGreaterThan(0);
  });

  it("keeps Thai tokens while removing English stop words in mixed text", () => {
    const tokens = tokenize("The การวิจัย AI and กราฟ");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("and");
    expect(tokens).toContain("ai");
    expect(tokens.some((token) => /[\u0E00-\u0E7F]/u.test(token))).toBe(true);
  });

  it("uses the Unicode letter/number fallback without Intl.Segmenter", () => {
    expect(tokenizeWithSegmenter("AI กราฟ 2026", undefined)).toEqual([
      "ai",
      "กราฟ",
      "2026"
    ]);
  });

  it("computes jaccard and median", () => {
    expect(jaccard(["AI", "Search"], ["search", "Graph"])).toBeCloseTo(1 / 3);
    expect(median([2020, 2024, 2022])).toBe(2022);
    expect(median([2020, 2022])).toBe(2021);
  });
});

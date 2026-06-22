import { describe, expect, it } from "vitest";
import { aggregateTopThree, weightedScore } from "../src/domain/ranking";

describe("ranking", () => {
  it("aggregates the best three seed scores", () => {
    const result = aggregateTopThree([
      { bm25: 1, keyword: 0, refs: 0, author: 0, year: 0 },
      { bm25: 0.8, keyword: 0, refs: 0, author: 0, year: 0 },
      { bm25: 0.6, keyword: 0, refs: 0, author: 0, year: 0 },
      { bm25: 0.1, keyword: 0, refs: 0, author: 0, year: 0 }
    ]);
    expect(result.bm25).toBeCloseTo(0.8);
  });

  it("renormalizes weights only when a channel is unavailable corpus-wide", () => {
    expect(weightedScore({
      bm25: 0,
      keyword: 1,
      refs: 0,
      author: 0,
      year: 0
    }, undefined, new Set(["keyword"]))).toBe(1);
  });

  it("keeps a candidate missing value at zero instead of renormalizing it away", () => {
    expect(weightedScore({
      bm25: 0,
      keyword: 1,
      refs: 0,
      author: 0,
      year: 0
    })).toBeCloseTo(0.15);
  });
});

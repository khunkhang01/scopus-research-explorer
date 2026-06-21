import { describe, expect, it } from "vitest";
import { evaluateRanking, mean } from "../src/domain/evaluation";

describe("recommendation evaluation", () => {
  const judgments = [
    { publicationId: "a", relevance: 3 },
    { publicationId: "b", relevance: 2 },
    { publicationId: "c", relevance: 1 },
    { publicationId: "x", relevance: 0 }
  ];

  it("rewards a better graded-relevance order", () => {
    const ideal = evaluateRanking(["a", "b", "c"], judgments);
    const reversed = evaluateRanking(["c", "b", "a"], judgments);
    expect(ideal.ndcg10).toBeCloseTo(1);
    expect(ideal.ndcg10).toBeGreaterThan(reversed.ndcg10);
    expect(ideal.precision10).toBeCloseTo(0.3);
  });

  it("computes a stable arithmetic mean", () => {
    expect(mean([0.5, 1, 0])).toBe(0.5);
    expect(mean([])).toBe(0);
  });
});

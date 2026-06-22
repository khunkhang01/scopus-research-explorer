export interface RelevanceJudgment {
  publicationId: string;
  relevance: number;
}

export interface RankingMetrics {
  ndcg10: number;
  precision10: number;
}

function dcg(relevances: readonly number[], limit = 10): number {
  return relevances.slice(0, limit).reduce(
    (sum, relevance, index) => sum + (2 ** relevance - 1) / Math.log2(index + 2),
    0
  );
}

export function evaluateRanking(
  ranking: readonly string[],
  judgments: readonly RelevanceJudgment[]
): RankingMetrics {
  const relevance = new Map(judgments.map((item) => [item.publicationId, item.relevance]));
  const rankedRelevance = ranking.map((publicationId) => relevance.get(publicationId) ?? 0);
  const ideal = judgments.map((item) => item.relevance).sort((a, b) => b - a);
  const idealDcg = dcg(ideal);
  const relevant = new Set(
    judgments.filter((item) => item.relevance > 0).map((item) => item.publicationId)
  );
  return {
    ndcg10: idealDcg > 0 ? dcg(rankedRelevance) / idealDcg : 0,
    precision10: ranking.slice(0, 10).filter((publicationId) => relevant.has(publicationId)).length / 10
  };
}

export function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

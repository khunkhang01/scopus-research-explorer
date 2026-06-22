export interface RankingFeatures {
  bm25: number;
  keyword: number;
  refs: number;
  author: number;
  year: number;
}

export const DEFAULT_WEIGHTS: RankingFeatures = {
  bm25: 0.5,
  keyword: 0.15,
  refs: 0.2,
  author: 0.1,
  year: 0.05
};

export function aggregateTopThree(
  perSeed: readonly RankingFeatures[]
): RankingFeatures {
  const result = {} as RankingFeatures;
  for (const channel of Object.keys(DEFAULT_WEIGHTS) as Array<keyof RankingFeatures>) {
    const top = perSeed.map((item) => item[channel]).sort((a, b) => b - a).slice(0, 3);
    result[channel] = top.reduce((sum, value) => sum + value, 0) / Math.max(top.length, 1);
  }
  return result;
}

export function weightedScore(
  features: RankingFeatures,
  weights: RankingFeatures = DEFAULT_WEIGHTS,
  availableChannels: ReadonlySet<keyof RankingFeatures> = new Set(
    Object.keys(DEFAULT_WEIGHTS) as Array<keyof RankingFeatures>
  )
): number {
  const active = (Object.keys(weights) as Array<keyof RankingFeatures>)
    .filter((channel) => availableChannels.has(channel));
  const denominator = active.reduce((sum, channel) => sum + weights[channel], 0);
  if (!denominator) return 0;
  return active.reduce(
    (sum, channel) => sum + features[channel] * weights[channel] / denominator,
    0
  );
}

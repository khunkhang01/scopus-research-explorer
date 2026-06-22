import fs from "node:fs";

const [judgmentsPath, candidatePath, baselinePath] = process.argv.slice(2);
if (!judgmentsPath || !candidatePath || !baselinePath) {
  console.error(
    "Usage: node scripts/evaluate-quality.mjs judgments.json candidate-results.json baseline-results.json"
  );
  process.exit(2);
}

const judgments = JSON.parse(fs.readFileSync(judgmentsPath, "utf8"));
const candidateResults = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
const baselineResults = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

if (!Array.isArray(judgments.seeds) || judgments.seeds.length < 20) {
  throw new Error("Quality evaluation requires at least 20 seed sets.");
}
if (!Array.isArray(judgments.evaluators) || new Set(judgments.evaluators).size < 2) {
  throw new Error("Quality evaluation requires at least two named evaluators.");
}

function dcg(relevances, limit = 10) {
  return relevances.slice(0, limit).reduce(
    (sum, relevance, index) => sum + (2 ** relevance - 1) / Math.log2(index + 2),
    0
  );
}

function resolvedJudgments(seed) {
  return seed.judgments.map((item) => {
    const ratings = item.ratings ?? [];
    const evaluatorIds = new Set(ratings.map((rating) => rating.evaluatorId));
    if (evaluatorIds.size < 2) {
      throw new Error(
        `Seed ${seed.seedId}, publication ${item.publicationId} has fewer than two ratings.`
      );
    }
    if (ratings.some((rating) =>
      !Number.isInteger(rating.relevance) || rating.relevance < 0 || rating.relevance > 3
    )) {
      throw new Error(
        `Seed ${seed.seedId}, publication ${item.publicationId} requires integer relevance ratings from 0 to 3.`
      );
    }
    const values = new Set(ratings.map((rating) => rating.relevance));
    if (values.size > 1 && item.adjudicatedRelevance == null) {
      throw new Error(
        `Seed ${seed.seedId}, publication ${item.publicationId} requires adjudication.`
      );
    }
    return {
      publicationId: item.publicationId,
      relevance: item.adjudicatedRelevance ?? ratings[0]?.relevance ?? 0
    };
  });
}

function metricsFor(ranking, resolved) {
  const relevance = new Map(resolved.map((item) => [item.publicationId, item.relevance]));
  const rankedRelevance = ranking.map((publicationId) => relevance.get(publicationId) ?? 0);
  const ideal = resolved.map((item) => item.relevance).sort((a, b) => b - a);
  const idealDcg = dcg(ideal);
  const relevant = new Set(
    resolved.filter((item) => item.relevance > 0).map((item) => item.publicationId)
  );
  return {
    ndcg10: idealDcg > 0 ? dcg(rankedRelevance) / idealDcg : 0,
    precision10: ranking.slice(0, 10)
      .filter((publicationId) => relevant.has(publicationId)).length / 10
  };
}

const perSeed = judgments.seeds.map((seed) => {
  const resolved = resolvedJudgments(seed);
  const candidate = metricsFor(candidateResults[seed.seedId] ?? [], resolved);
  const baseline = metricsFor(baselineResults[seed.seedId] ?? [], resolved);
  const relativeNdcgChange = baseline.ndcg10 > 0
    ? (candidate.ndcg10 - baseline.ndcg10) / baseline.ndcg10
    : candidate.ndcg10 > 0 ? 1 : 0;
  return {
    seedId: seed.seedId,
    candidate,
    baseline,
    relativeNdcgChange,
    dataQualityExplanation: seed.dataQualityExplanation
  };
});

const mean = (selector) => perSeed.reduce((sum, item) => sum + selector(item), 0) / perSeed.length;
const candidateMeanNdcg10 = mean((item) => item.candidate.ndcg10);
const baselineMeanNdcg10 = mean((item) => item.baseline.ndcg10);
const candidateMeanPrecision10 = mean((item) => item.candidate.precision10);
const baselineMeanPrecision10 = mean((item) => item.baseline.precision10);
const unexplainedRegressions = perSeed.filter(
  (item) => item.relativeNdcgChange < -0.2 && !item.dataQualityExplanation
);
const gates = {
  seedCountAtLeast20: perSeed.length >= 20,
  ndcgImprovesAtLeast10Percent: baselineMeanNdcg10 === 0
    ? candidateMeanNdcg10 > 0
    : candidateMeanNdcg10 >= baselineMeanNdcg10 * 1.1,
  precisionNotBelowBaseline: candidateMeanPrecision10 >= baselineMeanPrecision10,
  noUnexplainedRegressionOver20Percent: unexplainedRegressions.length === 0
};

const output = {
  seeds: perSeed.length,
  evaluators: [...new Set(judgments.evaluators)],
  candidateMeanNdcg10,
  baselineMeanNdcg10,
  candidateMeanPrecision10,
  baselineMeanPrecision10,
  unexplainedRegressions: unexplainedRegressions.map((item) => item.seedId),
  gates,
  perSeed
};
console.log(JSON.stringify(output, null, 2));
if (Object.values(gates).some((passed) => !passed)) process.exitCode = 1;

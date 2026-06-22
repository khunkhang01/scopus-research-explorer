import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "research-explorer-quality-"));
try {
  const judgments = {
    evaluators: ["reviewer-a", "reviewer-b"],
    seeds: []
  };
  const candidate = {};
  const baseline = {};
  for (let seedIndex = 0; seedIndex < 20; seedIndex++) {
    const seedId = `seed-${seedIndex}`;
    const publicationIds = Array.from({ length: 10 }, (_, index) => `${seedId}-paper-${index}`);
    judgments.seeds.push({
      seedId,
      judgments: publicationIds.map((publicationId, index) => ({
        publicationId,
        ratings: [
          { evaluatorId: "reviewer-a", relevance: index < 3 ? 3 - index : 0 },
          { evaluatorId: "reviewer-b", relevance: index < 3 ? 3 - index : 0 }
        ]
      }))
    });
    candidate[seedId] = publicationIds;
    baseline[seedId] = [...publicationIds].reverse();
  }
  const judgmentsPath = path.join(directory, "judgments.json");
  const candidatePath = path.join(directory, "candidate.json");
  const baselinePath = path.join(directory, "baseline.json");
  await Promise.all([
    fs.writeFile(judgmentsPath, JSON.stringify(judgments)),
    fs.writeFile(candidatePath, JSON.stringify(candidate)),
    fs.writeFile(baselinePath, JSON.stringify(baseline))
  ]);
  const result = spawnSync(process.execPath, [
    path.resolve("scripts/evaluate-quality.mjs"),
    judgmentsPath,
    candidatePath,
    baselinePath
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  process.stdout.write(result.stdout);
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}

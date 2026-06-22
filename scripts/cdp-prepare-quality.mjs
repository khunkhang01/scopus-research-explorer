import fs from "node:fs/promises";
import path from "node:path";

const [sourcePath, outputDirectory] = process.argv.slice(2);
if (!sourcePath || !outputDirectory) {
  console.error("Usage: node scripts/cdp-prepare-quality.mjs <scopus-export.csv> <output-directory>");
  process.exit(2);
}
const absoluteSource = path.resolve(sourcePath);
const absoluteOutput = path.resolve(outputDirectory);
const escapedSource = absoluteSource.replaceAll("\\", "\\\\");
const port = Number(process.env.CDP_PORT ?? 9222);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = targets.find((target) => target.type === "page" && target.url === "app://obsidian.md/index.html");
if (!page) throw new Error("Obsidian renderer target not found.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;
socket.onmessage = (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id) return;
  const resolver = pending.get(message.id);
  if (!resolver) return;
  pending.delete(message.id);
  message.error ? resolver.reject(new Error(message.error.message)) : resolver.resolve(message.result);
};
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result.value;
}

const dataset = await evaluate(`(async () => {
  const api = app.plugins.plugins["scopus-research-explorer"]?.api;
  if (!api) throw new Error("Plugin API is unavailable");
  const workspace = await api.createWorkspace({name: "Quality Preparation " + crypto.randomUUID()});
  try {
    const preflight = await api.getPreflightCapabilities(["${escapedSource}"]);
    await api.importScopusCsv(preflight.preflightId, {
      workspaceId: workspace.workspaceId,
      mode: "upsert-identifiers",
      searchProvenance: {
        database: "Scopus",
        exportedAt: new Date().toISOString(),
        notes: "Quality dataset preparation"
      }
    });
    const publications = await api.research({workspaceId: workspace.workspaceId, limit: 500});
    if (publications.length < 20) {
      throw new Error("Quality preparation requires a corpus with at least 20 publications.");
    }
    const seeds = publications.slice(0, 20);
    const judgments = {
      evaluators: ["reviewer-a", "reviewer-b"],
      seeds: []
    };
    const candidateResults = {};
    const baselineResults = {};
    for (const seed of seeds) {
      const exploration = await api.explore({
        workspaceId: workspace.workspaceId,
        seedPublicationIds: [seed.publicationId],
        mode: "similar",
        limit: 100
      });
      const candidate = exploration.items.slice(0, 10);
      const seedKeywords = new Set(
        [...seed.authorKeywords, ...seed.indexKeywords].map((keyword) => keyword.toLocaleLowerCase())
      );
      const baselineCandidates = await api.research({
        workspaceId: workspace.workspaceId,
        fullText: [seed.title, ...seedKeywords].join(" "),
        limit: 500
      });
      const keywordJaccard = (publication) => {
        const candidateKeywords = new Set(
          [...publication.authorKeywords, ...publication.indexKeywords]
            .map((keyword) => keyword.toLocaleLowerCase())
        );
        if (!seedKeywords.size && !candidateKeywords.size) return 0;
        let intersection = 0;
        for (const keyword of seedKeywords) if (candidateKeywords.has(keyword)) intersection++;
        return intersection / (seedKeywords.size + candidateKeywords.size - intersection);
      };
      const baseline = baselineCandidates
        .filter((publication) => publication.publicationId !== seed.publicationId)
        .sort((left, right) => {
          return keywordJaccard(right) - keywordJaccard(left) ||
            (right.citationCount ?? 0) - (left.citationCount ?? 0) ||
            right.publicationId.localeCompare(left.publicationId);
        })
        .slice(0, 10);
      candidateResults[seed.publicationId] = candidate.map((item) => item.publication.publicationId);
      baselineResults[seed.publicationId] = baseline.map((publication) => publication.publicationId);
      const pool = new Map(
        [
          ...candidate.map((item) => item.publication),
          ...baseline
        ].map((publication) => [publication.publicationId, publication])
      );
      judgments.seeds.push({
        seedId: seed.publicationId,
        seed: {title: seed.title, year: seed.year},
        judgments: [...pool.values()].map((publication) => ({
          publicationId: publication.publicationId,
          title: publication.title,
          year: publication.year,
          ratings: [
            {evaluatorId: "reviewer-a", relevance: null},
            {evaluatorId: "reviewer-b", relevance: null}
          ],
          adjudicatedRelevance: null
        }))
      });
    }
    return {
      metadata: {
        sourceFile: ${JSON.stringify(path.basename(absoluteSource))},
        generatedAt: new Date().toISOString(),
        corpusSize: publications.length,
        seedCount: seeds.length,
        instructions: "Each evaluator assigns integer relevance 0-3. Set adjudicatedRelevance when ratings disagree."
      },
      judgments,
      candidateResults,
      baselineResults
    };
  } finally {
    await api.deleteWorkspace(workspace.workspaceId);
  }
})()`);

socket.close();
await fs.mkdir(absoluteOutput, { recursive: true });
await Promise.all([
  fs.writeFile(
    path.join(absoluteOutput, "metadata.json"),
    JSON.stringify(dataset.metadata, null, 2)
  ),
  fs.writeFile(
    path.join(absoluteOutput, "judgments.json"),
    JSON.stringify(dataset.judgments, null, 2)
  ),
  fs.writeFile(
    path.join(absoluteOutput, "candidate-results.json"),
    JSON.stringify(dataset.candidateResults, null, 2)
  ),
  fs.writeFile(
    path.join(absoluteOutput, "baseline-results.json"),
    JSON.stringify(dataset.baselineResults, null, 2)
  )
]);
console.log(JSON.stringify(dataset.metadata, null, 2));

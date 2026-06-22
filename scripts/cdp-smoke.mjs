import fs from "node:fs/promises";
import path from "node:path";

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

const fixture = path.resolve("tests/fixtures/scopus-smoke.csv").replaceAll("\\", "\\\\");
const result = await evaluate(`(async () => {
  const plugin = app.plugins.plugins["scopus-research-explorer"];
  if (!plugin?.api) throw new Error("Plugin API is unavailable");
  const api = plugin.api;
  let workspace = (await api.listWorkspaces()).find((item) => item.name === "CDP Smoke Test");
  if (!workspace) workspace = await api.createWorkspace({name: "CDP Smoke Test"});
  const preflight = await api.getPreflightCapabilities(["${fixture}"]);
  const report = await api.importScopusCsv(preflight.preflightId, {
    workspaceId: workspace.workspaceId,
    mode: "upsert-identifiers",
    searchProvenance: {database: "Scopus", exportedAt: new Date().toISOString(), query: "smoke test"}
  });
  const publications = await api.research({workspaceId: workspace.workspaceId, limit: 20});
  const seed = publications.find((item) => item.doi === "10.1000/graph");
  if (!seed) throw new Error("Expected seed publication missing");
  const exploration = await api.explore({
    workspaceId: workspace.workspaceId,
    seedPublicationIds: [seed.publicationId],
    mode: "similar",
    limit: 10
  });
  const citedBy = await api.explore({
    workspaceId: workspace.workspaceId,
    seedPublicationIds: [seed.publicationId],
    mode: "cited-by-in-corpus",
    limit: 10
  });
  if (exploration.seedPublications.length !== 1) throw new Error("Exploration seed node missing");
  if (exploration.graphEdges.length < 1) throw new Error("Similarity graph edge missing");
  if (citedBy.graphEdges.length < 1) throw new Error("Citation graph edge missing");
  const explainedItem = exploration.items[0];
  if (!explainedItem || explainedItem.publicationId !== explainedItem.publication.publicationId) {
    throw new Error("Exploration item publication ID contract is inconsistent");
  }
  const explanation = await api.explainRecommendation(
    explainedItem.publicationId,
    exploration
  );
  if (explanation.publicationId !== explainedItem.publicationId) {
    throw new Error("Recommendation explanation contract failed");
  }
  const existingCollections = (await api.listCollections(workspace.workspaceId))
    .filter((item) => item.name === "Smoke Collection");
  const collection = existingCollections[0] ??
    await api.createCollection({workspaceId: workspace.workspaceId, name: "Smoke Collection"});
  for (const duplicate of existingCollections.slice(1)) {
    await api.deleteCollection(duplicate.collectionId);
  }
  await api.addPublicationsToCollection(collection.collectionId, [seed.publicationId]);
  const seeds = await api.getCollectionSeedIds(collection.collectionId);
  const notePath = await api.materializePublication(seed.publicationId, workspace.workspaceId);
  return {
    preflightRows: preflight.rowCount,
    created: report.created,
    publications: publications.length,
    resolvedEdges: report.resolvedReferenceEdges,
    explorationItems: exploration.items.length,
    explainedPublicationId: explanation.publicationId,
    similarityGraphEdges: exploration.graphEdges.length,
    citationGraphEdges: citedBy.graphEdges.length,
    collectionSeeds: seeds.length,
    notePath,
    capabilities: report.capabilities
  };
})()`);

socket.close();
await fs.writeFile("cdp-smoke-result.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

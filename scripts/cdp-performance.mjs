import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.env.CDP_PORT ?? 9222);
const publicationCount = Number(process.env.BENCHMARK_PUBLICATIONS ?? 10000);
const rankingRuns = Number(process.env.BENCHMARK_RANKING_RUNS ?? 10);
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

const apiFixturePath = path.resolve("tests/fixtures/generated-api-performance.csv");
const apiRows = ["Title,DOI,EID,Year,Authors,Author(s) ID,Abstract,Author Keywords,Cited by"];
for (let index = 0; index < publicationCount; index++) {
  apiRows.push(
    `"API Performance Paper ${index}",10.5100/${index},2-s2.0-51${String(index).padStart(5, "0")},` +
    `${2000 + index % 25},"Author ${index % 500}","API-${index % 500}",` +
    `"Graph discovery API performance topic ${index % 100}",` +
    `"graph; discovery; topic ${index % 100}",${index % 200}`
  );
}
await fs.writeFile(apiFixturePath, apiRows.join("\n"), "utf8");
const escapedApiFixturePath = apiFixturePath.replaceAll("\\", "\\\\");
let apiImportResult;
try {
  apiImportResult = await evaluate(`(async () => {
    const api = app.plugins.plugins["scopus-research-explorer"]?.api;
    if (!api) throw new Error("Plugin API is unavailable");
    const workspace = await api.createWorkspace({
      name: "Performance API " + crypto.randomUUID()
    });
    try {
      const preflight = await api.getPreflightCapabilities(["${escapedApiFixturePath}"]);
      const started = performance.now();
      const report = await api.importScopusCsv(preflight.preflightId, {
        workspaceId: workspace.workspaceId,
        mode: "upsert-identifiers",
        searchProvenance: {
          database: "Scopus",
          exportedAt: new Date().toISOString(),
          notes: "API-level performance validation"
        }
      });
      return {
        apiImportMs: performance.now() - started,
        apiImported: report.created,
        rawArchiveCreated: Boolean(report.rawArchivePath),
        backupWarning: report.backupWarning,
        rawArchiveWarning: report.rawArchiveWarning
      };
    } finally {
      await api.deleteWorkspace(workspace.workspaceId);
    }
  })()`);
} finally {
  await fs.rm(apiFixturePath, { force: true });
}

const workerPath = path.resolve("database.worker.js").replaceAll("\\", "\\\\");
const wasmPath = path.resolve("sqlite3.wasm").replaceAll("\\", "\\\\");
const databaseResult = await evaluate(`(async () => {
  const fs = require("node:fs");
  const workerCode = fs.readFileSync("${workerPath}", "utf8");
  const wasmBytes = fs.readFileSync("${wasmPath}");
  const workerUrl = URL.createObjectURL(new Blob([workerCode], {type: "text/javascript"}));
  const wasmUrl = URL.createObjectURL(new Blob([wasmBytes], {type: "application/wasm"}));
  const worker = new Worker(workerUrl);
  const pending = new Map();
  worker.onmessage = (event) => {
    const item = pending.get(event.data.id);
    if (!item || event.data.progress) return;
    pending.delete(event.data.id);
    event.data.ok ? item.resolve(event.data.result) : item.reject(
      Object.assign(new Error(event.data.error.message), event.data.error)
    );
  };
  const request = (type, payload) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    pending.set(id, {resolve, reject});
    worker.postMessage({id, type, payload});
  });
  const percentile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
  };
  let rows = ["Title,DOI,EID,Year,Authors,Author(s) ID,Abstract,Author Keywords,Cited by"];
  for (let index = 0; index < ${publicationCount}; index++) {
    rows.push(
      '"Performance Paper ' + index + '",10.5000/' + index + ',2-s2.0-5' +
      String(index).padStart(5, "0") + ',' + (2000 + index % 25) +
      ',"Author ' + (index % 500) + '","A-' + (index % 500) +
      '","Graph discovery semantic search topic ' + (index % 100) +
      '","graph; discovery; topic ' + (index % 100) + '",' + (index % 200)
    );
  }
  let csv = rows.join("\\n");
  const memoryBefore = process.memoryUsage().rss;
  await request("init", {
    vaultId: "performance-" + crypto.randomUUID(),
    wasmUrl
  });
  const workspace = await request("create-workspace", {name: "Performance"});
  let preflight = await request("preflight", {
    files: [{
      fileName: "performance.csv",
      path: "performance.csv",
      sourceFileHash: "performance-hash",
      content: csv
    }]
  });
  const longTasks = [];
  const observer = typeof PerformanceObserver === "function"
    ? new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    })
    : null;
  observer?.observe({entryTypes: ["longtask"]});
  const importStarted = performance.now();
  const report = await request("commit-import", {
    preflightId: preflight.preflightId,
    options: {
      workspaceId: workspace.workspaceId,
      mode: "upsert-identifiers",
      searchProvenance: {database: "Scopus", exportedAt: new Date().toISOString()}
    },
    currentHashes: {"performance.csv": "performance-hash"}
  });
  const importMs = performance.now() - importStarted;
  observer?.disconnect();
  rows = [];
  csv = "";
  preflight = null;

  const searchTimes = [];
  for (let index = 0; index < 25; index++) {
    const started = performance.now();
    await request("research", {
      workspaceId: workspace.workspaceId,
      fullText: "graph discovery topic",
      limit: 100
    });
    searchTimes.push(performance.now() - started);
  }
  let seeds = await request("research", {
    workspaceId: workspace.workspaceId,
    limit: 3
  });
  const rankingTimes = [];
  let rankingItems = 0;
  for (let index = 0; index < ${rankingRuns}; index++) {
    const started = performance.now();
    const exploration = await request("explore", {
      workspaceId: workspace.workspaceId,
      seedPublicationIds: seeds.map((seed) => seed.publicationId),
      mode: "similar",
      limit: 100
    });
    rankingItems = exploration.items.length;
    rankingTimes.push(performance.now() - started);
  }
  seeds = [];
  globalThis.__researchExplorerPerformanceWorker = {
    worker,
    request,
    workerUrl,
    wasmUrl
  };
  return {
    imported: report.created,
    importMs,
    searchP95Ms: percentile(searchTimes, 0.95),
    rankingP95Ms: percentile(rankingTimes, 0.95),
    rankingItems,
    maxMainThreadTaskMs: Math.max(...longTasks, 0),
    memoryBeforeMb: memoryBefore / 1024 / 1024
  };
})()`);
await send("HeapProfiler.collectGarbage");
await new Promise((resolve) => setTimeout(resolve, 200));
const steadyMemory = await evaluate(`(async () => {
  const benchmark = globalThis.__researchExplorerPerformanceWorker;
  const workerMemory = await benchmark.request("memory-stats", {});
  const memoryAfter = process.memoryUsage().rss;
  return {
    memoryAfterMb: memoryAfter / 1024 / 1024,
    workerWasmMemoryMb: workerMemory.wasmMemoryBytes / 1024 / 1024,
    databaseMb: workerMemory.databaseBytes / 1024 / 1024,
    cachedStatements: workerMemory.cachedStatements
  };
})()`);
await evaluate(`(async () => {
  const benchmark = globalThis.__researchExplorerPerformanceWorker;
  await benchmark.request("destroy-storage", {});
  benchmark.worker.terminate();
  URL.revokeObjectURL(benchmark.workerUrl);
  URL.revokeObjectURL(benchmark.wasmUrl);
  delete globalThis.__researchExplorerPerformanceWorker;
})()`);
Object.assign(databaseResult, steadyMemory, {
  memoryDeltaMb: steadyMemory.memoryAfterMb - databaseResult.memoryBeforeMb
});
await fs.writeFile(
  "cdp-performance-database-result.json",
  JSON.stringify(databaseResult, null, 2)
);

const cytoscapeCode = await fs.readFile(
  path.resolve("node_modules/cytoscape/dist/cytoscape.min.js"),
  "utf8"
);
await evaluate(cytoscapeCode);
await evaluate("globalThis.__researchExplorerBenchCytoscape = globalThis.cytoscape");
const graphResult = await evaluate(`(() => {
  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "fixed", left: "-2000px", top: "0", width: "1200px", height: "800px"
  });
  document.body.appendChild(container);
  const elements = [];
  for (let index = 0; index < 300; index++) {
    elements.push({data: {id: "n" + index, label: "Paper " + index}});
    if (index > 0) elements.push({
      data: {id: "e" + index, source: "n" + Math.floor((index - 1) / 2), target: "n" + index}
    });
  }
  const started = performance.now();
  const graph = globalThis.__researchExplorerBenchCytoscape({
    container,
    elements,
    style: [{selector: "node", style: {label: "data(label)"}}],
    layout: {
      name: "cose",
      animate: false,
      randomize: false,
      quality: "draft",
      numIter: 150,
      nodeRepulsion: 200000,
      idealEdgeLength: 80
    }
  });
  const renderMs = performance.now() - started;
  graph.destroy();
  container.remove();
  delete globalThis.__researchExplorerBenchCytoscape;
  return {nodes: 300, renderMs};
})()`);

socket.close();
const result = {
  ...apiImportResult,
  ...databaseResult,
  graphNodes: graphResult.nodes,
  graphRenderMs: graphResult.renderMs,
  gates: {
    importUnder60s: Math.max(databaseResult.importMs, apiImportResult.apiImportMs) <= 60000,
    publicImportArchivedAndBackedUp: apiImportResult.rawArchiveCreated &&
      !apiImportResult.backupWarning &&
      !apiImportResult.rawArchiveWarning,
    searchP95Under300ms: databaseResult.searchP95Ms < 300,
    rankingP95Under2s: databaseResult.rankingP95Ms < 2000,
    graphUnder2s: graphResult.renderMs < 2000,
    mainThreadUnder50ms: databaseResult.maxMainThreadTaskMs <= 50,
    pluginWorkingSetDeltaUnder500Mb: databaseResult.memoryDeltaMb < 500
  }
};
await fs.writeFile("cdp-performance-result.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (Object.values(result.gates).some((passed) => !passed)) process.exitCode = 1;

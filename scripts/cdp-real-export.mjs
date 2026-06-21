import fs from "node:fs/promises";
import path from "node:path";

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("Usage: node scripts/cdp-real-export.mjs <scopus-export.csv>");
  process.exit(2);
}
const absoluteSource = path.resolve(sourcePath);
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

const result = await evaluate(`(async () => {
  const api = app.plugins.plugins["scopus-research-explorer"]?.api;
  if (!api) throw new Error("Plugin API is unavailable");
  const workspace = await api.createWorkspace({name: "Real Export Validation " + crypto.randomUUID()});
  const started = performance.now();
  try {
    const preflight = await api.getPreflightCapabilities(["${escapedSource}"]);
    const report = await api.importScopusCsv(preflight.preflightId, {
      workspaceId: workspace.workspaceId,
      mode: "upsert-identifiers",
      searchProvenance: {
        database: "Scopus",
        exportedAt: new Date().toISOString(),
        notes: "Automated real-export compatibility validation"
      }
    });
    const archiveDirectory = require("node:path").join(
      app.vault.adapter.getBasePath(),
      report.rawArchivePath
    );
    const archiveManifest = require("node:path").join(archiveDirectory, "manifest.json");
    const archiveExists = require("node:fs").existsSync(archiveManifest);
    if (!archiveExists) throw new Error("Raw Scopus source archive was not created");
    const publications = await api.research({workspaceId: workspace.workspaceId, limit: 10});
    let explorationItems = 0;
    if (publications.length > 1) {
      const exploration = await api.explore({
        workspaceId: workspace.workspaceId,
        seedPublicationIds: [publications[0].publicationId],
        mode: "similar",
        limit: 10
      });
      explorationItems = exploration.items.length;
    }
    return {
      sourceFile: ${JSON.stringify(path.basename(absoluteSource))},
      elapsedMs: performance.now() - started,
      preflight: {
        rowCount: preflight.rowCount,
        invalidRows: preflight.invalidRows,
        duplicateRows: preflight.duplicateRows,
        conflictingRows: preflight.conflictingRows,
        probableDuplicateRows: preflight.probableDuplicateRows,
        recordsWithAbstract: preflight.recordsWithAbstract,
        recordsWithReferences: preflight.recordsWithReferences,
        recordsWithAuthorIds: preflight.recordsWithAuthorIds,
        recordsWithAffiliations: preflight.recordsWithAffiliations,
        availableColumnCount: preflight.availableColumns.length,
        warnings: preflight.warnings
      },
      import: {
        created: report.created,
        updated: report.updated,
        unchanged: report.unchanged,
        rejected: report.rejected,
        resolvedReferenceEdges: report.resolvedReferenceEdges,
        rawArchivePath: report.rawArchivePath,
        rawArchiveExists: archiveExists
      },
      capabilities: report.capabilities,
      explorationItems
    };
  } finally {
    await api.deleteWorkspace(workspace.workspaceId);
  }
})()`);

socket.close();
await fs.writeFile("cdp-real-export-result.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

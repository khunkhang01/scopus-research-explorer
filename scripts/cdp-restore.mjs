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

const schema = JSON.parse(await fs.readFile(path.resolve("../../..", ".research-explorer/schema.json"), "utf8"));
const namespace = `.research-explorer-${schema.vaultId}`;
const result = await evaluate(`(async () => {
  const pluginId = "scopus-research-explorer";
  const api = app.plugins.plugins[pluginId]?.api;
  if (!api) throw new Error("Plugin API is unavailable");
  const beforeWorkspace = (await api.listWorkspaces()).find((item) => item.name === "CDP Smoke Test");
  const before = await api.getCorpusCapabilities(beforeWorkspace.workspaceId);
  await app.plugins.disablePlugin(pluginId);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(${JSON.stringify(namespace)}, {recursive: true});
  await app.plugins.enablePlugin(pluginId);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const restoredApi = app.plugins.plugins[pluginId]?.api;
  if (!restoredApi) throw new Error("Plugin failed to initialize after OPFS removal");
  const afterWorkspace = (await restoredApi.listWorkspaces()).find((item) => item.name === "CDP Smoke Test");
  const after = await restoredApi.getCorpusCapabilities(afterWorkspace.workspaceId);
  if (before.publicationCount !== after.publicationCount ||
      before.resolvedReferenceEdges !== after.resolvedReferenceEdges) {
    throw new Error("Portable backup restore did not reproduce the corpus");
  }
  return {
    namespace: ${JSON.stringify(namespace)},
    beforePublications: before.publicationCount,
    afterPublications: after.publicationCount,
    beforeEdges: before.resolvedReferenceEdges,
    afterEdges: after.resolvedReferenceEdges,
    restoredCorpusVersion: after.corpusVersion
  };
})()`);

socket.close();
await fs.writeFile("cdp-restore-result.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

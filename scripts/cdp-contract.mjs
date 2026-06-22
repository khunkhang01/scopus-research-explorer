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

const fixture = (name) => path.resolve("tests/fixtures", name).replaceAll("\\", "\\\\");
const generatedPath = path.resolve("tests/fixtures/generated-cancellation.csv");
const sourceChangedPath = path.resolve("tests/fixtures/generated-source-change.csv");
const generatedRows = ["Title,DOI,EID,Year,Abstract,Author Keywords"];
for (let index = 0; index < 1500; index++) {
  generatedRows.push(
    `"Cancellation Paper ${index}",10.4000/${index},2-s2.0-4${String(index).padStart(4, "0")},2024,` +
    `"Cancellation test abstract ${index}","cancellation; worker"`
  );
}
await fs.writeFile(generatedPath, generatedRows.join("\n"), "utf8");
await fs.copyFile(
  path.resolve("tests/fixtures/closed-corpus-target.csv"),
  sourceChangedPath
);

const result = await evaluate(`(async () => {
  const api = app.plugins.plugins["scopus-research-explorer"]?.api;
  if (!api) throw new Error("Plugin API is unavailable");
  const getWorkspace = async (name) => {
    let workspace = (await api.listWorkspaces()).find((item) => item.name === name);
    if (!workspace) workspace = await api.createWorkspace({name});
    return workspace;
  };
  const importFile = async (workspace, file, mode = "upsert-identifiers", control) => {
    const preflight = await api.getPreflightCapabilities([file]);
    return api.importScopusCsv(preflight.preflightId, {
      workspaceId: workspace.workspaceId,
      mode,
      searchProvenance: {database: "Scopus", exportedAt: new Date().toISOString()}
    }, control);
  };

  const validationWorkspace = await getWorkspace("Contract Validation");
  const emptyCapabilitiesA = await api.getCorpusCapabilities(validationWorkspace.workspaceId);
  const emptyCapabilitiesB = await api.getCorpusCapabilities(validationWorkspace.workspaceId);
  if (emptyCapabilitiesA.corpusVersion !== emptyCapabilitiesB.corpusVersion) {
    throw new Error("Empty workspace corpus version is not stable");
  }
  let invalidLimitError = "";
  try {
    await api.research({workspaceId: validationWorkspace.workspaceId, limit: 501});
  } catch (error) {
    invalidLimitError = error.name;
  }
  if (invalidLimitError !== "ValidationError") {
    throw new Error("Research limit above 500 was not rejected");
  }
  const titleOnlyWorkspace = await getWorkspace("Contract Title Only");
  await importFile(titleOnlyWorkspace, "${fixture("title-only.csv")}");
  const titleOnlyPublications = await api.research({
    workspaceId: titleOnlyWorkspace.workspaceId,
    limit: 10
  });
  const titleOnlyExploration = await api.explore({
    workspaceId: titleOnlyWorkspace.workspaceId,
    seedPublicationIds: [titleOnlyPublications[0].publicationId],
    mode: "similar",
    limit: 10
  });
  if (!titleOnlyExploration.items.length ||
      titleOnlyExploration.items.some((item) => item.confidence >= 1)) {
    throw new Error("Title-only discovery did not return low-data confidence");
  }

  const sourceWorkspace = await getWorkspace("Contract Closed Source");
  const targetWorkspace = await getWorkspace("Contract Closed Target");
  await importFile(sourceWorkspace, "${fixture("closed-corpus-source.csv")}");
  await importFile(targetWorkspace, "${fixture("closed-corpus-target.csv")}");
  await importFile(sourceWorkspace, "${fixture("closed-corpus-source.csv")}");
  const sourceCapabilities = await api.getCorpusCapabilities(sourceWorkspace.workspaceId);
  if (sourceCapabilities.resolvedReferenceEdges !== 0) {
    throw new Error("Cross-workspace reference was incorrectly resolved");
  }
  await importFile(sourceWorkspace, "${fixture("closed-corpus-target.csv")}");
  const sourceWithTargetCapabilities = await api.getCorpusCapabilities(sourceWorkspace.workspaceId);
  if (sourceWithTargetCapabilities.resolvedReferenceEdges !== 1) {
    throw new Error("In-workspace reference did not resolve");
  }
  const isolationWorkspace = await getWorkspace("Contract Edge Isolation");
  await importFile(isolationWorkspace, "${fixture("closed-corpus-source.csv")}");
  const isolationCapabilities = await api.getCorpusCapabilities(isolationWorkspace.workspaceId);
  const preservedSourceCapabilities = await api.getCorpusCapabilities(sourceWorkspace.workspaceId);
  if (isolationCapabilities.resolvedReferenceEdges !== 0 ||
      preservedSourceCapabilities.resolvedReferenceEdges !== 1) {
    throw new Error("Resolving a shared publication leaked citation state between workspaces");
  }
  const sourcePaper = (await api.research({workspaceId: isolationWorkspace.workspaceId, limit: 10}))[0];
  let capabilityErrorName = "";
  try {
    await api.explore({
      workspaceId: isolationWorkspace.workspaceId,
      seedPublicationIds: [sourcePaper.publicationId],
      mode: "references"
    });
  } catch (error) {
    capabilityErrorName = error.constructor.name;
  }
  if (capabilityErrorName !== "CapabilityUnavailableError") {
    throw new Error("Expected typed CapabilityUnavailableError, got " + capabilityErrorName);
  }
  const targetPaper = (await api.research({workspaceId: targetWorkspace.workspaceId, limit: 10}))[0];
  const scopedCollection = await api.createCollection({
    workspaceId: isolationWorkspace.workspaceId,
    name: "Scoped collection",
    color: "#123456",
    labels: ["contract"]
  });
  let crossWorkspaceCollectionError = "";
  try {
    await api.addPublicationsToCollection(scopedCollection.collectionId, [targetPaper.publicationId]);
  } catch (error) {
    crossWorkspaceCollectionError = error.name;
  }
  if (crossWorkspaceCollectionError !== "ValidationError") {
    throw new Error("Collection accepted a publication outside its workspace");
  }
  await api.addPublicationsToCollection(scopedCollection.collectionId, [sourcePaper.publicationId]);
  const collectionAfterAdd = await api.getCollectionSeedIds(scopedCollection.collectionId);
  await api.removePublicationsFromCollection(scopedCollection.collectionId, [sourcePaper.publicationId]);
  const collectionAfterRemove = await api.getCollectionSeedIds(scopedCollection.collectionId);
  if (collectionAfterAdd.length !== 1 || collectionAfterRemove.length !== 0) {
    throw new Error("Collection add/remove lifecycle failed");
  }

  const conflictWorkspace = await getWorkspace("Contract Rollback");
  await importFile(conflictWorkspace, "${fixture("conflict-base.csv")}");
  const beforeConflict = await api.getCorpusCapabilities(conflictWorkspace.workspaceId);
  let conflictCode = "";
  try {
    await importFile(conflictWorkspace, "${fixture("conflict-batch.csv")}");
  } catch (error) {
    conflictCode = error.code;
  }
  const afterConflict = await api.getCorpusCapabilities(conflictWorkspace.workspaceId);
  const rollbackRecord = await api.research({
    workspaceId: conflictWorkspace.workspaceId,
    titleContains: "Must Roll Back",
    limit: 10
  });
  if (conflictCode !== "IDENTIFIER_CONFLICT" ||
      beforeConflict.publicationCount !== afterConflict.publicationCount ||
      beforeConflict.importIds.length !== afterConflict.importIds.length ||
      rollbackRecord.length !== 0) {
    throw new Error("Conflicting batch did not roll back atomically");
  }

  const cancelWorkspace = await api.createWorkspace({
    name: "Contract Cancellation " + crypto.randomUUID()
  });
  const cancelPreflight = await api.getPreflightCapabilities([
    "${generatedPath.replaceAll("\\", "\\\\")}"
  ]);
  const controller = new AbortController();
  let cancellationName = "";
  try {
    await api.importScopusCsv(cancelPreflight.preflightId, {
      workspaceId: cancelWorkspace.workspaceId,
      mode: "upsert-identifiers",
      searchProvenance: {database: "Scopus", exportedAt: new Date().toISOString()}
    }, {
      signal: controller.signal,
      onProgress: ({phase, completed}) => {
        if (phase === "import" && completed >= 100) controller.abort();
      }
    });
  } catch (error) {
    cancellationName = error.constructor.name;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const afterCancellation = await api.getCorpusCapabilities(cancelWorkspace.workspaceId);
  if (cancellationName !== "OperationCancelledError" ||
      afterCancellation.publicationCount !== 0 ||
      afterCancellation.importIds.length !== 0) {
    throw new Error("Cancelled import did not roll back atomically");
  }

  const sourceChangeWorkspace = await api.createWorkspace({
    name: "Contract Source Change " + crypto.randomUUID()
  });
  const sourceChangePreflight = await api.getPreflightCapabilities([
    "${sourceChangedPath.replaceAll("\\", "\\\\")}"
  ]);
  require("node:fs").appendFileSync(
    "${sourceChangedPath.replaceAll("\\", "\\\\")}",
    "\\n"
  );
  let sourceChangedName = "";
  try {
    await api.importScopusCsv(sourceChangePreflight.preflightId, {
      workspaceId: sourceChangeWorkspace.workspaceId,
      mode: "upsert-identifiers",
      searchProvenance: {database: "Scopus", exportedAt: new Date().toISOString()}
    });
  } catch (error) {
    sourceChangedName = error.constructor.name;
  }
  if (sourceChangedName !== "SourceChangedError") {
    throw new Error("Expected typed SourceChangedError, got " + sourceChangedName);
  }

  const smokeWorkspace = (await api.listWorkspaces()).find((item) => item.name === "CDP Smoke Test");
  const smokePapers = await api.research({workspaceId: smokeWorkspace.workspaceId, limit: 20});
  const seed = smokePapers.find((item) => item.doi === "10.1000/graph");
  const request = {
    workspaceId: smokeWorkspace.workspaceId,
    seedPublicationIds: [seed.publicationId],
    mode: "similar",
    limit: 100
  };
  const first = await api.explore(request);
  const second = await api.explore(request);
  const firstOrder = first.items.map((item) => item.publication.publicationId);
  const secondOrder = second.items.map((item) => item.publication.publicationId);
  if (JSON.stringify(firstOrder) !== JSON.stringify(secondOrder)) {
    throw new Error("Ranking is not deterministic");
  }
  let duplicateSeedError = "";
  try {
    await api.explore({
      ...request,
      seedPublicationIds: [seed.publicationId, seed.publicationId]
    });
  } catch (error) {
    duplicateSeedError = error.name;
  }
  if (duplicateSeedError !== "ValidationError") {
    throw new Error("Duplicate seed IDs were not rejected");
  }
  const notePath = await api.materializePublication(seed.publicationId, smokeWorkspace.workspaceId);
  const noteFile = app.vault.getAbstractFileByPath(notePath);
  const marker = "Contract user note: preserve me.";
  const originalNote = await app.vault.read(noteFile);
  const noteWithUserData = originalNote.replace(
    "---\\n",
    "---\\nuser_rating: 5\\n"
  ) + "\\n" + marker + "\\n";
  await app.vault.modify(noteFile, noteWithUserData);
  await api.materializePublication(seed.publicationId, smokeWorkspace.workspaceId);
  const materializedNote = await app.vault.read(noteFile);
  const markerCount = materializedNote.split(marker).length - 1;
  const managedStartCount = materializedNote.split("research-explorer:managed:start").length - 1;
  const managedEndCount = materializedNote.split("research-explorer:managed:end").length - 1;
  const userFrontmatterPreserved = materializedNote.includes("user_rating: 5");
  const corpusMetricFrontmatterPresent =
    materializedNote.includes("research_explorer_references_in_corpus:");
  await app.vault.modify(
    noteFile,
    materializedNote
      .replace("user_rating: 5\\n", "")
      .replace("\\n" + marker + "\\n", "\\n")
  );
  if (markerCount !== 1 || managedStartCount !== 1 || managedEndCount !== 1 ||
      !userFrontmatterPreserved || !corpusMetricFrontmatterPresent) {
    throw new Error("Markdown materialization is not idempotent or overwrote user content");
  }

  const output = {
    closedCorpusEdges: sourceCapabilities.resolvedReferenceEdges,
    stableEmptyCorpusVersion: emptyCapabilitiesA.corpusVersion,
    invalidLimitError,
    titleOnlyConfidence: titleOnlyExploration.items.map((item) => item.confidence),
    preservedWorkspaceEdges: preservedSourceCapabilities.resolvedReferenceEdges,
    isolatedWorkspaceEdges: isolationCapabilities.resolvedReferenceEdges,
    capabilityErrorName,
    crossWorkspaceCollectionError,
    collectionAfterAdd: collectionAfterAdd.length,
    collectionAfterRemove: collectionAfterRemove.length,
    conflictCode,
    rollbackPublicationCount: afterConflict.publicationCount,
    cancellationName,
    cancelledPublicationCount: afterCancellation.publicationCount,
    sourceChangedName,
    deterministicOrder: firstOrder,
    duplicateSeedError,
    confidence: first.items.map((item) => item.confidence),
    noteMarkerCount: markerCount,
    userFrontmatterPreserved,
    corpusMetricFrontmatterPresent,
    managedStartCount,
    managedEndCount
  };
  const contractWorkspaces = (await api.listWorkspaces())
    .filter((workspace) => workspace.name.startsWith("Contract "));
  for (const workspace of contractWorkspaces) {
    await api.deleteWorkspace(workspace.workspaceId);
  }
  return output;
})()`);

socket.close();
await fs.rm(generatedPath, { force: true });
await fs.rm(sourceChangedPath, { force: true });
await fs.writeFile("cdp-contract-result.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

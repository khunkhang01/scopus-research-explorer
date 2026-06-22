import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { App, FileSystemAdapter } from "obsidian";
import type {
  CorpusCapabilityReport,
  CreateCollectionInput,
  CreateWorkspaceInput,
  ExplorationRequest,
  ExplorationContext,
  ExplorationResult,
  ImportReport,
  OperationControl,
  PluginSettings,
  PreflightOptions,
  PreflightCapabilityReport,
  PublicationRecord,
  ReadingState,
  RecommendationExplanation,
  ResearchCollection,
  ResearchQuery,
  RuntimeCapabilityReport,
  ScopusImportOptions,
  Workspace
} from "../types";
import { DatabaseWorkerClient } from "../database/worker-client";
import type { SourcePayload } from "../database/protocol";
import { UnsupportedDatabaseRuntimeError } from "../errors";
import { decodeCsvBytes } from "../domain/csv-encoding";
import { NoteMaterializer } from "./note-materializer";
import { SemanticScholarClient, type RequestFn } from "../semantic-scholar/client";
import { mapSsPaperToRecord } from "../semantic-scholar/mapper";
import type { SemanticScholarImportOptions, SemanticScholarImportResult } from "../semantic-scholar/types";

interface VaultSchema {
  schemaVersion: 1;
  vaultId: string;
}

interface BackupManifest {
  schemaVersion: number;
  vaultId: string;
  checksum: string;
  corpusVersion?: string;
  corpusVersions?: Record<string, string>;
  createdAt: string;
}

export interface ResearchExplorerMvpApi {
  readonly apiVersion: "1";
  getRuntimeCapabilities(): RuntimeCapabilityReport;
  getPreflightCapabilities(paths: string[], options?: PreflightOptions): Promise<PreflightCapabilityReport>;
  importScopusCsv(
    preflightId: string,
    options: ScopusImportOptions,
    control?: OperationControl
  ): Promise<ImportReport>;
  getCorpusCapabilities(workspaceId: string): Promise<CorpusCapabilityReport>;
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  listWorkspaces(): Promise<Workspace[]>;
  getWorkspace(workspaceId: string): Promise<Workspace | null>;
  renameWorkspace(workspaceId: string, name: string): Promise<Workspace>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  research(query: ResearchQuery): Promise<PublicationRecord[]>;
  getPublication(publicationId: string, workspaceId: string): Promise<PublicationRecord | null>;
  materializePublication(publicationId: string, workspaceId: string): Promise<string>;
  explore(request: ExplorationRequest): Promise<ExplorationResult>;
  explainRecommendation(
    publicationId: string,
    context: ExplorationContext
  ): Promise<RecommendationExplanation>;
  createCollection(input: CreateCollectionInput): Promise<ResearchCollection>;
  listCollections(workspaceId: string): Promise<ResearchCollection[]>;
  deleteCollection(collectionId: string): Promise<void>;
  addPublicationsToCollection(collectionId: string, publicationIds: string[]): Promise<ResearchCollection>;
  removePublicationsFromCollection(collectionId: string, publicationIds: string[]): Promise<ResearchCollection>;
  getCollectionSeedIds(collectionId: string): Promise<string[]>;
  setReadingState(workspaceId: string, publicationId: string, state: ReadingState): Promise<void>;
  searchAndImportSemanticScholar(
    options: SemanticScholarImportOptions,
    onProgress?: (event: { stage: string; count?: number; total?: number; paperId?: string }) => void,
    signal?: AbortSignal
  ): Promise<SemanticScholarImportResult>;
}

export class ResearchApi implements ResearchExplorerMvpApi {
  readonly apiVersion = "1" as const;
  private client: DatabaseWorkerClient | undefined;
  private readonly preflightPaths = new Map<string, { paths: string[]; encoding: PreflightOptions["encoding"]; tempDir?: string }>();
  private vaultId = "";
  private wasmUrl?: string;
  private runtimeCapabilities: RuntimeCapabilityReport = {
    supported: false,
    webAssembly: false,
    worker: false,
    opfs: false,
    opfsSahPool: false,
    fts5: false
  };

  constructor(
    private readonly app: App,
    private readonly pluginDirectory: string,
    private readonly settings: PluginSettings,
    private readonly onBackupWarning?: (warning?: string) => Promise<void>,
    private readonly semanticScholarRequestFn?: RequestFn
  ) {}

  async initialize(): Promise<void> {
    const webAssembly = typeof WebAssembly === "object";
    const worker = typeof Worker === "function";
    const opfs = typeof navigator?.storage?.getDirectory === "function";
    this.runtimeCapabilities = {
      supported: false,
      webAssembly,
      worker,
      opfs,
      opfsSahPool: false,
      fts5: false
    };
    if (!webAssembly || !worker || !opfs) {
      throw new UnsupportedDatabaseRuntimeError(
        "This Obsidian runtime does not provide WebAssembly, Worker, and OPFS.",
        this.runtimeCapabilities
      );
    }
    const basePath = this.basePath();
    const storageRoot = path.join(basePath, ".research-explorer");
    const databaseDir = path.join(storageRoot, "database");
    await fs.mkdir(databaseDir, { recursive: true });
    const schemaPath = path.join(storageRoot, "schema.json");
    let schema: VaultSchema;
    try {
      schema = JSON.parse(await fs.readFile(schemaPath, "utf8")) as VaultSchema;
    } catch {
      schema = { schemaVersion: 1, vaultId: randomUUID() };
      await fs.writeFile(schemaPath, JSON.stringify(schema, null, 2), "utf8");
    }
    this.vaultId = schema.vaultId;
    try {
      const workerScript = await fs.readFile(
        path.join(this.pluginDirectory, "database.worker.js"),
        "utf8"
      );
      const workerUrl = URL.createObjectURL(new Blob([workerScript], { type: "text/javascript" }));
      const wasmBytes = await fs.readFile(path.join(this.pluginDirectory, "sqlite3.wasm"));
      this.wasmUrl = URL.createObjectURL(new Blob([wasmBytes], { type: "application/wasm" }));
      this.client = new DatabaseWorkerClient(workerUrl);
      const backupPath = path.join(databaseDir, "portable-backup.sqlite3");
      let restoreBytes: Uint8Array | undefined;
      let invalidBackupReason: string | undefined;
      try {
        const bytes = new Uint8Array(await fs.readFile(backupPath));
        const manifest = JSON.parse(
          await fs.readFile(path.join(databaseDir, "backup-manifest.json"), "utf8")
        ) as BackupManifest;
        const checksum = createHash("sha256").update(bytes).digest("hex");
        if (manifest.vaultId !== this.vaultId) {
          invalidBackupReason = "backup vault ID does not match this vault";
        } else if (manifest.checksum !== checksum) {
          invalidBackupReason = "backup checksum does not match its manifest";
        } else {
          restoreBytes = bytes;
        }
      } catch (error) {
        restoreBytes = undefined;
        try {
          await fs.access(backupPath);
          invalidBackupReason = error instanceof Error ? error.message : String(error);
        } catch {
          invalidBackupReason = undefined;
        }
      }
      const initialized = await this.requireClient().request("init", {
        vaultId: this.vaultId,
        wasmUrl: this.wasmUrl,
        restoreBytes,
        invalidBackupReason
      });
      this.runtimeCapabilities = {
        supported: true,
        webAssembly: true,
        worker: true,
        opfs: true,
        opfsSahPool: true,
        fts5: true,
        runtimeName: initialized.runtime,
        schemaVersion: initialized.schemaVersion
      };
      if (initialized.migrated) {
        try {
          await this.backup();
          await this.onBackupWarning?.(undefined);
        } catch (error) {
          await this.onBackupWarning?.(error instanceof Error ? error.message : String(error));
        }
      }
      await this.reconcileRawArchives();
    } catch (error) {
      this.client?.terminate();
      this.client = undefined;
      if (this.wasmUrl) URL.revokeObjectURL(this.wasmUrl);
      this.wasmUrl = undefined;
      throw error;
    }
  }

  async dispose(): Promise<void> {
    if (!this.client) return;
    try {
      try {
        await this.backup();
        await this.onBackupWarning?.(undefined);
      } catch (error) {
        await this.onBackupWarning?.(error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.client.terminate();
      this.client = undefined;
      if (this.wasmUrl) URL.revokeObjectURL(this.wasmUrl);
      this.wasmUrl = undefined;
    }
  }

  async backup(): Promise<void> {
    const metadata = await this.requireClient().request("backup-metadata", {});
    const bytes = await this.requireClient().request("export-backup", {});
    const databaseDir = path.join(this.basePath(), ".research-explorer", "database");
    const finalPath = path.join(databaseDir, "portable-backup.sqlite3");
    const temporaryPath = `${finalPath}.tmp`;
    await fs.mkdir(databaseDir, { recursive: true });
    await fs.writeFile(temporaryPath, bytes);
    // Windows does not allow rename over an existing file that is open/locked,
    // so we explicitly delete the destination first.
    try { await fs.rm(finalPath, { force: true }); } catch { /* ignore */ }
    await fs.rename(temporaryPath, finalPath);
    const manifest = {
      schemaVersion: metadata.schemaVersion,
      vaultId: this.vaultId,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      corpusVersion: Object.values(metadata.corpusVersions).sort().at(-1),
      corpusVersions: metadata.corpusVersions,
      createdAt: new Date().toISOString()
    };
    const manifestPath = path.join(databaseDir, "backup-manifest.json");
    const temporaryManifestPath = `${manifestPath}.tmp`;
    await fs.writeFile(temporaryManifestPath, JSON.stringify(manifest, null, 2), "utf8");
    await fs.rename(temporaryManifestPath, manifestPath);
  }

  getRuntimeCapabilities(): RuntimeCapabilityReport {
    return { ...this.runtimeCapabilities };
  }

  async getPreflightCapabilities(
    paths: string[],
    options: PreflightOptions = {}
  ): Promise<PreflightCapabilityReport> {
    if (!paths.length) throw new Error("Choose at least one CSV file.");
    const files = await Promise.all(paths.map((filePath) => this.readSource(filePath, options.encoding)));
    const report = await this.requireClient().request("preflight", { files }, [], options);
    this.preflightPaths.set(report.preflightId, { paths, encoding: options.encoding });
    return report;
  }

  // File objects from <input type="file"> — file.path is not exposed in Obsidian's
  // contextIsolation renderer, so we write bytes to a temp directory and use those paths.
  async getPreflightCapabilitiesFromFiles(
    files: File[],
    options: PreflightOptions = {}
  ): Promise<PreflightCapabilityReport> {
    if (!files.length) throw new Error("Choose at least one CSV file.");
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scopus-import-"));
    const tempPaths: string[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const tempPath = path.join(tempDir, file.name);
      await fs.writeFile(tempPath, buffer);
      tempPaths.push(tempPath);
    }
    const sources = await Promise.all(tempPaths.map((p) => this.readSource(p, options.encoding)));
    const report = await this.requireClient().request("preflight", { files: sources }, [], options);
    this.preflightPaths.set(report.preflightId, { paths: tempPaths, encoding: options.encoding, tempDir });
    return report;
  }

  async importScopusCsv(
    preflightId: string,
    options: ScopusImportOptions,
    control: OperationControl = {}
  ): Promise<ImportReport> {
    const preflight = this.preflightPaths.get(preflightId);
    if (!preflight) throw new Error("Preflight has expired. Please validate the CSV again.");
    const currentHashes = Object.fromEntries(
      await Promise.all(preflight.paths.map(async (filePath) => {
        const source = await this.readSource(filePath, preflight.encoding);
        return [filePath, source.sourceFileHash] as const;
      }))
    );
    const report = await this.requireClient().request("commit-import", {
      preflightId,
      options,
      currentHashes
    }, [], control);
    this.preflightPaths.delete(preflightId);
    try {
      report.rawArchivePath = await this.archiveRawSources(
        report.importId,
        preflight.paths,
        currentHashes,
        options
      );
    } catch (error) {
      report.rawArchiveWarning = error instanceof Error ? error.message : String(error);
      report.warnings.push(`Raw source archive failed: ${report.rawArchiveWarning}`);
    } finally {
      if (preflight.tempDir) {
        fs.rm(preflight.tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
    try {
      await this.backup();
      await this.onBackupWarning?.(undefined);
    } catch (error) {
      report.backupWarning = error instanceof Error ? error.message : String(error);
      await this.onBackupWarning?.(report.backupWarning);
    }
    return report;
  }

  getCorpusCapabilities(workspaceId: string): Promise<CorpusCapabilityReport> {
    return this.requireClient().request("get-capabilities", { workspaceId });
  }

  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    return this.requireClient().request("create-workspace", input);
  }

  listWorkspaces(): Promise<Workspace[]> {
    return this.requireClient().request("list-workspaces", {});
  }

  getWorkspace(workspaceId: string): Promise<Workspace | null> {
    return this.requireClient().request("get-workspace", { workspaceId });
  }

  renameWorkspace(workspaceId: string, name: string): Promise<Workspace> {
    return this.requireClient().request("rename-workspace", { workspaceId, name });
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const capabilities = await this.getCorpusCapabilities(workspaceId);
    await this.requireClient().request("delete-workspace", { workspaceId });
    for (const importId of capabilities.importIds) {
      await this.removeRawArchive(importId);
    }
    try {
      await this.backup();
      await this.onBackupWarning?.(undefined);
    } catch (error) {
      await this.onBackupWarning?.(error instanceof Error ? error.message : String(error));
    }
  }

  research(query: ResearchQuery): Promise<PublicationRecord[]> {
    return this.requireClient().request("research", query);
  }

  getPublication(publicationId: string, workspaceId: string): Promise<PublicationRecord | null> {
    return this.requireClient().request("get-publication", { publicationId, workspaceId });
  }

  async materializePublication(publicationId: string, workspaceId: string): Promise<string> {
    const publication = await this.getPublication(publicationId, workspaceId);
    if (!publication) throw new Error("Publication not found in this workspace.");
    return new NoteMaterializer(this.app, this.settings.notesFolder).materialize(publication);
  }

  explore(request: ExplorationRequest): Promise<ExplorationResult> {
    return this.requireClient().request("explore", request);
  }

  async explainRecommendation(
    publicationId: string,
    context: ExplorationContext
  ): Promise<RecommendationExplanation> {
    const item = context.items.find((candidate) => candidate.publicationId === publicationId);
    if (!item) throw new Error("Publication is not present in this exploration result.");
    return {
      publicationId,
      score: item.score,
      summary: item.evidence.map((evidence) => evidence.explanation).join(" "),
      evidence: item.evidence
    };
  }

  createCollection(input: CreateCollectionInput): Promise<ResearchCollection> {
    return this.requireClient().request("create-collection", input);
  }

  listCollections(workspaceId: string): Promise<ResearchCollection[]> {
    return this.requireClient().request("list-collections", { workspaceId });
  }

  deleteCollection(collectionId: string): Promise<void> {
    return this.requireClient().request("delete-collection", { collectionId });
  }

  addPublicationsToCollection(collectionId: string, publicationIds: string[]): Promise<ResearchCollection> {
    return this.requireClient().request("add-to-collection", { collectionId, publicationIds });
  }

  removePublicationsFromCollection(collectionId: string, publicationIds: string[]): Promise<ResearchCollection> {
    return this.requireClient().request("remove-from-collection", { collectionId, publicationIds });
  }

  getCollectionSeedIds(collectionId: string): Promise<string[]> {
    return this.requireClient().request("collection-seeds", { collectionId });
  }

  setReadingState(workspaceId: string, publicationId: string, state: ReadingState): Promise<void> {
    return this.requireClient().request("set-reading-state", { workspaceId, publicationId, state });
  }

  async searchAndImportSemanticScholar(
    options: SemanticScholarImportOptions,
    onProgress?: (event: { stage: string; count?: number; total?: number; paperId?: string }) => void,
    signal?: AbortSignal
  ): Promise<SemanticScholarImportResult> {
    if (!this.semanticScholarRequestFn) {
      throw new Error("Semantic Scholar transport is unavailable.");
    }
    const client = new SemanticScholarClient(options.apiKey, this.semanticScholarRequestFn);
    const searchResponse = await client.searchPapers(options.query, options.limit);
    onProgress?.({ stage: "fetched", count: searchResponse.data.length, total: searchResponse.total });

    let records = searchResponse.data.map((p) => mapSsPaperToRecord(p, options.workspaceId));

    if (options.fetchReferences) {
      for (const paper of searchResponse.data) {
        if (signal?.aborted) break;
        try {
          const refs = await client.getReferences(paper.paperId);
          const refRecords = refs.data
            .map((r) => mapSsPaperToRecord(r.citedPaper, options.workspaceId))
            .filter((r) => r.title !== "(no title)");
          records = [...records, ...refRecords];
          onProgress?.({ stage: "references", paperId: paper.paperId });
        } catch {
          // Non-fatal: reference fetch failure skips that paper's references
        }
      }
    }

    const result = await this.requireClient().request("commit-semantic-scholar-import", {
      workspaceId: options.workspaceId,
      records,
      searchProvenance: {
        query: options.query,
        exportedAt: new Date().toISOString(),
        database: "semantic-scholar" as const,
      },
    });

    try {
      await this.backup();
      await this.onBackupWarning?.(undefined);
    } catch (error) {
      await this.onBackupWarning?.(error instanceof Error ? error.message : String(error));
    }

    return result;
  }

  getNotesFolder(): string {
    return this.settings.notesFolder;
  }

  private async readSource(
    filePath: string,
    encoding: PreflightOptions["encoding"] = "auto"
  ): Promise<SourcePayload> {
    const bytes = await fs.readFile(filePath);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const { content } = decodeCsvBytes(bytes, encoding);
    return {
      fileName: path.basename(filePath),
      path: filePath,
      sourceFileHash: hash,
      content
    };
  }

  private async archiveRawSources(
    importId: string,
    sourcePaths: string[],
    sourceHashes: Record<string, string>,
    options: ScopusImportOptions
  ): Promise<string> {
    const relativeDirectory = path.join(".research-explorer", "imports", importId);
    const finalDirectory = path.join(this.basePath(), relativeDirectory);
    const temporaryDirectory = `${finalDirectory}.tmp`;
    await fs.mkdir(temporaryDirectory, { recursive: true });
    try {
      const archivedFiles: Array<{
        originalPath: string;
        archiveFile: string;
        sourceFileHash: string;
      }> = [];
      for (let index = 0; index < sourcePaths.length; index++) {
        const sourcePath = sourcePaths[index];
        if (!sourcePath) continue;
        const archiveFile = `${String(index + 1).padStart(3, "0")}-${path.basename(sourcePath)}`;
        await fs.copyFile(sourcePath, path.join(temporaryDirectory, archiveFile));
        archivedFiles.push({
          originalPath: sourcePath,
          archiveFile,
          sourceFileHash: sourceHashes[sourcePath] ?? ""
        });
      }
      await fs.writeFile(
        path.join(temporaryDirectory, "manifest.json"),
        JSON.stringify({
          importId,
          workspaceId: options.workspaceId,
          mode: options.mode,
          searchProvenance: options.searchProvenance,
          archivedAt: new Date().toISOString(),
          files: archivedFiles
        }, null, 2),
        "utf8"
      );
      await fs.mkdir(path.dirname(finalDirectory), { recursive: true });
      await fs.rename(temporaryDirectory, finalDirectory);
      return relativeDirectory.replaceAll("\\", "/");
    } catch (error) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  private async reconcileRawArchives(): Promise<void> {
    const importsDirectory = path.join(this.basePath(), ".research-explorer", "imports");
    const liveImportIds = new Set(await this.requireClient().request("list-import-ids", {}));
    let entries;
    try {
      entries = await fs.readdir(importsDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !liveImportIds.has(entry.name)) {
        await this.removeRawArchive(entry.name);
      }
    }
  }

  private async removeRawArchive(importId: string): Promise<void> {
    await fs.rm(
      path.join(this.basePath(), ".research-explorer", "imports", importId),
      {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 100
      }
    );
  }

  private basePath(): string {
    return (this.app.vault.adapter as FileSystemAdapter).getBasePath();
  }

  private requireClient(): DatabaseWorkerClient {
    if (!this.client) throw new Error("Research database is not initialized.");
    return this.client;
  }
}

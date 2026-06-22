/// <reference lib="webworker" />

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { parseScopusCsv, splitReferences, type CanonicalScopusRow } from "../domain/scopus";
import { normalizeDoi, normalizeEid, normalizeScopusId, normalizeTitle, titleYearKey } from "../domain/identifiers";
import { jaccard, median, tokenize } from "../domain/text-analysis";
import { aggregateTopThree, weightedScore, type RankingFeatures } from "../domain/ranking";
import type {
  CorpusCapabilityReport,
  ExplorationRequest,
  ExplorationResult,
  ExplorationResultItem,
  ImportReport,
  PreflightCapabilityReport,
  PublicationRecord,
  RecommendationEvidence,
  ResearchCollection,
  ResearchQuery,
  Workspace
} from "../types";
import type { SourcePayload, WorkerRequest, WorkerResponse } from "./protocol";

type Sqlite = Awaited<ReturnType<typeof sqlite3InitModule>>;
type Database = InstanceType<Sqlite["oo1"]["DB"]>;
type PoolUtil = Awaited<ReturnType<Sqlite["installOpfsSAHPoolVfs"]>>;

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const DB_PATH = "/corpus.sqlite3";
const SCHEMA_VERSION = 5;
const RANKING_VERSION = "mvp-ranking-v1";
const TEXT_VERSION = "mvp-text-v1";

let sqlite3: Sqlite;
let pool: PoolUtil;
let db: Database;
let vaultId = "";
const statementCache = new Map<string, any>();

interface PreflightCache {
  report: PreflightCapabilityReport;
  files: SourcePayload[];
  rows: Array<CanonicalScopusRow & { sourcePath: string; sourceHash: string }>;
}

const preflights = new Map<string, PreflightCache>();
const cancelledRequests = new Set<string>();

function throwIfCancelled(requestId: string): void {
  if (!cancelledRequests.has(requestId)) return;
  cancelledRequests.delete(requestId);
  throw Object.assign(new Error("The operation was cancelled."), {
    code: "OPERATION_CANCELLED",
    details: { requestId }
  });
}

function reportProgress(requestId: string, phase: string, completed: number, total: number): void {
  ctx.postMessage({
    id: requestId,
    ok: true,
    progress: { phase, completed, total }
  } satisfies WorkerResponse);
}

async function yieldToWorker(delayMs = 0): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

const SCHEMA = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS workspaces(
  workspace_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS imports(
  import_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  source_files_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_imports(
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  import_id TEXT NOT NULL REFERENCES imports(import_id) ON DELETE CASCADE,
  PRIMARY KEY(workspace_id, import_id)
);
CREATE TABLE IF NOT EXISTS publications(
  publication_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  abstract TEXT,
  year INTEGER,
  authors_json TEXT NOT NULL DEFAULT '[]',
  author_ids_json TEXT NOT NULL DEFAULT '[]',
  affiliations_json TEXT NOT NULL DEFAULT '[]',
  author_keywords_json TEXT NOT NULL DEFAULT '[]',
  index_keywords_json TEXT NOT NULL DEFAULT '[]',
  source_title TEXT,
  document_type TEXT,
  citation_count INTEGER,
  source_fields_json TEXT NOT NULL DEFAULT '{}',
  semantic_scholar_id TEXT,
  data_source TEXT DEFAULT 'scopus',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publications_semantic_scholar_id
  ON publications(semantic_scholar_id) WHERE semantic_scholar_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_publications_data_source
  ON publications(data_source);
CREATE TABLE IF NOT EXISTS publication_identifiers(
  publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE CASCADE,
  identifier_type TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  PRIMARY KEY(identifier_type, identifier_value)
);
CREATE INDEX IF NOT EXISTS idx_publication_identifiers_publication
  ON publication_identifiers(publication_id,identifier_type);
CREATE TABLE IF NOT EXISTS workspace_publications(
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE CASCADE,
  PRIMARY KEY(workspace_id, publication_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_publications_workspace
  ON workspace_publications(workspace_id,publication_id);
CREATE TABLE IF NOT EXISTS field_provenance(
  provenance_id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES imports(import_id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  source_column TEXT NOT NULL,
  source_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS authors(
  author_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publication_authors(
  publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES authors(author_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY(publication_id, author_id)
);
CREATE TABLE IF NOT EXISTS "references"(
  reference_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  source_publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  normalized_doi TEXT,
  parsed_eid TEXT,
  parsed_scopus_id TEXT,
  parsed_title TEXT,
  parsed_year INTEGER,
  target_publication_id TEXT REFERENCES publications(publication_id),
  resolution_method TEXT NOT NULL,
  matched_identifier TEXT,
  confidence REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS citation_edges(
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  source_publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE CASCADE,
  target_publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE CASCADE,
  reference_id TEXT NOT NULL REFERENCES "references"(reference_id) ON DELETE CASCADE,
  resolution_method TEXT NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY(source_publication_id, target_publication_id, reference_id)
);
CREATE INDEX IF NOT EXISTS idx_citation_edges_target
  ON citation_edges(workspace_id,target_publication_id,source_publication_id);
CREATE TABLE IF NOT EXISTS collections(
  collection_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_publications(
  collection_id TEXT NOT NULL REFERENCES collections(collection_id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY(collection_id, publication_id)
);
CREATE TABLE IF NOT EXISTS workspace_publication_state(
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE CASCADE,
  reading_state TEXT NOT NULL CHECK(reading_state IN ('unread','reading','read')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, publication_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_state_publication
  ON workspace_publication_state(publication_id,workspace_id);
CREATE TABLE IF NOT EXISTS corpus_meta(
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  corpus_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS publications_fts USING fts5(
  publication_id UNINDEXED,
  title,
  keywords,
  abstract,
  tokenize='unicode61'
);
`;

function now(): string {
  return new Date().toISOString();
}

function validatedLimit(value: number | undefined, fallback = 100): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw Object.assign(new Error("Limit must be an integer between 1 and 1000."), {
      code: "VALIDATION_ERROR",
      details: { limit }
    });
  }
  return limit;
}

function rows<T extends Record<string, unknown>>(sql: string, bind?: unknown[]): T[] {
  if (bind) {
    let statement = statementCache.get(sql);
    if (!statement) {
      statement = (db as any).prepare(sql);
      statementCache.set(sql, statement);
    }
    const result: T[] = [];
    try {
      statement.bind(bind);
      while (statement.step()) result.push(statement.get({}) as T);
      return result;
    } finally {
      statement.reset(true);
    }
  }
  const result: T[] = [];
  (db as any).exec({
    sql,
    bind,
    rowMode: "object",
    callback: (row: T) => result.push(row)
  });
  return result;
}

function run(sql: string, bind?: unknown[]): void {
  if (bind) {
    let statement = statementCache.get(sql);
    if (!statement) {
      statement = (db as any).prepare(sql);
      statementCache.set(sql, statement);
    }
    try {
      statement.bind(bind).step();
    } finally {
      statement.reset(true);
    }
    return;
  }
  (db as any).exec({ sql, bind });
}

function clearStatementCache(): void {
  for (const statement of statementCache.values()) statement.finalize();
  statementCache.clear();
}

function scalar<T>(sql: string, bind?: unknown[]): T | undefined {
  const row = rows<Record<string, T>>(sql, bind)[0];
  return row ? Object.values(row)[0] : undefined;
}

function jsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function publicationFromRow(row: Record<string, unknown>): PublicationRecord {
  return {
    publicationId: String(row.publication_id),
    eid: row.eid ? String(row.eid) : undefined,
    doi: row.doi ? String(row.doi) : undefined,
    scopusId: row.scopus_id ? String(row.scopus_id) : undefined,
    semanticScholarId: row.semantic_scholar_id ? String(row.semantic_scholar_id) : undefined,
    dataSource: row.data_source ? String(row.data_source) as PublicationRecord["dataSource"] : undefined,
    title: String(row.title),
    abstract: row.abstract ? String(row.abstract) : undefined,
    year: typeof row.year === "number" ? row.year : row.year ? Number(row.year) : undefined,
    authors: jsonArray(row.authors_json),
    authorIds: jsonArray(row.author_ids_json),
    affiliations: jsonArray(row.affiliations_json),
    authorKeywords: jsonArray(row.author_keywords_json),
    indexKeywords: jsonArray(row.index_keywords_json),
    sourceTitle: row.source_title ? String(row.source_title) : undefined,
    documentType: row.document_type ? String(row.document_type) : undefined,
    citationCount: row.citation_count == null ? undefined : Number(row.citation_count),
    referencesInCorpus: Number(row.references_in_corpus ?? 0),
    citedByInCorpus: Number(row.cited_by_in_corpus ?? 0),
    sourceFields: typeof row.source_fields_json === "string"
      ? JSON.parse(row.source_fields_json) as Record<string, string>
      : {},
    readingState: row.reading_state
      ? String(row.reading_state) as PublicationRecord["readingState"]
      : undefined
  };
}

function publicationSelect(workspaceId: string): string {
  return `
SELECT p.*,
  eid.identifier_value AS eid,
  doi.identifier_value AS doi,
  sid.identifier_value AS scopus_id,
  (SELECT COUNT(*) FROM citation_edges e
    WHERE e.workspace_id=wp.workspace_id AND e.source_publication_id=p.publication_id) AS references_in_corpus,
  (SELECT COUNT(*) FROM citation_edges e
    WHERE e.workspace_id=wp.workspace_id AND e.target_publication_id=p.publication_id) AS cited_by_in_corpus,
  s.reading_state
FROM publications p
JOIN workspace_publications wp ON wp.publication_id=p.publication_id AND wp.workspace_id=?
LEFT JOIN publication_identifiers eid ON eid.publication_id=p.publication_id AND eid.identifier_type='eid'
LEFT JOIN publication_identifiers doi ON doi.publication_id=p.publication_id AND doi.identifier_type='doi'
LEFT JOIN publication_identifiers sid ON sid.publication_id=p.publication_id AND sid.identifier_type='scopus_id'
LEFT JOIN workspace_publication_state s ON s.publication_id=p.publication_id AND s.workspace_id=wp.workspace_id`;
}

async function initialize(payload: {
  vaultId: string;
  wasmUrl: string;
  restoreBytes?: Uint8Array;
  invalidBackupReason?: string;
}): Promise<unknown> {
  vaultId = payload.vaultId;
  sqlite3 = await (sqlite3InitModule as unknown as (options: {
    locateFile: (file: string) => string;
  }) => Promise<Sqlite>)({
    locateFile: (file) => file === "sqlite3.wasm" ? payload.wasmUrl : new URL(file, ctx.location.href).href
  });
  pool = await sqlite3.installOpfsSAHPoolVfs({
    name: `research-explorer-${vaultId}`,
    directory: `.research-explorer-${vaultId}`,
    initialCapacity: 8,
    clearOnInit: false
  });
  const existedAtStartup = pool.getFileNames().includes(DB_PATH);
  if (!existedAtStartup && payload.invalidBackupReason) {
    throw Object.assign(new Error(
      `Portable backup cannot be restored: ${payload.invalidBackupReason}`
    ), {
      code: "UNSUPPORTED_DATABASE_RUNTIME",
      details: { invalidBackupReason: payload.invalidBackupReason }
    });
  }
  let restored = false;
  if (payload.restoreBytes?.byteLength && !existedAtStartup) {
    await pool.importDb(DB_PATH, payload.restoreBytes);
    restored = true;
  }
  const openDatabase = (): Database => new (sqlite3.oo1.DB as any)({
    filename: DB_PATH,
    flags: "c",
    vfs: pool.vfsName
  }) as Database;
  const isIntegrityValid = (): boolean => {
    try {
      return scalar<string>("PRAGMA quick_check") === "ok";
    } catch {
      return false;
    }
  };
  try {
    db = openDatabase();
    if (!isIntegrityValid()) throw new Error("SQLite integrity check failed.");
  } catch (error) {
    try {
      (db as any)?.close();
    } catch {
      // The failed connection may already be closed.
    }
    if (!payload.restoreBytes?.byteLength) {
      throw Object.assign(new Error("SQLite database is corrupt and no valid portable backup is available."), {
        code: "UNSUPPORTED_DATABASE_RUNTIME",
        details: { cause: error instanceof Error ? error.message : String(error) }
      });
    }
    pool.unlink(DB_PATH);
    await pool.importDb(DB_PATH, payload.restoreBytes);
    restored = true;
    db = openDatabase();
    if (!isIntegrityValid()) {
      throw Object.assign(new Error("Portable backup failed SQLite integrity validation."), {
        code: "UNSUPPORTED_DATABASE_RUNTIME"
      });
    }
  }
  run("PRAGMA foreign_keys=ON");
  const previousVersion = Number(scalar<number>("PRAGMA user_version") ?? 0);
  if (previousVersion > SCHEMA_VERSION) {
    throw Object.assign(new Error(
      `Database schema ${previousVersion} is newer than supported schema ${SCHEMA_VERSION}.`
    ), { code: "UNSUPPORTED_DATABASE_RUNTIME" });
  }
  let migrated = false;
  if (previousVersion < SCHEMA_VERSION) {
    run("BEGIN IMMEDIATE");
    try {
      if (previousVersion === 0) run(SCHEMA);
      if (previousVersion === 1) {
        run('DROP VIEW IF EXISTS "references"');
        run("ALTER TABLE reference_records ADD COLUMN parsed_scopus_id TEXT");
        run(
          `CREATE VIEW "references" AS
           SELECT reference_id,source_publication_id,raw_text,normalized_doi,parsed_eid,
             parsed_scopus_id,parsed_title,parsed_year,target_publication_id,
             resolution_method,confidence
           FROM reference_records`
        );
      }
      if (previousVersion >= 1 && previousVersion <= 2) {
        run('DROP VIEW IF EXISTS "references"');
        run("ALTER TABLE reference_records ADD COLUMN workspace_id TEXT");
        run("ALTER TABLE citation_edges ADD COLUMN workspace_id TEXT");
        run("DROP INDEX IF EXISTS idx_citation_edges_target");
        run(
          `CREATE INDEX idx_citation_edges_target
           ON citation_edges(workspace_id,target_publication_id,source_publication_id)`
        );
        run(
          `UPDATE reference_records
           SET workspace_id=(
             SELECT MIN(wp.workspace_id) FROM workspace_publications wp
             WHERE wp.publication_id=reference_records.source_publication_id
           )
           WHERE workspace_id IS NULL`
        );
        run(
          `UPDATE citation_edges
           SET workspace_id=(
             SELECT workspace_id FROM reference_records r
             WHERE r.reference_id=citation_edges.reference_id
           )
           WHERE workspace_id IS NULL`
        );
        run(
          `CREATE VIEW "references" AS
           SELECT reference_id,workspace_id,source_publication_id,raw_text,normalized_doi,
             parsed_eid,parsed_scopus_id,parsed_title,parsed_year,target_publication_id,
             resolution_method,confidence
           FROM reference_records`
        );
      }
      if (previousVersion >= 1 && previousVersion <= 3) {
        run('DROP VIEW IF EXISTS "references"');
        run('ALTER TABLE reference_records RENAME TO "references"');
        run('ALTER TABLE "references" ADD COLUMN matched_identifier TEXT');
        run(
          `UPDATE "references" SET matched_identifier=
            CASE resolution_method
              WHEN 'doi-exact' THEN normalized_doi
              WHEN 'eid-exact' THEN parsed_eid
              WHEN 'scopus-id-exact' THEN parsed_scopus_id
              WHEN 'title-year-exact' THEN parsed_title || '::' || parsed_year
              ELSE NULL
            END`
        );
      }
      if (previousVersion >= 1 && previousVersion <= 4) {
        run("ALTER TABLE publications ADD COLUMN semantic_scholar_id TEXT");
        run("ALTER TABLE publications ADD COLUMN data_source TEXT DEFAULT 'scopus'");
        run(
          "CREATE INDEX IF NOT EXISTS idx_publications_semantic_scholar_id ON publications(semantic_scholar_id) WHERE semantic_scholar_id IS NOT NULL"
        );
        run(
          "CREATE INDEX IF NOT EXISTS idx_publications_data_source ON publications(data_source)"
        );
      }
      run(`PRAGMA user_version=${SCHEMA_VERSION}`);
      run("COMMIT");
      migrated = true;
    } catch (error) {
      run("ROLLBACK");
      throw error;
    }
  }
  run(SCHEMA);
  const fts = scalar<string>("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled");
  if (!Number(fts)) throw new Error("SQLite runtime does not include FTS5");
  return {
    runtime: pool.vfsName,
    schemaVersion: SCHEMA_VERSION,
    migrated,
    restored,
    createdFresh: !existedAtStartup && !restored
  };
}

async function exportBackup(): Promise<Uint8Array> {
  clearStatementCache();
  (db as any).close();
  try {
    return await pool.exportFile(DB_PATH);
  } finally {
    db = new (sqlite3.oo1.DB as any)({
      filename: DB_PATH,
      flags: "c",
      vfs: pool.vfsName
    }) as Database;
    run("PRAGMA foreign_keys=ON");
  }
}

function backupMetadata(): { schemaVersion: number; corpusVersions: Record<string, string> } {
  return {
    schemaVersion: Number(scalar<number>("PRAGMA user_version") ?? SCHEMA_VERSION),
    corpusVersions: Object.fromEntries(rows<{ workspace_id: string; corpus_version: string }>(
      "SELECT workspace_id,corpus_version FROM corpus_meta ORDER BY workspace_id"
    ).map((item) => [item.workspace_id, item.corpus_version]))
  };
}

async function destroyStorage(): Promise<void> {
  clearStatementCache();
  (db as any).close();
  await pool.removeVfs();
}

async function memoryStats(): Promise<{
  wasmMemoryBytes: number;
  databaseBytes: number;
  cachedStatements: number;
}> {
  const bytes = await pool.exportFile(DB_PATH);
  const wasmMemory = (sqlite3.wasm as unknown as { memory: WebAssembly.Memory }).memory;
  return {
    wasmMemoryBytes: wasmMemory.buffer.byteLength,
    databaseBytes: bytes.byteLength,
    cachedStatements: statementCache.size
  };
}

async function preflight(requestId: string, files: SourcePayload[]): Promise<PreflightCapabilityReport> {
  const preflightId = crypto.randomUUID();
  const parsedFiles: Array<{ file: SourcePayload; parsed: ReturnType<typeof parseScopusCsv> }> = [];
  for (let index = 0; index < files.length; index++) {
    throwIfCancelled(requestId);
    const file = files[index];
    if (!file) continue;
    parsedFiles.push({ file, parsed: parseScopusCsv(file.content) });
    reportProgress(requestId, "preflight", index + 1, files.length);
    await yieldToWorker();
  }
  throwIfCancelled(requestId);
  const allRows = parsedFiles.flatMap(({ file, parsed }) =>
    parsed.rows.map((row) => ({ ...row, sourcePath: file.path, sourceHash: file.sourceFileHash }))
  );
  const identifierOwners = new Map<string, number>();
  const fingerprintOwners = new Map<string, number>();
  let duplicateRows = 0;
  let conflictingRows = 0;
  let probableDuplicateRows = 0;
  for (let index = 0; index < allRows.length; index++) {
    const row = allRows[index];
    if (!row) continue;
    const identities = [
      row.eid ? `eid:${row.eid}` : "",
      row.doi ? `doi:${row.doi}` : "",
      row.scopusId ? `scopus:${row.scopusId}` : ""
    ].filter(Boolean);
    const owners = new Set(
      identities.map((identity) => identifierOwners.get(identity)).filter(
        (owner): owner is number => owner != null
      )
    );
    if (owners.size > 0) duplicateRows++;
    if (owners.size > 1) conflictingRows++;
    const fingerprint = titleYearKey(row.title, row.year);
    if (fingerprint && fingerprintOwners.has(fingerprint) && owners.size === 0) {
      probableDuplicateRows++;
    }
    if (fingerprint && !fingerprintOwners.has(fingerprint)) fingerprintOwners.set(fingerprint, index);
    const canonicalOwner = [...owners][0] ?? index;
    for (const identity of identities) identifierOwners.set(identity, canonicalOwner);
  }
  const headers = [...new Set(parsedFiles.flatMap(({ parsed }) => parsed.headers))];
  const withReferences = allRows.filter((row) => row.referencesText).length;
  const report: PreflightCapabilityReport = {
    preflightId,
    sourceFiles: files.map(({ fileName, path, sourceFileHash }) => ({ fileName, path, sourceFileHash })),
    availableColumns: headers,
    rowCount: allRows.length,
    recordsWithAbstract: allRows.filter((row) => row.abstract).length,
    recordsWithReferences: withReferences,
    recordsWithAuthorIds: allRows.filter((row) => row.authorIds.length > 0).length,
    recordsWithAffiliations: allRows.filter((row) => row.affiliations.length > 0).length,
    duplicateRows,
    conflictingRows,
    probableDuplicateRows,
    invalidRows: parsedFiles.reduce((sum, item) => sum + item.parsed.errors.length, 0),
    potentialFeatures: [
      {
        feature: "lexical-similarity",
        status: allRows.some((row) => row.abstract || row.authorKeywords.length || row.indexKeywords.length)
          ? "available"
          : "degraded",
        reason: allRows.some((row) => row.abstract)
          ? "Title and abstract fields are available."
          : "Only title/keyword evidence is available.",
        requiredColumns: ["Title"]
      },
      {
        feature: "citation-graph",
        status: withReferences > 0 ? "available" : "unavailable",
        reason: withReferences > 0 ? "Reference text is available for resolution." : "References column is missing or empty.",
        requiredColumns: ["References"]
      }
    ],
    warnings: [
      ...parsedFiles.flatMap(({ file, parsed }) =>
        parsed.errors.map((error) => `${file.fileName}: ${error}`)
      ),
      ...(conflictingRows
        ? [`${conflictingRows} row(s) contain identifiers that point to conflicting records.`]
        : []),
      ...(probableDuplicateRows
        ? [`${probableDuplicateRows} probable title/year duplicate(s) were not auto-merged.`]
        : [])
    ]
  };
  preflights.set(preflightId, { report, files, rows: allRows });
  return report;
}

function lookupPublication(
  row: CanonicalScopusRow,
  identifierIndex: Map<string, string>
): string | undefined {
  const matches = new Set<string>();
  for (const [type, value] of [["eid", row.eid], ["doi", row.doi], ["scopus_id", row.scopusId]] as const) {
    if (!value) continue;
    const match = identifierIndex.get(`${type}:${value}`);
    if (match) matches.add(match);
  }
  if (matches.size > 1) {
    throw Object.assign(new Error("Identifiers in this row belong to different publications."), {
      code: "IDENTIFIER_CONFLICT",
      details: { rowNumber: row.rowNumber, matches: [...matches] }
    });
  }
  return [...matches][0];
}

function insertIdentifier(
  publicationId: string,
  type: string,
  value: string | undefined,
  identifierIndex: Map<string, string>
): void {
  if (!value) return;
  const key = `${type}:${value}`;
  const owner = identifierIndex.get(key);
  if (owner && owner !== publicationId) {
    throw Object.assign(new Error(`Identifier ${type}:${value} belongs to another publication.`), {
      code: "IDENTIFIER_CONFLICT",
      details: { type, value, publicationId, owner }
    });
  }
  run(
    "INSERT OR IGNORE INTO publication_identifiers(publication_id,identifier_type,identifier_value) VALUES(?,?,?)",
    [publicationId, type, value]
  );
  identifierIndex.set(key, publicationId);
}

function persistAuthors(publicationId: string): void {
  const publication = rows<{ authors_json: string; author_ids_json: string }>(
    "SELECT authors_json,author_ids_json FROM publications WHERE publication_id=?",
    [publicationId]
  )[0];
  if (!publication) return;
  const authors = jsonArray(publication.authors_json);
  const authorIds = jsonArray(publication.author_ids_json);
  if (!authors.length && !authorIds.length) return;
  run("DELETE FROM publication_authors WHERE publication_id=?", [publicationId]);
  const count = Math.max(authors.length, authorIds.length);
  for (let index = 0; index < count; index++) {
    const displayName = authors[index]?.trim() || `Scopus author ${authorIds[index] ?? index + 1}`;
    const authorId = authorIds[index]?.trim() || `name:${normalizeTitle(displayName)}`;
    run(
      `INSERT INTO authors(author_id,display_name) VALUES(?,?)
       ON CONFLICT(author_id) DO UPDATE SET
         display_name=CASE WHEN authors.display_name LIKE 'Scopus author %'
           THEN excluded.display_name ELSE authors.display_name END`,
      [authorId, displayName]
    );
    run(
      "INSERT INTO publication_authors(publication_id,author_id,ordinal) VALUES(?,?,?)",
      [publicationId, authorId, index]
    );
  }
}

function persistFieldProvenance(
  publicationId: string,
  importId: string,
  row: CanonicalScopusRow,
  sourceHash: string
): void {
  const canonicalByColumn = new Map(
    Object.entries(row.fieldSources).map(([fieldName, column]) => [column, fieldName])
  );
  for (const [sourceColumn, rawValue] of Object.entries(row.sourceFields)) {
    if (!rawValue) continue;
    const fieldName = canonicalByColumn.get(sourceColumn) ?? `sourceFields.${sourceColumn}`;
    run(
      `INSERT INTO field_provenance(
        provenance_id,import_id,publication_id,field_name,row_number,source_column,source_hash
      ) VALUES(?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), importId, publicationId, fieldName, row.rowNumber, sourceColumn, sourceHash]
    );
  }
}

function bulkInsert(
  table: string,
  columns: string[],
  values: unknown[][],
  conflictClause = "",
  chunkSize = 400
): void {
  for (let offset = 0; offset < values.length; offset += chunkSize) {
    const chunk = values.slice(offset, offset + chunkSize);
    if (!chunk.length) continue;
    const placeholders = chunk
      .map(() => `(${columns.map(() => "?").join(",")})`)
      .join(",");
    run(
      `INSERT INTO ${table}(${columns.join(",")}) VALUES ${placeholders} ${conflictClause}`,
      chunk.flat()
    );
  }
}

function bulkInsertNewPublications(
  plans: Array<{
    publicationId: string;
    row: CanonicalScopusRow & { sourceHash: string };
  }>,
  workspaceId: string,
  importId: string
): void {
  if (!plans.length) return;
  const timestamp = now();
  bulkInsert("publications", [
    "publication_id", "title", "normalized_title", "abstract", "year", "authors_json",
    "author_ids_json", "affiliations_json", "author_keywords_json", "index_keywords_json",
    "source_title", "document_type", "citation_count", "source_fields_json",
    "data_source", "created_at", "updated_at"
  ], plans.map(({ publicationId, row }) => [
    publicationId, row.title, normalizeTitle(row.title), row.abstract ?? null, row.year ?? null,
    JSON.stringify(row.authors), JSON.stringify(row.authorIds), JSON.stringify(row.affiliations),
    JSON.stringify(row.authorKeywords), JSON.stringify(row.indexKeywords), row.sourceTitle ?? null,
    row.documentType ?? null, row.citationCount ?? null, JSON.stringify(row.sourceFields),
    "scopus", timestamp, timestamp
  ]));

  const identifiers: unknown[][] = [];
  const authors: unknown[][] = [];
  const publicationAuthors: unknown[][] = [];
  const provenance: unknown[][] = [];
  for (const { publicationId, row } of plans) {
    for (const [type, value] of [
      ["eid", row.eid],
      ["doi", row.doi],
      ["scopus_id", row.scopusId]
    ] as const) {
      if (value) identifiers.push([publicationId, type, value]);
    }
    const authorCount = Math.max(row.authors.length, row.authorIds.length);
    for (let index = 0; index < authorCount; index++) {
      const displayName = row.authors[index]?.trim() ||
        `Scopus author ${row.authorIds[index] ?? index + 1}`;
      const authorId = row.authorIds[index]?.trim() || `name:${normalizeTitle(displayName)}`;
      authors.push([authorId, displayName]);
      publicationAuthors.push([publicationId, authorId, index]);
    }
    const canonicalByColumn = new Map(
      Object.entries(row.fieldSources).map(([fieldName, column]) => [column, fieldName])
    );
    for (const [sourceColumn, rawValue] of Object.entries(row.sourceFields)) {
      if (!rawValue) continue;
      provenance.push([
        crypto.randomUUID(),
        importId,
        publicationId,
        canonicalByColumn.get(sourceColumn) ?? `sourceFields.${sourceColumn}`,
        row.rowNumber,
        sourceColumn,
        row.sourceHash
      ]);
    }
  }
  bulkInsert(
    "publication_identifiers",
    ["publication_id", "identifier_type", "identifier_value"],
    identifiers,
    "ON CONFLICT(identifier_type,identifier_value) DO NOTHING"
  );
  bulkInsert(
    "workspace_publications",
    ["workspace_id", "publication_id"],
    plans.map(({ publicationId }) => [workspaceId, publicationId]),
    "ON CONFLICT(workspace_id,publication_id) DO NOTHING"
  );
  bulkInsert(
    "workspace_publication_state",
    ["workspace_id", "publication_id", "reading_state", "updated_at"],
    plans.map(({ publicationId }) => [workspaceId, publicationId, "unread", timestamp]),
    "ON CONFLICT(workspace_id,publication_id) DO NOTHING"
  );
  bulkInsert(
    "authors",
    ["author_id", "display_name"],
    authors,
    `ON CONFLICT(author_id) DO UPDATE SET
      display_name=CASE WHEN authors.display_name LIKE 'Scopus author %'
        THEN excluded.display_name ELSE authors.display_name END`
  );
  bulkInsert(
    "publication_authors",
    ["publication_id", "author_id", "ordinal"],
    publicationAuthors,
    "ON CONFLICT(publication_id,author_id) DO NOTHING"
  );
  bulkInsert("field_provenance", [
    "provenance_id", "import_id", "publication_id", "field_name",
    "row_number", "source_column", "source_hash"
  ], provenance);
  bulkInsert(
    "publications_fts",
    ["publication_id", "title", "keywords", "abstract"],
    plans.map(({ publicationId, row }) => [
      publicationId,
      row.title,
      [...row.authorKeywords, ...row.indexKeywords].join(" "),
      row.abstract ?? ""
    ])
  );
}

function upsertPublication(
  row: CanonicalScopusRow,
  workspaceId: string,
  importId: string,
  sourceHash: string,
  mode: "import-new" | "upsert-identifiers",
  identifierIndex: Map<string, string>
): "created" | "updated" | "unchanged" {
  let publicationId = lookupPublication(row, identifierIndex);
  const timestamp = now();
  let status: "created" | "updated" | "unchanged" = "unchanged";
  if (!publicationId) {
    publicationId = crypto.randomUUID();
    run(
      `INSERT INTO publications(
        publication_id,title,normalized_title,abstract,year,authors_json,author_ids_json,
        affiliations_json,author_keywords_json,index_keywords_json,source_title,document_type,
        citation_count,source_fields_json,data_source,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        publicationId, row.title, normalizeTitle(row.title), row.abstract ?? null, row.year ?? null,
        JSON.stringify(row.authors), JSON.stringify(row.authorIds), JSON.stringify(row.affiliations),
        JSON.stringify(row.authorKeywords), JSON.stringify(row.indexKeywords), row.sourceTitle ?? null,
        row.documentType ?? null, row.citationCount ?? null, JSON.stringify(row.sourceFields),
        "scopus", timestamp, timestamp
      ]
    );
    insertIdentifier(publicationId, "eid", row.eid, identifierIndex);
    insertIdentifier(publicationId, "doi", row.doi, identifierIndex);
    insertIdentifier(publicationId, "scopus_id", row.scopusId, identifierIndex);
    status = "created";
  } else if (mode === "upsert-identifiers") {
    const existing = rows<Record<string, unknown>>(
      "SELECT * FROM publications WHERE publication_id=?",
      [publicationId]
    )[0];
    if (!existing) throw new Error(`Missing publication ${publicationId}`);
    const mergedSourceFields = {
      ...(JSON.parse(String(existing.source_fields_json ?? "{}")) as Record<string, string>),
      ...Object.fromEntries(Object.entries(row.sourceFields).filter(([, value]) => value))
    };
    const sourceFieldsChanged = JSON.stringify(mergedSourceFields) !== String(existing.source_fields_json ?? "{}");
    const changes = [
      !existing.abstract && row.abstract,
      !existing.year && row.year,
      !existing.source_title && row.sourceTitle,
      !existing.document_type && row.documentType,
      existing.citation_count == null && row.citationCount != null,
      String(existing.authors_json) === "[]" && row.authors.length > 0,
      String(existing.author_ids_json) === "[]" && row.authorIds.length > 0,
      String(existing.affiliations_json) === "[]" && row.affiliations.length > 0,
      String(existing.author_keywords_json) === "[]" && row.authorKeywords.length > 0,
      String(existing.index_keywords_json) === "[]" && row.indexKeywords.length > 0,
      sourceFieldsChanged
    ].some(Boolean);
    if (changes) {
      run(
        `UPDATE publications SET
          abstract=COALESCE(abstract,?), year=COALESCE(year,?),
          source_title=COALESCE(source_title,?), document_type=COALESCE(document_type,?),
          citation_count=COALESCE(citation_count,?),
          authors_json=CASE WHEN authors_json='[]' THEN ? ELSE authors_json END,
          author_ids_json=CASE WHEN author_ids_json='[]' THEN ? ELSE author_ids_json END,
          affiliations_json=CASE WHEN affiliations_json='[]' THEN ? ELSE affiliations_json END,
          author_keywords_json=CASE WHEN author_keywords_json='[]' THEN ? ELSE author_keywords_json END,
          index_keywords_json=CASE WHEN index_keywords_json='[]' THEN ? ELSE index_keywords_json END,
          source_fields_json=?, updated_at=?
        WHERE publication_id=?`,
        [
          row.abstract ?? null, row.year ?? null, row.sourceTitle ?? null,
          row.documentType ?? null, row.citationCount ?? null,
          JSON.stringify(row.authors), JSON.stringify(row.authorIds), JSON.stringify(row.affiliations),
          JSON.stringify(row.authorKeywords), JSON.stringify(row.indexKeywords),
          JSON.stringify(mergedSourceFields), timestamp, publicationId
        ]
      );
      status = "updated";
    }
    insertIdentifier(publicationId, "eid", row.eid, identifierIndex);
    insertIdentifier(publicationId, "doi", row.doi, identifierIndex);
    insertIdentifier(publicationId, "scopus_id", row.scopusId, identifierIndex);
  }
  run(
    "INSERT OR IGNORE INTO workspace_publications(workspace_id,publication_id) VALUES(?,?)",
    [workspaceId, publicationId]
  );
  run(
    "INSERT OR IGNORE INTO workspace_publication_state(workspace_id,publication_id,reading_state,updated_at) VALUES(?,?,?,?)",
    [workspaceId, publicationId, "unread", timestamp]
  );
  persistAuthors(publicationId);
  persistFieldProvenance(publicationId, importId, row, sourceHash);
  const canonical = rows<{
    title: string;
    author_keywords_json: string;
    index_keywords_json: string;
    abstract: string | null;
  }>(
    "SELECT title,author_keywords_json,index_keywords_json,abstract FROM publications WHERE publication_id=?",
    [publicationId]
  )[0];
  if (!canonical) throw new Error(`Missing publication ${publicationId}`);
  run("DELETE FROM publications_fts WHERE publication_id=?", [publicationId]);
  run(
    "INSERT INTO publications_fts(publication_id,title,keywords,abstract) VALUES(?,?,?,?)",
    [
      publicationId,
      canonical.title,
      [...jsonArray(canonical.author_keywords_json), ...jsonArray(canonical.index_keywords_json)].join(" "),
      canonical.abstract ?? ""
    ]
  );
  return status;
}

function parseReference(rawText: string): {
  doi?: string;
  eid?: string;
  scopusId?: string;
  title?: string;
  year?: number;
} {
  const doi = normalizeDoi(rawText.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i)?.[0]);
  const eid = normalizeEid(rawText.match(/\b2-s2\.0-\d+\b/i)?.[0]);
  const scopusId = normalizeScopusId(
    rawText.match(/\bSCOPUS[_ -]?ID\s*[:=]\s*\d+\b/i)?.[0]
      ?.replace(/^.*?[:=]\s*/, "")
  );
  const yearMatch = rawText.match(/\b(19|20)\d{2}\b/);
  const titleMatch = rawText.match(/["“](.+?)["”]/);
  const fallbackTitle = rawText
    .split(",")
    .map((part) => part.trim())
    .filter((part) =>
      part.length >= 12 &&
      !/\b(19|20)\d{2}\b/.test(part) &&
      !/\b10\.\d{4,9}\//i.test(part) &&
      !/^(vol\.?|volume|pp\.?|pages?)\b/i.test(part)
    )
    .sort((a, b) => b.length - a.length)[0];
  return {
    doi,
    eid,
    scopusId,
    title: titleMatch?.[1]?.trim() ?? fallbackTitle,
    year: yearMatch ? Number(yearMatch[0]) : undefined
  };
}

function resolveReferences(workspaceId: string): number {
  run("DELETE FROM citation_edges WHERE workspace_id=?", [workspaceId]);
  run('DELETE FROM "references" WHERE workspace_id=?', [workspaceId]);
  const publicationRows = rows<Record<string, unknown>>(
    `SELECT p.publication_id,p.title,p.year,p.source_fields_json
     FROM publications p
     JOIN workspace_publications wp ON wp.publication_id=p.publication_id
     WHERE wp.workspace_id=?
     ORDER BY p.publication_id`,
    [workspaceId]
  );
  const titleYear = new Map<string, string[]>();
  for (const publication of publicationRows) {
    const key = titleYearKey(String(publication.title), publication.year ? Number(publication.year) : undefined);
    if (key) titleYear.set(key, [...(titleYear.get(key) ?? []), String(publication.publication_id)]);
  }
  let edges = 0;
  for (const publication of publicationRows) {
    const sourceFields = JSON.parse(String(publication.source_fields_json || "{}")) as Record<string, string>;
    const referencesValue = sourceFields.References ?? sourceFields.references ?? "";
    for (const rawText of splitReferences(referencesValue)) {
      const parsed = parseReference(rawText);
      let target: string | undefined;
      let method = "unresolved";
      let matchedIdentifier: string | undefined;
      let confidence = 0;
      if (parsed.doi) {
        target = scalar<string>(
          `SELECT pi.publication_id
           FROM publication_identifiers pi
           JOIN workspace_publications wp ON wp.publication_id=pi.publication_id
           WHERE pi.identifier_type='doi' AND pi.identifier_value=? AND wp.workspace_id=?`,
          [parsed.doi, workspaceId]
        );
        if (target) {
          method = "doi-exact";
          matchedIdentifier = parsed.doi;
          confidence = 1;
        }
      }
      if (!target && parsed.eid) {
        target = scalar<string>(
          `SELECT pi.publication_id
           FROM publication_identifiers pi
           JOIN workspace_publications wp ON wp.publication_id=pi.publication_id
           WHERE pi.identifier_type='eid' AND pi.identifier_value=? AND wp.workspace_id=?`,
          [parsed.eid, workspaceId]
        );
        if (target) {
          method = "eid-exact";
          matchedIdentifier = parsed.eid;
          confidence = 1;
        }
      }
      if (!target && parsed.scopusId) {
        target = scalar<string>(
          `SELECT pi.publication_id
           FROM publication_identifiers pi
           JOIN workspace_publications wp ON wp.publication_id=pi.publication_id
           WHERE pi.identifier_type='scopus_id' AND pi.identifier_value=? AND wp.workspace_id=?`,
          [parsed.scopusId, workspaceId]
        );
        if (target) {
          method = "scopus-id-exact";
          matchedIdentifier = parsed.scopusId;
          confidence = 1;
        }
      }
      if (!target && parsed.title && parsed.year) {
        const candidates = titleYear.get(titleYearKey(parsed.title, parsed.year) ?? "") ?? [];
        if (candidates.length === 1) {
          target = candidates[0];
          method = "title-year-exact";
          matchedIdentifier = titleYearKey(parsed.title, parsed.year);
          confidence = 0.9;
        } else if (candidates.length > 1) {
          method = "ambiguous-title-year";
        }
      }
      const referenceId = crypto.randomUUID();
      run(
        `INSERT INTO "references"(
          reference_id,workspace_id,source_publication_id,raw_text,normalized_doi,parsed_eid,
          parsed_scopus_id,parsed_title,parsed_year,target_publication_id,resolution_method,
          matched_identifier,confidence
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          referenceId, workspaceId, publication.publication_id, rawText,
          parsed.doi ?? null, parsed.eid ?? null,
          parsed.scopusId ?? null, parsed.title ?? null, parsed.year ?? null,
          target ?? null, method, matchedIdentifier ?? null, confidence
        ]
      );
      if (target && target !== publication.publication_id) {
        run(
          `INSERT OR IGNORE INTO citation_edges(
            workspace_id,source_publication_id,target_publication_id,
            reference_id,resolution_method,confidence
          ) VALUES(?,?,?,?,?,?)`,
          [workspaceId, publication.publication_id, target, referenceId, method, confidence]
        );
        edges++;
      }
    }
  }
  return edges;
}

function capabilities(workspaceId: string): CorpusCapabilityReport {
  if (!scalar<string>("SELECT workspace_id FROM workspaces WHERE workspace_id=?", [workspaceId])) {
    throw Object.assign(new Error("Workspace not found."), {
      code: "VALIDATION_ERROR",
      details: { workspaceId }
    });
  }
  const publicationCount = Number(scalar<number>(
    "SELECT COUNT(*) AS n FROM workspace_publications WHERE workspace_id=?",
    [workspaceId]
  ) ?? 0);
  const resolvedReferenceEdges = Number(scalar<number>(
    "SELECT COUNT(*) AS n FROM citation_edges WHERE workspace_id=?",
    [workspaceId]
  ) ?? 0);
  const coverage = rows<Record<string, number>>(
    `SELECT
      SUM(CASE WHEN p.title<>'' THEN 1 ELSE 0 END) AS with_title,
      SUM(CASE WHEN COALESCE(p.abstract,'')<>'' THEN 1 ELSE 0 END) AS with_abstract,
      SUM(CASE WHEN p.author_keywords_json<>'[]' OR p.index_keywords_json<>'[]' THEN 1 ELSE 0 END) AS with_keywords
     FROM publications p JOIN workspace_publications wp ON wp.publication_id=p.publication_id
     WHERE wp.workspace_id=?`,
    [workspaceId]
  )[0] ?? {};
  let corpusVersion = scalar<string>(
    "SELECT corpus_version FROM corpus_meta WHERE workspace_id=?",
    [workspaceId]
  );
  if (!corpusVersion) {
    corpusVersion = crypto.randomUUID();
    run(
      `INSERT INTO corpus_meta(workspace_id,corpus_version,updated_at)
       SELECT workspace_id,?,? FROM workspaces WHERE workspace_id=?
       ON CONFLICT(workspace_id) DO NOTHING`,
      [corpusVersion, now(), workspaceId]
    );
    corpusVersion = scalar<string>(
      "SELECT corpus_version FROM corpus_meta WHERE workspace_id=?",
      [workspaceId]
    ) ?? corpusVersion;
  }
  const importIds = rows<{ import_id: string }>(
    "SELECT import_id FROM workspace_imports WHERE workspace_id=? ORDER BY import_id",
    [workspaceId]
  ).map((row) => row.import_id);
  return {
    corpusVersion,
    importIds,
    publicationCount,
    resolvedReferenceEdges,
    lexicalCoverage: {
      withTitle: Number(coverage.with_title ?? 0),
      withAbstract: Number(coverage.with_abstract ?? 0),
      withKeywords: Number(coverage.with_keywords ?? 0)
    },
    supportsKeywordSearch: publicationCount > 0,
    supportsLexicalSimilarity: publicationCount > 1,
    supportsCitationGraph: resolvedReferenceEdges > 0,
    supportsReferences: resolvedReferenceEdges > 0,
    supportsCitedByInCorpus: resolvedReferenceEdges > 0,
    unavailableFeatures: resolvedReferenceEdges > 0 ? [] : [{
      feature: "citation-graph",
      reason: "No references resolved to publications in this workspace.",
      requiredData: ["References with DOI, EID, or exact title/year matches"]
    }]
  };
}

async function commitImport(
  requestId: string,
  preflightId: string,
  options: {
    workspaceId: string;
    mode: "import-new" | "upsert-identifiers";
    searchProvenance: unknown;
  },
  currentHashes: Record<string, string>
): Promise<ImportReport> {
  const cached = preflights.get(preflightId);
  if (!cached) throw Object.assign(new Error("Preflight expired or unknown."), { code: "PREFLIGHT_NOT_FOUND" });
  for (const file of cached.files) {
    if (currentHashes[file.path] !== file.sourceFileHash) {
      throw Object.assign(new Error(`Source changed after preflight: ${file.path}`), {
        code: "SOURCE_CHANGED",
        details: { path: file.path }
      });
    }
  }
  if (!scalar<string>("SELECT workspace_id FROM workspaces WHERE workspace_id=?", [options.workspaceId])) {
    throw Object.assign(new Error("Workspace not found."), { code: "VALIDATION_ERROR" });
  }
  if (options.mode !== "import-new" && options.mode !== "upsert-identifiers") {
    throw Object.assign(new Error(`Unsupported import mode: ${String(options.mode)}`), {
      code: "VALIDATION_ERROR"
    });
  }
  const importId = crypto.randomUUID();
  let created = 0, updated = 0, unchanged = 0;
  const identifierIndex = new Map(rows<{
    identifier_type: string;
    identifier_value: string;
    publication_id: string;
  }>(
    "SELECT identifier_type,identifier_value,publication_id FROM publication_identifiers"
  ).map((item) => [`${item.identifier_type}:${item.identifier_value}`, item.publication_id]));
  run("BEGIN IMMEDIATE");
  try {
    run(
      "INSERT INTO imports(import_id,workspace_id,source_files_json,provenance_json,created_at) VALUES(?,?,?,?,?)",
      [importId, options.workspaceId, JSON.stringify(cached.report.sourceFiles), JSON.stringify(options.searchProvenance), now()]
    );
    run("INSERT INTO workspace_imports(workspace_id,import_id) VALUES(?,?)", [options.workspaceId, importId]);
    const newPlans: Array<{
      publicationId: string;
      row: CanonicalScopusRow & { sourceHash: string };
    }> = [];
    const existingRows: Array<CanonicalScopusRow & { sourceHash: string }> = [];
    for (const row of cached.rows) {
      const publicationId = lookupPublication(row, identifierIndex);
      if (publicationId) {
        existingRows.push(row);
        continue;
      }
      const newPublicationId = crypto.randomUUID();
      newPlans.push({ publicationId: newPublicationId, row });
      for (const [type, value] of [
        ["eid", row.eid],
        ["doi", row.doi],
        ["scopus_id", row.scopusId]
      ] as const) {
        if (!value) continue;
        const key = `${type}:${value}`;
        const owner = identifierIndex.get(key);
        if (owner && owner !== newPublicationId) {
          throw Object.assign(new Error(`Identifier ${key} belongs to another publication.`), {
            code: "IDENTIFIER_CONFLICT",
            details: { key, owner, publicationId: newPublicationId }
          });
        }
        identifierIndex.set(key, newPublicationId);
      }
    }
    bulkInsertNewPublications(newPlans, options.workspaceId, importId);
    created = newPlans.length;
    reportProgress(requestId, "import", created, cached.rows.length);
    await yieldToWorker(10);
    throwIfCancelled(requestId);
    for (let index = 0; index < existingRows.length; index++) {
      if (index % 100 === 0) {
        reportProgress(requestId, "import", created + index, cached.rows.length);
        await yieldToWorker();
        throwIfCancelled(requestId);
      }
      const row = existingRows[index];
      if (!row) continue;
      const status = upsertPublication(
        row,
        options.workspaceId,
        importId,
        row.sourceHash,
        options.mode,
        identifierIndex
      );
      if (status === "updated") updated++;
      else unchanged++;
    }
    reportProgress(requestId, "references", cached.rows.length, cached.rows.length);
    await yieldToWorker();
    throwIfCancelled(requestId);
    const hasReferenceText = Boolean(scalar<number>(
      `SELECT EXISTS(
         SELECT 1 FROM publications p
         JOIN workspace_publications wp ON wp.publication_id=p.publication_id
         WHERE wp.workspace_id=?
           AND (
             COALESCE(json_extract(p.source_fields_json,'$.References'),'')<>''
             OR COALESCE(json_extract(p.source_fields_json,'$.references'),'')<>''
           )
       )`,
      [options.workspaceId]
    ));
    const resolvedReferenceEdges = hasReferenceText
      ? resolveReferences(options.workspaceId)
      : Number(scalar<number>(
        "SELECT COUNT(*) FROM citation_edges WHERE workspace_id=?",
        [options.workspaceId]
      ) ?? 0);
    const corpusVersion = crypto.randomUUID();
    run(
      `INSERT INTO corpus_meta(workspace_id,corpus_version,updated_at) VALUES(?,?,?)
       ON CONFLICT(workspace_id) DO UPDATE SET corpus_version=excluded.corpus_version,updated_at=excluded.updated_at`,
      [options.workspaceId, corpusVersion, now()]
    );
    run("COMMIT");
    clearStatementCache();
    run("PRAGMA shrink_memory");
    reportProgress(requestId, "complete", cached.rows.length, cached.rows.length);
    preflights.delete(preflightId);
    return {
      importId,
      corpusVersion,
      created,
      updated,
      unchanged,
      rejected: cached.report.invalidRows,
      resolvedReferenceEdges,
      warnings: cached.report.warnings,
      capabilities: capabilities(options.workspaceId)
    };
  } catch (error) {
    run("ROLLBACK");
    throw error;
  }
}

function research(query: ResearchQuery): PublicationRecord[] {
  const where: string[] = [];
  const bind: unknown[] = [query.workspaceId];
  if (query.fullText) {
    const terms = tokenize(query.fullText).slice(0, 32);
    if (!terms.length) return [];
    where.push(
      `p.publication_id IN (
        SELECT f.publication_id
        FROM publications_fts f
        JOIN workspace_publications fwp ON fwp.publication_id=f.publication_id
        WHERE fwp.workspace_id=? AND publications_fts MATCH ?
        ORDER BY bm25(publications_fts,0,3,2,1)
        LIMIT 500
      )`
    );
    bind.push(
      query.workspaceId,
      terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ")
    );
  }
  if (query.titleContains) { where.push("p.title LIKE ?"); bind.push(`%${query.titleContains}%`); }
  for (const author of query.authors ?? []) {
    where.push("p.authors_json LIKE ?");
    bind.push(`%${author}%`);
  }
  for (const keyword of query.keywords ?? []) {
    where.push("(p.author_keywords_json LIKE ? OR p.index_keywords_json LIKE ?)");
    bind.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (query.years?.from != null) { where.push("p.year>=?"); bind.push(query.years.from); }
  if (query.years?.to != null) { where.push("p.year<=?"); bind.push(query.years.to); }
  if (query.documentTypes?.length) {
    where.push(`p.document_type IN (${query.documentTypes.map(() => "?").join(",")})`);
    bind.push(...query.documentTypes);
  }
  if (query.citationCount?.min != null) { where.push("p.citation_count>=?"); bind.push(query.citationCount.min); }
  if (query.citationCount?.max != null) { where.push("p.citation_count<=?"); bind.push(query.citationCount.max); }
  if (query.hasAbstract != null) where.push(query.hasAbstract ? "COALESCE(p.abstract,'')<>''" : "COALESCE(p.abstract,'')=''");
  const limit = validatedLimit(query.limit);
  const offset = query.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw Object.assign(new Error("Research offset must be a non-negative integer."), {
      code: "VALIDATION_ERROR",
      details: { offset }
    });
  }
  bind.push(limit, offset);
  const sql = `${publicationSelect(query.workspaceId)}
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY p.citation_count DESC, p.year DESC, p.title
    LIMIT ? OFFSET ?`;
  return rows<Record<string, unknown>>(sql, bind).map(publicationFromRow);
}

function getPublication(publicationId: string, workspaceId: string): PublicationRecord | null {
  const row = rows<Record<string, unknown>>(
    `${publicationSelect(workspaceId)} WHERE p.publication_id=?`,
    [workspaceId, publicationId]
  )[0];
  return row ? publicationFromRow(row) : null;
}

function getPublications(
  publicationIds: readonly string[],
  workspaceId: string
): Map<string, PublicationRecord> {
  if (!publicationIds.length) return new Map();
  const placeholders = publicationIds.map(() => "?").join(",");
  return new Map(rows<Record<string, unknown>>(
    `${publicationSelect(workspaceId)} WHERE p.publication_id IN (${placeholders})`,
    [workspaceId, ...publicationIds]
  ).map((row) => {
    const publication = publicationFromRow(row);
    return [publication.publicationId, publication] as const;
  }));
}

function matchesFilters(
  publication: PublicationRecord,
  filters: ExplorationRequest["filters"]
): boolean {
  if (!filters) return true;
  if (filters.titleContains &&
    !publication.title.toLocaleLowerCase().includes(filters.titleContains.toLocaleLowerCase())) return false;
  if (filters.authors?.length &&
    !filters.authors.every((author) => publication.authors.some(
      (candidate) => candidate.toLocaleLowerCase().includes(author.toLocaleLowerCase())
    ))) return false;
  if (filters.keywords?.length) {
    const keywords = [...publication.authorKeywords, ...publication.indexKeywords]
      .map((keyword) => keyword.toLocaleLowerCase());
    if (!filters.keywords.every((keyword) =>
      keywords.some((candidate) => candidate.includes(keyword.toLocaleLowerCase())))) return false;
  }
  if (filters.years?.from != null && (publication.year == null || publication.year < filters.years.from)) return false;
  if (filters.years?.to != null && (publication.year == null || publication.year > filters.years.to)) return false;
  if (filters.documentTypes?.length &&
    (!publication.documentType || !filters.documentTypes.includes(publication.documentType))) return false;
  if (filters.citationCount?.min != null &&
    (publication.citationCount == null || publication.citationCount < filters.citationCount.min)) return false;
  if (filters.citationCount?.max != null &&
    (publication.citationCount == null || publication.citationCount > filters.citationCount.max)) return false;
  if (filters.hasAbstract != null && Boolean(publication.abstract) !== filters.hasAbstract) return false;
  if (filters.fullText) {
    const haystack = [
      publication.title,
      publication.abstract ?? "",
      ...publication.authorKeywords,
      ...publication.indexKeywords
    ].join(" ").toLocaleLowerCase();
    if (!haystack.includes(filters.fullText.toLocaleLowerCase())) return false;
  }
  return true;
}

function availableRankingChannels(workspaceId: string): Set<keyof RankingFeatures> {
  const availability = rows<Record<string, number>>(
    `SELECT
      COUNT(*) AS publications,
      SUM(CASE WHEN p.author_keywords_json<>'[]' OR p.index_keywords_json<>'[]' THEN 1 ELSE 0 END) AS keywords,
      SUM(CASE WHEN p.author_ids_json<>'[]' THEN 1 ELSE 0 END) AS authors,
      SUM(CASE WHEN p.year IS NOT NULL THEN 1 ELSE 0 END) AS years
     FROM publications p
     JOIN workspace_publications wp ON wp.publication_id=p.publication_id
     WHERE wp.workspace_id=?`,
    [workspaceId]
  )[0] ?? {};
  const result = new Set<keyof RankingFeatures>();
  if (Number(availability.publications ?? 0) > 1) result.add("bm25");
  if (Number(availability.keywords ?? 0) > 0) result.add("keyword");
  if (Number(availability.authors ?? 0) > 0) result.add("author");
  if (Number(availability.years ?? 0) > 0) result.add("year");
  if (Number(scalar<number>(
    "SELECT COUNT(*) FROM citation_edges WHERE workspace_id=?",
    [workspaceId]
  ) ?? 0) > 0) result.add("refs");
  return result;
}

function topAbstractTerms(workspaceId: string, abstract: string): string[] {
  const frequencies = new Map<string, number>();
  for (const token of tokenize(abstract)) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  const candidates = [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 128);
  const documentCount = Number(scalar<number>(
    "SELECT COUNT(*) FROM workspace_publications WHERE workspace_id=?",
    [workspaceId]
  ) ?? 1);
  return candidates
    .map(([term, frequency]) => {
      const phrase = `"${term.replaceAll('"', '""')}"`;
      const documentFrequency = Number(scalar<number>(
        `SELECT COUNT(*)
         FROM publications_fts f
         JOIN workspace_publications wp ON wp.publication_id=f.publication_id
         WHERE wp.workspace_id=? AND publications_fts MATCH ?`,
        [workspaceId, phrase]
      ) ?? 0);
      return {
        term,
        score: frequency * (Math.log((documentCount + 1) / (documentFrequency + 1)) + 1)
      };
    })
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .slice(0, 32)
    .map((item) => item.term);
}

function ftsCandidates(workspaceId: string, seed: PublicationRecord): Map<string, number> {
  const terms = [
    ...tokenize(seed.title),
    ...seed.authorKeywords.flatMap(tokenize),
    ...seed.indexKeywords.flatMap(tokenize),
    ...topAbstractTerms(workspaceId, seed.abstract ?? "")
  ].slice(0, 64);
  if (!terms.length) return new Map();
  const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
  const candidateRows = rows<{ publication_id: string; rank: number }>(
    `SELECT f.publication_id, bm25(publications_fts,0,3,2,1) AS rank
     FROM publications_fts f
     JOIN workspace_publications wp ON wp.publication_id=f.publication_id
     WHERE wp.workspace_id=? AND publications_fts MATCH ?
     ORDER BY rank LIMIT 500`,
    [workspaceId, match]
  );
  const raw = candidateRows.map((row) => -Number(row.rank));
  const max = Math.max(...raw, 0);
  const min = Math.min(...raw, 0);
  return new Map(candidateRows.map((row, index) => [
    row.publication_id,
    max === min ? 1 : ((raw[index] ?? min) - min) / (max - min)
  ]));
}

function referenceTargetsBatch(
  workspaceId: string,
  publicationIds: readonly string[]
): Map<string, Set<string>> {
  const result = new Map(publicationIds.map((publicationId) => [publicationId, new Set<string>()]));
  if (!publicationIds.length) return result;
  const placeholders = publicationIds.map(() => "?").join(",");
  for (const row of rows<{ source_publication_id: string; target_publication_id: string }>(
    `SELECT source_publication_id,target_publication_id
     FROM citation_edges
     WHERE workspace_id=? AND source_publication_id IN (${placeholders})`,
    [workspaceId, ...publicationIds]
  )) {
    result.get(row.source_publication_id)?.add(row.target_publication_id);
  }
  return result;
}

function directExplore(request: ExplorationRequest): ExplorationResult {
  const direction = request.mode === "references"
    ? ["source_publication_id", "target_publication_id"]
    : ["target_publication_id", "source_publication_id"];
  const placeholders = request.seedPublicationIds.map(() => "?").join(",");
  const edgeRows = rows<{
    publication_id: string;
    connections: number;
    average_confidence: number;
  }>(
    `SELECT ${direction[1]} AS publication_id,
       COUNT(DISTINCT ${direction[0]}) AS connections,
       AVG(confidence) AS average_confidence
     FROM citation_edges WHERE workspace_id=? AND ${direction[0]} IN (${placeholders})
     GROUP BY ${direction[1]}
     ORDER BY connections DESC`,
    [request.workspaceId, ...request.seedPublicationIds]
  );
  const items = edgeRows
    .filter((row) => !request.seedPublicationIds.includes(row.publication_id))
    .map((row): ExplorationResultItem | null => {
      const publication = getPublication(row.publication_id, request.workspaceId);
      if (!publication || !matchesFilters(publication, request.filters)) return null;
      return {
        publicationId: publication.publicationId,
        publication,
        score: row.connections,
        confidence: Number(row.average_confidence),
        evidenceCoverage: "full",
        evidence: [{
          channel: "citation",
          rawValue: row.connections,
          normalizedValue: 1,
          explanation: `${row.connections} direct seed connection(s)`
        }]
      };
    })
    .filter((item): item is ExplorationResultItem => item !== null)
    .sort((a, b) =>
      b.score - a.score ||
      (b.publication.citationCount ?? 0) - (a.publication.citationCount ?? 0) ||
      (b.publication.year ?? 0) - (a.publication.year ?? 0) ||
      a.publication.publicationId.localeCompare(b.publication.publicationId)
    )
    .slice(0, validatedLimit(request.limit));
  const visibleIds = new Set(items.map((item) => item.publication.publicationId));
  const graphEdges = rows<{
    source_publication_id: string;
    target_publication_id: string;
    confidence: number;
  }>(
    `SELECT source_publication_id,target_publication_id,confidence
     FROM citation_edges
     WHERE workspace_id=? AND (
       source_publication_id IN (${placeholders})
       OR target_publication_id IN (${placeholders})
     )`,
    [request.workspaceId, ...request.seedPublicationIds, ...request.seedPublicationIds]
  )
    .filter((edge) => request.mode === "references"
      ? request.seedPublicationIds.includes(edge.source_publication_id) &&
        visibleIds.has(edge.target_publication_id)
      : request.seedPublicationIds.includes(edge.target_publication_id) &&
        visibleIds.has(edge.source_publication_id))
    .map((edge) => ({
      sourcePublicationId: edge.source_publication_id,
      targetPublicationId: edge.target_publication_id,
      kind: "citation" as const,
      weight: Number(edge.confidence),
      label: "cites"
    }));
  return resultEnvelope(request, items, graphEdges);
}

function resultEnvelope(
  request: ExplorationRequest,
  items: ExplorationResultItem[],
  graphEdges: ExplorationResult["graphEdges"] = []
): ExplorationResult {
  return {
    corpusVersion: capabilities(request.workspaceId).corpusVersion,
    rankingProfileVersion: RANKING_VERSION,
    textAnalysisProfileVersion: TEXT_VERSION,
    mode: request.mode,
    seedPublicationIds: request.seedPublicationIds,
    seedPublications: request.seedPublicationIds
      .map((id) => getPublication(id, request.workspaceId))
      .filter((publication): publication is PublicationRecord => publication !== null),
    items,
    graphEdges
  };
}

function explore(request: ExplorationRequest): ExplorationResult {
  if (request.seedPublicationIds.length < 1 || request.seedPublicationIds.length > 10) {
    throw Object.assign(new Error("Seed count must be between 1 and 10."), { code: "VALIDATION_ERROR" });
  }
  if (new Set(request.seedPublicationIds).size !== request.seedPublicationIds.length) {
    throw Object.assign(new Error("Seed publication IDs must be unique."), {
      code: "VALIDATION_ERROR"
    });
  }
  validatedLimit(request.limit);
  const corpusCapabilities = capabilities(request.workspaceId);
  if (request.mode === "references" || request.mode === "cited-by-in-corpus") {
    if (!corpusCapabilities.supportsCitationGraph) {
      throw Object.assign(new Error("Citation graph is unavailable for this corpus."), {
        code: "CAPABILITY_UNAVAILABLE",
        details: { feature: request.mode, requiredData: ["Resolved references"] }
      });
    }
    return directExplore(request);
  }
  if (!corpusCapabilities.supportsLexicalSimilarity) {
    throw Object.assign(new Error("Lexical discovery requires at least two corpus publications."), {
      code: "CAPABILITY_UNAVAILABLE",
      details: {
        feature: request.mode,
        reason: "Lexical discovery requires at least two corpus publications.",
        requiredData: ["At least two publications with titles"]
      }
    });
  }
  const seeds = request.seedPublicationIds
    .map((id) => getPublication(id, request.workspaceId))
    .filter((item): item is PublicationRecord => item !== null);
  if (seeds.length !== request.seedPublicationIds.length) {
    throw Object.assign(new Error("One or more seeds are outside the workspace corpus."), { code: "VALIDATION_ERROR" });
  }
  const medianYear = median(seeds.map((seed) => seed.year).filter((year): year is number => year != null));
  if ((request.mode === "earlier" || request.mode === "later") && medianYear == null) {
    throw Object.assign(new Error(`${request.mode} discovery requires seed publication years.`), {
      code: "CAPABILITY_UNAVAILABLE",
      details: {
        feature: request.mode,
        reason: "No seed publication has a known publication year.",
        requiredData: ["Publication year for at least one seed"]
      }
    });
  }
  const availableChannels = availableRankingChannels(request.workspaceId);
  const publicationCache = new Map(seeds.map((seed) => [seed.publicationId, seed]));
  const referenceCache = referenceTargetsBatch(
    request.workspaceId,
    seeds.map((seed) => seed.publicationId)
  );
  const candidates = new Map<string, Array<{
    seedId: string; bm25: number; keyword: number; refs: number; author: number; year: number;
  }>>();
  for (const seed of seeds) {
    const fts = ftsCandidates(request.workspaceId, seed);
    const candidateIds = [...fts.keys()].filter((candidateId) =>
      !request.seedPublicationIds.includes(candidateId)
    );
    for (const [publicationId, publication] of getPublications(candidateIds, request.workspaceId)) {
      publicationCache.set(publicationId, publication);
    }
    const missingReferenceIds = candidateIds.filter((candidateId) => !referenceCache.has(candidateId));
    for (const [publicationId, targets] of referenceTargetsBatch(
      request.workspaceId,
      missingReferenceIds
    )) {
      referenceCache.set(publicationId, targets);
    }
    const seedRefs = referenceCache.get(seed.publicationId) ?? new Set<string>();
    for (const [candidateId, bm25] of fts) {
      if (request.seedPublicationIds.includes(candidateId)) continue;
      const candidate = publicationCache.get(candidateId);
      if (!candidate) continue;
      if (!matchesFilters(candidate, request.filters)) continue;
      if (request.mode === "earlier" && (medianYear == null || candidate.year == null || candidate.year >= medianYear)) continue;
      if (request.mode === "later" && (medianYear == null || candidate.year == null || candidate.year <= medianYear)) continue;
      const candidateRefs = referenceCache.get(candidateId) ?? new Set<string>();
      const shared = [...seedRefs].filter((id) => candidateRefs.has(id)).length;
      const refNorm = shared / Math.max(seedRefs.size, candidateRefs.size, 1);
      const authorSet = new Set(seed.authorIds);
      const authorOverlap = candidate.authorIds.filter((id) => authorSet.has(id)).length /
        Math.max(seed.authorIds.length, candidate.authorIds.length, 1);
      const yearPreference = medianYear == null || candidate.year == null
        ? 0
        : 1 / (1 + Math.abs(candidate.year - medianYear));
      const values = {
        seedId: seed.publicationId,
        bm25,
        keyword: jaccard(
          [...seed.authorKeywords, ...seed.indexKeywords],
          [...candidate.authorKeywords, ...candidate.indexKeywords]
        ),
        refs: refNorm,
        author: authorOverlap,
        year: yearPreference
      };
      candidates.set(candidateId, [...(candidates.get(candidateId) ?? []), values]);
    }
  }
  const items: ExplorationResultItem[] = [];
  const graphEdges: ExplorationResult["graphEdges"] = [];
  for (const [candidateId, perSeed] of candidates) {
    const aggregated = aggregateTopThree(perSeed.map(({ seedId: _seedId, ...scores }) => scores));
    const channelScores = Object.entries(aggregated) as Array<[keyof typeof aggregated, number]>;
    const score = weightedScore(aggregated, undefined, availableChannels);
    const publication = publicationCache.get(candidateId);
    if (!publication) continue;
    const evidence: RecommendationEvidence[] = channelScores
      .filter(([, value]) => value > 0)
      .map(([channel, value]) => ({
        channel: channel === "refs" ? "shared-reference" : channel,
        rawValue: value,
        normalizedValue: value,
        explanation: channel === "bm25"
          ? "textual overlap"
          : channel === "refs"
            ? "shared references"
            : channel === "keyword"
              ? "shared keywords"
              : channel === "author"
                ? "shared authors"
                : "similar publication year"
      }));
    const evidenceRatio = availableChannels.size
      ? evidence.length / availableChannels.size
      : 0;
    const seedHasAbstract = seeds.some((seed) => Boolean(seed.abstract));
    const seedHasKeywords = seeds.some((seed) =>
      seed.authorKeywords.length > 0 || seed.indexKeywords.length > 0
    );
    const candidateHasKeywords =
      publication.authorKeywords.length > 0 || publication.indexKeywords.length > 0;
    const dataCompleteness =
      (seedHasAbstract && publication.abstract ? 1 : 0.75) *
      (seedHasKeywords && candidateHasKeywords ? 1 : 0.8);
    const confidence = Math.min(1, evidenceRatio * dataCompleteness);
    items.push({
      publicationId: publication.publicationId,
      publication,
      score,
      confidence,
      evidenceCoverage: confidence >= 0.75
        ? "full"
        : confidence >= 0.4
          ? "degraded"
          : "minimal",
      evidence
    });
    for (const seedScore of perSeed) {
      const { seedId, ...scores } = seedScore;
      const edgeWeight = weightedScore(scores, undefined, availableChannels);
      if (edgeWeight <= 0) continue;
      graphEdges.push({
        sourcePublicationId: seedId,
        targetPublicationId: candidateId,
        kind: "similarity",
        weight: edgeWeight,
        label: "similar"
      });
    }
  }
  items.sort((a, b) =>
    b.score - a.score ||
    b.evidence.length - a.evidence.length ||
    (b.publication.citationCount ?? 0) - (a.publication.citationCount ?? 0) ||
    (b.publication.year ?? 0) - (a.publication.year ?? 0) ||
    a.publication.publicationId.localeCompare(b.publication.publicationId)
  );
  const limitedItems = items.slice(0, validatedLimit(request.limit));
  const visibleIds = new Set(limitedItems.map((item) => item.publication.publicationId));
  const allVisibleIds = [...request.seedPublicationIds, ...visibleIds];

  // Add citation edges between any two visible publications (seeds + results)
  if (allVisibleIds.length > 1) {
    const ph = allVisibleIds.map(() => "?").join(",");
    for (const row of rows<{ source_publication_id: string; target_publication_id: string; confidence: number }>(
      `SELECT source_publication_id, target_publication_id, confidence
       FROM citation_edges
       WHERE workspace_id=? AND source_publication_id IN (${ph}) AND target_publication_id IN (${ph})`,
      [request.workspaceId, ...allVisibleIds, ...allVisibleIds]
    )) {
      graphEdges.push({
        sourcePublicationId: row.source_publication_id,
        targetPublicationId: row.target_publication_id,
        kind: "citation",
        weight: Number(row.confidence),
        label: "cites"
      });
    }
  }

  const allVisibleSet = new Set(allVisibleIds);
  return resultEnvelope(
    request,
    limitedItems,
    graphEdges.filter((edge) =>
      allVisibleSet.has(edge.sourcePublicationId) && allVisibleSet.has(edge.targetPublicationId)
    )
  );
}

function createWorkspace(name: string): Workspace {
  const workspace: Workspace = {
    workspaceId: crypto.randomUUID(),
    name: name.trim(),
    createdAt: now(),
    updatedAt: now()
  };
  if (!workspace.name) throw Object.assign(new Error("Workspace name is required."), { code: "VALIDATION_ERROR" });
  run(
    "INSERT INTO workspaces(workspace_id,name,created_at,updated_at) VALUES(?,?,?,?)",
    [workspace.workspaceId, workspace.name, workspace.createdAt, workspace.updatedAt]
  );
  run(
    "INSERT INTO corpus_meta(workspace_id,corpus_version,updated_at) VALUES(?,?,?)",
    [workspace.workspaceId, crypto.randomUUID(), workspace.updatedAt]
  );
  return workspace;
}

function listWorkspaces(): Workspace[] {
  return rows<Record<string, unknown>>(
    "SELECT workspace_id,name,created_at,updated_at FROM workspaces ORDER BY updated_at DESC"
  ).map((row) => ({
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }));
}

function getWorkspace(workspaceId: string): Workspace | null {
  return listWorkspaces().find((workspace) => workspace.workspaceId === workspaceId) ?? null;
}

function renameWorkspace(workspaceId: string, name: string): Workspace {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw Object.assign(new Error("Workspace name is required."), { code: "VALIDATION_ERROR" });
  }
  run("UPDATE workspaces SET name=?,updated_at=? WHERE workspace_id=?", [normalizedName, now(), workspaceId]);
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw Object.assign(new Error("Workspace not found."), { code: "VALIDATION_ERROR" });
  return workspace;
}

function deleteWorkspace(workspaceId: string): void {
  run("BEGIN IMMEDIATE");
  try {
    run("DELETE FROM citation_edges WHERE workspace_id=?", [workspaceId]);
    run('DELETE FROM "references" WHERE workspace_id=?', [workspaceId]);
    run("DELETE FROM workspaces WHERE workspace_id=?", [workspaceId]);
    run(
      `DELETE FROM publications
       WHERE NOT EXISTS (
         SELECT 1 FROM workspace_publications wp
         WHERE wp.publication_id=publications.publication_id
       )`
    );
    run(
      `DELETE FROM publications_fts
       WHERE publication_id NOT IN (SELECT publication_id FROM publications)`
    );
    run("COMMIT");
  } catch (error) {
    run("ROLLBACK");
    throw error;
  }
}

function collectionRecord(collectionId: string): ResearchCollection {
  const row = rows<Record<string, unknown>>(
    "SELECT * FROM collections WHERE collection_id=?",
    [collectionId]
  )[0];
  if (!row) throw Object.assign(new Error("Collection not found."), { code: "VALIDATION_ERROR" });
  const publicationIds = rows<{ publication_id: string }>(
    "SELECT publication_id FROM collection_publications WHERE collection_id=? ORDER BY added_at",
    [collectionId]
  ).map((item) => item.publication_id);
  return {
    collectionId: String(row.collection_id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    color: row.color ? String(row.color) : undefined,
    labels: jsonArray(row.labels_json),
    publicationIds,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function createCollection(payload: { workspaceId: string; name: string; color?: string; labels?: string[] }): ResearchCollection {
  if (!payload.name.trim()) {
    throw Object.assign(new Error("Collection name is required."), { code: "VALIDATION_ERROR" });
  }
  if (!getWorkspace(payload.workspaceId)) {
    throw Object.assign(new Error("Workspace not found."), { code: "VALIDATION_ERROR" });
  }
  const id = crypto.randomUUID();
  const timestamp = now();
  run(
    "INSERT INTO collections(collection_id,workspace_id,name,color,labels_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    [id, payload.workspaceId, payload.name.trim(), payload.color ?? null, JSON.stringify(payload.labels ?? []), timestamp, timestamp]
  );
  return collectionRecord(id);
}

function updateCollection(collectionId: string, publicationIds: string[], add: boolean): ResearchCollection {
  const collection = collectionRecord(collectionId);
  run("BEGIN");
  try {
    for (const publicationId of publicationIds) {
      if (add) {
        if (!scalar<string>(
          "SELECT publication_id FROM workspace_publications WHERE workspace_id=? AND publication_id=?",
          [collection.workspaceId, publicationId]
        )) {
          throw Object.assign(new Error("Publication is outside the collection workspace."), {
            code: "VALIDATION_ERROR",
            details: { collectionId, publicationId }
          });
        }
        run(
          "INSERT OR IGNORE INTO collection_publications(collection_id,publication_id,added_at) VALUES(?,?,?)",
          [collectionId, publicationId, now()]
        );
      } else {
        run("DELETE FROM collection_publications WHERE collection_id=? AND publication_id=?", [collectionId, publicationId]);
      }
    }
    run("UPDATE collections SET updated_at=? WHERE collection_id=?", [now(), collectionId]);
    run("COMMIT");
  } catch (error) {
    run("ROLLBACK");
    throw error;
  }
  return collectionRecord(collectionId);
}

function commitSemanticScholarImport(
  requestId: string,
  workspaceId: string,
  records: PublicationRecord[],
  searchProvenance: unknown
): import("../semantic-scholar/types").SemanticScholarImportResult {
  if (!scalar<string>("SELECT workspace_id FROM workspaces WHERE workspace_id=?", [workspaceId])) {
    throw Object.assign(new Error("Workspace not found."), { code: "VALIDATION_ERROR" });
  }

  // Build identifier index once for the whole import
  const identifierIndex = new Map(rows<{
    identifier_type: string;
    identifier_value: string;
    publication_id: string;
  }>(
    "SELECT identifier_type,identifier_value,publication_id FROM publication_identifiers"
  ).map((item) => [`${item.identifier_type}:${item.identifier_value}`, item.publication_id]));

  // Also build a semantic_scholar_id lookup to avoid full-table scans inside the loop
  const ssIdIndex = new Map(rows<{
    semantic_scholar_id: string;
    publication_id: string;
  }>(
    "SELECT semantic_scholar_id,publication_id FROM publications WHERE semantic_scholar_id IS NOT NULL"
  ).map((item) => [item.semantic_scholar_id, item.publication_id]));

  const importId = crypto.randomUUID();
  const timestamp = now();
  let created = 0, updated = 0, unchanged = 0, rejected = 0;

  run("BEGIN IMMEDIATE");
  try {
    run(
      "INSERT INTO imports(import_id,workspace_id,source_files_json,provenance_json,created_at) VALUES(?,?,?,?,?)",
      [importId, workspaceId, "[]", JSON.stringify(searchProvenance), timestamp]
    );
    run("INSERT INTO workspace_imports(workspace_id,import_id) VALUES(?,?)", [workspaceId, importId]);

    for (const record of records) {
      if (!record.title) { rejected++; continue; }

      // Resolve existing publication by: doi > semanticScholarId > title+year
      let existingId: string | undefined;

      if (record.doi) {
        existingId = identifierIndex.get(`doi:${record.doi}`);
      }
      if (!existingId && record.semanticScholarId) {
        existingId = ssIdIndex.get(record.semanticScholarId);
      }
      if (!existingId && record.title && record.year) {
        existingId = identifierIndex.get(`title_year:${record.title.toLowerCase().replace(/\s+/g, " ").trim()}::${record.year}`);
      }

      if (!existingId) {
        // Create new publication
        const pubId = record.publicationId ?? crypto.randomUUID();
        run(
          `INSERT INTO publications(
            publication_id,title,normalized_title,abstract,year,authors_json,author_ids_json,
            affiliations_json,author_keywords_json,index_keywords_json,source_title,document_type,
            citation_count,source_fields_json,semantic_scholar_id,data_source,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            pubId,
            record.title,
            record.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim(),
            record.abstract ?? null,
            record.year ?? null,
            JSON.stringify(record.authors),
            JSON.stringify(record.authorIds),
            JSON.stringify(record.affiliations),
            JSON.stringify(record.authorKeywords),
            JSON.stringify(record.indexKeywords),
            record.sourceTitle ?? null,
            record.documentType ?? null,
            record.citationCount ?? null,
            JSON.stringify(record.sourceFields ?? {}),
            record.semanticScholarId ?? null,
            record.dataSource ?? "semantic-scholar",
            timestamp,
            timestamp
          ]
        );
        if (record.doi) {
          run(
            "INSERT OR IGNORE INTO publication_identifiers(publication_id,identifier_type,identifier_value) VALUES(?,?,?)",
            [pubId, "doi", record.doi]
          );
          identifierIndex.set(`doi:${record.doi}`, pubId);
        }
        if (record.semanticScholarId) {
          ssIdIndex.set(record.semanticScholarId, pubId);
        }
        run(
          "INSERT OR IGNORE INTO workspace_publications(workspace_id,publication_id) VALUES(?,?)",
          [workspaceId, pubId]
        );
        run(
          "INSERT OR IGNORE INTO workspace_publication_state(workspace_id,publication_id,reading_state,updated_at) VALUES(?,?,?,?)",
          [workspaceId, pubId, "unread", timestamp]
        );
        // Update FTS
        run("DELETE FROM publications_fts WHERE publication_id=?", [pubId]);
        run(
          "INSERT INTO publications_fts(publication_id,title,keywords,abstract) VALUES(?,?,?,?)",
          [pubId, record.title, record.indexKeywords.join(" "), record.abstract ?? ""]
        );
        created++;
      } else {
        // Upsert into existing publication — only fill gaps, never overwrite
        const existing = rows<Record<string, unknown>>(
          "SELECT * FROM publications WHERE publication_id=?",
          [existingId]
        )[0];
        if (!existing) { unchanged++; continue; }

        const changed = [
          !existing.abstract && record.abstract,
          !existing.year && record.year,
          !existing.source_title && record.sourceTitle,
          !existing.document_type && record.documentType,
          existing.citation_count == null && record.citationCount != null,
          String(existing.authors_json) === "[]" && record.authors.length > 0,
          String(existing.index_keywords_json) === "[]" && record.indexKeywords.length > 0,
          !existing.semantic_scholar_id && record.semanticScholarId,
        ].some(Boolean);

        if (changed) {
          run(
            `UPDATE publications SET
              abstract=COALESCE(abstract,?), year=COALESCE(year,?),
              source_title=COALESCE(source_title,?), document_type=COALESCE(document_type,?),
              citation_count=COALESCE(citation_count,?),
              authors_json=CASE WHEN authors_json='[]' THEN ? ELSE authors_json END,
              index_keywords_json=CASE WHEN index_keywords_json='[]' THEN ? ELSE index_keywords_json END,
              semantic_scholar_id=COALESCE(semantic_scholar_id,?),
              updated_at=?
            WHERE publication_id=?`,
            [
              record.abstract ?? null, record.year ?? null,
              record.sourceTitle ?? null, record.documentType ?? null,
              record.citationCount ?? null,
              JSON.stringify(record.authors), JSON.stringify(record.indexKeywords),
              record.semanticScholarId ?? null,
              timestamp, existingId
            ]
          );
          // Refresh FTS
          const canonical = rows<{ title: string; index_keywords_json: string; abstract: string | null }>(
            "SELECT title,index_keywords_json,abstract FROM publications WHERE publication_id=?",
            [existingId]
          )[0];
          if (canonical) {
            run("DELETE FROM publications_fts WHERE publication_id=?", [existingId]);
            run(
              "INSERT INTO publications_fts(publication_id,title,keywords,abstract) VALUES(?,?,?,?)",
              [existingId, canonical.title,
               (JSON.parse(canonical.index_keywords_json) as string[]).join(" "),
               canonical.abstract ?? ""]
            );
          }
          updated++;
        } else {
          unchanged++;
        }
        run(
          "INSERT OR IGNORE INTO workspace_publications(workspace_id,publication_id) VALUES(?,?)",
          [workspaceId, existingId]
        );
        run(
          "INSERT OR IGNORE INTO workspace_publication_state(workspace_id,publication_id,reading_state,updated_at) VALUES(?,?,?,?)",
          [workspaceId, existingId, "unread", timestamp]
        );
        if (record.doi && !identifierIndex.has(`doi:${record.doi}`)) {
          run(
            "INSERT OR IGNORE INTO publication_identifiers(publication_id,identifier_type,identifier_value) VALUES(?,?,?)",
            [existingId, "doi", record.doi]
          );
          identifierIndex.set(`doi:${record.doi}`, existingId);
        }
        if (record.semanticScholarId) {
          ssIdIndex.set(record.semanticScholarId, existingId);
        }
      }
    }

    run("COMMIT");
  } catch (error) {
    run("ROLLBACK");
    throw error;
  }

  return { created, updated, unchanged, rejected, totalFetched: records.length };
}

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.type) {
    case "cancel":
      cancelledRequests.add(request.payload.requestId);
      return undefined;
    case "init": return initialize(request.payload);
    case "preflight": return preflight(request.id, request.payload.files);
    case "commit-import": return commitImport(
      request.id,
      request.payload.preflightId,
      request.payload.options,
      request.payload.currentHashes
    );
    case "export-backup": return exportBackup();
    case "backup-metadata": return backupMetadata();
    case "list-import-ids": return rows<{ import_id: string }>(
      "SELECT import_id FROM imports ORDER BY import_id"
    ).map((item) => item.import_id);
    case "destroy-storage": return destroyStorage();
    case "memory-stats": return memoryStats();
    case "create-workspace": return createWorkspace(request.payload.name);
    case "list-workspaces": return listWorkspaces();
    case "get-workspace": return getWorkspace(request.payload.workspaceId);
    case "rename-workspace": return renameWorkspace(request.payload.workspaceId, request.payload.name);
    case "delete-workspace": return deleteWorkspace(request.payload.workspaceId);
    case "get-capabilities": return capabilities(request.payload.workspaceId);
    case "research": return research(request.payload);
    case "get-publication": return getPublication(request.payload.publicationId, request.payload.workspaceId);
    case "explore": {
      const result = explore(request.payload);
      clearStatementCache();
      run("PRAGMA shrink_memory");
      return result;
    }
    case "create-collection": return createCollection(request.payload);
    case "list-collections": return rows<{ collection_id: string }>(
      "SELECT collection_id FROM collections WHERE workspace_id=? ORDER BY updated_at DESC",
      [request.payload.workspaceId]
    ).map((item) => collectionRecord(item.collection_id));
    case "delete-collection":
      run("DELETE FROM collections WHERE collection_id=?", [request.payload.collectionId]);
      return undefined;
    case "add-to-collection": return updateCollection(request.payload.collectionId, request.payload.publicationIds, true);
    case "remove-from-collection": return updateCollection(request.payload.collectionId, request.payload.publicationIds, false);
    case "collection-seeds": return collectionRecord(request.payload.collectionId).publicationIds;
    case "set-reading-state":
      if (!scalar<string>(
        "SELECT publication_id FROM workspace_publications WHERE workspace_id=? AND publication_id=?",
        [request.payload.workspaceId, request.payload.publicationId]
      )) {
        throw Object.assign(new Error("Publication is outside the workspace corpus."), {
          code: "VALIDATION_ERROR"
        });
      }
      run(
        `INSERT INTO workspace_publication_state(workspace_id,publication_id,reading_state,updated_at)
         VALUES(?,?,?,?) ON CONFLICT(workspace_id,publication_id)
         DO UPDATE SET reading_state=excluded.reading_state,updated_at=excluded.updated_at`,
        [request.payload.workspaceId, request.payload.publicationId, request.payload.state, now()]
      );
      return undefined;
    case "commit-semantic-scholar-import":
      return commitSemanticScholarImport(
        request.id,
        request.payload.workspaceId,
        request.payload.records,
        request.payload.searchProvenance
      );
  }
}

async function processRequest(request: WorkerRequest): Promise<void> {
  try {
    const result = await handle(request);
    const response: WorkerResponse = { id: request.id, ok: true, result };
    if (result instanceof Uint8Array) ctx.postMessage(response, [result.buffer]);
    else ctx.postMessage(response);
  } catch (error) {
    const value = error as Error & { code?: string; details?: unknown };
    ctx.postMessage({
      id: request.id,
      ok: false,
      error: {
        code: value.code ?? "DATABASE_WORKER_ERROR",
        message: value.message,
        details: value.details
      }
    } satisfies WorkerResponse);
  }
}

let requestQueue = Promise.resolve();
ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === "cancel") {
    cancelledRequests.add(event.data.payload.requestId);
    void processRequest(event.data);
    return;
  }
  requestQueue = requestQueue.then(
    () => processRequest(event.data),
    () => processRequest(event.data)
  );
};

export type ReadingState = "unread" | "reading" | "read";

export interface OperationControl {
  signal?: AbortSignal;
  onProgress?: (progress: { phase: string; completed: number; total: number }) => void;
}

export interface PreflightOptions extends OperationControl {
  encoding?: import("./domain/csv-encoding").CsvEncoding;
}

export type MvpExplorationMode =
  | "similar"
  | "earlier"
  | "later"
  | "references"
  | "cited-by-in-corpus";

export interface SourceFileIdentity {
  fileName: string;
  path: string;
  sourceFileHash: string;
}

export interface FeatureAvailability {
  feature: string;
  status: "available" | "degraded" | "unavailable";
  reason: string;
  requiredColumns: string[];
}

export interface PreflightCapabilityReport {
  preflightId: string;
  sourceFiles: SourceFileIdentity[];
  availableColumns: string[];
  rowCount: number;
  recordsWithAbstract: number;
  recordsWithReferences: number;
  recordsWithAuthorIds: number;
  recordsWithAffiliations: number;
  duplicateRows: number;
  conflictingRows: number;
  probableDuplicateRows: number;
  invalidRows: number;
  potentialFeatures: FeatureAvailability[];
  warnings: string[];
}

export interface CorpusCapabilityReport {
  corpusVersion: string;
  importIds: string[];
  publicationCount: number;
  resolvedReferenceEdges: number;
  lexicalCoverage: {
    withTitle: number;
    withAbstract: number;
    withKeywords: number;
  };
  supportsKeywordSearch: boolean;
  supportsLexicalSimilarity: boolean;
  supportsCitationGraph: boolean;
  supportsReferences: boolean;
  supportsCitedByInCorpus: boolean;
  unavailableFeatures: Array<{
    feature: string;
    reason: string;
    requiredData: string[];
  }>;
}

export interface RuntimeCapabilityReport {
  supported: boolean;
  webAssembly: boolean;
  worker: boolean;
  opfs: boolean;
  opfsSahPool: boolean;
  fts5: boolean;
  runtimeName?: string;
  schemaVersion?: number;
}

export interface ScopusSearchProvenance {
  query?: string;
  filters?: Record<string, string | string[]>;
  searchedAt?: string;
  exportedAt: string;
  database: "Scopus";
  resultCountAtExport?: number;
  notes?: string;
}

export interface Workspace {
  workspaceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchCollection {
  collectionId: string;
  workspaceId: string;
  name: string;
  color?: string;
  labels: string[];
  publicationIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PublicationRecord {
  publicationId: string;
  eid?: string;
  doi?: string;
  scopusId?: string;
  semanticScholarId?: string;
  dataSource?: "scopus" | "semantic-scholar";
  title: string;
  abstract?: string;
  year?: number;
  authors: string[];
  authorIds: string[];
  affiliations: string[];
  authorKeywords: string[];
  indexKeywords: string[];
  sourceTitle?: string;
  documentType?: string;
  citationCount?: number;
  referencesInCorpus: number;
  citedByInCorpus: number;
  sourceFields: Record<string, string>;
  readingState?: ReadingState;
}

export interface ResearchQuery {
  workspaceId: string;
  titleContains?: string;
  authors?: string[];
  keywords?: string[];
  years?: { from?: number; to?: number };
  documentTypes?: string[];
  citationCount?: { min?: number; max?: number };
  hasAbstract?: boolean;
  fullText?: string;
  limit?: number;
  offset?: number;
}

export interface ScopusImportOptions {
  workspaceId: string;
  mode: "import-new" | "upsert-identifiers";
  searchProvenance: ScopusSearchProvenance;
}

export interface ImportReport {
  importId: string;
  corpusVersion: string;
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  resolvedReferenceEdges: number;
  warnings: string[];
  capabilities: CorpusCapabilityReport;
  backupWarning?: string;
  rawArchivePath?: string;
  rawArchiveWarning?: string;
}

export interface ExplorationRequest {
  workspaceId: string;
  seedPublicationIds: string[];
  mode: MvpExplorationMode;
  filters?: Omit<ResearchQuery, "workspaceId">;
  limit?: number;
}

export interface RecommendationEvidence {
  channel: "bm25" | "keyword" | "shared-reference" | "author" | "year" | "citation";
  rawValue: number;
  normalizedValue: number;
  explanation: string;
}

export interface ExplorationResultItem {
  publicationId: string;
  publication: PublicationRecord;
  score: number;
  confidence: number;
  evidenceCoverage: "full" | "degraded" | "minimal";
  evidence: RecommendationEvidence[];
}

export type ExplorationContext = ExplorationResult;

export interface ExplorationGraphEdge {
  sourcePublicationId: string;
  targetPublicationId: string;
  kind: "citation" | "similarity";
  weight: number;
  label: string;
}

export interface ExplorationResult {
  corpusVersion: string;
  rankingProfileVersion: string;
  textAnalysisProfileVersion: string;
  mode: MvpExplorationMode;
  seedPublicationIds: string[];
  seedPublications: PublicationRecord[];
  items: ExplorationResultItem[];
  graphEdges: ExplorationGraphEdge[];
}

export interface RecommendationExplanation {
  publicationId: string;
  score: number;
  summary: string;
  evidence: RecommendationEvidence[];
}

export interface CreateCollectionInput {
  workspaceId: string;
  name: string;
  color?: string;
  labels?: string[];
}

export interface CreateWorkspaceInput {
  name: string;
}

export interface TextAnalysisProfile {
  version: "mvp-text-v1";
  unicodeNormalization: "NFKC";
  caseFolding: "unicode-lowercase";
  segmentation: "Intl.Segmenter-word";
  stemming: "none";
  englishStopWords: "bundled-v1";
  titleBoost: 3;
  keywordBoost: 2;
  abstractBoost: 1;
  maxAbstractTermsPerSeed: 32;
  maxCandidatesPerSeed: 500;
}

export interface RankingProfile {
  version: "mvp-ranking-v1";
  textAnalysisProfileVersion: "mvp-text-v1";
  bm25Weight: 0.5;
  keywordWeight: 0.15;
  sharedReferenceWeight: 0.2;
  authorWeight: 0.1;
  yearWeight: 0.05;
}

export interface PluginSettings {
  defaultWorkspaceId?: string;
  notesFolder: string;
  graphNodeLimit: number;
  resultLimit: number;
  backupWarning?: string;
  semanticScholarApiKey?: string;
}

export type { SemanticScholarImportOptions, SemanticScholarImportResult } from "./semantic-scholar/types";

export const DEFAULT_SETTINGS: PluginSettings = {
  notesFolder: "Research/Publications",
  graphNodeLimit: 500,
  resultLimit: 500
};

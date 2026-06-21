import type {
  CorpusCapabilityReport,
  CreateCollectionInput,
  CreateWorkspaceInput,
  ExplorationRequest,
  ExplorationResult,
  ImportReport,
  PreflightCapabilityReport,
  PublicationRecord,
  ReadingState,
  ResearchCollection,
  ResearchQuery,
  ScopusImportOptions,
  SourceFileIdentity,
  Workspace
} from "../types";

export interface SourcePayload extends SourceFileIdentity {
  content: string;
}

export type WorkerRequest =
  | { id: string; type: "cancel"; payload: { requestId: string } }
  | {
      id: string;
      type: "init";
      payload: {
        vaultId: string;
        wasmUrl: string;
        restoreBytes?: Uint8Array;
        invalidBackupReason?: string;
      };
    }
  | { id: string; type: "preflight"; payload: { files: SourcePayload[] } }
  | { id: string; type: "commit-import"; payload: { preflightId: string; options: ScopusImportOptions; currentHashes: Record<string, string> } }
  | { id: string; type: "export-backup"; payload: Record<string, never> }
  | { id: string; type: "backup-metadata"; payload: Record<string, never> }
  | { id: string; type: "list-import-ids"; payload: Record<string, never> }
  | { id: string; type: "destroy-storage"; payload: Record<string, never> }
  | { id: string; type: "memory-stats"; payload: Record<string, never> }
  | { id: string; type: "create-workspace"; payload: CreateWorkspaceInput }
  | { id: string; type: "list-workspaces"; payload: Record<string, never> }
  | { id: string; type: "get-workspace"; payload: { workspaceId: string } }
  | { id: string; type: "rename-workspace"; payload: { workspaceId: string; name: string } }
  | { id: string; type: "delete-workspace"; payload: { workspaceId: string } }
  | { id: string; type: "get-capabilities"; payload: { workspaceId: string } }
  | { id: string; type: "research"; payload: ResearchQuery }
  | { id: string; type: "get-publication"; payload: { publicationId: string; workspaceId: string } }
  | { id: string; type: "explore"; payload: ExplorationRequest }
  | { id: string; type: "create-collection"; payload: CreateCollectionInput }
  | { id: string; type: "list-collections"; payload: { workspaceId: string } }
  | { id: string; type: "delete-collection"; payload: { collectionId: string } }
  | { id: string; type: "add-to-collection"; payload: { collectionId: string; publicationIds: string[] } }
  | { id: string; type: "remove-from-collection"; payload: { collectionId: string; publicationIds: string[] } }
  | { id: string; type: "collection-seeds"; payload: { collectionId: string } }
  | { id: string; type: "set-reading-state"; payload: { workspaceId: string; publicationId: string; state: ReadingState } };

export interface WorkerSuccess<T = unknown> {
  id: string;
  ok: true;
  result: T;
}

export interface WorkerFailure {
  id: string;
  ok: false;
  error: { code: string; message: string; details?: unknown };
}

export interface WorkerProgress {
  id: string;
  ok: true;
  progress: {
    phase: string;
    completed: number;
    total: number;
  };
}

export type WorkerResponse = WorkerSuccess | WorkerFailure | WorkerProgress;

export interface WorkerResultMap {
  cancel: void;
  init: {
    runtime: string;
    schemaVersion: number;
    migrated: boolean;
    restored: boolean;
    createdFresh: boolean;
  };
  preflight: PreflightCapabilityReport;
  "commit-import": ImportReport;
  "export-backup": Uint8Array;
  "backup-metadata": {
    schemaVersion: number;
    corpusVersions: Record<string, string>;
  };
  "list-import-ids": string[];
  "destroy-storage": void;
  "memory-stats": {
    wasmMemoryBytes: number;
    databaseBytes: number;
    cachedStatements: number;
  };
  "create-workspace": Workspace;
  "list-workspaces": Workspace[];
  "get-workspace": Workspace | null;
  "rename-workspace": Workspace;
  "delete-workspace": void;
  "get-capabilities": CorpusCapabilityReport;
  research: PublicationRecord[];
  "get-publication": PublicationRecord | null;
  explore: ExplorationResult;
  "create-collection": ResearchCollection;
  "list-collections": ResearchCollection[];
  "delete-collection": void;
  "add-to-collection": ResearchCollection;
  "remove-from-collection": ResearchCollection;
  "collection-seeds": string[];
  "set-reading-state": void;
}

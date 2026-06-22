export interface SsSearchResponse {
  total: number;
  offset: number;
  next?: number;
  data: SsPaper[];
}

export interface SsPaper {
  paperId: string;
  externalIds?: {
    DOI?: string;
    ArXiv?: string;
    PubMed?: string;
    CorpusId?: number;
  };
  title?: string;
  abstract?: string;
  year?: number;
  authors?: SsAuthor[];
  venue?: string;
  journal?: { name?: string; volume?: string; pages?: string };
  publicationTypes?: string[];
  fieldsOfStudy?: string[];
  citationCount?: number;
  openAccessPdf?: { url?: string };
  publicationDate?: string;
}

export interface SsAuthor {
  authorId?: string;
  name?: string;
}

export interface SsReferencePage {
  offset: number;
  next?: number;
  data: Array<{ citedPaper: SsPaper }>;
}

export interface SemanticScholarImportOptions {
  workspaceId: string;
  query: string;
  limit: number;
  fetchReferences: boolean;
  apiKey?: string;
}

export interface SemanticScholarImportResult {
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  totalFetched: number;
}

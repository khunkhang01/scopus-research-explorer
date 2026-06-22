import { normalizeDoi } from "../domain/identifiers";
import type { SsPaper } from "./types";
import type { PublicationRecord } from "../types";

const SS_DOCUMENT_TYPE_MAP: Record<string, string> = {
  JournalArticle: "Article",
  Conference: "Conference Paper",
  Review: "Review",
  Book: "Book",
  BookSection: "Book Chapter",
  Preprint: "Preprint",
  Dataset: "Data",
};

export function mapSsPaperToRecord(paper: SsPaper, workspaceId: string): PublicationRecord {
  const doi = normalizeDoi(paper.externalIds?.DOI);

  return {
    publicationId: crypto.randomUUID(),
    eid: undefined,
    doi,
    scopusId: undefined,
    semanticScholarId: paper.paperId,
    dataSource: "semantic-scholar",
    title: paper.title ?? "(no title)",
    abstract: paper.abstract ?? undefined,
    year: paper.year ?? undefined,
    authors: (paper.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
    authorIds: (paper.authors ?? []).map((a) => a.authorId ?? "").filter(Boolean),
    affiliations: [],
    authorKeywords: [],
    indexKeywords: paper.fieldsOfStudy ?? [],
    sourceTitle: paper.journal?.name ?? paper.venue ?? undefined,
    documentType: mapDocumentType(paper.publicationTypes),
    citationCount: paper.citationCount ?? undefined,
    referencesInCorpus: 0,
    citedByInCorpus: 0,
    sourceFields: buildSourceFields(paper),
    readingState: "unread",
  };
}

function mapDocumentType(types?: string[]): string | undefined {
  if (!types || types.length === 0) return undefined;
  const first = types[0]!;
  return SS_DOCUMENT_TYPE_MAP[first] ?? first;
}

function buildSourceFields(paper: SsPaper): Record<string, string> {
  return {
    paperId: paper.paperId,
    doi: paper.externalIds?.DOI ?? "",
    arxivId: paper.externalIds?.ArXiv ?? "",
    pubmedId: paper.externalIds?.PubMed ?? "",
    venue: paper.venue ?? "",
    journalName: paper.journal?.name ?? "",
    publicationDate: paper.publicationDate ?? "",
  };
}

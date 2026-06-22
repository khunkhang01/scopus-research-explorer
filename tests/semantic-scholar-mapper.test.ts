import { describe, it, expect } from "vitest";
import { mapSsPaperToRecord } from "../src/semantic-scholar/mapper";
import type { SsPaper } from "../src/semantic-scholar/types";

const WS = "workspace-1";

function paper(overrides: Partial<SsPaper> = {}): SsPaper {
  return {
    paperId: "ss-id-001",
    title: "Default Title",
    year: 2023,
    authors: [{ authorId: "auth-1", name: "Alice Smith" }],
    ...overrides,
  };
}

describe("mapSsPaperToRecord", () => {
  it("maps a full record correctly", () => {
    const p = paper({
      paperId: "abc",
      externalIds: { DOI: "10.1234/test", ArXiv: "2301.00001" },
      title: "Full Paper",
      abstract: "A great abstract.",
      year: 2022,
      authors: [{ authorId: "a1", name: "Alice" }, { authorId: "a2", name: "Bob" }],
      venue: "NeurIPS",
      journal: { name: "Journal of AI" },
      publicationTypes: ["JournalArticle"],
      fieldsOfStudy: ["Computer Science"],
      citationCount: 42,
      openAccessPdf: { url: "https://arxiv.org/pdf/2301.00001" },
    });
    const rec = mapSsPaperToRecord(p, WS);

    expect(rec.doi).toBe("10.1234/test");
    expect(rec.title).toBe("Full Paper");
    expect(rec.abstract).toBe("A great abstract.");
    expect(rec.year).toBe(2022);
    expect(rec.authors).toEqual(["Alice", "Bob"]);
    expect(rec.authorIds).toEqual(["a1", "a2"]);
    expect(rec.documentType).toBe("Article");
    expect(rec.indexKeywords).toEqual(["Computer Science"]);
    expect(rec.citationCount).toBe(42);
    expect(rec.semanticScholarId).toBe("abc");
    expect(rec.dataSource).toBe("semantic-scholar");
    expect(rec.eid).toBeUndefined();
    expect(rec.scopusId).toBeUndefined();
    expect(rec.readingState).toBe("unread");
    expect(rec.referencesInCorpus).toBe(0);
    expect(rec.citedByInCorpus).toBe(0);
  });

  it("applies defaults for minimal record (only paperId + title)", () => {
    const rec = mapSsPaperToRecord({ paperId: "min-1", title: "Minimal" }, WS);
    expect(rec.title).toBe("Minimal");
    expect(rec.abstract).toBeUndefined();
    expect(rec.year).toBeUndefined();
    expect(rec.authors).toEqual([]);
    expect(rec.authorIds).toEqual([]);
    expect(rec.affiliations).toEqual([]);
    expect(rec.authorKeywords).toEqual([]);
    expect(rec.indexKeywords).toEqual([]);
    expect(rec.citationCount).toBeUndefined();
    expect(rec.documentType).toBeUndefined();
    expect(rec.semanticScholarId).toBe("min-1");
  });

  it("normalizes DOI — strips URL prefix", () => {
    const rec = mapSsPaperToRecord(paper({ externalIds: { DOI: "https://doi.org/10.1234/test" } }), WS);
    expect(rec.doi).toBe("10.1234/test");
  });

  it("normalizes DOI — strips doi: prefix", () => {
    const rec = mapSsPaperToRecord(paper({ externalIds: { DOI: "doi:10.1234/foo" } }), WS);
    expect(rec.doi).toBe("10.1234/foo");
  });

  it("sets title to '(no title)' when title is undefined", () => {
    const rec = mapSsPaperToRecord({ paperId: "x", title: undefined }, WS);
    expect(rec.title).toBe("(no title)");
  });

  it("maps JournalArticle publicationType to 'Article'", () => {
    const rec = mapSsPaperToRecord(paper({ publicationTypes: ["JournalArticle"] }), WS);
    expect(rec.documentType).toBe("Article");
  });

  it("maps Conference to 'Conference Paper'", () => {
    const rec = mapSsPaperToRecord(paper({ publicationTypes: ["Conference"] }), WS);
    expect(rec.documentType).toBe("Conference Paper");
  });

  it("passes through unknown document type", () => {
    const rec = mapSsPaperToRecord(paper({ publicationTypes: ["Thesis"] }), WS);
    expect(rec.documentType).toBe("Thesis");
  });

  it("returns undefined documentType when publicationTypes is undefined", () => {
    const rec = mapSsPaperToRecord(paper({ publicationTypes: undefined }), WS);
    expect(rec.documentType).toBeUndefined();
  });

  it("returns undefined documentType when publicationTypes is empty", () => {
    const rec = mapSsPaperToRecord(paper({ publicationTypes: [] }), WS);
    expect(rec.documentType).toBeUndefined();
  });

  it("uses openAccessPdf url as link when present", () => {
    const rec = mapSsPaperToRecord(paper({ openAccessPdf: { url: "https://arxiv.org/pdf/1234" } }), WS);
    expect(rec.sourceFields["paperId"]).toBe("ss-id-001");
  });

  it("stores sourceFields with raw SS data", () => {
    const p = paper({
      externalIds: { DOI: "10.1/x", ArXiv: "2301.1", PubMed: "PM123" },
      venue: "ICML",
      journal: { name: "ML Journal" },
      publicationDate: "2023-06-01",
    });
    const rec = mapSsPaperToRecord(p, WS);
    expect(rec.sourceFields["doi"]).toBe("10.1/x");
    expect(rec.sourceFields["arxivId"]).toBe("2301.1");
    expect(rec.sourceFields["pubmedId"]).toBe("PM123");
    expect(rec.sourceFields["venue"]).toBe("ICML");
    expect(rec.sourceFields["journalName"]).toBe("ML Journal");
    expect(rec.sourceFields["publicationDate"]).toBe("2023-06-01");
  });

  it("filters out authors with null/undefined name", () => {
    const rec = mapSsPaperToRecord(paper({
      authors: [{ authorId: "a1", name: "Alice" }, { authorId: "a2", name: undefined }]
    }), WS);
    expect(rec.authors).toEqual(["Alice"]);
  });

  it("filters out author IDs with null/undefined authorId", () => {
    const rec = mapSsPaperToRecord(paper({
      authors: [{ authorId: "a1", name: "Alice" }, { authorId: undefined, name: "Bob" }]
    }), WS);
    expect(rec.authorIds).toEqual(["a1"]);
  });

  it("prefers journal.name over venue for sourceTitle", () => {
    const rec = mapSsPaperToRecord(paper({
      journal: { name: "Nature" },
      venue: "NeurIPS",
    }), WS);
    expect(rec.sourceTitle).toBe("Nature");
  });

  it("falls back to venue when journal.name is absent", () => {
    const rec = mapSsPaperToRecord(paper({
      journal: undefined,
      venue: "NeurIPS",
    }), WS);
    expect(rec.sourceTitle).toBe("NeurIPS");
  });

  it("generates a unique publicationId for each call", () => {
    const a = mapSsPaperToRecord(paper(), WS);
    const b = mapSsPaperToRecord(paper(), WS);
    expect(a.publicationId).not.toBe(b.publicationId);
  });
});

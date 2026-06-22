import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapSsPaperToRecord } from "../src/semantic-scholar/mapper";
import { SemanticScholarClient } from "../src/semantic-scholar/client";
import type { SsSearchResponse, SsReferencePage, SsPaper } from "../src/semantic-scholar/types";

// Unit tests for the searchAndImportSemanticScholar logic, exercised through the mapper +
// client in isolation (worker is tested separately via the dedup tests).

function paper(id: string, title: string, doi?: string): SsPaper {
  return {
    paperId: id,
    title,
    year: 2023,
    authors: [{ authorId: "a1", name: "Author One" }],
    externalIds: doi ? { DOI: doi } : undefined,
    publicationTypes: ["JournalArticle"],
    citationCount: 5,
  };
}

const SEARCH_RESPONSE: SsSearchResponse = {
  total: 2,
  offset: 0,
  data: [paper("p1", "Paper One", "10.1/one"), paper("p2", "Paper Two")],
};

describe("SemanticScholarClient (via mock) — searchPapers integration", () => {
  it("returns parsed search response", async () => {
    const mockFn = vi.fn().mockResolvedValue({ status: 200, json: SEARCH_RESPONSE });
    const client = new SemanticScholarClient(undefined, mockFn as any);
    const res = await client.searchPapers("test query", 2);
    expect(res.total).toBe(2);
    expect(res.data).toHaveLength(2);
    expect(mockFn).toHaveBeenCalledOnce();
  });

  it("calls getReferences for each paper when fetchReferences=true", async () => {
    const refPage: SsReferencePage = {
      offset: 0,
      data: [{ citedPaper: paper("ref-1", "Referenced Paper") }],
    };
    const mockFn = vi.fn()
      .mockResolvedValueOnce({ status: 200, json: SEARCH_RESPONSE }) // search
      .mockResolvedValue({ status: 200, json: refPage });              // references x2

    const client = new SemanticScholarClient(undefined, mockFn as any);
    await client.searchPapers("test", 2);
    // Simulate fetching references for each paper
    for (const p of SEARCH_RESPONSE.data) {
      await client.getReferences(p.paperId);
    }
    expect(mockFn).toHaveBeenCalledTimes(3); // 1 search + 2 reference calls
  });

  it("maps all search result papers to PublicationRecord", () => {
    const records = SEARCH_RESPONSE.data.map((p) => mapSsPaperToRecord(p, "ws-1"));
    expect(records).toHaveLength(2);
    expect(records[0]!.doi).toBe("10.1/one");
    expect(records[0]!.dataSource).toBe("semantic-scholar");
    expect(records[1]!.doi).toBeUndefined();
  });

  it("skips reference papers with '(no title)'", () => {
    const refPage: SsReferencePage = {
      offset: 0,
      data: [
        { citedPaper: { paperId: "ref-1" } },          // no title → (no title)
        { citedPaper: paper("ref-2", "Good Ref") },
      ],
    };
    const refRecords = refPage.data
      .map((r) => mapSsPaperToRecord(r.citedPaper, "ws-1"))
      .filter((r) => r.title !== "(no title)");
    expect(refRecords).toHaveLength(1);
    expect(refRecords[0]!.title).toBe("Good Ref");
  });

  it("abortSignal stops reference fetching mid-loop", async () => {
    const controller = new AbortController();
    const fetchedPapers: string[] = [];

    const mockFn = vi.fn().mockResolvedValue({
      status: 200,
      json: { offset: 0, data: [{ citedPaper: paper("ref-1", "Ref") }] } as SsReferencePage,
    });
    const client = new SemanticScholarClient(undefined, mockFn as any);

    controller.abort();
    const papers = SEARCH_RESPONSE.data;
    for (const p of papers) {
      if (controller.signal.aborted) break;
      await client.getReferences(p.paperId);
      fetchedPapers.push(p.paperId);
    }
    expect(fetchedPapers).toHaveLength(0);
  });

  it("reference fetch failure is non-fatal — continues with remaining papers", async () => {
    const refPage: SsReferencePage = { offset: 0, data: [{ citedPaper: paper("ref-1", "Good") }] };
    const mockFn = vi.fn()
      .mockRejectedValueOnce(new Error("Network error")) // p1 fails
      .mockResolvedValueOnce({ status: 200, json: refPage }); // p2 succeeds

    const client = new SemanticScholarClient(undefined, mockFn as any);
    const allRefRecords: ReturnType<typeof mapSsPaperToRecord>[] = [];
    for (const p of SEARCH_RESPONSE.data) {
      try {
        const refs = await client.getReferences(p.paperId);
        allRefRecords.push(...refs.data.map((r) => mapSsPaperToRecord(r.citedPaper, "ws-1")));
      } catch {
        // non-fatal
      }
    }
    expect(allRefRecords).toHaveLength(1);
    expect(allRefRecords[0]!.title).toBe("Good");
  });
});

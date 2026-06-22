import { describe, it, expect, vi } from "vitest";
import { SemanticScholarClient, SemanticScholarApiError } from "../src/semantic-scholar/client";
import type { SsSearchResponse, SsReferencePage } from "../src/semantic-scholar/types";

const BASE = "https://api.semanticscholar.org/graph/v1";

function makeClient(mockFn: ReturnType<typeof vi.fn>, apiKey?: string) {
  return new SemanticScholarClient(apiKey, mockFn as any);
}

const EMPTY_SEARCH: SsSearchResponse = { total: 0, offset: 0, data: [] };
const EMPTY_REFS: SsReferencePage = { offset: 0, data: [] };

describe("SemanticScholarClient.searchPapers", () => {
  it("calls the correct URL with encoded query", async () => {
    const mock = vi.fn().mockResolvedValue({ status: 200, json: EMPTY_SEARCH });
    const client = makeClient(mock);
    await client.searchPapers("machine learning", 10);
    const { url } = mock.mock.calls[0]![0]! as { url: string };
    expect(url).toContain(`${BASE}/paper/search`);
    expect(url).toContain("query=machine%20learning");
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=0");
  });

  it("passes offset parameter", async () => {
    const mock = vi.fn().mockResolvedValue({ status: 200, json: EMPTY_SEARCH });
    const client = makeClient(mock);
    await client.searchPapers("test", 5, 20);
    const { url } = mock.mock.calls[0]![0]! as { url: string };
    expect(url).toContain("offset=20");
  });

  it("includes x-api-key header when apiKey provided", async () => {
    const mock = vi.fn().mockResolvedValue({ status: 200, json: EMPTY_SEARCH });
    const client = makeClient(mock, "my-key-123");
    await client.searchPapers("test", 5);
    const { headers } = mock.mock.calls[0]![0]! as { headers: Record<string, string> };
    expect(headers["x-api-key"]).toBe("my-key-123");
  });

  it("sends no x-api-key header when no apiKey", async () => {
    const mock = vi.fn().mockResolvedValue({ status: 200, json: EMPTY_SEARCH });
    const client = makeClient(mock);
    await client.searchPapers("test", 5);
    const { headers } = mock.mock.calls[0]![0]! as { headers: Record<string, string> };
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("throws SemanticScholarApiError on non-200", async () => {
    const mock = vi.fn().mockResolvedValue({ status: 429, json: {}, text: "Rate limited" });
    const client = makeClient(mock);
    await expect(client.searchPapers("test", 5)).rejects.toBeInstanceOf(SemanticScholarApiError);
    await expect(client.searchPapers("test", 5)).rejects.toMatchObject({ statusCode: 429 });
  });

  it("returns parsed response on 200", async () => {
    const response: SsSearchResponse = { total: 1, offset: 0, data: [{ paperId: "abc123", title: "Test" }] };
    const mock = vi.fn().mockResolvedValue({ status: 200, json: response });
    const client = makeClient(mock);
    const result = await client.searchPapers("test", 1);
    expect(result.total).toBe(1);
    expect(result.data[0]?.paperId).toBe("abc123");
  });
});

describe("SemanticScholarClient.getReferences", () => {
  it("calls the references endpoint for the given paperId", async () => {
    const mock = vi.fn().mockResolvedValue({ status: 200, json: EMPTY_REFS });
    const client = makeClient(mock);
    await client.getReferences("paper-xyz");
    const { url } = mock.mock.calls[0]![0]! as { url: string };
    expect(url).toContain(`/paper/paper-xyz/references`);
    expect(url).toContain("limit=100");
  });

  it("URL-encodes the paperId", async () => {
    const mock = vi.fn().mockResolvedValue({ status: 200, json: EMPTY_REFS });
    const client = makeClient(mock);
    await client.getReferences("id with spaces");
    const { url } = mock.mock.calls[0]![0]! as { url: string };
    expect(url).toContain("id%20with%20spaces");
  });

  it("throws SemanticScholarApiError on non-200", async () => {
    const mock = vi.fn().mockResolvedValue({ status: 404, json: {}, text: "Not found" });
    const client = makeClient(mock);
    await expect(client.getReferences("bad-id")).rejects.toBeInstanceOf(SemanticScholarApiError);
    await expect(client.getReferences("bad-id")).rejects.toMatchObject({ statusCode: 404 });
  });
});

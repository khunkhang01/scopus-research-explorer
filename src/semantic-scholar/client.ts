import type { SsSearchResponse, SsReferencePage } from "./types";
import { RateLimiter } from "./rate-limiter";

const BASE = "https://api.semanticscholar.org/graph/v1";

const PAPER_FIELDS = [
  "paperId", "externalIds", "title", "abstract", "year",
  "authors", "venue", "journal", "publicationTypes",
  "fieldsOfStudy", "citationCount", "openAccessPdf", "publicationDate"
].join(",");

// Injected in tests via SemanticScholarClient.requestFn to avoid importing 'obsidian' in tests.
export type RequestFn = (options: { url: string; headers?: Record<string, string> }) => Promise<{ status: number; json: unknown; text?: string }>;

export class SemanticScholarApiError extends Error {
  constructor(
    public readonly statusCode: number,
    body: string
  ) {
    super(`Semantic Scholar API error ${statusCode}: ${body}`);
    this.name = "SemanticScholarApiError";
  }
}

export class SemanticScholarClient {
  private readonly limiter: RateLimiter;
  private readonly headers: Record<string, string>;
  readonly requestFn: RequestFn;

  constructor(apiKey?: string, requestFnOverride?: RequestFn) {
    // Conservative: 10/s with key (well below 100/s limit), 1/s without
    this.limiter = new RateLimiter(apiKey ? 10 : 1);
    this.headers = apiKey ? { "x-api-key": apiKey } : {};
    if (requestFnOverride) {
      this.requestFn = requestFnOverride;
    } else {
      // Dynamic import of obsidian so tests can override without the module being present
      this.requestFn = async (options) => {
        const { requestUrl } = await import("obsidian");
        return requestUrl(options);
      };
    }
  }

  async searchPapers(query: string, limit: number, offset = 0): Promise<SsSearchResponse> {
    await this.limiter.acquire();
    const url = `${BASE}/paper/search?query=${encodeURIComponent(query)}&fields=${PAPER_FIELDS}&limit=${limit}&offset=${offset}`;
    const res = await this.requestFn({ url, headers: this.headers });
    if (res.status !== 200) {
      throw new SemanticScholarApiError(res.status, res.text ?? "(no body)");
    }
    return res.json as SsSearchResponse;
  }

  async getReferences(paperId: string, limit = 100): Promise<SsReferencePage> {
    await this.limiter.acquire();
    const url = `${BASE}/paper/${encodeURIComponent(paperId)}/references?fields=${PAPER_FIELDS}&limit=${limit}`;
    const res = await this.requestFn({ url, headers: this.headers });
    if (res.status !== 200) {
      throw new SemanticScholarApiError(res.status, res.text ?? "(no body)");
    }
    return res.json as SsReferencePage;
  }
}

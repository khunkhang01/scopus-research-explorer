# Semantic Scholar API Integration — Implementation Plan

> Prepared: 2026-06-22  
> Scope: Add Semantic Scholar as a live-query data source alongside the existing Scopus CSV import path

---

## 1. Goal and Context

The plugin currently operates **local-first**: all publications enter the corpus via Scopus CSV export. This plan adds a second import path — **live search against the Semantic Scholar Academic Graph API** — so users can query, preview, and import papers directly inside Obsidian without downloading CSV files.

**Semantic Scholar API baseline facts** (confirmed free tier as of 2026):

| Property | Value |
|---|---|
| Base URL | `https://api.semanticscholar.org/graph/v1` |
| Auth | Optional API key (`x-api-key` header). Without key: 1 req/s; with key: 100 req/s |
| Key endpoint | `GET /paper/search?query=…&fields=…&offset=…&limit=…` |
| Paper detail | `GET /paper/{paperId}?fields=…` |
| References | `GET /paper/{paperId}/references?fields=…&limit=…` |
| Citations | `GET /paper/{paperId}/citations?fields=…&limit=…` |
| Max page size | 100 results per search page |
| Max references/citations per call | 1000 per call |

---

## 2. Prerequisite: Recover Source Code

The source tree was removed in commit `262db4b`. All implementation work requires it.

### Step P-1 — Restore source to a working branch

```sh
git checkout -b feature/semantic-scholar
git checkout 262db4b~1 -- src/ tests/ scripts/ tsconfig.json esbuild.config.mjs package.json package-lock.json
git add src tests scripts tsconfig.json esbuild.config.mjs package.json package-lock.json
git commit -m "restore: source tree from pre-release commit"
```

### Step P-2 — Verify build

```sh
npm install
npm run verify      # typecheck + test + build
```

**QA Gate P:** All pre-existing tests must pass before any new code is added. If tests fail, fix regressions first.

---

## 3. Architecture Overview

### 3.1 Component Map (after integration)

```
ResearchView (UI)
    │
    ├── ImportModal (Scopus CSV)         ← unchanged
    ├── SemanticScholarSearchModal (NEW) ← new UI component
    │       │
    │       └── SemanticScholarClient (NEW)
    │               │
    │               ├── HTTP via Obsidian requestUrl()
    │               ├── RateLimiter (NEW)
    │               └── SemanticScholarMapper (NEW) — SS fields → PublicationRecord
    │
    └── ResearchExplorerMvpApi
            │
            └── DatabaseWorkerClient
                    │
                    └── database.worker (SQLite WASM)
                            │
                            ├── commit-import (existing)
                            └── commit-semantic-scholar-import (NEW, reuses upsert path)
```

### 3.2 Design Principles

- **Additive only**: new files, new protocol message types, new UI entry points. No breaking changes to existing Scopus CSV path.
- **Reuse upsert infrastructure**: the existing `upsert-identifiers` mode in `commit-import` already deduplicates by DOI/EID/title+year. SS records enter through the same gate.
- **Source provenance**: every SS import records `{ database: "semantic-scholar", query: "...", importedAt: ISO8601 }` in the existing `searchProvenance` field.
- **No runtime CORS issues**: Obsidian desktop exposes `requestUrl()` (not `fetch`) which bypasses browser CORS. All HTTP calls must go through this Obsidian API.
- **Rate limit safety first**: the client must never exceed Semantic Scholar's rate limits regardless of user actions.

---

## 4. Phase 1 — New Types and Interfaces

**File: `src/semantic-scholar/types.ts`** (new)

Define the raw Semantic Scholar API response shapes:

```typescript
// Raw API response types — only fields we actually use
export interface SsSearchResponse {
  total: number
  offset: number
  next?: number
  data: SsPaper[]
}

export interface SsPaper {
  paperId: string
  externalIds?: {
    DOI?: string
    ArXiv?: string
    PubMed?: string
    CorpusId?: number
  }
  title?: string
  abstract?: string
  year?: number
  authors?: SsAuthor[]
  venue?: string
  journal?: { name?: string; volume?: string; pages?: string }
  publicationTypes?: string[]
  fieldsOfStudy?: string[]
  citationCount?: number
  openAccessPdf?: { url?: string }
  publicationDate?: string   // ISO 8601 date
}

export interface SsAuthor {
  authorId?: string
  name?: string
}

export interface SsReferencePage {
  offset: number
  next?: number
  data: Array<{ citedPaper: SsPaper }>
}

// Options for a live search import
export interface SemanticScholarImportOptions {
  workspaceId: string
  query: string
  limit: number            // 1–100
  fetchReferences: boolean // whether to call /references for each paper
  apiKey?: string          // forwarded from settings
}

// Result of an import
export interface SemanticScholarImportResult {
  created: number
  updated: number
  unchanged: number
  rejected: number
  totalFetched: number
}
```

**QA Gate 1:** TypeScript compilation must succeed with `strict: true` after this file is added.

---

## 5. Phase 2 — Rate Limiter

**File: `src/semantic-scholar/rate-limiter.ts`** (new)

Semantic Scholar enforces 1 req/s (no key) or 100 req/s (with key). A token-bucket limiter prevents breaching this regardless of how fast the user interacts.

```typescript
export class RateLimiter {
  private queue: Array<() => void> = []
  private lastFired = 0
  private intervalMs: number

  constructor(requestsPerSecond: number) {
    this.intervalMs = 1000 / requestsPerSecond
  }

  // Returns a promise that resolves when it is safe to make the next request
  async acquire(): Promise<void> {
    return new Promise(resolve => {
      this.queue.push(resolve)
      this.drain()
    })
  }

  private drain() {
    if (this.queue.length === 0) return
    const now = Date.now()
    const wait = Math.max(0, this.intervalMs - (now - this.lastFired))
    setTimeout(() => {
      const next = this.queue.shift()
      if (next) {
        this.lastFired = Date.now()
        next()
        this.drain()
      }
    }, wait)
  }
}
```

**QA Gate 2:** Unit test — fire 5 requests; assert that total elapsed time ≥ 4 × intervalMs (4 gaps between 5 requests). Verify no request fires before its slot.

---

## 6. Phase 3 — HTTP Client

**File: `src/semantic-scholar/client.ts`** (new)

All HTTP calls go through Obsidian's `requestUrl()`, which avoids CORS and works on all desktop platforms.

```typescript
import { requestUrl } from 'obsidian'
import type { SsSearchResponse, SsPaper, SsReferencePage } from './types'
import { RateLimiter } from './rate-limiter'

const BASE = 'https://api.semanticscholar.org/graph/v1'

const PAPER_FIELDS = [
  'paperId', 'externalIds', 'title', 'abstract', 'year',
  'authors', 'venue', 'journal', 'publicationTypes',
  'fieldsOfStudy', 'citationCount', 'openAccessPdf', 'publicationDate'
].join(',')

export class SemanticScholarClient {
  private limiter: RateLimiter
  private headers: Record<string, string>

  constructor(apiKey?: string) {
    const rps = apiKey ? 10 : 1   // conservative: 10/s with key to stay well below 100/s limit
    this.limiter = new RateLimiter(rps)
    this.headers = apiKey ? { 'x-api-key': apiKey } : {}
  }

  async searchPapers(query: string, limit: number, offset = 0): Promise<SsSearchResponse> {
    await this.limiter.acquire()
    const url = `${BASE}/paper/search?query=${encodeURIComponent(query)}&fields=${PAPER_FIELDS}&limit=${limit}&offset=${offset}`
    const res = await requestUrl({ url, headers: this.headers })
    if (res.status !== 200) {
      throw new SemanticScholarApiError(res.status, await this.bodyText(res))
    }
    return res.json as SsSearchResponse
  }

  async getReferences(paperId: string, limit = 100): Promise<SsReferencePage> {
    await this.limiter.acquire()
    const url = `${BASE}/paper/${encodeURIComponent(paperId)}/references?fields=${PAPER_FIELDS}&limit=${limit}`
    const res = await requestUrl({ url, headers: this.headers })
    if (res.status !== 200) {
      throw new SemanticScholarApiError(res.status, await this.bodyText(res))
    }
    return res.json as SsReferencePage
  }

  private bodyText(res: { text?: string }): string {
    return res.text ?? '(no body)'
  }
}

export class SemanticScholarApiError extends Error {
  constructor(public readonly statusCode: number, body: string) {
    super(`Semantic Scholar API error ${statusCode}: ${body}`)
    this.name = 'SemanticScholarApiError'
  }
}
```

**QA Gate 3:**
- Unit test with a mocked `requestUrl`: verify correct URL construction for `searchPapers` and `getReferences`.
- Verify that `apiKey` is included in the `x-api-key` header when present, and absent when not set.
- Verify that a non-200 response throws `SemanticScholarApiError` with the correct status code.

---

## 7. Phase 4 — Field Mapper

**File: `src/semantic-scholar/mapper.ts`** (new)

Maps a `SsPaper` to the existing `PublicationRecord` shape used by the database and UI. This is the most critical correctness boundary.

```typescript
import type { SsPaper } from './types'
import type { PublicationRecord } from '../types'
import { normalizeDoi } from '../domain/identifiers'
import { randomUUID } from '../utils'   // existing helper, or crypto.randomUUID()

export function mapSsPaperToRecord(paper: SsPaper, workspaceId: string): PublicationRecord {
  const doi = paper.externalIds?.DOI ? normalizeDoi(paper.externalIds.DOI) : undefined
  const corpusId = paper.externalIds?.CorpusId

  return {
    publicationId: randomUUID(),
    workspaceId,
    // Identifiers
    eid: undefined,                          // Scopus-specific, not available
    doi,
    scopusId: undefined,                     // Scopus-specific, not available
    semanticScholarId: paper.paperId,        // new optional field (see §8)
    // Bibliographic
    title: paper.title ?? '(no title)',
    abstract: paper.abstract ?? '',
    year: paper.year ?? 0,
    authors: (paper.authors ?? []).map(a => a.name ?? '').filter(Boolean),
    authorIds: (paper.authors ?? []).map(a => a.authorId ?? '').filter(Boolean),
    affiliations: [],                        // not in basic search fields
    authorKeywords: [],                      // not provided by SS API at this tier
    indexKeywords: paper.fieldsOfStudy ?? [],
    sourceTitle: paper.journal?.name ?? paper.venue ?? '',
    documentType: mapDocumentType(paper.publicationTypes),
    citationCount: paper.citationCount ?? 0,
    // Corpus metrics (computed later after graph is built)
    referencesInCorpus: 0,
    citedByInCorpus: 0,
    // Source
    link: paper.openAccessPdf?.url ?? `https://www.semanticscholar.org/paper/${paper.paperId}`,
    sourceFields: buildSourceFields(paper),
    readingState: 'unread',
    // Provenance
    dataSource: 'semantic-scholar',          // new optional field (see §8)
  }
}

function mapDocumentType(types?: string[]): string {
  if (!types || types.length === 0) return 'Unknown'
  // Semantic Scholar types: JournalArticle, Conference, Review, Book, BookSection, Preprint, Dataset, etc.
  const t = types[0]
  const map: Record<string, string> = {
    'JournalArticle': 'Article',
    'Conference': 'Conference Paper',
    'Review': 'Review',
    'Book': 'Book',
    'BookSection': 'Book Chapter',
    'Preprint': 'Preprint',
    'Dataset': 'Data',
  }
  return map[t] ?? t
}

function buildSourceFields(paper: SsPaper): Record<string, string> {
  // Preserves raw SS data for audit/debug; mirrors the Scopus sourceFields pattern
  return {
    paperId: paper.paperId ?? '',
    doi: paper.externalIds?.DOI ?? '',
    arxivId: paper.externalIds?.ArXiv ?? '',
    pubmedId: paper.externalIds?.PubMed ?? '',
    venue: paper.venue ?? '',
    journalName: paper.journal?.name ?? '',
    publicationDate: paper.publicationDate ?? '',
  }
}
```

**QA Gate 4 (field mapping validation):**

Write `tests/semantic-scholar-mapper.test.ts` with these cases:

| Test case | Input | Expected outcome |
|---|---|---|
| Full record | Paper with all fields populated | All fields mapped correctly |
| Minimal record | Only `paperId` and `title` | Defaults applied (empty arrays, year=0, unread state) |
| DOI normalization | `doi: "https://doi.org/10.1234/test"` | `doi === "10.1234/test"` |
| Missing title | `title: undefined` | `title === "(no title)"` |
| Document type mapping | `publicationTypes: ["JournalArticle"]` | `documentType === "Article"` |
| Unknown document type | `publicationTypes: ["Thesis"]` | `documentType === "Thesis"` (pass-through) |
| No publicationTypes | `publicationTypes: undefined` | `documentType === "Unknown"` |
| SS link fallback | No `openAccessPdf` | `link` contains the paperId in an SS URL |
| Author IDs | Authors with null authorId | Empty string filtered out |

---

## 8. Phase 5 — Extend Existing Types

**File: `src/types.ts`** (modify existing)

Add two optional fields to `PublicationRecord` so the database can track the data source without breaking backward compatibility:

```typescript
// Add to PublicationRecord interface
semanticScholarId?: string   // paper.paperId from Semantic Scholar
dataSource?: 'scopus' | 'semantic-scholar'  // provenance tag
```

Add `SemanticScholarImportOptions` and `SemanticScholarImportResult` (from Phase 1) to the exports.

**QA Gate 5:** Existing tests must continue to pass — the new fields are optional, so no existing test should break.

---

## 9. Phase 6 — Database Protocol Extension

**File: `src/database/protocol.ts`** (modify existing)

Add a new worker message type that reuses the existing `commit-import` upsert machinery but sets `dataSource: 'semantic-scholar'` provenance automatically.

```typescript
// Add to WorkerRequest union:
| { type: 'commit-semantic-scholar-import'; payload: CommitSemanticScholarImportPayload }

// New payload type:
export interface CommitSemanticScholarImportPayload {
  workspaceId: string
  records: PublicationRecord[]    // already mapped by SemanticScholarMapper
  searchProvenance: {
    query: string
    exportedAt: string
    database: 'semantic-scholar'
    notes?: string
  }
  mode: 'upsert-identifiers'      // always upsert — never creates duplicates
}

// Add to WorkerResultMap:
'commit-semantic-scholar-import': SemanticScholarImportResult
```

**Worker implementation** (`database.worker.ts`): The handler calls the existing upsert insert pipeline (already handles DOI and title+year deduplication). The only addition is writing `dataSource = 'semantic-scholar'` and `semanticScholarId` to the new columns.

**QA Gate 6:**
- Add a database column migration: `ALTER TABLE publications ADD COLUMN semanticScholarId TEXT; ALTER TABLE publications ADD COLUMN dataSource TEXT DEFAULT 'scopus'` — guarded by schema version bump.
- Write a test that imports 3 SS records, then imports the same 3 again → `created=3, updated=0, unchanged=3`.
- Write a test that imports a SS record whose DOI matches an existing Scopus record → `updated=1` (provenance merged, `dataSource` stays `scopus`).

---

## 10. Phase 7 — ResearchApi Extension

**File: `src/services/research-api.ts`** (modify existing)

Add one new method to `ResearchExplorerMvpApi`:

```typescript
// Add to interface:
searchAndImportSemanticScholar(
  options: SemanticScholarImportOptions,
  onProgress?: (event: ProgressEvent) => void,
  signal?: AbortSignal
): Promise<SemanticScholarImportResult>
```

**Implementation:**

```typescript
async searchAndImportSemanticScholar(options, onProgress, signal) {
  const client = new SemanticScholarClient(options.apiKey)
  const response = await client.searchPapers(options.query, options.limit)
  onProgress?.({ stage: 'fetched', count: response.data.length, total: response.total })

  let records = response.data.map(p => mapSsPaperToRecord(p, options.workspaceId))

  if (options.fetchReferences) {
    for (const paper of response.data) {
      if (signal?.aborted) break
      try {
        const refs = await client.getReferences(paper.paperId)
        const refRecords = refs.data
          .map(r => mapSsPaperToRecord(r.citedPaper, options.workspaceId))
          .filter(r => r.title !== '(no title)')
        records = [...records, ...refRecords]
        onProgress?.({ stage: 'references', paperId: paper.paperId })
      } catch {
        // Reference fetch failure is non-fatal — log and continue
      }
    }
  }

  return this.workerClient.send('commit-semantic-scholar-import', {
    workspaceId: options.workspaceId,
    records,
    searchProvenance: {
      query: options.query,
      exportedAt: new Date().toISOString(),
      database: 'semantic-scholar',
    },
    mode: 'upsert-identifiers',
  }, onProgress, signal)
}
```

**QA Gate 7:**
- Unit test: mock `SemanticScholarClient`, verify `searchPapers` is called with correct params.
- Unit test: `fetchReferences: true` → verify `getReferences` is called once per paper.
- Unit test: if `getReferences` throws, import still completes (non-fatal).
- Unit test: `AbortSignal` aborted mid-loop → reference fetching stops, existing records are still committed.

---

## 11. Phase 8 — Settings: API Key

**File: `src/settings.ts`** (modify existing)

Add an `apiKey` field to the settings schema and render a password input in the settings tab.

```typescript
// In PluginSettings interface — add:
semanticScholarApiKey?: string    // stored in Obsidian's data.json
```

**UI addition** (settings tab):

```
Semantic Scholar API Key
[password input]  [Test connection button]
```

- The field uses `input type="password"` so the key is masked.
- "Test connection" fires one search for `"test"` with limit=1; shows "✓ Connected" or the error message.
- The key is stored in Obsidian's `data.json` (vault-local, not synced by default). Add a note in the UI: "This key is stored locally in your vault's `.obsidian` folder. Do not store it in a shared or cloud-synced vault."

**QA Gate 8:** Manual test — enter a key, click "Test connection", confirm the correct header is sent (inspect via network tool or mock). Verify that an empty field results in unauthenticated mode (no header sent).

---

## 12. Phase 9 — UI: Semantic Scholar Search Modal

**File: `src/ui/semantic-scholar-modal.ts`** (new)

A new modal similar to `ImportModal` but for live search:

```
┌─────────────────────────────────────────────────────────────┐
│  Search Semantic Scholar                                     │
│                                                              │
│  Query _____________________________________________________ │
│  Results  [10 ▾]    Fetch references [ ]                    │
│                                                              │
│  [Search]                                [Cancel]           │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Preview (shown after search)                          │  │
│  │  • Paper title (year) — Author et al.                 │  │
│  │  • Paper title (year) — Author et al.                 │  │
│  │  ...                                                  │  │
│  │  Total: 1,234 results on Semantic Scholar             │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  [Import N papers into workspace]                            │
└─────────────────────────────────────────────────────────────┘
```

**Modal flow:**

1. User enters query and clicks **Search** → calls `client.searchPapers()` (preview only, no DB write).
2. Preview list shows titles, years, and first author.
3. User optionally checks "Fetch references" (warning: adds ~N × 1 HTTP calls).
4. User clicks **Import N papers** → calls `api.searchAndImportSemanticScholar()`.
5. Progress bar appears during import (especially relevant when fetching references).
6. On completion, modal shows summary: "Imported 42 new papers, 3 updated, 1 duplicate skipped."
7. Modal closes; the research view refreshes automatically.

**Edge cases to handle in UI:**

| Scenario | UX response |
|---|---|
| Empty query | Disable Search button |
| API key missing | Show info banner: "Running without API key — limited to 1 request/second" |
| Rate limited (429) | Show: "Rate limit reached. Please wait a moment and try again." |
| Network error | Show: "Could not reach Semantic Scholar. Check your internet connection." |
| Zero results | Show: "No results found. Try a different query." |
| `fetchReferences: true` with large result set | Show warning: "Fetching references for 100 papers will make up to 100 additional API calls." |

**Registration** (add to `src/main.ts`):

```typescript
this.addCommand({
  id: 'search-semantic-scholar',
  name: 'Search Semantic Scholar',
  callback: () => new SemanticScholarModal(this.app, this.api, this.settings).open()
})
```

Also add a button or menu item in `ResearchView` near the existing "Import Scopus CSV" entry point.

**QA Gate 9 (UI):**
- Manual: open modal, submit empty query → Search button stays disabled.
- Manual: submit a real query → preview renders with correct paper count.
- Manual: import 5 papers → navigate to explorer and confirm papers appear in the corpus.
- Manual: import same 5 papers again → summary shows 0 created, 5 unchanged.

---

## 13. Quality Assurance Master Checklist

### 13.1 Automated Tests

| Test file | What it covers | Must pass before |
|---|---|---|
| `tests/semantic-scholar-mapper.test.ts` | All field mapping cases from §7 | Phase 4 complete |
| `tests/semantic-scholar-rate-limiter.test.ts` | Timing invariants from §5 | Phase 2 complete |
| `tests/semantic-scholar-client.test.ts` | URL construction, header injection, error throwing | Phase 3 complete |
| `tests/semantic-scholar-import.test.ts` | ResearchApi end-to-end with mocked worker | Phase 7 complete |
| `tests/semantic-scholar-dedup.test.ts` | DOI dedup, title+year dedup, SS-to-Scopus merge | Phase 6 complete |

Run all existing tests plus new ones with:

```sh
npm run verify
```

**All tests must remain green throughout development.** Never ship a phase with failing tests.

### 13.2 Field Mapping Validation Matrix

Manually verify each field against a real Semantic Scholar API response before shipping:

| PublicationRecord field | SS source field | Risk | Validation step |
|---|---|---|---|
| `doi` | `externalIds.DOI` | DOI may have URL prefix | Unit test normalizeDoi |
| `title` | `title` | May be null | Fallback "(no title)" in test |
| `abstract` | `abstract` | Often null for older papers | Fallback "" in test |
| `year` | `year` | May be null | Fallback 0 in test |
| `authors` | `authors[].name` | May be null per author | Filter in test |
| `citationCount` | `citationCount` | May be null | Fallback 0 in test |
| `sourceTitle` | `journal.name ?? venue` | Both may be null | Fallback "" in test |
| `documentType` | `publicationTypes[0]` | May be empty array | Fallback "Unknown" in test |
| `indexKeywords` | `fieldsOfStudy` | May be null | Fallback [] in test |
| `semanticScholarId` | `paperId` | Always present | Assert truthy |
| `link` | `openAccessPdf.url` | May be null | Fallback to SS URL |
| `eid` | (none) | Must be undefined | Assert undefined |
| `scopusId` | (none) | Must be undefined | Assert undefined |

### 13.3 Rate Limiting Stress Test

Run a manual stress test before shipping:

1. Search for 100 results with `fetchReferences: true` (no API key).
2. Monitor the Obsidian console — no `429 Too Many Requests` responses should appear.
3. Total request count = 1 (search) + 100 (references) = 101 requests.
4. At 1 req/s, this should take ≥ 100 seconds. Verify this is clearly communicated in the progress bar.

### 13.4 Deduplication Contract (Critical)

These invariants must hold before shipping, tested by `tests/semantic-scholar-dedup.test.ts`:

| Scenario | Expected result |
|---|---|
| Import SS paper with same DOI as existing Scopus paper | `updated=1`, no duplicate row, Scopus `dataSource` preserved |
| Import SS paper with same title+year as existing, no DOI | `updated=1` (title+year match) |
| Import SS paper with unique DOI | `created=1` |
| Re-import same SS paper | `unchanged=1` |
| Import SS paper, then import updated citation count from SS | `updated=1`, new citationCount stored |

### 13.5 Security Review

| Risk | Mitigation |
|---|---|
| API key leaking in logs | Never log `apiKey`; `SemanticScholarClient` must not include key in error messages |
| API key in memory after unload | Set `apiKey` field to `undefined` in plugin `onunload()` |
| SSRF / URL injection | All URLs are constructed from constants + `encodeURIComponent()` — user query string is always encoded |
| Data from SS contains script tags in title/abstract | The existing `PublicationRecord` rendering in `ResearchView` must use `el.textContent` (not `el.innerHTML`) for user-controlled fields — verify this is already the case |

### 13.6 Regression Test: Existing Scopus CSV Path

After every phase, confirm the existing Scopus CSV import still works end-to-end:

```sh
# Run existing CSV-related tests
npx vitest tests/scopus.test.ts tests/identifiers.test.ts tests/csv-encoding.test.ts
```

Also run the existing CDP smoke test if available:

```sh
node scripts/cdp-smoke.mjs
```

---

## 14. Implementation Sequence

Do the phases in this order to keep the build green throughout:

```
P-0  Recover source + npm install + verify baseline tests pass
  │
  ▼
Phase 1  src/semantic-scholar/types.ts
  │
  ▼
Phase 2  src/semantic-scholar/rate-limiter.ts + unit tests
  │
  ▼
Phase 3  src/semantic-scholar/client.ts + unit tests
  │
  ▼
Phase 4  src/semantic-scholar/mapper.ts + unit tests
  │
  ▼
Phase 5  Extend src/types.ts (optional fields only)
  │
  ▼
Phase 6  Extend database/protocol.ts + worker handler + schema migration + dedup tests
  │
  ▼
Phase 7  Extend research-api.ts + integration tests
  │
  ▼
Phase 8  Extend settings.ts (API key storage + test button)
  │
  ▼
Phase 9  src/ui/semantic-scholar-modal.ts + register command in main.ts
  │
  ▼
Final    npm run verify (all tests green)
         Manual end-to-end: search → preview → import → explore in Obsidian
         npm run build → copy to vault → smoke test
```

---

## 15. Known Constraints and Risks

| Constraint | Impact | Mitigation |
|---|---|---|
| Source code must be recovered from git | Blocks all work | Do Step P-1 first, on a fresh branch |
| No Scopus-equivalent `authorKeywords` in SS API | Keyword-based ranking has fewer signals for SS papers | Use `fieldsOfStudy` as `indexKeywords`; document limitation |
| `affiliations` not in basic search fields | Author affiliation filter will show blank for SS papers | Leave empty; document that affiliations require separate call (out of scope for v1) |
| Reference count may hit rate limit with large searches | UX slowdown | Show estimated time in modal; cap `fetchReferences` at 50 papers by default |
| `requestUrl()` is Obsidian desktop only | Cannot test in JSDOM (vitest) environment | Mock `obsidian` module in tests (already done for existing tests) |
| Semantic Scholar `paper/search` only returns up to 100 per page | Cannot import >100 in one call | Cap UI at 100; add pagination in a future release |
| Citation count in SS vs. Scopus may differ significantly | Users may see conflicting counts if same paper imported from both | Show `dataSource` in detail view so user knows which count came from where |

---

## 16. Out of Scope (Future Releases)

- Pagination through all SS search results (>100 papers)
- Author affiliation enrichment via `/author/{id}` endpoint
- Scheduled background re-sync to update citation counts
- Semantic Scholar recommendation endpoint (`/recommendations/v1/papers/`)
- Automatic enrichment of existing Scopus corpus with SS metadata (e.g., add `semanticScholarId` to papers imported from CSV by DOI lookup)
- MCP bridge for agent-driven SS queries (planned in `AGENTIC_LITERATURE_REVIEW_PLAN_TH.md`)

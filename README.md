# Scopus Research Explorer

Desktop-only Obsidian plugin for exploring a closed research corpus imported from Scopus CSV.

## Implemented MVP

- Transactional Scopus CSV preflight/import
- Encoding auto-detection/override, source hashes, progress, and cancellation rollback
- DOI/EID/Scopus-ID deduplication and field provenance
- SQLite WASM schema v4 in a dedicated worker using `opfs-sahpool`
- Raw Scopus CSV archives and manifests under `.research-explorer/imports/<import-id>/`
- Integrity-checked portable backup/restore under `.research-explorer/database/`
- Workspace, collection, reading-state, search, and publication APIs
- Similar/Earlier/Later deterministic ranking
- References and Cited By in Corpus when references resolve
- Corpus search and capability-gated exploration modes
- Cytoscape force/timeline graph with similarity and citation edges
- Two-step CSV validation/import wizard with capability and import reports
- Idempotent Markdown publication notes with a user-owned notes region
- Persistent backup warnings and typed runtime/capability/import errors

## Installation

1. Download this repository.
2. Copy the `scopus-research-explorer` folder into your vault's `.obsidian/plugins/` directory.
3. Restart Obsidian.
4. Enable **Scopus Research Explorer** under **Settings → Community plugins**.

The repository contains the compiled plugin and runtime assets, so Node.js and a build step are not required.

## Important limitations

- Recommendations never leave the imported corpus.
- Scopus Citation Count is not a citation edge.
- Reference resolution is exact-only: DOI, EID, Scopus ID, or unique normalized title/year.
- Gemini, adaptive feedback, ResearchTrails, and external APIs are intentionally outside MVP.
- Windows x64 runtime is verified on Obsidian 1.12.7 / Electron 39.8.3, including migrations, restart restore, closed-workspace isolation, transaction rollback, cancellation, and import-to-note E2E.
- The vault's real 45-column Scopus export was validated: 20/20 rows imported, 0 validation errors, 6 resolved citation edges, and discovery returned results.
- The public 10k import path—including source re-hash, raw archive, commit, and portable backup—passes at 11.17s.
- The latest isolated 10k discovery run passes: search p95 119.3ms, ranking p95 1.565s, 300-node graph 1.525s, and plugin-attributable RSS delta 19MB.
- Memory reporting includes absolute renderer RSS before/after, while the `<500MB` gate uses incremental renderer+worker RSS because Obsidian and Chromium share the host renderer process.
- macOS/Linux OPFS runtime, additional Scopus export variants, and completed human relevance ratings still require release validation.

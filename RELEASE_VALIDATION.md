# Release validation

## Automated source/build matrix

GitHub Actions runs typecheck, unit tests, production build, parser fixtures, quality-evaluator self-test, and runtime dependency audit on Windows, macOS, and Linux.

## Obsidian/Electron runtime matrix

For each supported OS:

1. Install the plugin dependencies with `npm ci`.
2. Run `npm run verify`.
3. Launch Obsidian with Chromium remote debugging on port `9222` and open a disposable validation vault containing this plugin.
4. Run:

   ```bash
   npm run verify:obsidian
   ```

5. Record:

   - OS/version and architecture;
   - Obsidian and Electron versions;
   - `cdp-smoke-result.json`;
   - `cdp-contract-result.json`;
   - `cdp-restore-result.json`;
   - `cdp-performance-result.json`;
   - any console errors.

The runtime suite validates OPFS/`opfs-sahpool`, FTS5, migrations, transactional rollback, cancellation, closed-workspace citation isolation, backup restore, note preservation, and all 10k performance gates. It removes its temporary workspaces and note in a `finally` cleanup.

## Real Scopus export

```bash
npm run validate:real-export -- /absolute/path/to/scopus-export.csv
```

The command uses and deletes a temporary workspace. Keep `cdp-real-export-result.json` as evidence.

## Human recommendation quality

Generate a review package:

```bash
npm run quality:prepare -- /absolute/path/to/scopus-export.csv quality/review-round
```

Two independent evaluators assign integer relevance `0–3` in `judgments.json`. Add `adjudicatedRelevance` wherever ratings disagree, then run:

```bash
npm run quality:evaluate -- \
  quality/review-round/judgments.json \
  quality/review-round/candidate-results.json \
  quality/review-round/baseline-results.json
```

Release is blocked unless all reported gates are `true`.

# Recommendation quality dataset

Release evaluation requires:

- at least 20 seed sets;
- at least two named evaluators;
- graded relevance ratings for every judged publication;
- `adjudicatedRelevance` whenever evaluators disagree;
- candidate rankings and keyword-only baseline rankings keyed by `seedId`.

Run:

```bash
npm run quality:prepare -- path/to/scopus-export.csv path/to/quality-dataset
npm run quality:evaluate -- quality/judgments.json quality/candidate-results.json quality/baseline-results.json
```

`quality:prepare` creates 20 seed sets, candidate results, a keyword-only baseline, and a two-reviewer judgment template. It uses a temporary workspace and deletes it after generation.

The command fails unless mean nDCG@10 improves by at least 10%, mean Precision@10 is not below baseline, and every regression over 20% has a documented data-quality explanation.

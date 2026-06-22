import type { TextAnalysisProfile } from "../types";

export const TEXT_PROFILE: TextAnalysisProfile = {
  version: "mvp-text-v1",
  unicodeNormalization: "NFKC",
  caseFolding: "unicode-lowercase",
  segmentation: "Intl.Segmenter-word",
  stemming: "none",
  englishStopWords: "bundled-v1",
  titleBoost: 3,
  keywordBoost: 2,
  abstractBoost: 1,
  maxAbstractTermsPerSeed: 32,
  maxCandidatesPerSeed: 500
};

const ENGLISH_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
  "in", "is", "it", "of", "on", "or", "that", "the", "to", "was", "were",
  "will", "with", "this", "these", "those", "using", "use", "used", "study"
]);

export function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

export function tokenize(value: string): string[] {
  return tokenizeWithSegmenter(value, Intl.Segmenter);
}

export function tokenizeWithSegmenter(
  value: string,
  SegmenterCtor: typeof Intl.Segmenter | undefined
): string[] {
  const normalized = normalizeText(value);
  const tokens: string[] = [];
  if (SegmenterCtor) {
    const segmenter = new SegmenterCtor(undefined, { granularity: "word" });
    for (const part of segmenter.segment(normalized)) {
      if (part.isWordLike) tokens.push(part.segment);
    }
  } else {
    tokens.push(...(normalized.match(/[\p{L}\p{N}]+/gu) ?? []));
  }
  return tokens.filter((token) => token.length > 1 && !ENGLISH_STOP_WORDS.has(token));
}

export function normalizeKeyword(value: string): string {
  return tokenize(value).join(" ");
}

export function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left.map(normalizeKeyword).filter(Boolean));
  const b = new Set(right.map(normalizeKeyword).filter(Boolean));
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) return undefined;
  if (sorted.length % 2 === 1) return value;
  return ((sorted[middle - 1] ?? value) + value) / 2;
}

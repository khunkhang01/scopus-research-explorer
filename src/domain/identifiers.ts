import { normalizeText } from "./text-analysis";

export function normalizeDoi(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "")
    .replace(/[\s.,;:)\]}]+$/g, "");
  return normalized || undefined;
}

export function normalizeEid(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function normalizeScopusId(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/(?:SCOPUS_ID:|record\/display\.uri\?eid=)?([^&\s]+)/i);
  return match?.[1]?.trim() || undefined;
}

export function normalizeTitle(value: string): string {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleYearKey(title: string, year?: number): string | undefined {
  if (!year) return undefined;
  const normalized = normalizeTitle(title);
  return normalized ? `${normalized}::${year}` : undefined;
}

import Papa from "papaparse";
import { normalizeDoi, normalizeEid, normalizeScopusId } from "./identifiers";

export interface CanonicalScopusRow {
  rowNumber: number;
  eid?: string;
  doi?: string;
  scopusId?: string;
  title: string;
  abstract?: string;
  year?: number;
  authors: string[];
  authorIds: string[];
  affiliations: string[];
  authorKeywords: string[];
  indexKeywords: string[];
  sourceTitle?: string;
  documentType?: string;
  citationCount?: number;
  referencesText?: string;
  sourceFields: Record<string, string>;
  fieldSources: Record<string, string>;
}

const ALIASES: Record<string, string[]> = {
  eid: ["EID"],
  doi: ["DOI"],
  title: ["Title", "Document title"],
  abstract: ["Abstract"],
  year: ["Year"],
  authors: ["Authors"],
  authorIds: ["Author(s) ID", "Authors ID"],
  affiliations: ["Affiliations"],
  authorKeywords: ["Author Keywords", "Author keywords"],
  indexKeywords: ["Index Keywords", "Indexed keywords"],
  sourceTitle: ["Source title", "Source Title"],
  documentType: ["Document Type", "Document type"],
  citationCount: ["Cited by", "Cited By"],
  referencesText: ["References"],
  scopusId: ["Scopus ID", "Scopus Id"],
  link: ["Link"]
};

function pick(row: Record<string, string>, key: string): string | undefined {
  for (const alias of ALIASES[key] ?? []) {
    const value = row[alias]?.trim();
    if (value) return value;
  }
  return undefined;
}

function sourceColumn(row: Record<string, string>, key: string): string | undefined {
  return (ALIASES[key] ?? []).find((alias) => Boolean(row[alias]?.trim()));
}

function splitList(value?: string): string[] {
  if (!value) return [];
  return value.split(";").map((item) => item.trim()).filter(Boolean);
}

export interface ParsedCsv {
  headers: string[];
  rows: CanonicalScopusRow[];
  errors: string[];
}

export function parseScopusCsv(content: string): ParsedCsv {
  const parsed = Papa.parse<Record<string, string>>(content.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim()
  });
  const headers = parsed.meta.fields ?? [];
  const rows: CanonicalScopusRow[] = [];
  const errors = parsed.errors.map((error) => `Row ${error.row ?? "?"}: ${error.message}`);
  parsed.data.forEach((row, index) => {
    const title = pick(row, "title");
    if (!title) {
      errors.push(`Row ${index + 2}: missing Title`);
      return;
    }
    const yearRaw = pick(row, "year");
    const citationsRaw = pick(row, "citationCount");
    const sourceFields = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value ?? ""])
    );
    const fieldSources = Object.fromEntries(
      Object.keys(ALIASES)
        .map((key) => [key, sourceColumn(row, key)] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    );
    rows.push({
      rowNumber: index + 2,
      eid: normalizeEid(pick(row, "eid")),
      doi: normalizeDoi(pick(row, "doi")),
      scopusId: normalizeScopusId(pick(row, "scopusId") ?? pick(row, "link")),
      title,
      abstract: pick(row, "abstract"),
      year: yearRaw && Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : undefined,
      authors: splitList(pick(row, "authors")),
      authorIds: splitList(pick(row, "authorIds")),
      affiliations: splitList(pick(row, "affiliations")),
      authorKeywords: splitList(pick(row, "authorKeywords")),
      indexKeywords: splitList(pick(row, "indexKeywords")),
      sourceTitle: pick(row, "sourceTitle"),
      documentType: pick(row, "documentType"),
      citationCount: citationsRaw && Number.isFinite(Number(citationsRaw))
        ? Number(citationsRaw)
        : undefined,
      referencesText: pick(row, "referencesText"),
      sourceFields,
      fieldSources
    });
  });
  return { headers, rows, errors };
}

export function splitReferences(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/\s*;\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((reference) => reference.trim())
    .filter(Boolean);
}

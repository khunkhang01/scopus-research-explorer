import type { App, TFile } from "obsidian";
import type { PublicationRecord } from "../types";

const START = "<!-- research-explorer:managed:start -->";
const END = "<!-- research-explorer:managed:end -->";

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function managedContent(publication: PublicationRecord): string {
  const keywords = [...publication.authorKeywords, ...publication.indexKeywords];
  return [
    START,
    `# ${publication.title}`,
    "",
    publication.abstract ? `## Abstract\n\n${publication.abstract}` : "",
    keywords.length ? `## Keywords\n\n${keywords.map((keyword) => `- ${keyword}`).join("\n")}` : "",
    "## Corpus metrics",
    "",
    `- Scopus Citation Count: ${publication.citationCount ?? "N/A"}`,
    `- References in Corpus: ${publication.referencesInCorpus}`,
    `- Cited By in Corpus: ${publication.citedByInCorpus}`,
    END
  ].filter(Boolean).join("\n\n");
}

function frontmatter(publication: PublicationRecord): string {
  return [
    "---",
    "type: publication",
    `research_explorer_publication_id: ${yamlString(publication.publicationId)}`,
    `research_explorer_title: ${yamlString(publication.title)}`,
    publication.eid ? `research_explorer_eid: ${yamlString(publication.eid)}` : "",
    publication.doi ? `research_explorer_doi: ${yamlString(publication.doi)}` : "",
    publication.year ? `research_explorer_year: ${publication.year}` : "",
    `research_explorer_scopus_citation_count: ${publication.citationCount ?? 0}`,
    `research_explorer_references_in_corpus: ${publication.referencesInCorpus}`,
    `research_explorer_cited_by_in_corpus: ${publication.citedByInCorpus}`,
    "research_explorer_managed: true",
    "---"
  ].filter(Boolean).join("\n");
}

function managedFrontmatterValues(publication: PublicationRecord): Record<string, string | number | boolean> {
  return {
    type: "publication",
    research_explorer_publication_id: publication.publicationId,
    research_explorer_title: publication.title,
    ...(publication.eid ? { research_explorer_eid: publication.eid } : {}),
    ...(publication.doi ? { research_explorer_doi: publication.doi } : {}),
    ...(publication.year ? { research_explorer_year: publication.year } : {}),
    research_explorer_scopus_citation_count: publication.citationCount ?? 0,
    research_explorer_references_in_corpus: publication.referencesInCorpus,
    research_explorer_cited_by_in_corpus: publication.citedByInCorpus,
    research_explorer_managed: true
  };
}

export class NoteMaterializer {
  constructor(private readonly app: App, private readonly folder: string) {}

  async materialize(publication: PublicationRecord): Promise<string> {
    await this.ensureFolder(this.folder);
    const notePath = `${this.folder}/${publication.publicationId}.md`;
    const existing = this.app.vault.getAbstractFileByPath(notePath) as TFile | null;
    const managed = managedContent(publication);
    if (!existing) {
      await this.app.vault.create(
        notePath,
        `${frontmatter(publication)}\n\n${managed}\n\n## My Notes\n\n`
      );
      return notePath;
    }
    const current = await this.app.vault.read(existing);
    const start = current.indexOf(START);
    const end = current.indexOf(END);
    const body = start >= 0 && end >= start
      ? `${current.slice(0, start)}${managed}${current.slice(end + END.length)}`
      : `${current.trimEnd()}\n\n${managed}\n`;
    await this.app.vault.modify(existing, body);
    await this.app.fileManager.processFrontMatter(existing, (values) => {
      const managedValues = managedFrontmatterValues(publication);
      for (const [key, value] of Object.entries(managedValues)) {
        values[key] = value;
      }
      for (const key of [
        "research_explorer_eid",
        "research_explorer_doi",
        "research_explorer_year"
      ]) {
        if (!(key in managedValues)) delete values[key];
      }
    });
    return notePath;
  }

  private async ensureFolder(folder: string): Promise<void> {
    const parts = folder.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }
}

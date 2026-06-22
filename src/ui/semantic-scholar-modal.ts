import { App, Modal, Notice, Setting } from "obsidian";
import type { ResearchExplorerMvpApi } from "../services/research-api";
import type { PluginSettings } from "../types";
import { SemanticScholarClient, SemanticScholarApiError } from "../semantic-scholar/client";
import type { SsPaper } from "../semantic-scholar/types";

export class SemanticScholarModal extends Modal {
  private query = "";
  private limit = 20;
  private fetchReferences = false;

  private previewPapers: SsPaper[] = [];
  private totalOnServer = 0;

  private previewListEl: HTMLElement | null = null;
  private importBtnEl: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private abortController: AbortController | null = null;

  constructor(
    app: App,
    private readonly api: ResearchExplorerMvpApi,
    private readonly settings: PluginSettings,
    private readonly workspaceId: string,
    private readonly onImported?: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Search Semantic Scholar");
    const { contentEl } = this;
    contentEl.empty();

    if (!this.settings.semanticScholarApiKey) {
      contentEl.createEl("p", {
        text: "No API key configured — limited to 1 request/second. Add a key in Settings → Scopus Research Explorer.",
        cls: "research-explorer-info-banner",
      });
    }

    // Query input
    new Setting(contentEl)
      .setName("Query")
      .addText((text) => {
        text.setPlaceholder("e.g. machine learning healthcare")
          .setValue(this.query)
          .onChange((value) => {
            this.query = value;
            this.updateSearchButton();
          });
        text.inputEl.style.width = "100%";
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && this.query.trim()) void this.doSearch();
        });
        return text;
      });

    // Results limit
    new Setting(contentEl)
      .setName("Max results")
      .setDesc("Number of papers to import (1–100).")
      .addSlider((slider) => slider
        .setLimits(1, 100, 1)
        .setValue(this.limit)
        .setDynamicTooltip()
        .onChange((value) => { this.limit = value; }));

    // Fetch references toggle
    new Setting(contentEl)
      .setName("Fetch references")
      .setDesc("Also import papers cited by search results. Adds one API call per result paper.")
      .addToggle((toggle) => toggle
        .setValue(this.fetchReferences)
        .onChange((value) => {
          this.fetchReferences = value;
          this.updateReferenceWarning();
        }));

    // Reference count warning (shown when toggle is on)
    this.progressEl = contentEl.createEl("p", {
      cls: "research-explorer-info-banner",
      text: "",
    });
    this.progressEl.style.display = "none";

    // Search / Cancel buttons
    const buttonRow = contentEl.createDiv({ cls: "research-explorer-modal-buttons" });
    buttonRow.style.display = "flex";
    buttonRow.style.gap = "8px";
    buttonRow.style.marginTop = "8px";

    const searchBtn = buttonRow.createEl("button", { text: "Search", cls: "mod-cta" });
    searchBtn.disabled = true;
    searchBtn.addEventListener("click", () => void this.doSearch());

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.abortController?.abort();
      this.close();
    });

    // Status line
    this.statusEl = contentEl.createEl("p", { cls: "research-explorer-modal-status", text: "" });

    // Preview list
    this.previewListEl = contentEl.createEl("ul", { cls: "research-explorer-ss-preview" });
    this.previewListEl.style.maxHeight = "240px";
    this.previewListEl.style.overflowY = "auto";
    this.previewListEl.style.paddingLeft = "16px";

    // Import button
    this.importBtnEl = contentEl.createEl("button", { text: "Import into workspace", cls: "mod-cta" });
    this.importBtnEl.style.display = "none";
    this.importBtnEl.addEventListener("click", () => void this.doImport());

    // Wire up: enable search button only when query non-empty
    this.updateSearchButton = () => {
      searchBtn.disabled = !this.query.trim();
    };
    this.updateSearchButton();
  }

  private updateSearchButton: () => void = () => {};

  private updateReferenceWarning(): void {
    if (!this.progressEl) return;
    if (this.fetchReferences && this.limit > 10) {
      this.progressEl.style.display = "";
      this.progressEl.setText(
        `Fetching references will make up to ${this.limit} additional API calls (one per result paper).`
      );
    } else {
      this.progressEl.style.display = "none";
    }
  }

  private setStatus(text: string, color?: string): void {
    if (!this.statusEl) return;
    this.statusEl.setText(text);
    this.statusEl.style.color = color ?? "";
  }

  private async doSearch(): Promise<void> {
    if (!this.query.trim()) return;
    this.setStatus("Searching…");
    if (this.previewListEl) this.previewListEl.empty();
    if (this.importBtnEl) this.importBtnEl.style.display = "none";

    try {
      const client = new SemanticScholarClient(this.settings.semanticScholarApiKey || undefined);
      const response = await client.searchPapers(this.query.trim(), this.limit);
      this.previewPapers = response.data;
      this.totalOnServer = response.total;
      this.renderPreview();
      this.setStatus(`Showing ${response.data.length} of ${response.total.toLocaleString()} results on Semantic Scholar.`);
    } catch (err) {
      const msg = err instanceof SemanticScholarApiError
        ? `API error ${err.statusCode} — ${err.message}`
        : (err instanceof Error ? err.message : String(err));
      this.setStatus(msg, "var(--color-red)");
    }
  }

  private renderPreview(): void {
    if (!this.previewListEl || !this.importBtnEl) return;
    this.previewListEl.empty();

    if (this.previewPapers.length === 0) {
      this.previewListEl.createEl("li", { text: "No results found. Try a different query." });
      return;
    }

    for (const paper of this.previewPapers) {
      const li = this.previewListEl.createEl("li");
      li.style.marginBottom = "4px";
      const firstAuthor = paper.authors?.[0]?.name ?? "Unknown";
      const authorSuffix = (paper.authors?.length ?? 0) > 1 ? " et al." : "";
      li.createEl("strong").textContent = paper.title ?? "(no title)";
      li.createSpan({ text: ` (${paper.year ?? "n.d."}) — ${firstAuthor}${authorSuffix}` });
    }

    this.importBtnEl.textContent = `Import ${this.previewPapers.length} paper${this.previewPapers.length !== 1 ? "s" : ""} into workspace`;
    this.importBtnEl.style.display = "";
    this.importBtnEl.style.marginTop = "8px";
  }

  private async doImport(): Promise<void> {
    if (!this.importBtnEl) return;
    this.importBtnEl.disabled = true;
    this.abortController = new AbortController();
    this.setStatus("Importing…");

    let progressCount = 0;
    const onProgress = (event: { stage: string; count?: number; total?: number; paperId?: string }) => {
      progressCount++;
      if (event.stage === "fetched") {
        this.setStatus(`Fetched ${event.count ?? 0} papers from Semantic Scholar…`);
      } else if (event.stage === "references") {
        this.setStatus(`Fetching references… (${progressCount} papers processed)`);
      }
    };

    try {
      const result = await this.api.searchAndImportSemanticScholar(
        {
          workspaceId: this.workspaceId,
          query: this.query.trim(),
          limit: this.limit,
          fetchReferences: this.fetchReferences,
          apiKey: this.settings.semanticScholarApiKey || undefined,
        },
        onProgress,
        this.abortController.signal
      );

      const summary = [
        result.created > 0 && `${result.created} new`,
        result.updated > 0 && `${result.updated} updated`,
        result.unchanged > 0 && `${result.unchanged} unchanged`,
        result.rejected > 0 && `${result.rejected} skipped`,
      ].filter(Boolean).join(", ");

      this.setStatus(`Done — ${summary}.`, "var(--color-green)");
      new Notice(`Semantic Scholar import complete: ${summary}.`);
      this.onImported?.();

      if (this.importBtnEl) this.importBtnEl.style.display = "none";
    } catch (err) {
      if (err instanceof Error && err.message.includes("cancelled")) {
        this.setStatus("Import cancelled.");
      } else {
        const msg = err instanceof SemanticScholarApiError
          ? `API error ${err.statusCode}`
          : (err instanceof Error ? err.message : String(err));
        this.setStatus(`Import failed: ${msg}`, "var(--color-red)");
        if (this.importBtnEl) this.importBtnEl.disabled = false;
      }
    }
  }

  onClose(): void {
    this.abortController?.abort();
    this.contentEl.empty();
  }
}

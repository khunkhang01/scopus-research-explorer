import { ButtonComponent, Modal, Notice, Setting } from "obsidian";
import type {
  ImportReport,
  PreflightCapabilityReport,
  ScopusSearchProvenance,
  Workspace
} from "../types";
import type { ResearchApi } from "../services/research-api";

export class ImportModal extends Modal {
  private selectedFiles: File[] = [];
  private query = "";
  private exportedAt = new Date().toISOString().slice(0, 10);
  private encoding: "auto" | "utf-8" | "windows-1252" | "utf-16le" = "auto";
  private preflight?: PreflightCapabilityReport;
  private statusEl?: HTMLElement;
  private importButton?: ButtonComponent;
  private operation?: AbortController;

  constructor(
    app: ConstructorParameters<typeof Modal>[0],
    private readonly api: ResearchApi,
    private readonly workspace: Workspace,
    private readonly onImported: () => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Import Scopus CSV");
    new Setting(this.contentEl)
      .setName("CSV files")
      .setDesc("Choose one or more Scopus CSV exports.")
      .addButton((button) => button.setButtonText("Choose files").onClick(() => this.chooseFiles()));
    new Setting(this.contentEl)
      .setName("CSV encoding")
      .setDesc("Auto detects UTF-8/UTF-16 BOM and falls back to Windows-1252 when UTF-8 is invalid.")
      .addDropdown((dropdown) => dropdown
        .addOptions({
          auto: "Auto detect",
          "utf-8": "UTF-8",
          "windows-1252": "Windows-1252",
          "utf-16le": "UTF-16 LE"
        })
        .setValue(this.encoding)
        .onChange((value) => {
          this.encoding = value as typeof this.encoding;
          this.preflight = undefined;
          this.importButton?.setDisabled(true);
        }));
    new Setting(this.contentEl)
      .setName("Scopus search query")
      .addTextArea((text) => text.onChange((value) => { this.query = value; }));
    new Setting(this.contentEl)
      .setName("Export date")
      .addText((text) => {
        text.setValue(this.exportedAt);
        text.inputEl.type = "date";
        text.onChange((value) => { this.exportedAt = value; });
      });
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("1. Validate")
        .onClick(() => this.validate()))
      .addButton((button) => {
        button.setCta()
          .setButtonText("2. Import")
          .setDisabled(true)
          .onClick(() => this.commitImport());
        this.importButton = button;
      })
      .addButton((button) => button
        .setButtonText("Cancel operation")
        .onClick(() => this.operation?.abort()));
    this.statusEl = this.contentEl.createDiv("research-explorer-import-report");
    this.statusEl.createEl("p", { text: "Choose CSV files, then validate before importing." });
  }

  onClose(): void {
    this.operation?.abort();
  }

  private chooseFiles(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);
    const cleanup = () => {
      if (document.body.contains(input)) document.body.removeChild(input);
    };
    input.addEventListener("change", () => {
      // Snapshot FileList BEFORE removing input from DOM — Chromium clears it on detach.
      const snapshot = [...(input.files ?? [])];
      cleanup();
      this.selectedFiles = snapshot;
      this.preflight = undefined;
      this.importButton?.setDisabled(true);
      if (this.selectedFiles.length) {
        this.renderMessage(`${this.selectedFiles.length} CSV file(s) selected. Validate to continue.`);
      }
    });
    input.addEventListener("cancel", cleanup);
    input.click();
  }

  private async validate(): Promise<void> {
    if (!this.selectedFiles.length) {
      new Notice("Choose at least one CSV file.");
      return;
    }
    try {
      this.operation?.abort();
      this.operation = new AbortController();
      this.renderMessage("Validating source files…");
      this.preflight = await this.api.getPreflightCapabilitiesFromFiles(this.selectedFiles, {
        encoding: this.encoding,
        signal: this.operation.signal,
        onProgress: ({ completed, total }) => {
          this.renderMessage(`Validating source files… ${completed}/${total}`);
        }
      });
      if (!this.preflight.rowCount) throw new Error("No valid publication rows found.");
      this.importButton?.setDisabled(false);
      this.renderPreflight(this.preflight);
    } catch (error) {
      this.preflight = undefined;
      this.importButton?.setDisabled(true);
      this.renderError(error);
    } finally {
      this.operation = undefined;
    }
  }

  private async commitImport(): Promise<void> {
    if (!this.preflight) {
      new Notice("Validate the selected files first.");
      return;
    }
    try {
      this.operation?.abort();
      this.operation = new AbortController();
      this.importButton?.setDisabled(true);
      this.renderMessage("Importing transactionally and creating portable backup…");
      const provenance: ScopusSearchProvenance = {
        query: this.query || undefined,
        exportedAt: new Date(this.exportedAt).toISOString(),
        database: "Scopus"
      };
      const report = await this.api.importScopusCsv(this.preflight.preflightId, {
        workspaceId: this.workspace.workspaceId,
        mode: "upsert-identifiers",
        searchProvenance: provenance
      }, {
        signal: this.operation.signal,
        onProgress: ({ phase, completed, total }) => {
          this.renderMessage(`${phase}: ${completed}/${total}`);
        }
      });
      this.renderImportReport(report);
      await this.onImported();
    } catch (error) {
      console.error("Scopus Research Explorer — import failed:", error);
      new Notice(`Import failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
      this.renderError(error);
      this.importButton?.setDisabled(false);
    } finally {
      this.operation = undefined;
    }
  }

  private renderPreflight(report: PreflightCapabilityReport): void {
    const root = this.resetStatus("Preflight report");
    root.createEl("p", {
      text: `${report.rowCount} rows · ${report.duplicateRows} duplicates · ` +
        `${report.conflictingRows} conflicts · ${report.probableDuplicateRows} probable duplicates · ` +
        `${report.invalidRows} invalid`
    });
    root.createEl("p", {
      text: `Abstracts ${report.recordsWithAbstract} · References ${report.recordsWithReferences} · Author IDs ${report.recordsWithAuthorIds}`
    });
    const features = root.createEl("ul");
    for (const feature of report.potentialFeatures) {
      features.createEl("li", { text: `${feature.feature}: ${feature.status} — ${feature.reason}` });
    }
    for (const warning of report.warnings) root.createEl("p", { cls: "research-explorer-error", text: warning });
  }

  private renderImportReport(report: ImportReport): void {
    const root = this.resetStatus("Import report");
    root.createEl("p", {
      text: `Created ${report.created} · Updated ${report.updated} · Unchanged ${report.unchanged} · Rejected ${report.rejected}`
    });
    root.createEl("p", {
      text: `${report.resolvedReferenceEdges} resolved citation edges · Corpus ${report.capabilities.publicationCount} publications`
    });
    if (report.rawArchivePath) {
      root.createEl("p", { text: `Raw CSV archive: ${report.rawArchivePath}` });
    }
    root.createEl("p", {
      text: report.capabilities.supportsCitationGraph
        ? "Citation graph features are available."
        : "Citation graph features are unavailable for this corpus."
    });
    if (report.backupWarning) {
      root.createEl("p", {
        cls: "research-explorer-error",
        text: `Import committed, but portable backup failed: ${report.backupWarning}`
      });
    }
    if (report.rawArchiveWarning) {
      root.createEl("p", {
        cls: "research-explorer-error",
        text: `Import committed, but raw source archive failed: ${report.rawArchiveWarning}`
      });
    }
    new Setting(root).addButton((button) => button.setButtonText("Done").onClick(() => this.close()));
  }

  private renderMessage(message: string): void {
    const root = this.resetStatus();
    root.createEl("p", { text: message });
  }

  private renderError(error: unknown): void {
    const root = this.resetStatus("Import error");
    root.createEl("p", {
      cls: "research-explorer-error",
      text: error instanceof Error ? error.message : String(error)
    });
  }

  private resetStatus(title?: string): HTMLElement {
    const root = this.statusEl ?? this.contentEl;
    root.empty();
    if (title) root.createEl("h3", { text: title });
    return root;
  }
}

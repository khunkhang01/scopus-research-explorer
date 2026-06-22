import path from "node:path";
import { FileSystemAdapter, Notice, Plugin, WorkspaceLeaf, requestUrl } from "obsidian";
import { ResearchApi, type ResearchExplorerMvpApi } from "./services/research-api";
import { NoteMaterializer } from "./services/note-materializer";
import { DEFAULT_SETTINGS, type PluginSettings } from "./types";
import { ImportModal } from "./ui/import-modal";
import { RESEARCH_VIEW_TYPE, ResearchView, TextInputModal } from "./ui/research-view";
import { SemanticScholarModal } from "./ui/semantic-scholar-modal";
import { ResearchExplorerSettingTab } from "./settings";

export default class ScopusResearchExplorerPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  api?: ResearchExplorerMvpApi;
  private researchApi?: ResearchApi;
  private notes?: NoteMaterializer;
  private backupStatusEl?: HTMLElement;

  async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData() as Partial<PluginSettings> | null ?? {}) };
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("Scopus Research Explorer is desktop-only.");
      return;
    }
    const pluginDirectory = path.join(
      adapter.getBasePath(),
      this.app.vault.configDir,
      "plugins",
      this.manifest.id
    );
    this.backupStatusEl = this.addStatusBarItem();
    this.notes = new NoteMaterializer(this.app, this.settings.notesFolder);
    this.researchApi = new ResearchApi(
      this.app,
      pluginDirectory,
      this.settings,
      async (warning) => {
        this.settings.backupWarning = warning;
        await this.saveSettings();
        this.renderBackupStatus();
      },
      requestUrl
    );

    // Register view before initializing so that workspace-restored tabs can display
    // a meaningful error instead of a blank pane if initialization fails.
    this.registerView(
      RESEARCH_VIEW_TYPE,
      (leaf) => new ResearchView(leaf, this.researchApi!, this.notes!, this.settings)
    );
    this.addRibbonIcon("network", "Open Scopus Research Explorer", () => this.activateView());
    this.addCommand({
      id: "open-research-explorer",
      name: "Open research explorer",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "create-research-workspace",
      name: "Create research workspace",
      callback: () => new TextInputModal(this.app, "New workspace", "My research", async (name) => {
        await this.researchApi!.createWorkspace({ name });
        await this.activateView();
      }).open()
    });
    this.addCommand({
      id: "import-scopus-csv",
      name: "Import Scopus CSV",
      callback: async () => {
        const workspaces = await this.researchApi!.listWorkspaces();
        const workspace = workspaces[0] ?? await this.researchApi!.createWorkspace({ name: "My research" });
        new ImportModal(this.app, this.researchApi!, workspace, async () => {
          await this.activateView();
          const leaf = this.app.workspace.getLeavesOfType(RESEARCH_VIEW_TYPE)[0];
          if (leaf?.view instanceof ResearchView) await leaf.view.refresh();
        }).open();
      }
    });
    this.addCommand({
      id: "search-semantic-scholar",
      name: "Search Semantic Scholar",
      callback: async () => {
        const workspaces = await this.researchApi!.listWorkspaces();
        const workspace = workspaces[0] ?? await this.researchApi!.createWorkspace({ name: "My research" });
        new SemanticScholarModal(
          this.app,
          this.researchApi!,
          this.settings,
          workspace.workspaceId,
          async () => {
            await this.activateView();
            const leaf = this.app.workspace.getLeavesOfType(RESEARCH_VIEW_TYPE)[0];
            if (leaf?.view instanceof ResearchView) await leaf.view.refresh();
          }
        ).open();
      }
    });
    this.addCommand({
      id: "run-runtime-diagnostics",
      name: "Run database runtime diagnostics",
      callback: async () => {
        try {
          const runtime = this.researchApi!.getRuntimeCapabilities();
          const workspaces = await this.researchApi!.listWorkspaces();
          const message = `SQLite worker ready (${runtime.runtimeName}, schema ${runtime.schemaVersion}). ` +
            (workspaces.length
              ? `${workspaces.length} workspace(s) available.`
              : "Create a workspace to begin.");
          new Notice(message, 8000);
        } catch (error) {
          new Notice(`Runtime diagnostic failed: ${error instanceof Error ? error.message : String(error)}`, 12000);
        }
      }
    });
    this.addSettingTab(new ResearchExplorerSettingTab(this.app, this));

    try {
      await this.researchApi.initialize();
    } catch (error) {
      console.error("Scopus Research Explorer database initialization failed", error);
      new Notice(`Research database unavailable: ${error instanceof Error ? error.message : String(error)}`, 15000);
      // Refresh any already-open view so it can render the error state.
      for (const leaf of this.app.workspace.getLeavesOfType(RESEARCH_VIEW_TYPE)) {
        if (leaf.view instanceof ResearchView) await leaf.view.refresh();
      }
      return;
    }
    this.api = this.researchApi;
    this.renderBackupStatus();
    if (this.settings.backupWarning) {
      new Notice(`Research Explorer backup warning: ${this.settings.backupWarning}`, 15000);
    }
    // Refresh any view that opened before initialization completed.
    for (const leaf of this.app.workspace.getLeavesOfType(RESEARCH_VIEW_TYPE)) {
      if (leaf.view instanceof ResearchView) await leaf.view.refresh();
    }
  }

  async onunload(): Promise<void> {
    this.settings.semanticScholarApiKey = undefined;
    await this.researchApi?.dispose();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private renderBackupStatus(): void {
    if (!this.backupStatusEl) return;
    if (this.settings.backupWarning) {
      this.backupStatusEl.setText("Research Explorer: backup needs attention");
      this.backupStatusEl.setAttribute("aria-label", this.settings.backupWarning);
      this.backupStatusEl.addClass("research-explorer-error");
    } else {
      this.backupStatusEl.setText("");
      this.backupStatusEl.removeClass("research-explorer-error");
      this.backupStatusEl.removeAttribute("aria-label");
    }
  }

  private async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(RESEARCH_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: RESEARCH_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf as WorkspaceLeaf);
  }
}

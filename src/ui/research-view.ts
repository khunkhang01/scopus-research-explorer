import cytoscape, { type Core } from "cytoscape";
import { App, ItemView, Modal, Notice, Setting, WorkspaceLeaf } from "obsidian";
import type { ResearchApi } from "../services/research-api";
import type { NoteMaterializer } from "../services/note-materializer";
import type {
  CorpusCapabilityReport,
  ExplorationResult,
  MvpExplorationMode,
  PluginSettings,
  PublicationRecord,
  ResearchCollection,
  Workspace
} from "../types";
import { ImportModal } from "./import-modal";

export class TextInputModal extends Modal {
  private readonly label: string;
  private readonly defaultValue: string;
  private readonly onSubmit: (value: string) => void;

  constructor(app: App, label: string, defaultValue: string, onSubmit: (value: string) => void) {
    super(app);
    this.label = label;
    this.defaultValue = defaultValue;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.titleEl.setText(this.label);
    const input = this.contentEl.createEl("input", { type: "text" });
    input.value = this.defaultValue;
    input.style.cssText = "width:100%;box-sizing:border-box;margin-bottom:12px;";
    const submit = () => {
      const value = input.value.trim();
      if (!value) return;
      this.close();
      this.onSubmit(value);
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    new Setting(this.contentEl)
      .addButton((btn) => btn.setCta().setButtonText("Create").onClick(submit))
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
    setTimeout(() => { input.focus(); input.select(); }, 50);
  }

  onClose(): void { this.contentEl.empty(); }
}

class CreateCollectionModal extends Modal {
  private readonly onSubmit: (name: string, color?: string, labels?: string[]) => void;

  constructor(app: App, onSubmit: (name: string, color?: string, labels?: string[]) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.titleEl.setText("New collection");
    let name = "";
    let color = "#7c6fef";
    let labelsStr = "";

    // Name
    let nameInput: HTMLInputElement;
    new Setting(this.contentEl).setName("Name *").addText((t) => {
      t.setPlaceholder("e.g. Review papers 2024").onChange((v) => {
        name = v;
        errorEl.style.display = "none";
      });
      nameInput = t.inputEl;
    });

    // Color — native color picker
    const colorSetting = new Setting(this.contentEl)
      .setName("Color")
      .setDesc("Shown as a colored stripe on the collection");
    const colorInput = colorSetting.controlEl.createEl("input");
    colorInput.type = "color";
    colorInput.value = color;
    colorInput.style.cssText = "width:48px;height:30px;padding:2px;border-radius:4px;cursor:pointer;border:1px solid var(--background-modifier-border);";
    colorInput.addEventListener("input", () => { color = colorInput.value; });

    // Labels
    new Setting(this.contentEl)
      .setName("Tags")
      .setDesc("Optional — comma-separated (e.g. review, 2024)")
      .addText((t) => {
        t.setPlaceholder("review, 2024, …").onChange((v) => { labelsStr = v; });
      });

    // Error text
    const errorEl = this.contentEl.createDiv();
    errorEl.style.cssText = "color:var(--text-error);font-size:var(--font-ui-smaller);margin:4px 0 8px;display:none;";
    errorEl.setText("Please enter a collection name.");

    const submit = () => {
      if (!name.trim()) {
        errorEl.style.display = "block";
        nameInput?.focus();
        return;
      }
      const labels = labelsStr.split(",").map((l) => l.trim()).filter(Boolean);
      this.close();
      this.onSubmit(name.trim(), color, labels.length ? labels : undefined);
    };

    new Setting(this.contentEl)
      .addButton((btn) => btn.setCta().setButtonText("Create").onClick(submit))
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));

    setTimeout(() => nameInput?.focus(), 50);

    // Enter key submits
    this.contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

export const RESEARCH_VIEW_TYPE = "scopus-research-explorer-view";

export class ResearchView extends ItemView {
  private workspaces: Workspace[] = [];
  private collections: ResearchCollection[] = [];
  private publications: PublicationRecord[] = [];
  private selectedWorkspace?: Workspace;
  private selectedPublication?: PublicationRecord;
  private seedIds = new Set<string>();
  private exploration?: ExplorationResult;
  private capabilities?: CorpusCapabilityReport;
  private searchText = "";
  private selectedMode: MvpExplorationMode = "similar";
  private graphLayout: "force" | "scatter" = "scatter";
  private yearFrom?: number;
  private yearTo?: number;
  private hasAbstract: "any" | "yes" | "no" = "any";
  private filterCollectionId?: string;
  private graph?: Core;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly api: ResearchApi,
    private readonly notes: NoteMaterializer,
    private readonly settings: PluginSettings
  ) {
    super(leaf);
  }

  getViewType(): string {
    return RESEARCH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Scopus Research Explorer";
  }

  getIcon(): string {
    return "network";
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  private renderError(message: string): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("research-explorer-view");
    const box = root.createDiv("research-explorer-error-state");
    box.createEl("p", { cls: "research-explorer-error", text: message });
    box.createEl("p", { text: "Reload Obsidian or check the developer console for details." });
  }

  async onClose(): Promise<void> {
    this.graph?.destroy();
  }

  async refresh(): Promise<void> {
    try {
      this.workspaces = await this.api.listWorkspaces();
      if (!this.selectedWorkspace && this.workspaces[0]) this.selectedWorkspace = this.workspaces[0];
      if (this.selectedWorkspace) {
        this.collections = await this.api.listCollections(this.selectedWorkspace.workspaceId);
        this.capabilities = await this.api.getCorpusCapabilities(this.selectedWorkspace.workspaceId);
        this.publications = await this.api.research({
          workspaceId: this.selectedWorkspace.workspaceId,
          fullText: this.searchText || undefined,
          ...this.currentFilters(),
          limit: this.settings.resultLimit
        });
      }
      this.render();
    } catch (error) {
      this.renderError(error instanceof Error ? error.message : String(error));
    }
  }

  private render(): void {
    this.graph?.destroy();
    const root = this.contentEl;
    root.empty();
    root.addClass("research-explorer-view");
    const sidebar = root.createDiv("research-explorer-sidebar");
    this.renderSidebar(sidebar);
    root.createDiv("research-explorer-divider");
    const main = root.createDiv("research-explorer-main");
    root.createDiv("research-explorer-divider");
    const right = root.createDiv("research-explorer-right");
    this.renderMain(main, right);
    this.setupResizablePanels(sidebar, main, right);
  }

  private setupResizablePanels(sidebar: HTMLElement, main: HTMLElement, right: HTMLElement): void {
    const dividers = this.contentEl.querySelectorAll<HTMLElement>(".research-explorer-divider");
    const leftDivider = dividers[0];
    const rightDivider = dividers[1];
    if (!leftDivider || !rightDivider) return;

    const makeColDraggable = (
      handle: HTMLElement,
      target: HTMLElement,
      getNewWidth: (startWidth: number, dx: number) => number
    ) => {
      handle.addEventListener("mousedown", (startEvent) => {
        startEvent.preventDefault();
        const startX = startEvent.clientX;
        const startWidth = target.offsetWidth;
        handle.classList.add("is-dragging");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        const onMove = (e: MouseEvent) => {
          target.style.width = `${getNewWidth(startWidth, e.clientX - startX)}px`;
          target.style.flex = "none";
          this.graph?.resize();
        };
        const onUp = () => {
          handle.classList.remove("is-dragging");
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          this.graph?.resize();
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    };

    makeColDraggable(leftDivider, sidebar, (start, dx) => Math.max(120, Math.min(420, start + dx)));
    makeColDraggable(rightDivider, right, (start, dx) => Math.max(180, Math.min(680, start - dx)));
  }

  private renderSidebar(container: HTMLElement): void {
    container.createEl("h3", { text: "Workspaces" });
    new Setting(container).addButton((button) => button
      .setButtonText("New")
      .onClick(() => new TextInputModal(this.app, "New workspace", "My research", async (name) => {
        this.selectedWorkspace = await this.api.createWorkspace({ name });
        await this.refresh();
      }).open()));
    for (const workspace of this.workspaces) {
      const row = container.createDiv(
        `research-explorer-row${workspace.workspaceId === this.selectedWorkspace?.workspaceId ? " is-selected" : ""}`
      );
      row.setText(workspace.name);
      row.onclick = async () => {
        this.selectedWorkspace = workspace;
        this.seedIds.clear();
        this.exploration = undefined;
        this.searchText = "";
        await this.refresh();
      };
    }
    if (!this.selectedWorkspace) return;
    new Setting(container).addButton((button) => button
      .setCta()
      .setButtonText("Import Scopus CSV")
      .onClick(() => new ImportModal(this.app, this.api, this.selectedWorkspace!, () => this.refresh()).open()));
    const collHeader = container.createDiv({ cls: "research-explorer-section-header" });
    collHeader.createEl("h3", { text: "Collections" });
    collHeader.createEl("button", { text: "+ New", attr: { title: "Create a new collection" } })
      .addEventListener("click", () => {
        if (!this.selectedWorkspace) return;
        new CreateCollectionModal(this.app, async (name, color, labels) => {
          await this.api.createCollection({
            workspaceId: this.selectedWorkspace!.workspaceId,
            name,
            color,
            labels: labels ?? []
          });
          await this.refresh();
        }).open();
      });

    if (this.collections.length === 0) {
      container.createEl("p", {
        cls: "research-explorer-muted",
        text: "No collections yet."
      });
      const setupBtn = container.createEl("button", { text: "Set up Literature Review collections" });
      setupBtn.style.cssText = "width:100%;padding:6px;margin:4px 0 8px;cursor:pointer;border-radius:6px;border:1px dashed var(--interactive-accent);background:transparent;color:var(--interactive-accent);font-size:var(--font-ui-smaller);";
      setupBtn.addEventListener("click", async () => {
        if (!this.selectedWorkspace) return;
        const defaults = [
          { name: "Must Read",       color: "#e63946", labels: ["priority"] },
          { name: "Foundational",    color: "#f4a261", labels: ["foundational"] },
          { name: "Methodology",     color: "#2a9d8f", labels: ["method"] },
          { name: "State of the Art",color: "#457b9d", labels: ["sota"] },
          { name: "Out of Scope",    color: "#6c757d", labels: ["irrelevant"] },
        ];
        for (const d of defaults) {
          await this.api.createCollection({
            workspaceId: this.selectedWorkspace!.workspaceId,
            ...d
          });
        }
        new Notice("5 Literature Review collections created.");
        await this.refresh();
      });
    }

    // "All papers" filter chip
    const allChip = container.createDiv("research-explorer-coll-chip");
    allChip.setText("All papers");
    if (!this.filterCollectionId) allChip.addClass("is-active");
    allChip.addEventListener("click", () => {
      this.filterCollectionId = undefined;
      this.render();
    });

    for (const collection of this.collections) {
      const row = container.createDiv("research-explorer-collection-row");
      if (collection.color) {
        row.style.borderInlineStart = `4px solid ${collection.color}`;
      }

      // Main info area — click to filter list, Ctrl/Cmd+click to load as seeds
      const info = row.createDiv("research-explorer-collection-info");
      if (this.filterCollectionId === collection.collectionId) info.addClass("is-active");
      info.setAttribute("title", `Click to filter list · Ctrl+click to load as seeds`);

      const nameRow = info.createDiv({ cls: "research-explorer-collection-name-row" });
      nameRow.createSpan({ cls: "research-explorer-collection-name", text: collection.name });
      const count = nameRow.createSpan({ cls: "research-explorer-muted" });
      count.setText(` (${collection.publicationIds.length})`);

      if (collection.labels.length) {
        info.createDiv({ cls: "research-explorer-muted", text: collection.labels.join(", ") });
      }

      info.addEventListener("click", async (e) => {
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+click → load as seeds
          if (collection.publicationIds.length === 0) {
            new Notice("This collection has no papers yet.");
            return;
          }
          const collectionSeeds = await this.api.getCollectionSeedIds(collection.collectionId);
          this.seedIds = new Set(collectionSeeds.slice(0, 10));
          new Notice(collectionSeeds.length > 10
            ? `Loaded first 10 of ${collectionSeeds.length} papers as seeds.`
            : `${this.seedIds.size} paper(s) loaded as seeds.`);
          this.render();
        } else {
          // Regular click → filter list
          this.filterCollectionId =
            this.filterCollectionId === collection.collectionId ? undefined : collection.collectionId;
          this.render();
        }
      });

      // Action buttons
      const actions = row.createDiv("research-explorer-collection-actions");

      // Save current seeds → this collection
      const saveBtn = actions.createEl("button", {
        text: "↓ Save seeds",
        attr: { title: `Save currently checked papers into "${collection.name}"` }
      });
      saveBtn.addClass("research-explorer-collection-btn");
      saveBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (this.seedIds.size === 0) {
          new Notice("No papers are currently checked. Check papers in the list first.");
          return;
        }
        await this.api.addPublicationsToCollection(collection.collectionId, [...this.seedIds]);
        new Notice(`${this.seedIds.size} paper(s) saved to "${collection.name}".`);
        await this.refresh();
      });

      const deleteBtn = actions.createEl("button", {
        text: "×",
        attr: { title: `Delete collection "${collection.name}"` }
      });
      deleteBtn.addClass("research-explorer-collection-btn", "research-explorer-collection-btn-danger");
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!window.confirm(`Delete collection "${collection.name}"?`)) return;
        await this.api.deleteCollection(collection.collectionId);
        await this.refresh();
      });
    }
  }

  private renderMain(container: HTMLElement, rightPanel: HTMLElement): void {
    const toolbar = container.createDiv("research-explorer-toolbar");
    const mainHDivider = container.createDiv("research-explorer-hdivider");
    const graphEl = container.createDiv("research-explorer-graph");
    const list = rightPanel.createDiv("research-explorer-list");
    const hDivider = rightPanel.createDiv("research-explorer-hdivider");
    const detailEl = rightPanel.createDiv("research-explorer-detail");

    mainHDivider.addEventListener("mousedown", (startEvent) => {
      startEvent.preventDefault();
      const startY = startEvent.clientY;
      const startToolbarHeight = toolbar.offsetHeight;
      mainHDivider.classList.add("is-dragging");
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      const onMove = (e: MouseEvent) => {
        const h = Math.max(40, Math.min(container.clientHeight - 80, startToolbarHeight + (e.clientY - startY)));
        toolbar.style.height = `${h}px`;
        this.graph?.resize();
      };
      const onUp = () => {
        mainHDivider.classList.remove("is-dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        this.graph?.resize();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    hDivider.addEventListener("mousedown", (startEvent) => {
      startEvent.preventDefault();
      const startY = startEvent.clientY;
      const startDetailHeight = detailEl.offsetHeight;
      hDivider.classList.add("is-dragging");
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      const onMove = (e: MouseEvent) => {
        const h = Math.max(60, Math.min(rightPanel.clientHeight - 100, startDetailHeight - (e.clientY - startY)));
        detailEl.style.height = `${h}px`;
      };
      const onUp = () => {
        hDivider.classList.remove("is-dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    if (!this.selectedWorkspace) {
      const welcome = list.createDiv("research-explorer-welcome");
      welcome.createEl("h2", { text: "Welcome to Scopus Research Explorer" });
      welcome.createEl("p", { text: "Get started in two steps:" });
      const steps = welcome.createEl("ol");
      steps.createEl("li", { text: "Click \"New\" in the left sidebar to create a workspace." });
      steps.createEl("li", { text: "Then click \"Import Scopus CSV\" to load your Scopus export." });
      welcome.createEl("p", {
        cls: "research-explorer-muted",
        text: "Export your search results from Scopus as CSV, then import here to discover related work."
      });
      new Setting(welcome)
        .addButton((button) => button
          .setCta()
          .setButtonText("Create first workspace")
          .onClick(() => new TextInputModal(this.app, "New workspace", "My research", async (name) => {
            this.selectedWorkspace = await this.api.createWorkspace({ name });
            await this.refresh();
          }).open()));
      return;
    }

    new Setting(toolbar)
      .setName("Search corpus")
      .addText((text) => {
        text.setPlaceholder("Title, keywords, abstract")
          .setValue(this.searchText)
          .onChange((value) => {
            this.searchText = value.trim();
          });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") void this.runSearch();
        });
      })
      .addButton((button) => button.setButtonText("Search").onClick(() => this.runSearch()));

    new Setting(toolbar)
      .setName("Filters")
      .addText((text) => text
        .setPlaceholder("Year from")
        .setValue(this.yearFrom?.toString() ?? "")
        .onChange((value) => {
          const parsed = Number(value);
          this.yearFrom = value.trim() && Number.isFinite(parsed) ? parsed : undefined;
        }))
      .addText((text) => text
        .setPlaceholder("Year to")
        .setValue(this.yearTo?.toString() ?? "")
        .onChange((value) => {
          const parsed = Number(value);
          this.yearTo = value.trim() && Number.isFinite(parsed) ? parsed : undefined;
        }))
      .addDropdown((dropdown) => dropdown
        .addOptions({ any: "Any abstract", yes: "Has abstract", no: "No abstract" })
        .setValue(this.hasAbstract)
        .onChange((value) => {
          this.hasAbstract = value as typeof this.hasAbstract;
        }))
      .addButton((button) => button.setButtonText("Apply").onClick(() => this.runSearch()));

    const seedSetting = new Setting(toolbar)
      .setName(`${this.seedIds.size} seed(s)`)
      .addDropdown((dropdown) => {
        const options: Array<[MvpExplorationMode, string]> = [];
        if (this.capabilities?.supportsLexicalSimilarity) {
          options.push(
            ["similar", "Similar Work"],
            ["earlier", "Earlier Work"],
            ["later", "Later Work"]
          );
        }
        if (this.capabilities?.supportsReferences) options.push(["references", "References"]);
        if (this.capabilities?.supportsCitedByInCorpus) {
          options.push(["cited-by-in-corpus", "Cited By in Corpus"]);
        }
        if (!options.length) {
          dropdown.addOption("", "Discovery unavailable");
          dropdown.setDisabled(true);
          return;
        }
        for (const [value, label] of options) dropdown.addOption(value, label);
        if (!options.some(([value]) => value === this.selectedMode)) this.selectedMode = "similar";
        dropdown.setValue(this.selectedMode);
        dropdown.onChange((value) => {
          this.selectedMode = value as MvpExplorationMode;
        });
      })
      .addDropdown((dropdown) => dropdown
        .addOptions({ scatter: "Scatter", force: "Force graph" })
        .setValue(this.graphLayout)
        .onChange((value) => {
          this.graphLayout = value as "force" | "scatter";
          this.render();
        }))
      .addButton((button) => button
        .setButtonText("Explore")
        .setDisabled(!this.capabilities?.supportsLexicalSimilarity &&
          !this.capabilities?.supportsCitationGraph)
        .onClick(() => this.runExplore(this.selectedMode)));

    // ── Corpus stats panel ────────────────────────────────────
    if (this.publications.length > 0) {
      const statsEl = list.createDiv("research-explorer-stats");
      const allYears = this.publications
        .map(p => p.year)
        .filter((y): y is number => y != null && y > 1900);
      const minYr = allYears.length ? Math.min(...allYears) : null;
      const maxYr = allYears.length ? Math.max(...allYears) : null;
      const topPub = this.publications.reduce((best, p) =>
        (p.citationCount ?? 0) > (best.citationCount ?? 0) ? p : best
      );

      const statRow = (label: string, value: string) => {
        const row = statsEl.createDiv("research-explorer-stats-row");
        row.createSpan({ cls: "research-explorer-stats-label", text: label });
        row.createSpan({ cls: "research-explorer-stats-value", text: value });
      };

      statRow("บทความ", `${this.publications.length} เรื่อง`);
      statRow("ช่วงปี", minYr && maxYr ? `${minYr} – ${maxYr}` : "–");

      const topRow = statsEl.createDiv("research-explorer-stats-row");
      topRow.createSpan({ cls: "research-explorer-stats-label", text: "อ้างอิงสูงสุด" });
      const topLink = topRow.createSpan({ cls: "research-explorer-stats-value research-explorer-stats-link" });
      const shortTitle = topPub.title.length > 38 ? topPub.title.slice(0, 35) + "…" : topPub.title;
      topLink.setText(`${shortTitle} (${topPub.citationCount ?? 0})`);
      topLink.setAttribute("title", topPub.title);
      topLink.addEventListener("click", () => {
        this.selectedPublication = topPub;
        this.render();
      });
    }

    const baseShown = this.exploration?.items.map((item) => item.publication) ?? this.publications;
    // Apply collection filter
    const filterCol = this.filterCollectionId
      ? this.collections.find(c => c.collectionId === this.filterCollectionId)
      : undefined;
    const shown = filterCol
      ? baseShown.filter(p => filterCol.publicationIds.includes(p.publicationId))
      : baseShown;

    if (filterCol && shown.length === 0) {
      list.createEl("p", {
        cls: "research-explorer-muted",
        text: `No papers in "${filterCol.name}" yet. Use the dot buttons to add papers.`
      });
    }

    for (const publication of shown) {
      const resultItem = this.exploration?.items.find(
        (item) => item.publication.publicationId === publication.publicationId
      );
      const row = list.createDiv(
        `research-explorer-row${this.selectedPublication?.publicationId === publication.publicationId ? " is-selected" : ""}`
      );
      const checkbox = row.createEl("input");
      checkbox.type = "checkbox";
      checkbox.checked = this.seedIds.has(publication.publicationId);
      // stopPropagation prevents click from bubbling to row.onclick (which calls render()),
      // which would destroy this checkbox before its change event fires.
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.onchange = () => {
        if (checkbox.checked && this.seedIds.size >= 10) {
          checkbox.checked = false;
          new Notice("A seed set can contain at most 10 papers.");
          return;
        }
        checkbox.checked
          ? this.seedIds.add(publication.publicationId)
          : this.seedIds.delete(publication.publicationId);
        seedSetting.setName(`${this.seedIds.size} seed(s)`);
      };
      const text = row.createDiv({ cls: "research-explorer-row-text" });
      text.createDiv({ text: publication.title });
      text.createDiv({
        cls: "research-explorer-muted",
        text: `${publication.year ?? "n.d."} · Cited ${publication.citationCount ?? 0}` +
          (resultItem
            ? ` · Score ${resultItem.score.toFixed(3)} · Confidence ${Math.round(resultItem.confidence * 100)}%`
            : "")
      });
      if (resultItem) {
        const evidence = text.createEl("ul", { cls: "research-explorer-evidence" });
        for (const item of resultItem.evidence.slice(0, 3)) {
          evidence.createEl("li", { text: `${item.channel}: ${item.explanation}` });
        }
      }

      // ── Collection dot toggles ────────────────────────────
      if (this.collections.length > 0) {
        const dots = row.createDiv("research-explorer-coll-dots");
        dots.addEventListener("click", (e) => e.stopPropagation());
        for (const col of this.collections) {
          const isMember = col.publicationIds.includes(publication.publicationId);
          const dot = dots.createSpan("research-explorer-coll-dot");
          dot.style.setProperty("--coll-color", col.color ?? "#888");
          if (isMember) dot.addClass("is-member");
          dot.setAttribute("title", isMember ? `Remove from "${col.name}"` : `Add to "${col.name}"`);
          dot.addEventListener("click", async () => {
            if (isMember) {
              await this.api.removePublicationsFromCollection(col.collectionId, [publication.publicationId]);
            } else {
              await this.api.addPublicationsToCollection(col.collectionId, [publication.publicationId]);
            }
            await this.refresh();
          });
        }
      }

      row.onclick = (event) => {
        if (event.target === checkbox) return;
        this.selectedPublication = publication;
        this.render();
      };
    }
    this.renderGraph(graphEl, shown);
    this.renderDetail(detailEl);
  }

  private renderGraph(container: HTMLElement, publications: PublicationRecord[]): void {
    const publicationMap = new Map(
      [...(this.exploration?.seedPublications ?? []), ...publications]
        .map((publication) => [publication.publicationId, publication])
    );
    const limited = [...publicationMap.values()].slice(
      0,
      Math.min(500, Math.max(100, this.settings.graphNodeLimit))
    );
    const resultScores = new Map(
      this.exploration?.items.map((item) => [item.publication.publicationId, item.score]) ?? []
    );
    const maxScore = Math.max(...resultScores.values(), 1);
    const isScatter = this.graphLayout === "scatter";

    const years = limited.map(p => p.year).filter((y): y is number => y != null && y > 1900);
    const minYear = years.length ? Math.min(...years) : 2000;
    const maxYear = years.length ? Math.max(...years) : 2024;
    const maxCitations = Math.max(...limited.map(p => p.citationCount ?? 0), 1);
    const xPerYear = Math.max(60, Math.min(200, 1000 / Math.max(maxYear - minYear, 1)));
    const yScaleRange = 600;

    const nodes: cytoscape.ElementDefinition[] = limited.map((publication) => ({
      data: {
        id: publication.publicationId,
        label: publication.title.length > 40 ? `${publication.title.slice(0, 37)}...` : publication.title,
        year: publication.year ?? 0,
        size: Math.max(20, Math.min(60, 20 + Math.log2((publication.citationCount ?? 0) + 1) * 5)),
        ...(this.seedIds.has(publication.publicationId) && { seed: true })
      },
      position: {
        x: ((publication.year ?? minYear) - minYear) * xPerYear,
        y: -(publication.citationCount ?? 0) / maxCitations * yScaleRange
      }
    }));

    const visibleIds = new Set(limited.map((publication) => publication.publicationId));
    const edges: cytoscape.ElementDefinition[] = (this.exploration?.graphEdges ?? [])
      .filter((edge) => visibleIds.has(edge.sourcePublicationId) && visibleIds.has(edge.targetPublicationId))
      .map((edge, index) => ({
        data: {
          id: `edge-${index}-${edge.sourcePublicationId}-${edge.targetPublicationId}`,
          source: edge.sourcePublicationId,
          target: edge.targetPublicationId,
          kind: edge.kind,
          weight: edge.weight
        }
      }));

    // ── DOM structure ─────────────────────────────────────────
    const controls = container.createDiv("research-explorer-graph-controls");
    const canvas = container.createDiv("research-explorer-graph-canvas");
    const tooltip = canvas.createDiv("research-explorer-graph-tooltip");

    // ── Cytoscape instance ────────────────────────────────────
    this.graph = cytoscape({
      container: canvas,
      elements: [...nodes, ...edges],
      userZoomingEnabled: true,
      userPanningEnabled: true,
      minZoom: 0.05,
      maxZoom: 8,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            width: "data(size)",
            height: "data(size)",
            "font-size": 9,
            "text-wrap": "wrap",
            "text-max-width": 90,
            "text-valign": "bottom",
            "text-margin-y": 4,
            "background-color": "#7c6fef",
            color: "var(--text-muted)"
          }
        },
        {
          selector: "node[seed]",
          style: {
            "border-width": 4,
            "border-color": "#ffb000",
            "background-color": "#dc5f57",
            color: "var(--text-normal)"
          }
        },
        {
          selector: "edge",
          style: {
            width: "mapData(weight, 0, 1, 1, 5)",
            "line-color": "#8f8f9d",
            "target-arrow-color": "#8f8f9d",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            opacity: 0.7
          }
        },
        {
          selector: "edge[kind = 'similarity']",
          style: { "line-style": "dashed", "target-arrow-shape": "none" }
        },
        { selector: ":selected", style: { "border-width": 3, "border-color": "#ffb000" } },
        { selector: ".dimmed", style: { opacity: 0.12 } },
        { selector: ".re-edge-hidden", style: { display: "none" } }
      ] as any,
      layout: {
        name: isScatter ? "preset" : "cose",
        animate: false,
        randomize: false,
        quality: "draft",
        numIter: 150,
        nodeRepulsion: 200000,
        idealEdgeLength: 80
      } as any
    });

    // Auto-fit after layout settles
    setTimeout(() => this.graph?.fit(undefined, 20), 50);

    // ── Toolbar buttons ───────────────────────────────────────
    const addBtn = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
      const btn = controls.createEl("button", { text: label, attr: { title } });
      btn.addClass("research-explorer-graph-btn");
      btn.addEventListener("click", onClick);
      return btn;
    };

    addBtn("+", "Zoom in", () => {
      this.graph?.zoom({
        level: this.graph.zoom() * 1.3,
        renderedPosition: { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }
      });
    });
    addBtn("−", "Zoom out", () => {
      this.graph?.zoom({
        level: this.graph.zoom() / 1.3,
        renderedPosition: { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }
      });
    });
    addBtn("⊡ Fit", "Fit all nodes in view", () => this.graph?.fit(undefined, 20));
    addBtn("⟳ Reset", "Reset layout to default", () => {
      if (isScatter) {
        nodes.forEach(n => this.graph?.getElementById(n.data.id!).position(n.position!));
      } else {
        this.graph?.layout({
          name: "cose", animate: false, randomize: false,
          quality: "draft", numIter: 150, nodeRepulsion: 200000, idealEdgeLength: 80
        } as any).run();
      }
      setTimeout(() => this.graph?.fit(undefined, 20), 50);
    });

    // ── Legend + edge toggles ─────────────────────────────────
    const legend = controls.createDiv("research-explorer-graph-legend");

    const dotItem = (bg: string, border: string | null, text: string) => {
      const item = legend.createSpan("research-explorer-graph-legend-item");
      const dot = item.createSpan("research-explorer-graph-legend-dot");
      dot.style.background = bg;
      if (border) dot.style.boxShadow = `0 0 0 2px ${border}`;
      item.appendText(text);
    };

    // Clickable legend item — toggles edge visibility
    const toggleEdgeItem = (dashed: boolean, text: string, kind: string) => {
      const item = legend.createSpan("research-explorer-graph-legend-item research-explorer-graph-toggle");
      item.setAttribute("title", `Click to show/hide ${text.trim()}`);
      const line = item.createSpan("research-explorer-graph-legend-line");
      if (dashed) line.addClass("research-explorer-graph-legend-dashed");
      item.appendText(text);

      let visible = true;
      item.addEventListener("click", () => {
        visible = !visible;
        if (visible) {
          this.graph?.elements(`edge[kind = "${kind}"]`).removeClass("re-edge-hidden");
          item.removeClass("is-muted");
        } else {
          this.graph?.elements(`edge[kind = "${kind}"]`).addClass("re-edge-hidden");
          item.addClass("is-muted");
        }
      });
    };

    dotItem("#7c6fef", null, " Publication");
    dotItem("#dc5f57", "#ffb000", " Seed");
    toggleEdgeItem(false, " Citation edge", "citation");
    toggleEdgeItem(true, " Similarity edge", "similarity");

    // ── Tooltip on hover ──────────────────────────────────────
    this.graph.on("mouseover", "node", (event) => {
      const pub = limited.find(p => p.publicationId === event.target.id());
      if (!pub) return;
      tooltip.empty();
      tooltip.createEl("strong").setText(pub.title);
      tooltip.createEl("br");
      tooltip.appendText(`${pub.year ?? "n.d."} · ${pub.citationCount ?? 0} citations`);
      if (pub.abstract) {
        tooltip.createEl("br");
        tooltip.createEl("small").setText(
          pub.abstract.length > 140 ? pub.abstract.slice(0, 140) + "…" : pub.abstract
        );
      }
      tooltip.style.display = "block";
      // Dim everything except hovered node, its neighbors, and their edges
      const node = event.target;
      const connectedEdges = node.connectedEdges();
      const neighbors = node.neighborhood().filter("node");
      this.graph!.nodes().not(node).not(neighbors).addClass("dimmed");
      this.graph!.edges().not(connectedEdges).addClass("dimmed");
    });

    canvas.addEventListener("mousemove", (e) => {
      const x = e.offsetX;
      const y = e.offsetY;
      const tipW = 240;
      const tipH = 120;
      tooltip.style.left = `${x + canvas.clientWidth - x > tipW + 20 ? x + 14 : x - tipW - 6}px`;
      tooltip.style.top = `${y + canvas.clientHeight - y > tipH + 10 ? y + 10 : y - tipH - 4}px`;
    });

    this.graph.on("mouseout", "node", () => {
      tooltip.style.display = "none";
      this.graph!.elements().removeClass("dimmed");
    });

    // ── Node click → select publication ──────────────────────
    this.graph.on("tap", "node", (event) => {
      const publication = limited.find(item => item.publicationId === event.target.id());
      if (publication) {
        this.selectedPublication = publication;
        this.render();
      }
    });

    // ── Scatter axes (SVG overlay) ────────────────────────────
    if (isScatter && years.length > 0) {
      const svgNS = "http://www.w3.org/2000/svg";
      const axisSvg = document.createElementNS(svgNS, "svg");
      axisSvg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;";
      canvas.appendChild(axisSvg);

      const se = (tag: string, attrs: Record<string, string | number>): SVGElement => {
        const el = document.createElementNS(svgNS, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
        return el;
      };

      const AX_L = 56; // left reserved for Y-axis labels
      const AX_B = 28; // bottom reserved for X-axis labels

      const niceStep = (range: number, targetSteps = 5): number => {
        const raw = range / targetSteps;
        const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
        for (const f of [1, 2, 5, 10]) {
          if (f * mag >= raw) return f * mag;
        }
        return mag * 10;
      };

      const updateAxes = () => {
        if (!this.graph) return;
        const pan = this.graph.pan();
        const zoom = this.graph.zoom();
        const W = canvas.clientWidth;
        const H = canvas.clientHeight;

        while (axisSvg.firstChild) axisSvg.removeChild(axisSvg.firstChild);

        const gridColor = "var(--background-modifier-border)";
        const tickColor = "var(--text-faint)";
        const lineColor = "var(--text-muted)";
        const labelColor = "var(--text-muted)";
        const titleColor = "var(--text-normal)";

        // ─ X-axis ticks (years) ─
        const yearSpan = maxYear - minYear;
        const xStep = yearSpan <= 8 ? 1 : yearSpan <= 20 ? 2 : yearSpan <= 40 ? 5 : 10;
        const xStart = Math.ceil(minYear / xStep) * xStep;

        for (let yr = xStart; yr <= maxYear + xStep * 0.5; yr += xStep) {
          const sx = (yr - minYear) * xPerYear * zoom + pan.x;
          if (sx < AX_L - 30 || sx > W + 30) continue;

          // Grid line
          axisSvg.appendChild(se("line", { x1: sx, y1: 0, x2: sx, y2: H - AX_B, stroke: gridColor, "stroke-width": 1 }));
          // Tick mark
          axisSvg.appendChild(se("line", { x1: sx, y1: H - AX_B, x2: sx, y2: H - AX_B + 6, stroke: lineColor, "stroke-width": 1.5 }));
          // Label
          const lbl = se("text", { x: sx, y: H - AX_B + 18, "text-anchor": "middle", "font-size": 10, fill: labelColor });
          lbl.textContent = String(yr);
          axisSvg.appendChild(lbl);
        }

        // ─ Y-axis ticks (citation count) ─
        const yStep = niceStep(maxCitations);
        for (let cit = 0; cit <= maxCitations + yStep * 0.5; cit += yStep) {
          const sy = -(cit / maxCitations) * yScaleRange * zoom + pan.y;
          if (sy < -20 || sy > H - AX_B + 20) continue;

          // Grid line
          axisSvg.appendChild(se("line", { x1: AX_L, y1: sy, x2: W, y2: sy, stroke: gridColor, "stroke-width": 1 }));
          // Tick mark
          axisSvg.appendChild(se("line", { x1: AX_L - 6, y1: sy, x2: AX_L, y2: sy, stroke: lineColor, "stroke-width": 1.5 }));
          // Label
          const val = cit >= 1000 ? `${+(cit / 1000).toFixed(1)}k` : String(cit);
          const lbl = se("text", { x: AX_L - 9, y: sy + 4, "text-anchor": "end", "font-size": 10, fill: labelColor });
          lbl.textContent = val;
          axisSvg.appendChild(lbl);
        }

        // ─ Axis lines (drawn on top of grid) ─
        axisSvg.appendChild(se("line", { x1: AX_L, y1: 0, x2: AX_L, y2: H - AX_B, stroke: lineColor, "stroke-width": 1.5 }));
        axisSvg.appendChild(se("line", { x1: AX_L, y1: H - AX_B, x2: W, y2: H - AX_B, stroke: lineColor, "stroke-width": 1.5 }));

        // ─ Axis titles ─
        const xT = se("text", { x: (W + AX_L) / 2, y: H - 5, "text-anchor": "middle", "font-size": 11, "font-weight": "600", fill: titleColor });
        xT.textContent = "Year →";
        axisSvg.appendChild(xT);

        const yMid = (H - AX_B) / 2;
        const yT = se("text", { x: 11, y: yMid, "text-anchor": "middle", "font-size": 11, "font-weight": "600", fill: titleColor, transform: `rotate(-90,11,${yMid})` });
        yT.textContent = "Citations ↑";
        axisSvg.appendChild(yT);
      };

      this.graph.on("viewport", updateAxes);
      setTimeout(updateAxes, 80);
    }
  }

  private renderDetail(container: HTMLElement): void {
    const publication = this.selectedPublication;
    if (!publication || !this.selectedWorkspace) {
      container.createEl("p", { text: "Select a publication." });
      return;
    }
    container.createEl("h2", { text: publication.title });
    container.createEl("p", {
      cls: "research-explorer-muted",
      text: `${publication.authors.join(", ")} · ${publication.year ?? "n.d."}`
    });
    if (publication.abstract) container.createEl("p", { text: publication.abstract });
    container.createEl("p", { text: `Scopus Citation Count: ${publication.citationCount ?? 0}` });
    container.createEl("p", { text: `References in Corpus: ${publication.referencesInCorpus}` });
    container.createEl("p", { text: `Cited By in Corpus: ${publication.citedByInCorpus}` });
    new Setting(container)
      .addDropdown((dropdown) => dropdown
        .addOptions({ unread: "Unread", reading: "Reading", read: "Read" })
        .setValue(publication.readingState ?? "unread")
        .onChange(async (value) => {
          await this.api.setReadingState(
            this.selectedWorkspace!.workspaceId,
            publication.publicationId,
            value as "unread" | "reading" | "read"
          );
        }))
      .addButton((button) => button.setButtonText("Create/open note").onClick(async () => {
        const notePath = await this.notes.materialize(publication);
        await this.app.workspace.openLinkText(notePath, "", false);
      }));
    if (this.collections.length) {
      new Setting(container)
        .setName("Add to collection")
        .addDropdown((dropdown) => {
          dropdown.addOption("", "Choose...");
          for (const collection of this.collections) {
            dropdown.addOption(collection.collectionId, collection.name);
          }
          dropdown.onChange(async (collectionId) => {
            if (!collectionId) return;
            const col = this.collections.find(c => c.collectionId === collectionId);
            await this.api.addPublicationsToCollection(collectionId, [publication.publicationId]);
            new Notice(`Added to "${col?.name ?? "collection"}".`);
            dropdown.setValue("");
            await this.refresh();
          });
        });
      for (const collection of this.collections.filter((item) =>
        item.publicationIds.includes(publication.publicationId)
      )) {
        new Setting(container)
          .setName(`In ${collection.name}`)
          .setDesc(collection.labels.join(", "))
          .addButton((button) => button
            .setWarning()
            .setButtonText("Remove")
            .onClick(async () => {
              await this.api.removePublicationsFromCollection(
                collection.collectionId,
                [publication.publicationId]
              );
              await this.refresh();
            }));
      }
    }
  }

  private async runExplore(mode: MvpExplorationMode): Promise<void> {
    if (!this.selectedWorkspace || !this.seedIds.size) {
      new Notice("Select between 1 and 10 seed papers.");
      return;
    }
    try {
      this.exploration = await this.api.explore({
        workspaceId: this.selectedWorkspace.workspaceId,
        seedPublicationIds: [...this.seedIds].slice(0, 10),
        mode,
        filters: this.currentFilters(),
        limit: this.settings.resultLimit
      });
      this.render();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 10000);
    }
  }

  private async runSearch(): Promise<void> {
    if (!this.selectedWorkspace) return;
    try {
      this.exploration = undefined;
      this.publications = await this.api.research({
        workspaceId: this.selectedWorkspace.workspaceId,
        fullText: this.searchText || undefined,
        ...this.currentFilters(),
        limit: this.settings.resultLimit
      });
      this.render();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 10000);
    }
  }

  private currentFilters(): {
    years?: { from?: number; to?: number };
    hasAbstract?: boolean;
  } {
    return {
      years: this.yearFrom != null || this.yearTo != null
        ? { from: this.yearFrom, to: this.yearTo }
        : undefined,
      hasAbstract: this.hasAbstract === "any" ? undefined : this.hasAbstract === "yes"
    };
  }
}

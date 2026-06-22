import { App, Notice, PluginSettingTab, Setting, requestUrl } from "obsidian";
import type ScopusResearchExplorerPlugin from "./main";
import { SemanticScholarClient, SemanticScholarApiError } from "./semantic-scholar/client";

export class ResearchExplorerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ScopusResearchExplorerPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "Scopus Research Explorer" });

    new Setting(this.containerEl)
      .setName("Publication notes folder")
      .setDesc("Managed publication notes are written here.")
      .addText((text) => text
        .setValue(this.plugin.settings.notesFolder)
        .onChange(async (value) => {
          this.plugin.settings.notesFolder = value.trim() || "Research/Publications";
          await this.plugin.saveSettings();
        }));

    if (this.plugin.settings.backupWarning) {
      new Setting(this.containerEl)
        .setName("Portable backup warning")
        .setDesc(this.plugin.settings.backupWarning);
    }

    new Setting(this.containerEl)
      .setName("Maximum results to load")
      .setDesc("Number of publications fetched per query (up to 1000).")
      .addSlider((slider) => slider
        .setLimits(100, 1000, 100)
        .setValue(this.plugin.settings.resultLimit)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.resultLimit = value;
          await this.plugin.saveSettings();
        }));

    new Setting(this.containerEl)
      .setName("Maximum visible graph nodes")
      .addSlider((slider) => slider
        .setLimits(100, 500, 50)
        .setValue(this.plugin.settings.graphNodeLimit)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.graphNodeLimit = value;
          await this.plugin.saveSettings();
        }));

    this.containerEl.createEl("h3", { text: "Semantic Scholar" });

    const apiKeyDesc = document.createDocumentFragment();
    apiKeyDesc.appendText("Optional API key from ");
    apiKeyDesc.createEl("a", {
      text: "Semantic Scholar",
      href: "https://www.semanticscholar.org/product/api",
    });
    apiKeyDesc.appendText(
      ". Without a key: 1 request/second. With a key: up to 10 requests/second. " +
      "Key is stored locally in your vault's .obsidian folder — do not use a shared or cloud-synced vault for sensitive keys."
    );

    let testButtonEl: HTMLButtonElement | undefined;
    let statusEl: HTMLElement | undefined;

    new Setting(this.containerEl)
      .setName("API key")
      .setDesc(apiKeyDesc)
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.placeholder = "Paste your API key here";
        text.setValue(this.plugin.settings.semanticScholarApiKey ?? "");
        text.onChange(async (value) => {
          this.plugin.settings.semanticScholarApiKey = value.trim() || undefined;
          await this.plugin.saveSettings();
          if (statusEl) statusEl.setText("");
        });
        return text;
      })
      .addButton((btn) => {
        testButtonEl = btn.buttonEl;
        btn.setButtonText("Test connection").onClick(async () => {
          if (!testButtonEl || !statusEl) return;
          testButtonEl.disabled = true;
          statusEl.setText("Testing…");
          try {
            const key = this.plugin.settings.semanticScholarApiKey;
            const client = new SemanticScholarClient(key || undefined, requestUrl);
            await client.searchPapers("test", 1);
            statusEl.setText("✓ Connected");
            statusEl.style.color = "var(--color-green)";
          } catch (err) {
            const msg = err instanceof SemanticScholarApiError
              ? `Error ${err.statusCode}`
              : (err instanceof Error ? err.message : String(err));
            statusEl.setText(`✗ ${msg}`);
            statusEl.style.color = "var(--color-red)";
          } finally {
            if (testButtonEl) testButtonEl.disabled = false;
          }
        });
        return btn;
      });

    // Status line shown below the API key setting
    statusEl = this.containerEl.createEl("p", { cls: "setting-item-description" });
    statusEl.style.paddingLeft = "var(--size-4-4)";
  }
}

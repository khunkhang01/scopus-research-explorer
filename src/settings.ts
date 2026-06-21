import { App, PluginSettingTab, Setting } from "obsidian";
import type ScopusResearchExplorerPlugin from "./main";

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
  }
}

import { App, PluginSettingTab, Setting } from "obsidian";
import DropdownPlugin from "./main";

export interface SelectorConfig {
	name: string;
	options: string[];
}

export interface DropdownSettings {
	selectors: SelectorConfig[];
}

export const DEFAULT_SETTINGS: DropdownSettings = {
	selectors: []
};

export class DropdownSettingTab extends PluginSettingTab {
	plugin: DropdownPlugin;

	constructor(app: App, plugin: DropdownPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Selector properties")
			.setDesc("Define property names and their comma-separated dropdown options.");

		this.plugin.settings.selectors.forEach((selector, index) => {
			const s = new Setting(containerEl)
				.addText(text => text
					.setPlaceholder("selector.name")
					.setValue(selector.name)
					.onChange(async (value) => {
						selector.name = value;
						await this.plugin.saveSettings();
					})
				)
				.addText(text => text
					.setPlaceholder("Option 1, Option 2")
					.setValue(selector.options.join(", "))
					.onChange(async (value) => {
						selector.options = value.split(",").map(s => s.trim()).filter(s => s.length > 0);
						await this.plugin.saveSettings();
					})
				)
				.addExtraButton(btn => btn
					.setIcon("trash")
					.setTooltip("Delete selector")
					.onClick(async () => {
						this.plugin.settings.selectors.splice(index, 1);
						await this.plugin.saveSettings();
						this.display(); // re-render
					})
				);
			
			s.infoEl.style.display = "none";
		});

		new Setting(containerEl)
			.addButton(btn => btn
				.setButtonText("Add selector")
				.onClick(async () => {
					this.plugin.settings.selectors.push({ name: "", options: [] });
					await this.plugin.saveSettings();
					this.display(); // re-render
				})
			);
	}
}

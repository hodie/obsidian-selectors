import { App, Plugin, TFile } from 'obsidian';
import { DropdownSettings, DEFAULT_SETTINGS, DropdownSettingTab, SelectorConfig } from "./settings";

export default class DropdownPlugin extends Plugin {
	settings: DropdownSettings;
	observer: MutationObserver;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new DropdownSettingTab(this.app, this));

		this.observer = new MutationObserver((mutations) => {
			this.handleMutations(mutations);
		});
		
		this.app.workspace.onLayoutReady(() => {
			this.observer.observe(document.body, { childList: true, subtree: true });
			// initial scan just in case
			this.injectDropdowns(document.body);
		});
	}

	onunload() {
		this.observer?.disconnect();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<DropdownSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private injectDropdowns(container: HTMLElement | Document) {
		// 1. Standard Properties view
		const propertyContainers = container.querySelectorAll('.metadata-property');
		propertyContainers.forEach((propEl) => {
			const keyEl = propEl.querySelector('.metadata-property-key-input') as HTMLInputElement;
			if (!keyEl) return;
			const key = keyEl.value || keyEl.textContent;
			
			if (key) {
				const selectorConfig = this.settings.selectors.find(s => s.name && s.name === key);
				if (selectorConfig) {
					const valueContainer = propEl.querySelector('.metadata-property-value');
					if (!valueContainer) return;
					
					// If we haven't already injected our dropdown
					if (!valueContainer.querySelector('.dropdown-plugin-select')) {
						this.replaceWithValueDropdown(valueContainer as HTMLElement, selectorConfig.options, key);
					}
				}
			}
		});

		// 2. Base table view support.
		const tables = container.querySelectorAll('table');
		tables.forEach(table => {
			const headers = Array.from(table.querySelectorAll('th'));
			const selectorColumns: { index: number, config: SelectorConfig }[] = [];
			
			headers.forEach((th, index) => {
				const colName = th.textContent?.trim();
				if (colName) {
					const config = this.settings.selectors.find(s => s.name === colName);
					if (config) {
						selectorColumns.push({ index, config });
					}
				}
			});

			if (selectorColumns.length === 0) return;

			const rows = table.querySelectorAll('tr');
			rows.forEach(row => {
				const cells = Array.from(row.children);
				selectorColumns.forEach(sc => {
					const cell = cells[sc.index] as HTMLElement;
					if (!cell) return;

					const inputEl = cell.querySelector('input');
					if (inputEl) {
						if (!cell.querySelector('.dropdown-plugin-select')) {
							this.injectIntoTableCellInput(cell, inputEl, sc.config);
						}
					}
				});
			});
		});
	}

	private handleMutations(mutations: MutationRecord[]) {
		let shouldInject = false;
		for (const mutation of mutations) {
			if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
				shouldInject = true;
				break;
			}
		}
		if (shouldInject) {
			this.injectDropdowns(document.body);
		}
	}

	private replaceWithValueDropdown(valueContainer: HTMLElement, options: string[], key: string) {
		// Hide original elements instead of removing them to not break Obsidian's internal state managers
		const children = Array.from(valueContainer.children);
		let currentValue = "";
		
		children.forEach((child: Element) => {
			if (child.classList.contains('dropdown-plugin-select')) return;

			if (child instanceof HTMLElement) {
				// Try to extract existing value. Usually it's an input or a rendered pill.
				const inputEl = child.querySelector('input');
				if (inputEl) currentValue = inputEl.value;
				else if (child.textContent) currentValue = child.textContent;

				child.style.display = 'none';
			}
		});

		// Clean up extracted value depending on property type format
		currentValue = currentValue.replace(/\s+/g, ' ').trim();

		// Create dropdown
		const selectEl = document.createElement("select");
		selectEl.classList.add('dropdown-plugin-select', 'search-input');
		selectEl.style.width = '100%';
		selectEl.style.background = 'transparent';
		
		// Default empty option
		const emptyOpt = document.createElement("option");
		emptyOpt.value = "";
		emptyOpt.text = "---";
		selectEl.appendChild(emptyOpt);
		
		options.forEach(opt => {
			const optionEl = document.createElement('option');
			optionEl.value = opt;
			optionEl.text = opt;
			if (opt === currentValue) {
				optionEl.selected = true;
			}
			selectEl.appendChild(optionEl);
		});

		selectEl.addEventListener('change', async (e) => {
			const newValue = (e.target as HTMLSelectElement).value;
			// Best way to update frontmatter safely:
			const file = this.app.workspace.getActiveFile();
			if (file instanceof TFile) {
				await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
					frontmatter[key] = newValue;
				});
			}
		});

		valueContainer.appendChild(selectEl);
	}

	private injectIntoTableCellInput(cell: HTMLElement, inputEl: HTMLInputElement, config: SelectorConfig) {
		inputEl.style.display = 'none';

		const currentValue = inputEl.value?.trim() || "";

		const selectEl = document.createElement("select");
		selectEl.classList.add('dropdown-plugin-select');
		selectEl.style.width = '100%';
		selectEl.style.background = 'var(--background-modifier-form-field)';
		selectEl.style.color = 'var(--text-normal)';
		selectEl.style.border = 'var(--input-border-width) solid var(--background-modifier-border)';
		selectEl.style.borderRadius = 'var(--input-radius)';
		
		const emptyOpt = document.createElement("option");
		emptyOpt.value = "";
		emptyOpt.text = "---";
		selectEl.appendChild(emptyOpt);
		
		config.options.forEach((opt: string) => {
			const optionEl = document.createElement('option');
			optionEl.value = opt;
			optionEl.text = opt;
			if (opt === currentValue) {
				optionEl.selected = true;
			}
			selectEl.appendChild(optionEl);
		});

		selectEl.addEventListener('change', (e) => {
			const newValue = (e.target as HTMLSelectElement).value;
			inputEl.value = newValue;
			
			inputEl.dispatchEvent(new Event('input', { bubbles: true }));
			inputEl.dispatchEvent(new Event('change', { bubbles: true }));
			
			const enterEvent = new KeyboardEvent('keydown', {
				key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
			});
			inputEl.dispatchEvent(enterEvent);
			inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
			
			selectEl.blur();
		});

		selectEl.addEventListener('click', (e) => {
			e.stopPropagation(); // prevent closing the cell editor prematurely
		});

		cell.appendChild(selectEl);
		selectEl.focus();
	}
}

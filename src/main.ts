import { Plugin, TFile } from 'obsidian';
import { CustomSelectorsSettings, DEFAULT_SETTINGS, CustomSelectorsSettingTab, SelectorConfig } from "./settings";

export default class CustomSelectorsPlugin extends Plugin {
	settings: CustomSelectorsSettings;
	observer: MutationObserver;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CustomSelectorsSettingTab(this.app, this));

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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<CustomSelectorsSettings>);
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
					if (!valueContainer.querySelector('.custom-selectors-plugin-select')) {
						this.replaceWithValueDropdown(valueContainer as HTMLElement, selectorConfig.options, key);
					}
				}
			}
		});

		// 2. Obsidian Bases table view support.
		// Bases uses a custom div grid: .bases-td[data-property="note.<name>"]
		this.settings.selectors.forEach(selectorConfig => {
			if (!selectorConfig.name) return;

			const dataProperty = `note.${selectorConfig.name}`;
			const cells = container.querySelectorAll(`.bases-td[data-property="${dataProperty}"]`);

			cells.forEach(cellEl => {
				const cell = cellEl as HTMLElement;
				if (cell.querySelector('.custom-selectors-plugin-select')) return;

				const row = cell.closest('.bases-tr') as HTMLElement;
				if (!row) return;

				this.injectIntoBaseCell(cell, row, selectorConfig);
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
			if (child.classList.contains('custom-selectors-plugin-select')) return;

			if (child instanceof HTMLElement) {
				// Try to extract existing value. Usually it's an input or a rendered pill.
				const inputEl = child.querySelector('input');
				if (inputEl) currentValue = inputEl.value;
				else if (child.textContent) currentValue = child.textContent;

				child.setCssProps({ display: 'none' });
			}
		});

		// Clean up extracted value depending on property type format
		currentValue = currentValue.replace(/\s+/g, ' ').trim();

		// Create dropdown
		const selectEl = document.createElement("select");
		selectEl.classList.add('custom-selectors-plugin-select', 'search-input');
		selectEl.setCssProps({ width: '100%', background: 'transparent' });
		
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

		selectEl.addEventListener('change', (e) => {
			const newValue = (e.target as HTMLSelectElement).value;
			// Best way to update frontmatter safely:
			const file = this.app.workspace.getActiveFile();
			if (file instanceof TFile) {
				// eslint-disable-next-line @typescript-eslint/no-floating-promises
				this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
					frontmatter[key] = newValue;
				});
			}
		});

		valueContainer.appendChild(selectEl);
	}

	private injectIntoBaseCell(cell: HTMLElement, row: HTMLElement, config: SelectorConfig) {
		// Read current value from the contenteditable div inside the cell
		const contentEl = cell.querySelector('.metadata-input-longtext') as HTMLElement | null;
		const currentValue = (contentEl?.textContent || '').replace(/\s+/g, ' ').trim();

		// Find the note file via the internal-link span in this row
		const link = row.querySelector('.internal-link') as HTMLElement | null;
		const href = link?.getAttribute('data-href');

		// The .bases-td is already position:absolute (uses inset-inline-start),
		// so it already serves as a containing block for our overlay — don't change it.
		const selectEl = document.createElement("select");
		selectEl.classList.add('custom-selectors-plugin-select');
		selectEl.setCssProps({
			position: 'absolute',
			top: '0',
			left: '0',
			width: '100%',
			height: '100%',
			background: 'var(--background-primary)',
			color: 'var(--text-normal)',
			border: 'none',
			zIndex: '10',
			cursor: 'pointer',
			boxSizing: 'border-box',
			padding: '0 4px'
		});

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

			// Update frontmatter directly via the Obsidian API
			if (href) {
				const file = this.app.metadataCache.getFirstLinkpathDest(href, '');
				if (file instanceof TFile) {
					// eslint-disable-next-line @typescript-eslint/no-floating-promises
					this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
						frontmatter[config.name] = newValue;
					});
				}
			}
		});

		// Prevent base's pointer/mouse/focus controllers from hijacking our select
		const stopInteraction = (e: Event) => {
			e.stopPropagation();
		};
		const evts = ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup', 'focusin'];
		evts.forEach(evt => {
			selectEl.addEventListener(evt, stopInteraction);
			selectEl.addEventListener(evt, stopInteraction, { capture: true });
		});

		cell.appendChild(selectEl);
	}
}

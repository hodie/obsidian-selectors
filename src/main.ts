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

		// When a file is created from a Bases view (+New), set selector defaults
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;

				// Only act when a Bases view is active
				const leaf = this.app.workspace.getMostRecentLeaf();
				if (!leaf?.view || leaf.view.getViewType() !== 'bases') return;

				// Only default selectors that are columns in this Base
				const basesView = (leaf as any).containerEl?.querySelector('.bases-view');
				if (!basesView) return;

				const headerNames = new Set(
					Array.from(basesView.querySelectorAll('.bases-table-header-name'))
						.map((el: Element) => el.textContent?.trim())
						.filter((s): s is string => !!s)
				);

				const relevantSelectors = this.settings.selectors.filter(
					s => s.name && s.options.length > 0 && headerNames.has(s.name)
				);
				if (relevantSelectors.length === 0) return;

				// Delay to let Bases finish initializing the file
				setTimeout(() => {
					// eslint-disable-next-line @typescript-eslint/no-floating-promises
					this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
						relevantSelectors.forEach(selector => {
							if (!frontmatter[selector.name]) {
								frontmatter[selector.name] = selector.options[0];
							}
						});
					});
				}, 200);
			})
		);
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
				const existingSelect = cell.querySelector('.custom-selectors-plugin-select') as HTMLSelectElement | null;

				if (existingSelect) {
					// Sync dropdown with underlying value if data changed externally
					const contentEl = cell.querySelector('.metadata-input-longtext') as HTMLElement | null;
					const currentValue = (contentEl?.textContent || '').replace(/\s+/g, ' ').trim();
					if (existingSelect.value !== currentValue) {
						existingSelect.value = currentValue || '';
					}
					return;
				}

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

				child.addClass('cs-hidden');
			}
		});

		// Clean up extracted value depending on property type format
		currentValue = currentValue.replace(/\s+/g, ' ').trim();

		// Create dropdown
		const selectEl = document.createElement("select");
		selectEl.classList.add('custom-selectors-plugin-select', 'search-input');
		selectEl.setAttribute('aria-label', `Select value for ${key}`);
		
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

			// Trigger Obsidian's internal reactive property system through the
			// hidden native input so other views (like Bases) update immediately.
			const nativeInput = valueContainer.querySelector('input') as HTMLInputElement | null;
			const nativeEditable = valueContainer.querySelector('[contenteditable]') as HTMLElement | null;

			if (nativeInput) {
				nativeInput.value = newValue;
				nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
				nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
			} else if (nativeEditable) {
				nativeEditable.textContent = newValue;
				nativeEditable.dispatchEvent(new InputEvent('input', { bubbles: true }));
			}

			// Also write via processFrontMatter as a fallback
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
		selectEl.classList.add('custom-selectors-plugin-select', 'mod-base');
		selectEl.setAttribute('aria-label', `Select value for ${config.name}`);

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

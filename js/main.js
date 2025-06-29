import { MCU_DATABASE, TEMPLATES } from './constants.js';
import { AppState } from './state.js';
import { Renderer } from './rendering.js';
import { LayoutValidator } from './validation.js';
import { LayoutCalculator } from './layout-calculator.js';
import { FileHandler } from './file-handler.js';
import { DragDropHandler } from './drag-drop.js';
import { debounce, handleError } from './utils.js';

class PartitionManager {
    constructor() {
        this.state = new AppState();
        this.renderer = new Renderer(this.state);
        this.validator = new LayoutValidator(this.state);
        this.calculator = new LayoutCalculator(this.state);
        this.fileHandler = new FileHandler(this.state);
        this.dragDropHandler = new DragDropHandler(this.state);
        
        this.debouncedRecalculate = debounce(() => this.recalculateLayout(), 300);
        
        this.init();
    }

    init() {
        try {
            this.setupEventListeners();
            this.populateSelectors();
            this.loadDefaultState();
            this.recalculateLayout();
        } catch (error) {
            handleError(error, 'during initialization');
        }
    }

    setupEventListeners() {
        this.state.subscribe((change) => this.handleStateChange(change));
        this.setupUIEventListeners();
        this.dragDropHandler.init();
    }

    setupUIEventListeners() {
        const elements = this.getDOMElements();

        elements.mcuSelector.addEventListener('change', (e) => {
            this.handleMcuChange(e.target.value);
        });

        elements.templateSelector.addEventListener('change', (e) => {
            this.loadTemplate(e.target.value);
        });

        elements.copyYamlBtn.addEventListener('click', () => {
            this.copyYamlToClipboard();
        });

        elements.addPartitionBtn.addEventListener('click', () => {
            this.addPartition();
        });

        elements.addGroupBtn.addEventListener('click', () => {
            this.addGroup();
        });

        elements.addRegionBtn.addEventListener('click', () => {
            this.addCustomRegion();
        });

        elements.yamlUpload.addEventListener('change', (e) => {
            this.fileHandler.handleFileUpload(e);
        });

        this.setupPartitionListEvents();
        this.setupRegionListEvents();
    }

    setupPartitionListEvents() {
        const partitionList = document.getElementById('partition-list');

        partitionList.addEventListener('click', (e) => {
            const target = e.target;
            const id = target.dataset.id ? parseInt(target.dataset.id, 10) : null;

            if (target.classList.contains('remove-item-btn')) {
                this.removeItem(id);
            } else if (target.classList.contains('add-child-btn')) {
                this.addChildPartition(id);
            }
        });

        // Handle input events with minimal recalculation to avoid breaking user typing
        partitionList.addEventListener('input', (e) => {
            const target = e.target;
            if (target.classList.contains('item-input')) {
                const id = parseInt(target.dataset.id, 10);
                const key = target.dataset.key;
                // Update state without triggering render to avoid interrupting typing
                this.updateItemSilently(id, key, target.value);
            }
        });

        // Handle change events with full recalculation when user finishes editing
        partitionList.addEventListener('change', (e) => {
            const target = e.target;
            if (target.classList.contains('item-input')) {
                const id = parseInt(target.dataset.id, 10);
                const key = target.dataset.key;
                this.updateItem(id, key, target.value);
            }
        });
    }

    setupRegionListEvents() {
        const regionsList = document.getElementById('memory-regions-list');

        regionsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-region-btn')) {
                this.removeRegion(e.target.dataset.name);
            }
        });

        // Handle input events for regions with minimal recalculation
        regionsList.addEventListener('input', (e) => {
            if (e.target.classList.contains('region-input')) {
                const name = e.target.dataset.name;
                const key = e.target.dataset.key;
                if (key !== 'name' && name) {
                    // Update state silently during typing
                    this.updateRegionSilently(name, key, e.target.value);
                }
            }
        });

        regionsList.addEventListener('change', (e) => {
            if (e.target.classList.contains('region-input')) {
                const name = e.target.dataset.name;
                const key = e.target.dataset.key;
                if (key !== 'name' && name) {
                    this.updateRegion(name, key, e.target.value);
                }
            }
        });
    }

    populateSelectors() {
        const elements = this.getDOMElements();

        Object.entries(TEMPLATES).forEach(([key]) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            elements.templateSelector.appendChild(option);
        });

        Object.entries(MCU_DATABASE).forEach(([key, mcu]) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = mcu.name;
            elements.mcuSelector.appendChild(option);
        });
    }

    loadDefaultState() {
        const elements = this.getDOMElements();
        elements.mcuSelector.value = this.state.selectedMcu;
        
        const defaultTemplate = this.state.selectedMcu === 'nrf5340' ? 'nrf5340_multi' : 'fota';
        this.loadTemplate(defaultTemplate);
        elements.templateSelector.value = defaultTemplate;
    }

    handleStateChange(change) {
        try {
            switch (change.type) {
                case 'ITEM_ADDED':
                case 'ITEM_REMOVED':
                case 'ITEM_UPDATED':
                case 'ITEM_MOVED':
                case 'REGION_ADDED':
                case 'REGION_REMOVED':
                case 'REGION_UPDATED':
                case 'MCU_CHANGED':
                    this.debouncedRecalculate();
                    break;
                case 'TEMPLATE_LOADED':
                    this.recalculateLayout();
                    break;
                case 'YAML_LOADED':
                    // Preserve exact sizes from YAML file by not aligning
                    this.recalculateLayout({ alignSizes: false });
                    break;
                default:
                    break;
            }
        } catch (error) {
            handleError(error, 'handling state change');
        }
    }

    recalculateLayout(options = {}) {
        try {
            this.calculator.recalculateLayout(options);
            this.validator.validateLayout();
            this.renderer.renderAll();
        } catch (error) {
            handleError(error, 'during layout recalculation');
        }
    }

    handleMcuChange(mcuKey) {
        try {
            this.state.updateMcu(mcuKey);
            const defaultTemplate = mcuKey === 'nrf5340' ? 'nrf5340_multi' : 'fota';
            this.loadTemplate(defaultTemplate);
            document.getElementById('templates').value = defaultTemplate;
        } catch (error) {
            handleError(error, 'changing MCU');
        }
    }

    loadTemplate(templateName) {
        try {
            if (TEMPLATES[templateName]) {
                this.state.loadFromTemplate(TEMPLATES[templateName]);
            }
        } catch (error) {
            handleError(error, 'loading template');
        }
    }

    addPartition() {
        try {
            const regions = Object.keys(this.state.memoryRegions);
            this.state.addItem({
                type: 'partition',
                name: 'new_partition',
                sizeStr: '128K',
                region: regions[0] || 'flash_primary'
            });
        } catch (error) {
            handleError(error, 'adding partition');
        }
    }

    addGroup() {
        try {
            const regions = Object.keys(this.state.memoryRegions);
            this.state.addItem({
                type: 'group',
                name: 'new_group',
                region: regions[0] || 'flash_primary',
                children: []
            });
        } catch (error) {
            handleError(error, 'adding group');
        }
    }

    addChildPartition(parentId) {
        try {
            this.state.addItem({
                type: 'partition',
                name: 'new_partition',
                sizeStr: '16K'
            }, parentId);
        } catch (error) {
            handleError(error, 'adding child partition');
        }
    }

    addCustomRegion() {
        try {
            const name = prompt('Enter region name:');
            if (!name) return;

            const startAddr = prompt('Enter start address (hex):');
            if (!startAddr) return;

            const size = prompt('Enter size (hex):');
            if (!size) return;

            const startAddress = parseInt(startAddr, 16);
            const regionSize = parseInt(size, 16);

            if (isNaN(startAddress) || isNaN(regionSize)) {
                alert('Invalid address or size format');
                return;
            }

            this.state.addRegion(name, startAddress, regionSize, false);
        } catch (error) {
            handleError(error, 'adding custom region');
        }
    }

    removeItem(id) {
        try {
            this.state.removeItem(id);
        } catch (error) {
            handleError(error, 'removing item');
        }
    }

    removeRegion(name) {
        try {
            this.state.removeRegion(name);
        } catch (error) {
            handleError(error, 'removing region');
        }
    }

    updateItem(id, key, value) {
        try {
            this.state.updateItem(id, key, value);
        } catch (error) {
            handleError(error, 'updating item');
        }
    }

    updateItemSilently(id, key, value) {
        try {
            // Update state without triggering observers/recalculation
            const result = this.state.findItem(id);
            if (result) {
                if (key === 'span') {
                    result.item[key] = value.split(',').map(s => s.trim()).filter(Boolean);
                } else {
                    result.item[key] = value;
                }

                if (key === 'name' && value === 'mcuboot_pad') {
                    result.item.sizeStr = MCU_DATABASE[this.state.selectedMcu].mcubootPadSize.toString();
                }
            }
        } catch (error) {
            handleError(error, 'updating item silently');
        }
    }

    updateRegion(name, key, value) {
        try {
            const parsedValue = parseInt(value, 16);
            if (!isNaN(parsedValue)) {
                this.state.updateRegion(name, key, parsedValue);
            }
        } catch (error) {
            handleError(error, 'updating region');
        }
    }

    updateRegionSilently(name, key, value) {
        try {
            // Update region state without triggering observers/recalculation
            const region = this.state.memoryRegions[name];
            if (region) {
                const parsedValue = parseInt(value, 16);
                if (!isNaN(parsedValue)) {
                    region[key] = parsedValue;
                }
            }
        } catch (error) {
            handleError(error, 'updating region silently');
        }
    }

    copyYamlToClipboard() {
        try {
            const yamlOutput = document.getElementById('yaml-output');
            navigator.clipboard.writeText(yamlOutput.textContent)
                .then(() => alert('YAML copied to clipboard!'))
                .catch(() => alert('Failed to copy YAML'));
        } catch (error) {
            handleError(error, 'copying YAML');
        }
    }

    getDOMElements() {
        return {
            mcuSelector: document.getElementById('mcu-selector'),
            templateSelector: document.getElementById('templates'),
            copyYamlBtn: document.getElementById('copy-yaml-btn'),
            addPartitionBtn: document.getElementById('add-partition-btn'),
            addGroupBtn: document.getElementById('add-group-btn'),
            addRegionBtn: document.getElementById('add-region-btn'),
            yamlUpload: document.getElementById('yaml-upload')
        };
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        window.partitionManager = new PartitionManager();
    } catch (error) {
        handleError(error, 'initializing application');
    }
});
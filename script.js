// Modern modular version - bundled without ES6 modules for file:// compatibility

// Constants
const FLASH_PAGE_SIZE = 4096;

const MCU_DATABASE = {
    nrf9160: { 
        name: "nRF9160 SIAA", 
        regions: { 
            flash_primary: { startAddress: 0x0, size: 0x100000 } 
        }, 
        mcubootPadSize: 0x200 
    },
    nrf52840: { 
        name: "nRF52840", 
        regions: { 
            flash_primary: { startAddress: 0x0, size: 0x100000 } 
        }, 
        mcubootPadSize: 0x200 
    },
    nrf5340: {
        name: "nRF5340 (Multi-Core)",
        regions: {
            flash_primary: { startAddress: 0x0, size: 0x100000 },
            sram_primary: { startAddress: 0x20000000, size: 0x80000 },
            flash_primary_net: { startAddress: 0x01000000, size: 0x40000 },
            sram_primary_net: { startAddress: 0x21000000, size: 0x10000 }
        },
        mcubootPadSize: 0x200
    },
    nrf54l15: { 
        name: "nRF54L15 (Example)", 
        regions: { 
            flash_primary: { startAddress: 0x0, size: 0x180000 } 
        }, 
        mcubootPadSize: 0x800 
    }
};

const PARTITION_COLORS = [
    '#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f', 
    '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'
];

const TEMPLATES = {
    fota: [
        { type: 'partition', name: 'mcuboot', sizeStr: '48K', region: 'flash_primary' },
        { type: 'partition', name: 'mcuboot_pad', region: 'flash_primary' },
        { type: 'partition', name: 'slot_0', sizeStr: '480K', region: 'flash_primary' },
        { type: 'partition', name: 'slot_1', sizeStr: '480K', region: 'flash_primary' },
        { type: 'partition', name: 'storage', sizeStr: '16K', region: 'flash_primary' },
    ],
    fota_external: [
        { type: 'partition', name: 'mcuboot', sizeStr: '48K', region: 'flash_primary' },
        {
            type: 'group', name: 'mcuboot_primary', region: 'flash_primary', children: [
                { type: 'partition', name: 'mcuboot_pad' },
                { type: 'partition', name: 'app', sizeStr: '900K' }
            ]
        },
        { type: 'partition', name: 'mcuboot_secondary', sizeStr: '960K', region: 'external_flash', device: 'MX25R64' },
        { type: 'partition', name: 'storage', sizeStr: '16K', region: 'flash_primary' },
    ],
    nrf5340_multi: [
        { type: 'partition', name: 'mcuboot', sizeStr: '48K', region: 'flash_primary' },
        {
            type: 'group', name: 'mcuboot_primary_app', region: 'flash_primary', children: [
                { type: 'partition', name: 'mcuboot_pad' },
                { type: 'partition', name: 'slot_0_app', sizeStr: '440K' }
            ]
        },
        { type: 'partition', name: 'slot_1_app', sizeStr: '448K', region: 'flash_primary' },
        {
            type: 'group', name: 'mcuboot_primary_net', region: 'flash_primary_net', children: [
                { type: 'partition', name: 'slot_0_net', sizeStr: '128K' }
            ]
        },
        { type: 'partition', name: 'slot_1_net', sizeStr: '128K', region: 'flash_primary_net' },
        { type: 'partition', name: 'storage', sizeStr: '16K', region: 'flash_primary' },
    ]
};

// Utilities
function parseSize(sizeStr) {
    if (!sizeStr) return 0;
    
    const str = sizeStr.toString().trim();
    const upper = str.toUpperCase();

    if (upper.startsWith('0X')) {
        return parseInt(upper, 16);
    }

    const value = parseFloat(upper);
    if (isNaN(value)) return 0;
    
    if (upper.includes('M')) return Math.round(value * 1024 * 1024);
    if (upper.includes('K')) return Math.round(value * 1024);
    return Math.round(value);
}

function formatHex(num, pad = 0) {
    const hex = Number(num || 0).toString(16).toUpperCase();
    return `0x${hex.padStart(pad, '0')}`;
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatSizeForInput(bytes) {
    if (!bytes || bytes === 0) return '0';
    
    const k = 1024;
    const m = k * k;
    
    if (bytes % m === 0) return (bytes / m) + 'M';
    if (bytes % k === 0) return (bytes / k) + 'K';
    return bytes.toString();
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function handleError(error, context = '') {
    console.error(`Error ${context}:`, error);
    
    const userMessage = error.userMessage || 
        `An error occurred ${context}. Please check the console for details.`;
    
    alert(userMessage);
    return { success: false, error: error.message };
}

function collectAllItems(items, callback) {
    const result = [];
    
    function traverse(items) {
        items.forEach(item => {
            if (callback) callback(item);
            result.push(item);
            if (item.children) traverse(item.children);
        });
    }
    
    traverse(items);
    return result;
}

function findItemPath(targetId, items, currentPath = []) {
    for (const item of items) {
        const newPath = [...currentPath, item];
        if (item.id === targetId) return newPath;
        
        if (item.children) {
            const foundPath = findItemPath(targetId, item.children, newPath);
            if (foundPath) return foundPath;
        }
    }
    return null;
}

// State Management Class
class AppState {
    constructor() {
        this.selectedMcu = 'nrf9160';
        this.memoryRegions = {};
        this.items = [];
        this.nextId = 0;
        this.observers = new Set();
        
        this.initializeDefaultRegions();
    }

    initializeDefaultRegions() {
        const defaultRegions = MCU_DATABASE[this.selectedMcu].regions;
        Object.entries(defaultRegions).forEach(([name, config]) => {
            this.addRegion(name, config.startAddress, config.size, true);
        });
    }

    subscribe(observer) {
        this.observers.add(observer);
        return () => this.observers.delete(observer);
    }

    notify(change) {
        this.observers.forEach(observer => observer(change));
    }

    addRegion(name, startAddress, size, isDefault = false) {
        if (this.memoryRegions[name]) return false;
        
        this.memoryRegions[name] = { startAddress, size, isDefault };
        this.notify({ type: 'REGION_ADDED', payload: { name, startAddress, size, isDefault } });
        return true;
    }

    removeRegion(name) {
        if (!this.memoryRegions[name] || this.memoryRegions[name].isDefault) {
            return false;
        }
        
        delete this.memoryRegions[name];
        this.notify({ type: 'REGION_REMOVED', payload: { name } });
        return true;
    }

    updateRegion(name, key, value) {
        const region = this.memoryRegions[name];
        if (!region) return false;
        
        const oldValue = region[key];
        region[key] = value;
        this.notify({ 
            type: 'REGION_UPDATED', 
            payload: { name, key, value, oldValue } 
        });
        return true;
    }

    addItem(itemData, parentId = null) {
        const newItem = { 
            ...itemData, 
            id: this.nextId++,
            errors: []
        };

        if (newItem.name === 'mcuboot_pad') {
            newItem.sizeStr = MCU_DATABASE[this.selectedMcu].mcubootPadSize.toString();
        }

        // Store reference to template children before potentially modifying the newItem
        const childrenFromTemplate = itemData.children;
        
        if (newItem.type === 'group') {
            newItem.children = [];
        } else {
            delete newItem.children;
        }

        if (parentId === null) {
            this.items.push(newItem);
        } else {
            const parent = this.findItem(parentId);
            if (parent?.item.type === 'group') {
                parent.item.children = parent.item.children || [];
                parent.item.children.push(newItem);
            }
        }

        // Add template children if they exist (only for groups)
        if (childrenFromTemplate && newItem.type === 'group') {
            childrenFromTemplate.forEach(childData => 
                this.addItem(childData, newItem.id)
            );
        }

        this.notify({ type: 'ITEM_ADDED', payload: newItem });
        return newItem;
    }

    removeItem(id) {
        const result = this.findItem(id);
        if (!result) return false;

        const list = result.parent ? result.parent.children : this.items;
        const index = list.findIndex(i => i.id === id);
        
        if (index === -1) return false;
        
        const [removedItem] = list.splice(index, 1);
        this.notify({ type: 'ITEM_REMOVED', payload: removedItem });
        return true;
    }

    updateItem(id, key, value) {
        const result = this.findItem(id);
        if (!result) return false;

        const oldValue = result.item[key];
        
        if (key === 'span') {
            result.item[key] = value.split(',').map(s => s.trim()).filter(Boolean);
        } else {
            result.item[key] = value;
        }

        if (key === 'name' && value === 'mcuboot_pad') {
            result.item.sizeStr = MCU_DATABASE[this.selectedMcu].mcubootPadSize.toString();
        }

        if (key === 'sizeStr') {
            this.unpinSubsequentItems(id);
        }

        this.notify({ 
            type: 'ITEM_UPDATED', 
            payload: { id, key, value, oldValue, item: result.item } 
        });
        return true;
    }

    findItem(id, items = this.items, parent = null) {
        for (const item of items) {
            if (item.id === id) return { item, parent };
            if (item.children) {
                const found = this.findItem(id, item.children, item);
                if (found) return found;
            }
        }
        return null;
    }

    unpinSubsequentItems(changedItemId) {
        const itemPath = findItemPath(changedItemId, this.items);
        
        if (itemPath && itemPath.length > 0) {
            const topLevelItem = itemPath[0];
            const topLevelIndex = this.items.findIndex(i => i.id === topLevelItem.id);

            if (topLevelIndex > -1) {
                for (let i = topLevelIndex + 1; i < this.items.length; i++) {
                    const subsequentItem = this.items[i];
                    if (subsequentItem.region === topLevelItem.region) {
                        delete subsequentItem.address;
                    }
                }
            }
        }
    }

    moveItem(draggedId, targetId, position) {
        const dragged = this.findItem(draggedId);
        const target = this.findItem(targetId);

        if (!dragged || !target || dragged.item.id === target.item.id) {
            return false;
        }

        if (dragged.item.type === 'group' && this.isDescendant(target.item, dragged.item)) {
            return false;
        }

        const sourceList = dragged.parent ? dragged.parent.children : this.items;
        const draggedIndex = sourceList.findIndex(i => i.id === draggedId);
        const [draggedItem] = sourceList.splice(draggedIndex, 1);

        if (position === 'inside' && target.item.type === 'group') {
            target.item.children.push(draggedItem);
        } else {
            const destList = target.parent ? target.parent.children : this.items;
            const targetIndex = destList.findIndex(i => i.id === targetId);
            destList.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, draggedItem);
        }

        this.notify({ 
            type: 'ITEM_MOVED', 
            payload: { draggedId, targetId, position } 
        });
        return true;
    }

    isDescendant(potentialDescendant, potentialAncestor) {
        if (!potentialAncestor.children?.length) return false;
        
        return potentialAncestor.children.some(child => 
            child.id === potentialDescendant.id || 
            this.isDescendant(potentialDescendant, child)
        );
    }

    updateMcu(mcuKey) {
        if (!MCU_DATABASE[mcuKey]) return false;

        const customRegions = Object.fromEntries(
            Object.entries(this.memoryRegions)
                .filter(([, region]) => !region.isDefault)
        );

        this.selectedMcu = mcuKey;
        this.memoryRegions = { ...customRegions };

        const defaultRegions = MCU_DATABASE[mcuKey].regions;
        Object.entries(defaultRegions).forEach(([name, config]) => {
            this.addRegion(name, config.startAddress, config.size, true);
        });

        this.notify({ type: 'MCU_CHANGED', payload: { mcuKey } });
        return true;
    }

    loadFromTemplate(template) {
        this.items = [];
        this.nextId = 0;

        template.forEach(itemData => {
            if (itemData.region === 'external_flash' && !this.memoryRegions['external_flash']) {
                this.addRegion('external_flash', 0x0, 0x800000);
            }
        });

        template.forEach(itemData => this.addItem(itemData));
        this.notify({ type: 'TEMPLATE_LOADED', payload: template });
    }
}

// Layout Calculator
class LayoutCalculator {
    constructor(state) {
        this.state = state;
    }

    recalculateLayout(options = {}) {
        const { alignSizes = true } = options;
        
        this.precomputeSizes(alignSizes);
        this.calculateAddresses();
    }

    precomputeSizes(alignSizes) {
        const precompute = (items, parentRegion = null) => {
            items.forEach(item => {
                item.region = item.region || parentRegion;
                
                if (item.type === 'group') {
                    if (item.children) {
                        precompute(item.children, item.region);
                    }
                    item.size = (item.children || []).reduce((sum, child) => sum + (child.size || 0), 0);
                    item.sizeStr = formatBytes(item.size);
                } else {
                    const parsedSize = parseSize(item.sizeStr);
                    
                    if (alignSizes && 
                        item.region === 'flash_primary' && 
                        item.name !== 'mcuboot_pad' && 
                        parsedSize > 0) {
                        
                        const alignedSize = Math.ceil(parsedSize / FLASH_PAGE_SIZE) * FLASH_PAGE_SIZE;
                        item.size = alignedSize;
                        
                        if (item.size !== parsedSize) {
                            item.sizeStr = formatSizeForInput(item.size);
                        }
                    } else {
                        item.size = parsedSize;
                    }
                }
            });
        };

        precompute(this.state.items);
    }

    calculateAddresses() {
        Object.entries(this.state.memoryRegions).forEach(([regionName, region]) => {
            if (!region) return;
            
            let currentOffset = region.startAddress || 0;
            const isFlashRegion = regionName.startsWith('flash_');

            const allRegionItems = this.state.items.filter(item => item.region === regionName);
            const childIdsInRegion = this.getChildIdsInRegion(allRegionItems);

            allRegionItems
                .filter(item => !childIdsInRegion.has(item.id))
                .forEach(item => {
                    let effectiveAddress = item.address;
                    
                    if (effectiveAddress === undefined) {
                        let proposedAddress = currentOffset;
                        
                        if (isFlashRegion && item.name !== 'mcuboot_pad') {
                            proposedAddress = Math.ceil(proposedAddress / FLASH_PAGE_SIZE) * FLASH_PAGE_SIZE;
                        }
                        
                        effectiveAddress = proposedAddress;
                    }

                    item.address = effectiveAddress;
                    currentOffset = item.address + item.size;

                    if (item.type === 'group' && item.children) {
                        this.calculateGroupChildrenAddresses(item);
                    }
                });
        });
    }

    calculateGroupChildrenAddresses(group) {
        let childOffset = group.address;
        
        group.children.forEach(child => {
            child.region = group.region;
            child.address = childOffset;
            childOffset += child.size;
        });
    }

    getChildIdsInRegion(regionItems) {
        const childIds = new Set();
        
        regionItems.forEach(item => {
            if (item.type === 'group' && item.children) {
                item.children.forEach(child => childIds.add(child.id));
            }
        });
        
        return childIds;
    }
}

// Validation
class LayoutValidator {
    constructor(state) {
        this.state = state;
    }

    validateLayout() {
        this.clearErrors();
        this.validateDuplicateNames();
        this.validateRegionBounds();
        this.validateOverlaps();
    }

    clearErrors() {
        collectAllItems(this.state.items, item => {
            item.errors = [];
        });
    }

    validateDuplicateNames() {
        const allItems = collectAllItems(this.state.items);
        const childIds = this.getChildIds(allItems);
        const uniqueItemsByName = new Map();

        allItems
            .filter(item => !childIds.has(item.id))
            .forEach(item => {
                if (!item.name) return;

                if (uniqueItemsByName.has(item.name)) {
                    const other = uniqueItemsByName.get(item.name);
                    const errorMsg = `Error: Duplicate name '${item.name}'. All top-level item names must be unique.`;
                    
                    this.addError(item, errorMsg);
                    this.addError(other, errorMsg);
                } else {
                    uniqueItemsByName.set(item.name, item);
                }
            });
    }

    validateRegionBounds() {
        Object.entries(this.state.memoryRegions).forEach(([regionName, region]) => {
            const allItems = collectAllItems(this.state.items);
            const childIds = this.getChildIds(allItems);
            
            const rootItemsInRegion = allItems
                .filter(item => 
                    item.region === regionName && 
                    item.address !== undefined && 
                    !childIds.has(item.id)
                )
                .sort((a, b) => a.address - b.address);

            rootItemsInRegion.forEach(item => {
                const itemEnd = item.address + item.size;
                const regionEnd = region.startAddress + region.size;

                if (item.address < region.startAddress || itemEnd > regionEnd) {
                    this.addError(item, `Error: Item '${item.name}' is outside of '${regionName}' bounds.`);
                }
            });
        });
    }

    validateOverlaps() {
        Object.keys(this.state.memoryRegions).forEach(regionName => {
            const allItems = collectAllItems(this.state.items);
            const childIds = this.getChildIds(allItems);
            
            const rootItemsInRegion = allItems
                .filter(item => 
                    item.region === regionName && 
                    item.address !== undefined && 
                    !childIds.has(item.id)
                )
                .sort((a, b) => a.address - b.address);

            for (let i = 0; i < rootItemsInRegion.length; i++) {
                const current = rootItemsInRegion[i];
                const currentEnd = current.address + current.size;

                for (let j = i + 1; j < rootItemsInRegion.length; j++) {
                    const next = rootItemsInRegion[j];

                    if (currentEnd > next.address) {
                        if (!this.isPermissibleOverlap(current, next)) {
                            this.addError(current, `Error: Item '${current.name}' overlaps with '${next.name}'.`);
                            this.addError(next, `Error: Item '${next.name}' overlapped by '${current.name}'.`);
                        }
                    }
                }
            }
        });
    }

    isPermissibleOverlap(container, content) {
        if (container.type !== 'group' || !container.children) return false;
        
        const containerChildrenIds = new Set(container.children.map(c => c.id));
        
        if (containerChildrenIds.has(content.id)) return true;
        
        if (content.type === 'group' && content.children) {
            return content.children.every(child => 
                containerChildrenIds.has(child.id)
            );
        }
        
        return false;
    }

    getChildIds(items) {
        const childIds = new Set();
        items.forEach(item => {
            if (item.type === 'group' && item.children) {
                item.children.forEach(child => childIds.add(child.id));
            }
        });
        return childIds;
    }

    addError(item, errorMessage) {
        if (!item.errors.includes(errorMessage)) {
            item.errors.push(errorMessage);
        }
    }
}

// Renderer
class Renderer {
    constructor(state) {
        this.state = state;
        this.elements = this.getDOMElements();
    }

    getDOMElements() {
        return {
            memoryRegionsList: document.getElementById('memory-regions-list'),
            partitionList: document.getElementById('partition-list'),
            graphicalView: document.getElementById('graphical-view'),
            yamlOutput: document.getElementById('yaml-output')
        };
    }

    renderAll() {
        this.renderMemoryRegionsList();
        this.renderPartitionList();
        this.renderGraphicalView();
        this.renderYaml();
    }

    renderMemoryRegionsList() {
        const fragment = document.createDocumentFragment();
        
        Object.entries(this.state.memoryRegions).forEach(([name, region]) => {
            const item = document.createElement('div');
            item.className = 'region-item';
            
            item.innerHTML = `
                <input type="text" value="${name}" data-name="${name}" data-key="name" title="Region Name" readonly class="item-name">
                <input type="text" value="${formatHex(region.startAddress)}" data-name="${name}" data-key="startAddress" title="Start Address" class="region-input">
                <input type="text" value="${formatHex(region.size)}" data-name="${name}" data-key="size" title="Size" class="region-input">
                <div class="item-actions">
                    <button data-name="${name}" class="remove-region-btn action-btn" style="visibility: ${region.isDefault ? 'hidden' : 'visible'}">X</button>
                </div>
            `;
            
            fragment.appendChild(item);
        });
        
        this.elements.memoryRegionsList.replaceChildren(fragment);
    }

    renderPartitionList() {
        const fragment = document.createDocumentFragment();
        const regionOptions = Object.keys(this.state.memoryRegions)
            .map(name => `<option value="${name}">${name}</option>`)
            .join('');

        const renderItem = (item, isChild) => {
            const container = this.createPartitionItemElement(item, isChild, regionOptions);
            fragment.appendChild(container);
            
            if (!isChild) {
                const regionSelect = container.querySelector(`select[data-key="region"]`);
                if (regionSelect) regionSelect.value = item.region;
            }
            
            if (item.children) {
                item.children.forEach(child => renderItem(child, true));
            }
        };

        // Only collect child IDs from top-level items, not from the flattened tree
        const childIds = new Set();
        this.state.items.forEach(item => {
            if (item.type === 'group' && item.children) {
                item.children.forEach(child => childIds.add(child.id));
            }
        });

        // Render only top-level items (those not contained in any group)
        this.state.items
            .filter(item => !childIds.has(item.id))
            .forEach(item => renderItem(item, false));
            
        this.elements.partitionList.replaceChildren(fragment);
    }

    createPartitionItemElement(item, isChild, regionOptions) {
        const isGroup = item.type === 'group';
        const isPad = item.name === 'mcuboot_pad';
        const container = document.createElement('div');
        container.dataset.id = item.id;
        
        container.className = isGroup ? 'group-item' : (isChild ? 'child-partition-item' : 'partition-item');
        
        if (item.errors?.length > 0) {
            container.classList.add('has-error');
        }

        const regionSelector = !isChild 
            ? `<select data-id="${item.id}" data-key="region" class="item-input">${regionOptions}</select>` 
            : '<div></div>';
            
        const deviceInput = isGroup 
            ? '<div></div>' 
            : `<input type="text" value="${item.device || ''}" data-id="${item.id}" data-key="device" class="item-input" placeholder="Device">`;
            
        const spanInput = isGroup 
            ? '<div></div>' 
            : `<input type="text" value="${(item.span || []).join(', ')}" data-id="${item.id}" data-key="span" class="item-input" placeholder="Spanned by">`;
            
        const sizeInput = `<input type="text" value="${item.sizeStr || ''}" data-id="${item.id}" data-key="sizeStr" class="item-input" placeholder="Size" ${(isGroup || isPad) ? 'readonly' : ''}>`;
        
        const errorIcon = (item.errors?.length > 0)
            ? `<span class="item-error-icon" title="${item.errors.join('\\n')}">⚠️</span>`
            : '';

        container.innerHTML = `
            <div class="drag-handle" draggable="true">☰</div>
            <div class="item-name-wrapper">
                <input type="text" value="${item.name || ''}" data-id="${item.id}" data-key="name" placeholder="Name" class="item-input item-name">
                ${errorIcon}
            </div>
            ${sizeInput}
            ${regionSelector}
            ${deviceInput}
            ${spanInput}
            <div class="item-actions">
                ${isGroup ? `<button class="action-btn add-child-btn" data-id="${item.id}" title="Add Partition to Group">+</button>` : ''}
                <button class="action-btn remove-item-btn" data-id="${item.id}" title="Remove Item">X</button>
            </div>
        `;

        return container;
    }

    renderGraphicalView() {
        const fragment = document.createDocumentFragment();
        
        Object.entries(this.state.memoryRegions).forEach(([regionName, region]) => {
            const regionEl = this.createMemoryRegionElement(regionName, region);
            fragment.appendChild(regionEl);
        });
        
        this.elements.graphicalView.replaceChildren(fragment);
    }

    createMemoryRegionElement(regionName, region) {
        const regionEl = document.createElement('div');
        regionEl.className = 'memory-region';
        
        const { maxAddress, totalUsedSpace, isOverflowing, freeSpace } = 
            this.calculateRegionUsage(regionName, region);

        const titleEl = this.createRegionTitle(regionName, region, totalUsedSpace, freeSpace, isOverflowing);
        regionEl.appendChild(titleEl);

        const layoutContainer = document.createElement('div');
        layoutContainer.className = 'partition-layout-vertical';
        
        const headerRow = this.createHeaderRow();
        layoutContainer.appendChild(headerRow);

        this.renderRegionItems(layoutContainer, regionName);
        
        if (!isOverflowing && freeSpace > 0) {
            const unusedRow = this.createUnusedSpaceRow(maxAddress, region, freeSpace);
            layoutContainer.appendChild(unusedRow);
        }

        regionEl.appendChild(layoutContainer);
        return regionEl;
    }

    calculateRegionUsage(regionName, region) {
        let maxAddress = region.startAddress;
        
        const findMaxAddress = (items) => {
            items.forEach(item => {
                if (item.region === regionName && item.address !== undefined && item.size > 0) {
                    maxAddress = Math.max(maxAddress, item.address + item.size);
                }
                if (item.children) findMaxAddress(item.children);
            });
        };
        
        findMaxAddress(this.state.items);

        const totalUsedSpace = maxAddress - region.startAddress;
        const isOverflowing = totalUsedSpace > region.size;
        const freeSpace = Math.max(0, region.size - totalUsedSpace);

        return { maxAddress, totalUsedSpace, isOverflowing, freeSpace };
    }

    createRegionTitle(regionName, region, totalUsedSpace, freeSpace, isOverflowing) {
        const titleEl = document.createElement('div');
        titleEl.className = 'memory-region-title';
        titleEl.innerHTML = `<span>${regionName} (Total: ${formatBytes(region.size)})</span>`;
        
        if (isOverflowing) {
            const overflowAmount = totalUsedSpace - region.size;
            titleEl.innerHTML += `<span class="overflow-warning">OVERFLOW: ${formatBytes(overflowAmount)}</span>`;
        } else {
            titleEl.innerHTML += `<span>Used: ${formatBytes(totalUsedSpace)}, Free: ${formatBytes(freeSpace)}</span>`;
        }
        
        return titleEl;
    }

    createHeaderRow() {
        const headerRow = document.createElement('div');
        headerRow.className = 'partition-row header';
        headerRow.innerHTML = `
            <div class="part-name">Name</div>
            <div class="part-addr">Address Range</div>
            <div class="part-size">Size</div>
        `;
        return headerRow;
    }

    renderRegionItems(layoutContainer, regionName) {
        const renderItemRow = (item, isChild, colorIndex) => {
            if (!item.size && item.type !== 'group') return;

            const row = document.createElement('div');
            row.className = 'partition-row';
            if (isChild) row.classList.add('child-row');
            if (item.type === 'group') row.classList.add('group-row');
            
            row.style.borderLeftColor = PARTITION_COLORS[colorIndex % PARTITION_COLORS.length];

            const endAddress = item.address + (item.size > 0 ? item.size - 1 : 0);
            row.innerHTML = `
                <div class="part-name">${item.name}</div>
                <div class="part-addr">${formatHex(item.address, 6)} - ${formatHex(endAddress, 6)}</div>
                <div class="part-size">${formatBytes(item.size)} (${formatHex(item.size)})</div>
            `;
            
            layoutContainer.appendChild(row);

            if (item.type === 'group' && item.children) {
                item.children.forEach((child, childIndex) => {
                    renderItemRow(child, true, colorIndex + childIndex + 1);
                });
            }
        };

        const allItems = collectAllItems(this.state.items);
        const regionItems = allItems.filter(p => p.region === regionName);
        const childIdsInRegion = new Set();
        
        regionItems.forEach(item => {
            if (item.type === 'group' && item.children) {
                item.children.forEach(child => childIdsInRegion.add(child.id));
            }
        });
        
        const rootRegionItems = regionItems.filter(item => !childIdsInRegion.has(item.id));
        rootRegionItems.forEach((item, index) => renderItemRow(item, false, index));
    }

    createUnusedSpaceRow(maxAddress, region, freeSpace) {
        const unusedRow = document.createElement('div');
        unusedRow.className = 'partition-row unused-row';
        const startAddr = maxAddress;
        const endAddr = region.startAddress + region.size - 1;
        
        unusedRow.innerHTML = `
            <div class="part-name">Unused</div>
            <div class="part-addr">${formatHex(startAddr, 6)} - ${formatHex(endAddr, 6)}</div>
            <div class="part-size">${formatBytes(freeSpace)} (${formatHex(freeSpace)})</div>
        `;
        
        return unusedRow;
    }

    renderYaml() {
        const allUniqueItems = this.collectUniqueItemsForYaml();
        const sortedItems = this.sortItemsForYaml(allUniqueItems);
        
        let yamlString = '';
        
        sortedItems.forEach(item => {
            if (!item.name) return;
            
            yamlString += `${item.name}:\n`;
            
            if (item.address !== undefined) {
                yamlString += `  address: ${formatHex(item.address)}\n`;
            }
            
            if (item.region) {
                yamlString += `  region: ${item.region}\n`;
            }
            
            if (item.size) {
                yamlString += `  size: ${formatHex(item.size)}\n`;
            }
            
            if (item.device) {
                yamlString += `  device: ${item.device}\n`;
            }

            if (item.type === 'group') {
                const childrenNames = (item.children || [])
                    .map(c => c.name)
                    .filter(Boolean);
                    
                if (childrenNames.length > 0) {
                    const anchorId = (item.name || 'group').replace(/[^a-zA-Z0-9_]/g, '_') + '_span_def';
                    yamlString += `  orig_span: &${anchorId}\n`;
                    childrenNames.forEach(name => {
                        yamlString += `  - ${name}\n`;
                    });
                    yamlString += `  span: *${anchorId}\n`;
                }
            } else if (item.span?.length > 0) {
                yamlString += `  span: [${item.span.join(', ')}]\n`;
            }
            
            yamlString += `\n`;
        });
        
        this.elements.yamlOutput.textContent = yamlString.trim();
    }

    collectUniqueItemsForYaml() {
        const allUniqueItems = [];
        const uniqueNames = new Set();

        const collectUniqueItems = (items) => {
            items.forEach(item => {
                if (item.type === 'group' || !uniqueNames.has(item.name)) {
                    allUniqueItems.push(item);
                    uniqueNames.add(item.name);
                }

                if (item.type === 'group' && item.children) {
                    collectUniqueItems(item.children);
                }
            });
        };

        collectUniqueItems(this.state.items);
        return allUniqueItems;
    }

    sortItemsForYaml(items) {
        return items.sort((a, b) => {
            const regionOrder = (region) => {
                if (region === 'flash_primary') return 0;
                if (region === 'external_flash') return 1;
                return 2;
            };
            
            const aRegionOrder = regionOrder(a.region);
            const bRegionOrder = regionOrder(b.region);
            
            if (aRegionOrder !== bRegionOrder) {
                return aRegionOrder - bRegionOrder;
            }
            
            if (aRegionOrder > 1 && a.region !== b.region) {
                return a.region.localeCompare(b.region);
            }

            const aAddr = a.address !== undefined ? a.address : Infinity;
            const bAddr = b.address !== undefined ? b.address : Infinity;
            
            if (aAddr !== bAddr) return aAddr - bAddr;

            if (a.type === 'partition' && b.type === 'group') return -1;
            if (a.type === 'group' && b.type === 'partition') return 1;
            
            return 0;
        });
    }
}

// Drag and Drop Handler
class DragDropHandler {
    constructor(state) {
        this.state = state;
        this.draggedItemId = null;
        this.partitionList = null;
    }

    init() {
        this.partitionList = document.getElementById('partition-list');
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.partitionList.addEventListener('dragstart', (e) => this.handleDragStart(e));
        this.partitionList.addEventListener('dragend', (e) => this.handleDragEnd(e));
        this.partitionList.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.partitionList.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.partitionList.addEventListener('drop', (e) => this.handleDrop(e));
    }

    handleDragStart(e) {
        const dragHandle = e.target.closest('.drag-handle');
        if (!dragHandle) {
            e.preventDefault();
            return;
        }

        const dragTarget = e.target.closest('[data-id]');
        if (dragTarget) {
            this.draggedItemId = parseInt(dragTarget.dataset.id, 10);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', this.draggedItemId);
            
            setTimeout(() => {
                dragTarget.classList.add('dragging');
            }, 0);
        }
    }

    handleDragEnd() {
        const draggingEl = this.partitionList.querySelector('.dragging');
        if (draggingEl) {
            draggingEl.classList.remove('dragging');
        }

        this.clearDropIndicators();
        this.draggedItemId = null;
    }

    handleDragOver(e) {
        e.preventDefault();
        
        const dropTargetEl = e.target.closest('[data-id]');
        this.clearDropIndicators();

        if (!dropTargetEl || 
            !this.draggedItemId || 
            parseInt(dropTargetEl.dataset.id, 10) === this.draggedItemId) {
            return;
        }

        const position = this.calculateDropPosition(e, dropTargetEl);
        this.showDropIndicator(dropTargetEl, position);
    }

    handleDragLeave(e) {
        if (!e.currentTarget.contains(e.relatedTarget)) {
            this.clearDropIndicators();
        }
    }

    handleDrop(e) {
        e.preventDefault();
        
        const dropIndicatorEl = document.querySelector('.drop-target-top, .drop-target-bottom, .drop-target-inside');
        if (!dropIndicatorEl || !this.draggedItemId) return;

        const dropTargetId = parseInt(dropIndicatorEl.dataset.id, 10);
        const position = this.getDropPosition(dropIndicatorEl);
        
        this.state.moveItem(this.draggedItemId, dropTargetId, position);
        this.clearDropIndicators();
    }

    calculateDropPosition(e, dropTargetEl) {
        const isGroup = dropTargetEl.classList.contains('group-item');
        const rect = dropTargetEl.getBoundingClientRect();
        const dropZoneHeight = rect.height * 0.25;

        if (isGroup && 
            e.clientY > rect.top + dropZoneHeight && 
            e.clientY < rect.bottom - dropZoneHeight) {
            return 'inside';
        } else if (e.clientY < rect.top + rect.height / 2) {
            return 'before';
        } else {
            return 'after';
        }
    }

    showDropIndicator(element, position) {
        const className = `drop-target-${position === 'before' ? 'top' : position === 'after' ? 'bottom' : 'inside'}`;
        element.classList.add(className);
    }

    getDropPosition(element) {
        if (element.classList.contains('drop-target-inside')) return 'inside';
        if (element.classList.contains('drop-target-top')) return 'before';
        return 'after';
    }

    clearDropIndicators() {
        document.querySelectorAll('.drop-target-top, .drop-target-bottom, .drop-target-inside')
            .forEach(el => {
                el.classList.remove('drop-target-top', 'drop-target-bottom', 'drop-target-inside');
            });
    }
}

// Main Application Class
class PartitionManager {
    constructor() {
        this.state = new AppState();
        this.renderer = new Renderer(this.state);
        this.validator = new LayoutValidator(this.state);
        this.calculator = new LayoutCalculator(this.state);
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
            this.handleFileUpload(e);
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

    handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const yamlData = jsyaml.load(e.target.result);
                this.loadFromParsedYaml(yamlData);
            } catch (error) {
                handleError({
                    ...error,
                    userMessage: `Failed to parse YAML file: ${error.message}`
                }, 'parsing YAML file');
            }
        };

        reader.onerror = () => {
            handleError(new Error('Failed to read file'), 'reading file');
        };

        reader.readAsText(file);
    }

    loadFromParsedYaml(data) {
        try {
            this.state.items = [];
            this.state.nextId = 0;
            
            const tempPartitions = {};
            let hasExternalFlash = false;

            // First pass: Create all partition objects from the flat YAML structure
            for (const name in data) {
                const p = data[name];
                const size = p.size || 0;

                tempPartitions[name] = {
                    id: this.state.nextId++,
                    name: name,
                    address: p.address,
                    size: size,
                    sizeStr: formatSizeForInput(size),
                    region: p.region,
                    device: p.device,
                    spanSource: p.span || p.orig_span,
                    type: 'partition',
                    errors: []
                };

                if (p.region === 'external_flash') {
                    hasExternalFlash = true;
                }
            }

            // Add external_flash region if needed
            if (hasExternalFlash && !this.state.memoryRegions['external_flash']) {
                this.state.addRegion('external_flash', 0x0, 0x800000);
            }

            // Second pass: Identify groups and build the hierarchy
            for (const name in tempPartitions) {
                const partition = tempPartitions[name];
                
                if (partition.spanSource && Array.isArray(partition.spanSource)) {
                    partition.type = 'group';
                    partition.children = [];
                    
                    partition.spanSource.forEach(childName => {
                        const child = tempPartitions[childName];
                        if (child) {
                            partition.children.push(child);
                        }
                    });
                    
                    delete partition.spanSource;
                }
            }

            // Populate state items
            this.state.items = Object.values(tempPartitions).sort((a, b) => {
                if (a.type === 'group' && b.type !== 'group') return 1;
                if (a.type !== 'group' && b.type === 'group') return -1;
                return (a.address || 0) - (b.address || 0);
            });

            // Trigger full recalculation and render
            this.recalculateLayout({ alignSizes: false });
            
            alert('Successfully loaded partitions from pm_static.yml!');
            
        } catch (error) {
            handleError({
                ...error,
                userMessage: `Failed to load YAML data: ${error.message}`
            }, 'loading YAML data');
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

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('Initializing modular partition manager...');
        window.partitionManager = new PartitionManager();
        console.log('Partition manager initialized successfully');
    } catch (error) {
        handleError(error, 'initializing application');
    }
});
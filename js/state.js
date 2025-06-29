import { MCU_DATABASE } from './constants.js';

export class AppState {
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

        // When size changes, unpin subsequent items for recalculation
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

    unpinSubsequentItems(changedItemId) {
        const itemPath = this.findItemPath(changedItemId, this.items, []);
        
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

    findItemPath(targetId, items, currentPath) {
        for (const item of items) {
            const newPath = [...currentPath, item];
            if (item.id === targetId) return newPath;
            
            if (item.children) {
                const foundPath = this.findItemPath(targetId, item.children, newPath);
                if (foundPath) return foundPath;
            }
        }
        return null;
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

    reset() {
        this.items = [];
        this.nextId = 0;
        this.memoryRegions = {};
        this.initializeDefaultRegions();
        this.notify({ type: 'STATE_RESET' });
    }

    getSnapshot() {
        return {
            selectedMcu: this.selectedMcu,
            memoryRegions: { ...this.memoryRegions },
            items: JSON.parse(JSON.stringify(this.items)),
            nextId: this.nextId
        };
    }
}
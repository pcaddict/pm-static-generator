import { collectAllItems } from './utils.js';

export class LayoutValidator {
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

    hasErrors() {
        const allItems = collectAllItems(this.state.items);
        return allItems.some(item => item.errors && item.errors.length > 0);
    }

    getErrorSummary() {
        const allItems = collectAllItems(this.state.items);
        const errors = [];
        
        allItems.forEach(item => {
            if (item.errors && item.errors.length > 0) {
                errors.push({
                    itemName: item.name,
                    itemId: item.id,
                    errors: [...item.errors]
                });
            }
        });
        
        return errors;
    }
}
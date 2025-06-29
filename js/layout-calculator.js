import { FLASH_PAGE_SIZE, MCU_DATABASE } from './constants.js';
import { parseSize, formatSizeForInput, findItemPath, formatBytes } from './utils.js';

export class LayoutCalculator {
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

    unpinSubsequentItems(changedItemId) {
        const itemPath = findItemPath(changedItemId, this.state.items);
        
        if (itemPath && itemPath.length > 0) {
            const topLevelItem = itemPath[0];
            const topLevelIndex = this.state.items.findIndex(i => i.id === topLevelItem.id);

            if (topLevelIndex > -1) {
                for (let i = topLevelIndex + 1; i < this.state.items.length; i++) {
                    const subsequentItem = this.state.items[i];
                    
                    if (subsequentItem.region === topLevelItem.region) {
                        delete subsequentItem.address;
                    }
                }
            }
        }
    }

}
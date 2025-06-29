import { PARTITION_COLORS } from './constants.js';
import { formatHex, formatBytes, sanitizeYamlAnchor, sortItemsForYaml, collectAllItems, createElementWithClass } from './utils.js';

export class Renderer {
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
            const item = createElementWithClass('div', 'region-item');
            
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
        const container = createElementWithClass('div', '', {
            'data-id': item.id
        });
        
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
        const regionEl = createElementWithClass('div', 'memory-region');
        
        const { maxAddress, totalUsedSpace, isOverflowing, freeSpace } = 
            this.calculateRegionUsage(regionName, region);

        const titleEl = this.createRegionTitle(regionName, region, totalUsedSpace, freeSpace, isOverflowing);
        regionEl.appendChild(titleEl);

        const layoutContainer = createElementWithClass('div', 'partition-layout-vertical');
        
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
        const titleEl = createElementWithClass('div', 'memory-region-title');
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
        const headerRow = createElementWithClass('div', 'partition-row header');
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

            const row = createElementWithClass('div', 'partition-row');
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
        const unusedRow = createElementWithClass('div', 'partition-row unused-row');
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
        const sortedItems = sortItemsForYaml(allUniqueItems);
        
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
                    const anchorId = sanitizeYamlAnchor(item.name);
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
}
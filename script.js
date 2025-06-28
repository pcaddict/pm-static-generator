document.addEventListener('DOMContentLoaded', () => {
    // --- 1. DATABASE AND STATE ---
    const mcuDatabase = {
        nrf9160: { name: "nRF9160 SIAA", regions: { flash_primary: { startAddress: 0x0, size: 0x100000 } }, mcubootPadSize: 0x200 },
        nrf52840: { name: "nRF52840", regions: { flash_primary: { startAddress: 0x0, size: 0x100000 } }, mcubootPadSize: 0x200 },
        nrf5340: {
            name: "nRF5340 (Multi-Core)",
            regions: {
                flash_primary: { startAddress: 0x0, size: 0x100000 },        // App Core Flash (1MB)
                sram_primary: { startAddress: 0x20000000, size: 0x80000 },   // App Core SRAM (512KB)
                flash_primary_net: { startAddress: 0x01000000, size: 0x40000 }, // Net Core Flash (256KB)
                sram_primary_net: { startAddress: 0x21000000, size: 0x10000 }  // Net Core SRAM (64KB)
            },
            mcubootPadSize: 0x200
        },
        nrf54l15: { name: "nRF54L15 (Example)", regions: { flash_primary: { startAddress: 0x0, size: 0x180000 } }, mcubootPadSize: 0x800 }
    };
    let state = { selectedMcu: 'nrf9160', memoryRegions: {}, items: [], nextId: 0 };
    const partitionColors = ['#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'];
    const templates = {
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
                // Partitions for the network core must be in its own flash region.
                type: 'group', name: 'mcuboot_primary_net', region: 'flash_primary_net', children: [
                    { type: 'partition', name: 'slot_0_net', sizeStr: '128K' }
                ]
            },
            { type: 'partition', name: 'slot_1_net', sizeStr: '128K', region: 'flash_primary_net' },
            { type: 'partition', name: 'storage', sizeStr: '16K', region: 'flash_primary' },
        ]
    };

    // --- 2. DOM ELEMENTS ---
    const mcuSelector = document.getElementById('mcu-selector');
    const memoryRegionsListEl = document.getElementById('memory-regions-list');
    const addRegionBtn = document.getElementById('add-region-btn');
    const partitionListEl = document.getElementById('partition-list');
    const addPartitionBtn = document.getElementById('add-partition-btn');
    const addGroupBtn = document.getElementById('add-group-btn');
    const graphicalViewEl = document.getElementById('graphical-view');
    const yamlOutputEl = document.getElementById('yaml-output');
    const copyYamlBtn = document.getElementById('copy-yaml-btn');
    const templateSelector = document.getElementById('templates');
    const yamlUploadEl = document.getElementById('yaml-upload');

    // --- 3. HELPER AND LOGIC FUNCTIONS (Using hoisted declarations for stability) ---
    /**
     * Recursively finds an item (and its parent) in the state tree by its ID.
     * @param {number} id The ID of the item to find.
     * @param {Array<Object>} [items=state.items] The array of items to search within.
     * @param {Object|null} [parent=null] The parent of the current items array.
     * @returns {{item: Object, parent: Object|null}|null} An object containing the found item and its parent, or null if not found.
     */
    function findItem(id, items = state.items, parent = null) {
        for (const item of items) {
            if (item.id === id) return { item, parent };
            if (item.children) {
                const found = findItem(id, item.children, item);
                if (found) return found;
            }
        }
        return null;
    }
    /**
     * Parses a size string (e.g., "48K", "0.5M", "0x10000") into a number of bytes.
     * Supports K (kilobytes), M (megabytes), and 0x (hexadecimal) notations.
     * @param {string} sizeStr The string representation of the size.
     * @returns {number} The size in bytes.
     */
    function parseSize(sizeStr) {
        if (!sizeStr) return 0;
        const str = sizeStr.toString().trim();
        const upper = str.toUpperCase();

        // Check for hex format first (e.g., "0x10000")
        if (upper.startsWith('0X')) {
            return parseInt(upper, 16);
        }

        // Fallback to decimal/K/M parsing (e.g., "128K", "1.4M")
        const value = parseFloat(upper);
        if (isNaN(value)) return 0;
        if (upper.includes('M')) return Math.round(value * 1024 * 1024);
        if (upper.includes('K')) return Math.round(value * 1024);
        return Math.round(value);
    }
    /**
     * Formats a number as a hexadecimal string with a "0x" prefix.
     * @param {number} num The number to format.
     * @param {number} [pad=0] The minimum number of digits for the hex value (pads with leading zeros).
     * @returns {string} The formatted hexadecimal string (e.g., "0x001000").
     */
    function formatHex(num, pad = 0) {
        const hex = Number(num || 0).toString(16).toUpperCase();
        return `0x${hex.padStart(pad, '0')}`;
    }
    /**
     * Formats a number of bytes into a human-readable string (e.g., "128 KB", "1.5 MB").
     * @param {number} bytes The number of bytes.
     * @returns {string} The human-readable size string.
     */
    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    /**
     * Formats a number of bytes into a string suitable for the size input field (e.g., "48K", "1M").
     * Prefers K or M notation if the number is an exact multiple.
     * @param {number} bytes The number of bytes.
     * @returns {string} The formatted size string for input fields.
     */
    function formatSizeForInput(bytes) {
        if (!bytes || bytes === 0) return '0';
        const k = 1024;
        const m = 1024 * 1024;
        if (bytes % m === 0) { return (bytes / m) + 'M'; }
        if (bytes % k === 0) { return (bytes / k) + 'K'; }
        return bytes.toString();
    }

    /**
     * Validates the current partition layout.
     * Checks for:
     * 1. Duplicate top-level partition/group names.
     * 2. Partitions that are outside the bounds of their memory region.
     * 3. Overlapping partitions.
     * Errors are stored in the `errors` array of each affected item.
     */
    function validateLayout() {
        // Clear previous errors from all items in the state tree
        const allItems = [];
        function collectAllItems(items) {
            items.forEach(i => {
                i.errors = []; // Clear old errors
                allItems.push(i);
                if (i.children) { collectAllItems(i.children); }
            });
        }
        collectAllItems(state.items);

        // Identify all items that are children of a group. This is needed for both duplicate name and overlap checks.
        const allChildIds = new Set();
        allItems.forEach(item => {
            if (item.type === 'group' && item.children) {
                item.children.forEach(child => allChildIds.add(child.id));
            }
        });

        // Create a map of unique items by name (partitions and groups) for duplicate name check
        const uniqueItemsByName = new Map();
        // Only check for duplicate names among top-level items, as only they become top-level YAML keys.
        // Children within groups do not need unique names globally.
        allItems.filter(item => !allChildIds.has(item.id)).forEach(item => {
            if (item.name) { // Ensure the item has a name to check
                if (uniqueItemsByName.has(item.name)) {
                    const other = uniqueItemsByName.get(item.name);
                    const errorMsg = `Error: Duplicate name '${item.name}'. All top-level item names must be unique.`;
                    if (!item.errors.includes(errorMsg)) item.errors.push(errorMsg);
                    if (!other.errors.includes(errorMsg)) other.errors.push(errorMsg);
                } else {
                    uniqueItemsByName.set(item.name, item);
                }
            }
        });

        // Validate partitions within each memory region
        Object.keys(state.memoryRegions).forEach(regionName => {
            const region = state.memoryRegions[regionName];
            // Only consider "root" items for overlap and bounds checking.
            // Children of groups are contained within their parent's space and don't independently overlap.
            const rootItemsInRegion = Array.from(uniqueItemsByName.values())
                .filter(p => p.region === regionName && p.address !== undefined && !allChildIds.has(p.id));
            rootItemsInRegion.sort((a, b) => a.address - b.address); // Sort by address for overlap checks

            for (let i = 0; i < rootItemsInRegion.length; i++) {
                const p = rootItemsInRegion[i];
                const p_end = p.address + p.size;

                if (p.address < region.startAddress || p_end > (region.startAddress + region.size)) {
                    p.errors.push(`Error: Item '${p.name}' is outside of '${regionName}' bounds.`);
                }
                // Check for overlaps with all subsequent root items
                for (let j = i + 1; j < rootItemsInRegion.length; j++) {
                    const next_p = rootItemsInRegion[j];

                    // A simple check since items are sorted by address
                    if (p_end > next_p.address) {
                        // It's an overlap. Now check if it's a permissible one.
                        // A permissible overlap occurs if one item is a group that logically contains the other.
                        const isPermissible = (container, content) => {
                            if (container.type !== 'group' || !container.children) return false;
                            const containerChildrenIds = new Set(container.children.map(c => c.id));
                            // Case 1: The content item is a direct child of the container group.
                            if (containerChildrenIds.has(content.id)) return true;
                            // Case 2: The content item is a group whose children are a subset of the container's children.
                            if (content.type === 'group' && content.children) {
                                return content.children.every(child => containerChildrenIds.has(child.id));
                            }
                            return false;
                        };

                        if (isPermissible(p, next_p) || isPermissible(next_p, p)) {
                            // This is a logical sub-grouping, so we ignore this overlap.
                            continue;
                        }

                        // If not a permissible overlap, then it's a real error.
                        p.errors.push(`Error: Item '${p.name}' overlaps with '${next_p.name}'.`);
                        next_p.errors.push(`Error: Item '${next_p.name}' overlapped by '${p.name}'.`);
                    }
                }
            }
        });
    }

    /**
     * Recalculates the size and address of every item in the state.
     * This is the core logic function that determines the memory map.
     * It runs in two passes:
     * 1. Precomputes sizes, propagating regions down to children and optionally aligning flash partitions.
     * 2. Calculates addresses, laying out items sequentially within each region.
     * After calculating, it triggers validation and a full re-render.
     * @param {Object} [options={}] - Configuration options for the recalculation.
     * @param {boolean} [options.alignSizes=true] - Whether to align partition sizes in flash to the page size.
     */
    function recalculateLayout(options = {}) {
        const { alignSizes = true } = options;
        const FLASH_PAGE_SIZE = 4096; // Nordic MCUs use 4KB flash pages

        // Pass 1: Precompute sizes and propagate regions down the tree.
        function precompute(items, parentRegion = null) {
            // The `alignSizes` flag is available here from the outer scope.
            items.forEach(item => {
                // A child partition inherits its region from its parent group.
                item.region = item.region || parentRegion;
                if (item.type === 'group') {
                    // Recurse first to calculate child sizes.
                    if (item.children) { precompute(item.children, item.region); }
                    // A group's size is the sum of its children's sizes.
                    item.size = (item.children || []).reduce((sum, child) => sum + (child.size || 0), 0);
                    item.sizeStr = formatBytes(item.size);
                } else {
                    // A partition's size is parsed from its string representation.
                    const parsedSize = parseSize(item.sizeStr);

                    // Partitions in flash_primary should be aligned to 4KB page sizes.
                    // We exclude mcuboot_pad which has a special, non-aligned size.
                    // This alignment should only happen on user edits, not on file import.
                    if (alignSizes && item.region === 'flash_primary' && item.name !== 'mcuboot_pad' && parsedSize > 0) {
                        const alignedSize = Math.ceil(parsedSize / FLASH_PAGE_SIZE) * FLASH_PAGE_SIZE;
                        item.size = alignedSize;
                        // To improve UX, update the string in the input box to reflect the aligned size.
                        if (item.size !== parsedSize) {
                            item.sizeStr = formatSizeForInput(item.size);
                        }
                    } else {
                        item.size = parsedSize;
                    }
                }
            });
        }
        precompute(state.items);

        // Pass 2: Calculate addresses based on sizes and regions.
        Object.keys(state.memoryRegions).forEach(regionName => {
            const region = state.memoryRegions[regionName];
            if (!region) return;
            let currentOffset = region.startAddress || 0;
            const isFlashRegion = regionName.startsWith('flash_');

            // Get all items for the current region.
            const allRegionItems = state.items.filter(item => item.region === regionName);

            // Identify all items that are children of a group within this region.
            const childIdsInRegion = new Set();
            allRegionItems.forEach(item => {
                if (item.type === 'group' && item.children) {
                    item.children.forEach(child => childIdsInRegion.add(child.id));
                }
            });

            // Lay out only the "root" items (those not contained within another group in this region).
            // This prevents double-counting sizes and addresses for shared partitions.
            allRegionItems.filter(item => !childIdsInRegion.has(item.id)).forEach(item => {
                let effectiveAddress = item.address;
                if (effectiveAddress === undefined) { // Only auto-place if address is not manually set
                    let proposedAddress = currentOffset; // Start with the end of the previous item
                    // For flash regions, align the proposed start address of the partition (unless it's mcuboot_pad)
                    if (isFlashRegion && item.name !== 'mcuboot_pad') {
                        proposedAddress = Math.ceil(proposedAddress / FLASH_PAGE_SIZE) * FLASH_PAGE_SIZE;
                    }
                    effectiveAddress = proposedAddress;
                }

                item.address = effectiveAddress;

                currentOffset = item.address + item.size; // Update currentOffset for the next item
                // If the item is a group, we must also calculate the addresses for its children.
                if (item.type === 'group' && item.children) {
                    let childOffset = item.address;
                    item.children.forEach(child => {
                        // THE FIX: Ensure children inherit the parent's region and calculate their address.
                        child.region = item.region;
                        child.address = childOffset;
                        childOffset += child.size;
                    });
                }
            });
        });
        validateLayout();
        renderAll(); // Render everything with new layout and validation info
    }

    /**
     * Adds a new item (partition or group) to the state. Can be called recursively for groups.
     * @param {Object} itemData The data for the new item (e.g., { type, name, sizeStr }).
     * @param {number|null} [parentId=null] The ID of the parent group to add this item to. If null, adds to the root.
     * @param {boolean} [recalculate=true] Whether to trigger a layout recalculation after adding.
     */
    function addItem(itemData, parentId = null, recalculate = true) {
        const newItem = { ...itemData, id: state.nextId++ };

        // Enforce the correct size for mcuboot_pad based on the selected MCU.
        if (newItem.name === 'mcuboot_pad') {
            newItem.sizeStr = mcuDatabase[state.selectedMcu].mcubootPadSize.toString();
        }

        const childrenFromTemplate = newItem.children;
        if (newItem.type === 'group') {
            newItem.children = []; // Ensure children array exists for groups.
        } else {
            delete newItem.children; // Partitions can't have children.
        }

        if (parentId === null) {
            state.items.push(newItem);
        } else {
            const result = findItem(parentId);
            if (result && result.item.type === 'group') {
                result.item.children = result.item.children || [];
                result.item.children.push(newItem);
            }
        }

        // If the template data had children, add them recursively without recalculating layout yet.
        if (childrenFromTemplate) {
            childrenFromTemplate.forEach(childData => addItem(childData, newItem.id, false));
        }

        if (recalculate) { recalculateLayout(); }
    }
    /**
     * Removes an item (and its children, if it's a group) from the state by its ID.
     * @param {number} id The ID of the item to remove.
     */
    function removeItem(id) {
        const result = findItem(id);
        if (!result) return;
        const list = result.parent ? result.parent.children : state.items;
        const index = list.findIndex(i => i.id === id);
        if (index > -1) { list.splice(index, 1); }
        recalculateLayout();
    }
    /**
     * Updates a property of an item in the state.
     * Triggers a layout recalculation after the update.
     * Special logic handles un-pinning subsequent items when a size changes,
     * and auto-updating size when an item is renamed to 'mcuboot_pad'.
     * @param {number} id The ID of the item to update.
     * @param {string} key The property key to update (e.g., 'name', 'sizeStr').
     * @param {string|any} value The new value for the property.
     */
    function updateItem(id, key, value) {
        const result = findItem(id);
        if (result) {
            if (key === 'span') { result.item[key] = value.split(',').map(s => s.trim()).filter(Boolean); }
            else { result.item[key] = value; }

            // When a size changes, we must "un-pin" subsequent items so their addresses are recalculated.
            // We do this by deleting their `address` property, so `recalculateLayout` will auto-place them.
            if (key === 'sizeStr') {
                // First, find the path from the root to the changed item to identify its top-level ancestor.
                function findPath(id, items, currentPath) {
                    for (const item of items) {
                        const newPath = [...currentPath, item];
                        if (item.id === id) return newPath;
                        if (item.children) {
                            const foundPath = findPath(id, item.children, newPath);
                            if (foundPath) return foundPath;
                        }
                    }
                    return null;
                }
                const itemPath = findPath(id, state.items, []);

                if (itemPath && itemPath.length > 0) {
                    const topLevelItem = itemPath[0];
                    const topLevelIndex = state.items.findIndex(i => i.id === topLevelItem.id);

                    if (topLevelIndex > -1) {
                        // Iterate through all top-level items that come *after* the one that was changed.
                        for (let i = topLevelIndex + 1; i < state.items.length; i++) {
                            const subsequentItem = state.items[i];
                            // Only un-pin items in the same memory region.
                            if (subsequentItem.region === topLevelItem.region) {
                                delete subsequentItem.address; // Un-pin the item itself.
                            }
                        }
                    }
                }
            }

            // THE CORE FIX: If an item is renamed to mcuboot_pad, immediately fix its size.
            if (key === 'name' && value === 'mcuboot_pad') {
                result.item.sizeStr = mcuDatabase[state.selectedMcu].mcubootPadSize.toString();
            }
            recalculateLayout();
        }
    }

    /**
     * Adds a new memory region to the state.
     * @param {string} name The unique name for the region (e.g., 'external_flash').
     * @param {number} startAddress The starting address of the region.
     * @param {number} size The total size of the region in bytes.
     * @param {boolean} [isDefault=false] Whether this is a default region for the MCU (cannot be deleted).
     */
    function addRegion(name, startAddress, size, isDefault = false) {
        if (state.memoryRegions[name]) { return; }
        state.memoryRegions[name] = { startAddress, size, isDefault };
    }
    /**
     * Removes a custom (non-default) memory region from the state.
     * @param {string} name The name of the region to remove.
     */
    function removeRegion(name) {
        if (state.memoryRegions[name] && !state.memoryRegions[name].isDefault) {
            delete state.memoryRegions[name];
            recalculateLayout();
        }
    }
    /**
     * Updates a property (startAddress or size) of a memory region.
     * @param {string} name The name of the region to update.
     * @param {string} key The property to update ('startAddress' or 'size').
     * @param {string} value The new value (as a string, will be parsed).
     */
    function updateRegion(name, key, value) {
        const region = state.memoryRegions[name];
        if (region) {
            const newValue = parseSize(value);
            if (!isNaN(newValue)) { region[key] = newValue; }
            recalculateLayout();
        }
    }
    /**
     * Clears the current state and loads a predefined partition template.
     * Automatically adds the 'external_flash' region if the template requires it.
     * @param {string} templateName The key of the template to load from the `templates` object.
     */
    function loadTemplate(templateName) {
        state.items = [];
        state.nextId = 0;
        const template = templates[templateName];
        if (template) {
            template.forEach(itemData => {
                // When a template needs a region that doesn't exist (e.g., external_flash), create it.
                // Non-primary regions should default to a starting address of 0x0.
                if (itemData.region === 'external_flash' && !state.memoryRegions['external_flash']) {
                    addRegion('external_flash', 0x0, 0x800000);
                }
            });
            // Add items recursively from the template, but only trigger one final recalculation.
            template.forEach(itemData => addItem(itemData, null, false));
        }
        recalculateLayout(); // Recalculate layout once after all template items are added.
    }
    /**
     * Changes the selected MCU. This clears and reloads the default memory regions
     * for the new MCU, while preserving any custom-added regions.
     * @param {string} mcuKey The key of the MCU from the `mcuDatabase`.
     */
    function updateMcu(mcuKey) {
        state.selectedMcu = mcuKey;
        const customRegions = {};
        Object.keys(state.memoryRegions).forEach(name => {
            if (state.memoryRegions[name] && !state.memoryRegions[name].isDefault) { customRegions[name] = state.memoryRegions[name]; }
        });
        state.memoryRegions = {};
        const defaultRegions = mcuDatabase[mcuKey].regions;
        Object.keys(defaultRegions).forEach(name => { addRegion(name, defaultRegions[name].startAddress, defaultRegions[name].size, true); });
        Object.keys(customRegions).forEach(name => { state.memoryRegions[name] = customRegions[name]; });
        recalculateLayout();
    }
    /**
     * Loads and reconstructs the application state from a parsed YAML object.
     * This function handles the logic of converting the flat structure of pm_static.yml
     * (where groups are defined by 'span') into the hierarchical state tree used by the tool.
     * @param {Object} data The JavaScript object parsed from a pm_static.yml file.
     */
    function loadFromParsedYaml(data) {
        state.items = [];
        state.nextId = 0;
        let tempPartitions = {};
        let hasExternalFlash = false;

        // First pass: Create all partition objects from the flat YAML structure
        for (const name in data) {
            const p = data[name];
            const size = p.size || 0; // js-yaml already parses hex values to numbers.

            tempPartitions[name] = {
                id: state.nextId++,
                name: name,
                address: p.address, // js-yaml already parses hex values to numbers.
                size: size,
                sizeStr: formatSizeForInput(size),
                region: p.region,
                device: p.device,
                spanSource: p.span || p.orig_span, // Use span, fallback to orig_span
                type: 'partition' // Default to partition
            };

            if (p.region === 'external_flash') {
                hasExternalFlash = true;
            }
        }

        // If external_flash partitions exist but the region doesn't, create it with a starting address of 0x0.
        if (hasExternalFlash && !state.memoryRegions['external_flash']) {
            addRegion('external_flash', 0x0, 0x800000); // Add with default values, starting at 0x0
        }

        // Second pass: Identify groups and build the hierarchy.
        // All items in tempPartitions are candidates for state.items.
        // Groups will have their `type` changed and `children` populated with references.
        for (const name in tempPartitions) {
            const p = tempPartitions[name];
            if (p.spanSource && Array.isArray(p.spanSource)) {
                p.type = 'group';
                p.children = [];
                p.spanSource.forEach(childName => {
                    const child = tempPartitions[childName];
                    if (child) {
                        p.children.push(child);
                    }
                });
                delete p.spanSource; // This is now represented by the children array
            }
        }

        // Now, state.items should contain ALL unique partitions and groups from the YAML.
        state.items = Object.values(tempPartitions).sort((a, b) => {
            if (a.type === 'group' && b.type !== 'group') return 1;
            if (a.type !== 'group' && b.type === 'group') return -1;
            return (a.address || 0) - (b.address || 0);
        });
        recalculateLayout({ alignSizes: false }); // On import, preserve exact sizes from file.
        alert('Successfully loaded partitions from pm_static.yml!');
    }
    /**
     * Handles the file upload event for a `pm_static.yml` file.
     * Reads the file, parses it using js-yaml, and passes the data to `loadFromParsedYaml`.
     * @param {Event} e The file input change event.
     */
    function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try { loadFromParsedYaml(jsyaml.load(event.target.result)); }
            catch (err) { alert(`Failed to parse YAML file: ${err.message}`); }
        };
        reader.readAsText(file);
    }

    // --- Rendering Functions ---
    /**
     * A master function that calls all other render functions to update the entire UI.
     * This should be called after any state change that affects the display.
     */
    function renderAll() {
        renderMemoryRegionsList();
        renderPartitionList();
        renderGraphicalView();
        renderYaml();
    }
    /**
     * Renders the list of memory regions in the UI, including their name, start address, and size.
     * Binds data attributes for event handling.
     */
    function renderMemoryRegionsList() {
        const fragment = document.createDocumentFragment();
        Object.keys(state.memoryRegions).forEach(name => {
            const region = state.memoryRegions[name];
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
        memoryRegionsListEl.replaceChildren(fragment);
    }
    /**
     * Renders the hierarchical list of partitions and groups in the UI.
     * It creates input fields for name, size, region, etc., and includes action buttons.
     * It correctly handles rendering nested children within groups.
     */
    function renderPartitionList() {
        const fragment = document.createDocumentFragment();
        const regionOptions = Object.keys(state.memoryRegions).map(name => `<option value="${name}">${name}</option>`).join('');

        function renderItem(item, isChild) {
            const isGroup = item.type === 'group';
            const isPad = item.name === 'mcuboot_pad';
            const container = document.createElement('div');
            container.dataset.id = item.id;
            container.className = isGroup ? 'group-item' : (isChild ? 'child-partition-item' : 'partition-item');
            if (item.errors && item.errors.length > 0) {
                container.classList.add('has-error');
            }

            const regionSelector = !isChild ? `<select data-id="${item.id}" data-key="region" class="item-input">${regionOptions}</select>` : '<div></div>';
            const deviceInput = isGroup ? '<div></div>' : `<input type="text" value="${item.device || ''}" data-id="${item.id}" data-key="device" class="item-input" placeholder="Device">`;
            const spanInput = isGroup ? '<div></div>' : `<input type="text" value="${(item.span || []).join(', ')}" data-id="${item.id}" data-key="span" class="item-input" placeholder="Spanned by">`;
            const sizeInput = `<input type="text" value="${item.sizeStr || ''}" data-id="${item.id}" data-key="sizeStr" class="item-input" placeholder="Size" ${(isGroup || isPad) ? 'readonly' : ''}>`;
            const errorIcon = (item.errors && item.errors.length > 0)
                ? `<span class="item-error-icon" title="${item.errors.join('\n')}">⚠️</span>`
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
            fragment.appendChild(container);
            if (!isChild) {
                const regionSelect = container.querySelector(`select[data-key="region"]`);
                if (regionSelect) regionSelect.value = item.region;
            }
            if (item.children) { item.children.forEach(child => renderItem(child, true)); }
        }

        // To prevent rendering duplicate items in the list (e.g., a partition that is a child of multiple groups),
        // we first identify all items that are children.
        const allChildIds = new Set();
        state.items.forEach(item => {
            if (item.type === 'group' && item.children) {
                item.children.forEach(child => allChildIds.add(child.id));
            }
        });

        // Then, we only render the "root" items (those not contained within any group).
        state.items.filter(item => !allChildIds.has(item.id)).forEach(item => renderItem(item, false));
        partitionListEl.replaceChildren(fragment);
    }
    /**
     * Renders the visual block representation of the memory layout for each region.
     * It displays partitions as colored blocks, showing their name, address range, and size.
     * It also calculates and displays used, free, and overflow space for each region.
     */
    function renderGraphicalView() {
        const fragment = document.createDocumentFragment();
        Object.keys(state.memoryRegions).forEach(regionName => {
            const region = state.memoryRegions[regionName];
            if (!region) return;

            const regionEl = document.createElement('div');
            regionEl.className = 'memory-region';

            // --- Title ---
            // To correctly calculate used space, we must find the highest address reached by any partition.
            // This accounts for gaps caused by alignment.
            let maxAddress = region.startAddress;
            function findMaxAddress(items) {
                items.forEach(item => {
                    // Only consider items within the current region
                    if (item.region === regionName) {
                        if (item.address !== undefined && item.size > 0) {
                            maxAddress = Math.max(maxAddress, item.address + item.size);
                        }
                        // Recurse into children, as they might be in the same region
                        if (item.children) {
                            findMaxAddress(item.children);
                        }
                    }
                });
            }
            findMaxAddress(state.items); // Search through all items to find ones in this region

            const totalUsedSpace = maxAddress - region.startAddress;
            const isOverflowing = totalUsedSpace > region.size;
            const freeSpace = Math.max(0, region.size - totalUsedSpace);
            const titleEl = document.createElement('div');
            titleEl.className = 'memory-region-title';
            titleEl.innerHTML = `<span>${regionName} (Total: ${formatBytes(region.size)})</span>`;
            if (isOverflowing) {
                const overflowAmount = totalUsedSpace - region.size;
                titleEl.innerHTML += `<span class="overflow-warning">OVERFLOW: ${formatBytes(overflowAmount)}</span>`;
            } else {
                titleEl.innerHTML += `<span>Used: ${formatBytes(totalUsedSpace)}, Free: ${formatBytes(freeSpace)}</span>`;
            }
            regionEl.appendChild(titleEl);

            // --- Vertical Layout Container ---
            const layoutContainer = document.createElement('div');
            layoutContainer.className = 'partition-layout-vertical';

            // --- Header Row ---
            const headerRow = document.createElement('div');
            headerRow.className = 'partition-row header';
            headerRow.innerHTML = `
                <div class="part-name">Name</div>
                <div class="part-addr">Address Range</div>
                <div class="part-size">Size</div>
            `;
            layoutContainer.appendChild(headerRow);

            // --- Recursive function to render each item as a row ---
            function renderItemRow(item, isChild, colorIndex) {
                if (!item.size && item.type !== 'group') return; // Don't render zero-size partitions, but show empty groups

                const row = document.createElement('div');
                row.className = 'partition-row';
                if (isChild) row.classList.add('child-row');
                if (item.type === 'group') row.classList.add('group-row');
                row.style.borderLeftColor = partitionColors[colorIndex % partitionColors.length];

                // For an inclusive range, the end address is start + size - 1.
                // This handles the edge case where size is 0.
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
            }

            // To render the layout correctly, we only iterate over "root" items for this region.
            // A root item is one that is not a child of another group in this same region.
            const regionItems = state.items.filter(p => p.region === regionName);
            const childIdsInRegion = new Set();
            regionItems.forEach(item => {
                if (item.type === 'group' && item.children) {
                    item.children.forEach(child => childIdsInRegion.add(child.id));
                }
            });
            const rootRegionItems = regionItems.filter(item => !childIdsInRegion.has(item.id));

            // Start the recursive rendering from the root items.
            rootRegionItems.forEach((item, index) => renderItemRow(item, false, index));

            // --- Unused Space Row ---
            if (!isOverflowing && freeSpace > 0) {
                const unusedRow = document.createElement('div');
                unusedRow.className = 'partition-row unused-row';
                const startAddr = maxAddress; // The unused space starts where the last partition ended.
                const endAddr = region.startAddress + region.size - 1;
                unusedRow.innerHTML = `
                    <div class="part-name">Unused</div>
                    <div class="part-addr">${formatHex(startAddr, 6)} - ${formatHex(endAddr, 6)}</div>
                    <div class="part-size">${formatBytes(freeSpace)} (${formatHex(freeSpace)})</div>
                `;
                layoutContainer.appendChild(unusedRow);
            }

            regionEl.appendChild(layoutContainer);
            fragment.appendChild(regionEl);
        });
        graphicalViewEl.replaceChildren(fragment);
    }
    /**
     * Generates and renders the final `pm_static.yml` output in the text area.
     * It flattens the hierarchical state, sorts items correctly, and formats them
     * according to YAML syntax, including the use of YAML anchors for `span`.
     */
    function renderYaml() {
        let yamlString = '';
        const allUniqueItems = [];
        const uniqueNames = new Set(); // To track unique partition names added to allUniqueItems

        // Helper to flatten the state.items structure into a list of unique items for YAML output.
        // Ensures each partition name appears only once, and all groups are included.
        function collectUniqueItems(items) {
            items.forEach(item => {
                // If it's a group, always add it (groups are top-level in YAML).
                // If it's a partition, only add it if its name hasn't been added yet.
                if (item.type === 'group' || !uniqueNames.has(item.name)) {
                    allUniqueItems.push(item);
                    uniqueNames.add(item.name);
                }

                // Recursively collect children, but only for groups.
                if (item.type === 'group' && item.children) {
                    collectUniqueItems(item.children);
                }
            });
        }
        collectUniqueItems(state.items);

        // Sort the collected items to match standard pm_static.yml formatting.
        allUniqueItems.sort((a, b) => {
            // Primary sort: by region. 'flash_primary' always comes first.
            const regionOrder = (region) => {
                if (region === 'flash_primary') return 0;
                if (region === 'external_flash') return 1;
                return 2; // Other custom regions
            };
            const aRegionOrder = regionOrder(a.region);
            const bRegionOrder = regionOrder(b.region);
            if (aRegionOrder !== bRegionOrder) { return aRegionOrder - bRegionOrder; }
            if (aRegionOrder > 1 && a.region !== b.region) { return a.region.localeCompare(b.region); }

            // Secondary sort: by address.
            const aAddr = a.address !== undefined ? a.address : Infinity;
            const bAddr = b.address !== undefined ? b.address : Infinity;
            if (aAddr !== bAddr) { return aAddr - bAddr; }

            // Tertiary sort (tie-breaker): partitions before groups.
            if (a.type === 'partition' && b.type === 'group') return -1;
            if (a.type === 'group' && b.type === 'partition') return 1;
            return 0;
        });

        // Generate YAML for each unique item.
        allUniqueItems.forEach(item => {
            if (!item.name) return; // Skip items without a name.
            yamlString += `${item.name}:\n`;

            // All items (partitions and groups) get an address and region.
            if (item.address !== undefined) {
                yamlString += `  address: ${formatHex(item.address)}\n`;
            }
            if (item.region) {
                yamlString += `  region: ${item.region}\n`;
            }

            // All items get a size.
            if (item.size) {
                yamlString += `  size: ${formatHex(item.size)}\n`;
            }
            if (item.device) {
                yamlString += `  device: ${item.device}\n`;
            }

            // The 'span' property has different meanings for groups vs. partitions.
            if (item.type === 'group') {
                const childrenNames = (item.children || []).map(c => c.name).filter(Boolean);
                if (childrenNames.length > 0) {
                    // Use the group's name for a more descriptive YAML anchor. Sanitize it for YAML syntax.
                    const anchorId = (item.name || 'group').replace(/[^a-zA-Z0-9_]/g, '_') + '_span_def';
                    yamlString += `  orig_span: &${anchorId}\n`;
                    childrenNames.forEach(name => {
                        yamlString += `  - ${name}\n`;
                    });
                    yamlString += `  span: *${anchorId}\n`;
                }
            } else if (item.span && item.span.length > 0) { // 'partition' type
                yamlString += `  span: [${item.span.join(', ')}]\n`;
            }
            yamlString += `\n`;
        });
        yamlOutputEl.textContent = yamlString.trim();
    }

    // --- 4. INITIALIZATION ---
    /**
     * Initializes the application.
     * Populates UI selectors (MCUs, Templates), sets up all event listeners for user interaction
     * (clicks, changes, drag-and-drop), and loads the default MCU and template.
     */
    function init() {
        Object.keys(templates).forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            templateSelector.appendChild(option);
        });
        Object.keys(mcuDatabase).forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = mcuDatabase[key].name;
            mcuSelector.appendChild(option);
        });

        const loadDefaultTemplateForMcu = (mcuKey) => {
            if (mcuKey === 'nrf5340') {
                loadTemplate('nrf5340_multi');
                templateSelector.value = 'nrf5340_multi';
            } else {
                loadTemplate('fota');
                templateSelector.value = 'fota';
            }
        };

        mcuSelector.addEventListener('change', (e) => {
            const mcuKey = e.target.value;
            updateMcu(mcuKey);
            loadDefaultTemplateForMcu(mcuKey);
        });
        templateSelector.addEventListener('change', e => loadTemplate(e.target.value));
        copyYamlBtn.addEventListener('click', () => navigator.clipboard.writeText(yamlOutputEl.textContent).then(() => alert('YAML copied!')));

        partitionListEl.addEventListener('click', (e) => {
            const target = e.target;
            const id = target.dataset.id ? parseInt(target.dataset.id, 10) : null;
            if (target.classList.contains('remove-item-btn')) { removeItem(id); }
            if (target.classList.contains('add-child-btn')) { addItem({ type: 'partition', name: 'new_partition', sizeStr: '16K' }, id); }
        });
        partitionListEl.addEventListener('change', (e) => {
            const target = e.target;
            if (target.classList.contains('item-input')) {
                const id = parseInt(target.dataset.id, 10);
                const key = target.dataset.key;
                updateItem(id, key, target.value);
            }
        });

        yamlUploadEl.addEventListener('change', handleFileUpload);
        addPartitionBtn.addEventListener('click', () => { addItem({ type: 'partition', name: 'new_partition', sizeStr: '128K', region: Object.keys(state.memoryRegions)[0] }); });
        addGroupBtn.addEventListener('click', () => { addItem({ type: 'group', name: 'new_group', region: Object.keys(state.memoryRegions)[0], children: [] }); });

        memoryRegionsListEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-region-btn')) { removeRegion(e.target.dataset.name); }
        });
        memoryRegionsListEl.addEventListener('change', (e) => {
            if (e.target.classList.contains('region-input')) {
                const name = e.target.dataset.name;
                if (e.target.dataset.key !== 'name' && name) { updateRegion(name, e.target.dataset.key, e.target.value); }
            }
        });

        let draggedItemId = null;
        partitionListEl.addEventListener('dragstart', (e) => {
            if (!e.target.classList.contains('drag-handle')) {
                e.preventDefault();
                return;
            }
            const dragTarget = e.target.closest('[data-id]');
            if (dragTarget) {
                draggedItemId = parseInt(dragTarget.dataset.id, 10);
                e.dataTransfer.setData('text/plain', draggedItemId);
                setTimeout(() => { dragTarget.classList.add('dragging'); }, 0);
            }
        });
        partitionListEl.addEventListener('dragend', () => {
            const draggingEl = partitionListEl.querySelector('.dragging');
            if (draggingEl) draggingEl.classList.remove('dragging');
            draggedItemId = null;
        });
        partitionListEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            const dropTarget = e.target.closest('[data-id]');
            document.querySelectorAll('.drop-target-top, .drop-target-bottom').forEach(el => el.classList.remove('drop-target-top', 'drop-target-bottom'));
            if (!dropTarget || parseInt(dropTarget.dataset.id, 10) === draggedItemId) return;
            const rect = dropTarget.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            if (e.clientY < midpoint) { dropTarget.classList.add('drop-target-top'); }
            else { dropTarget.classList.add('drop-target-bottom'); }
        });
        partitionListEl.addEventListener('dragleave', (e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
                document.querySelectorAll('.drop-target-top, .drop-target-bottom').forEach(el => el.classList.remove('drop-target-top', 'drop-target-bottom'));
            }
        });
        partitionListEl.addEventListener('drop', (e) => {
            e.preventDefault();
            const dropTargetEl = document.querySelector('.drop-target-top, .drop-target-bottom');
            if (!dropTargetEl || !draggedItemId) return;
            const dropTargetId = parseInt(dropTargetEl.dataset.id, 10);
            const dropOnTop = dropTargetEl.classList.contains('drop-target-top');
            dropTargetEl.classList.remove('drop-target-top', 'drop-target-bottom');
            const dragged = findItem(draggedItemId);
            const dropTarget = findItem(dropTargetId);
            if (!dragged || !dropTarget || dragged.item === dropTarget.item || dragged.parent !== dropTarget.parent) return;
            const list = dragged.parent ? dragged.parent.children : state.items;
            const [draggedItem] = list.splice(list.findIndex(i => i.id === draggedItemId), 1);
            const dropIndex = list.findIndex(i => i.id === dropTargetId);
            list.splice(dropOnTop ? dropIndex : dropIndex + 1, 0, draggedItem);
            recalculateLayout();
        });

        mcuSelector.value = state.selectedMcu;
        updateMcu(state.selectedMcu);
        loadDefaultTemplateForMcu(state.selectedMcu);
    }

    // --- 5. START THE APP ---
    init();
});

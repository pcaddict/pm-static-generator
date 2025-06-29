import { BYTES_SIZES, BYTES_MULTIPLIER } from './constants.js';

export function parseSize(sizeStr) {
    if (!sizeStr) return 0;
    
    const str = sizeStr.toString().trim();
    const upper = str.toUpperCase();

    if (upper.startsWith('0X')) {
        return parseInt(upper, 16);
    }

    const value = parseFloat(upper);
    if (isNaN(value)) return 0;
    
    if (upper.includes('M')) return Math.round(value * BYTES_MULTIPLIER * BYTES_MULTIPLIER);
    if (upper.includes('K')) return Math.round(value * BYTES_MULTIPLIER);
    return Math.round(value);
}

export function formatHex(num, pad = 0) {
    const hex = Number(num || 0).toString(16).toUpperCase();
    return `0x${hex.padStart(pad, '0')}`;
}

export function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    
    const k = BYTES_MULTIPLIER;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + BYTES_SIZES[i];
}

export function formatSizeForInput(bytes) {
    if (!bytes || bytes === 0) return '0';
    
    const k = BYTES_MULTIPLIER;
    const m = k * k;
    
    if (bytes % m === 0) return (bytes / m) + 'M';
    if (bytes % k === 0) return (bytes / k) + 'K';
    return bytes.toString();
}

export function debounce(func, wait) {
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

export function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

export function sanitizeYamlAnchor(name) {
    return (name || 'group').replace(/[^a-zA-Z0-9_]/g, '_') + '_span_def';
}

export function collectAllItems(items, callback) {
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

export function findItemPath(targetId, items, currentPath = []) {
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

export function sortItemsForYaml(items) {
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

export function validateInput(value, type) {
    switch (type) {
        case 'size':
            return parseSize(value) > 0;
        case 'hex':
            return /^0x[0-9a-fA-F]+$/.test(value) || !isNaN(parseInt(value, 16));
        case 'name':
            return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value);
        default:
            return true;
    }
}

export function createElementWithClass(tag, className, attributes = {}) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    
    Object.entries(attributes).forEach(([key, value]) => {
        if (key === 'textContent') {
            element.textContent = value;
        } else if (key.startsWith('data-')) {
            element.setAttribute(key, value);
        } else {
            element[key] = value;
        }
    });
    
    return element;
}

export function handleError(error, context = '') {
    console.error(`Error ${context}:`, error);
    
    const userMessage = error.userMessage || 
        `An error occurred ${context}. Please check the console for details.`;
    
    if (typeof window !== 'undefined') {
        alert(userMessage);
    }
    
    return { success: false, error: error.message };
}
import { formatSizeForInput, handleError } from './utils.js';

export class FileHandler {
    constructor(state) {
        this.state = state;
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
            // Reset state
            this.state.items = [];
            this.state.nextId = 0;
            
            const tempPartitions = {};
            let hasExternalFlash = false;

            this.createPartitionsFromYaml(data, tempPartitions);
            
            hasExternalFlash = this.checkForExternalFlash(tempPartitions);
            
            if (hasExternalFlash && !this.state.memoryRegions['external_flash']) {
                this.state.addRegion('external_flash', 0x0, 0x800000);
            }

            this.buildHierarchy(tempPartitions);
            this.populateStateItems(tempPartitions);
            
            // Notify with recalculation flag to preserve exact sizes from file
            this.state.notify({ type: 'YAML_LOADED', payload: { data, alignSizes: false } });
            alert('Successfully loaded partitions from pm_static.yml!');
            
        } catch (error) {
            handleError({
                ...error,
                userMessage: `Failed to load YAML data: ${error.message}`
            }, 'loading YAML data');
        }
    }

    createPartitionsFromYaml(data, tempPartitions) {
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
        }
    }

    checkForExternalFlash(tempPartitions) {
        return Object.values(tempPartitions).some(p => p.region === 'external_flash');
    }

    buildHierarchy(tempPartitions) {
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
    }

    populateStateItems(tempPartitions) {
        this.state.items = Object.values(tempPartitions).sort((a, b) => {
            if (a.type === 'group' && b.type !== 'group') return 1;
            if (a.type !== 'group' && b.type === 'group') return -1;
            return (a.address || 0) - (b.address || 0);
        });
    }
}
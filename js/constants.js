export const FLASH_PAGE_SIZE = 4096;

export const MCU_DATABASE = {
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

export const PARTITION_COLORS = [
    '#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f', 
    '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'
];

export const TEMPLATES = {
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

export const DEFAULT_EXTERNAL_FLASH_SIZE = 0x800000;
export const BYTES_SIZES = ['B', 'KB', 'MB', 'GB'];
export const BYTES_MULTIPLIER = 1024;
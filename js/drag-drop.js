export class DragDropHandler {
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
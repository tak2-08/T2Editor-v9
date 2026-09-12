// T2Editor/plugin/table/table.js

class T2TablePlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['insertTable'];
    }

    handleCommand(command, button) {
        switch(command) {
            case 'insertTable':
                this.showTableModal();
                break;
        }
    }

    handlePaste(clipboardData) {
        const htmlText = clipboardData.getData('text/html');
        
        if (htmlText && htmlText.includes('<table')) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlText;
            
            const tables = tempDiv.querySelectorAll('table');
            tables.forEach(origTable => {
                const table = origTable.cloneNode(true);
                table.className = 't2-table';
                table.setAttribute('data-t2-table', 'true');
                table.style.width = '100%';
                table.style.borderCollapse = 'collapse';
                
                const cells = table.querySelectorAll('td, th');
                cells.forEach(cell => {
                    cell.style.border = '1px solid #ccc';
                    cell.style.padding = '8px';
                    if (cell.tagName === 'TH') {
                        cell.style.backgroundColor = '#f5f5f5';
                    }
                });
                
                const tableWrapper = this.createTableWrapper(table);
                this.insertTableWithLineBreaks(tableWrapper);
            });
            
            this.editor.normalizeContent();
            
            if (this.editor.collab) {
                this.editor.collab.recordChange();
            } else {
                this.editor.createUndoPoint();
            }
            
            return true;
        }
        
        return false;
    }

    onContentSet(html) {
        console.log('Table plugin: onContentSet called');
        setTimeout(() => {
            this.initializeTableBlocks();
        }, 50);
    }

    showTableModal() {
        const modalContent = `
            <div class="t2-table-editor-modal">
                <h3>테이블 삽입</h3>
                <div class="t2-table-size-selector">
                    <div class="t2-table-size-inputs">
                        <div class="t2-table-input-group">
                            <label>가로 셀 수:</label>
                            <div class="t2-input-with-controls">
                                <button class="t2-btn t2-table-control-btn" data-action="decrease-cols">
                                    <span class="material-icons">remove</span>
                                </button>
                                <input type="number" class="t2-table-cols" value="3" min="1" max="30">
                                <button class="t2-btn t2-table-control-btn" data-action="increase-cols">
                                    <span class="material-icons">add</span>
                                </button>
                            </div>
                        </div>
                        <div class="t2-table-input-group">
                            <label>세로 셀 수:</label>
                            <div class="t2-input-with-controls">
                                <button class="t2-btn t2-table-control-btn" data-action="decrease-rows">
                                    <span class="material-icons">remove</span>
                                </button>
                                <input type="number" class="t2-table-rows" value="3" min="1" max="30">
                                <button class="t2-btn t2-table-control-btn" data-action="increase-rows">
                                    <span class="material-icons">add</span>
                                </button>
                            </div>
                        </div>
                        <div class="t2-table-warning" style="display: none; color: #e67e22; margin-top: 10px; font-size: 13px;">
                            <span class="material-icons" style="font-size: 16px; vertical-align: middle;">warning</span>
                            큰 테이블은 가로 스크롤이 생성됩니다.
                        </div>
                    </div>
                    <div class="t2-table-preview-container" style="width: 160px; height: 160px; overflow: hidden; border: 1px solid #ddd; border-radius: 4px;">
                        <div class="t2-table-preview" style="transform-origin: top left;"></div>
                    </div>
                </div>
                <div class="t2-table-style-options">
                    <div class="t2-table-style-option">
                        <p>테이블 너비:&nbsp;</p>
                        <select class="t2-table-width">
                            <option value="100%">100% (전체)</option>
                            <option value="75%">75%</option>
                            <option value="50%">50%</option>
                            <option value="custom">직접 입력</option>
                        </select>
                        <div class="t2-custom-width-container" style="display: none;">
                            <input type="number" class="t2-custom-width-value" value="100" min="10" max="100">
                            <span>%</span>
                        </div>
                    </div>
                    <div class="t2-table-style-option">
                        <p>테두리 스타일:&nbsp;</p>
                        <select class="t2-table-border-style">
                            <option value="solid">실선</option>
                            <option value="dashed">점선</option>
                            <option value="dotted">점선 (원형)</option>
                            <option value="double">이중선</option>
                        </select>
                    </div>
                </div>
                <div class="t2-btn-group">
                    <button class="t2-btn" data-action="cancel">취소</button>
                    <button class="t2-btn" data-action="insert">삽입</button>
                </div>
            </div>
        `;

        const modal = T2Utils.createModal(modalContent);
        this.setupTableModalEvents(modal);
    }

    setupTableModalEvents(modal) {
        const previewContainer = modal.querySelector('.t2-table-preview');
        const colsInput = modal.querySelector('.t2-table-cols');
        const rowsInput = modal.querySelector('.t2-table-rows');
        const tableWidthSelect = modal.querySelector('.t2-table-width');
        const customWidthContainer = modal.querySelector('.t2-custom-width-container');
        const customWidthInput = modal.querySelector('.t2-custom-width-value');
        const tableWarning = modal.querySelector('.t2-table-warning');

        const closeModal = () => {
            const modalOverlay = document.querySelector('.t2-modal-overlay');
            if (modalOverlay) {
                modalOverlay.remove();
            } else if (modal.parentElement) {
                modal.parentElement.remove();
            } else {
                modal.remove();
            }
        };

        const updateTablePreview = () => {
            const cols = parseInt(colsInput.value) || 3;
            const rows = parseInt(rowsInput.value) || 3;
            
            if (cols > 10 || rows > 10) {
                tableWarning.style.display = 'block';
            } else {
                tableWarning.style.display = 'none';
            }
            
            const scale = Math.min(1, 140 / Math.max(cols * 16, rows * 16));
            
            let tableHTML = `<table class="t2-preview-table" style="transform: scale(${scale}); transform-origin: top left;">`;
            
            tableHTML += '<tr>';
            for (let col = 0; col < cols; col++) {
                tableHTML += `<th style="width: 16px; height: 16px; border: 1px solid #ccc; background: #f5f5f5;"></th>`;
            }
            tableHTML += '</tr>';
            
            for (let row = 1; row < rows; row++) {
                tableHTML += '<tr>';
                for (let col = 0; col < cols; col++) {
                    tableHTML += '<td style="width: 16px; height: 16px; border: 1px solid #ccc;"></td>';
                }
                tableHTML += '</tr>';
            }
            
            tableHTML += '</table>';
            previewContainer.innerHTML = tableHTML;
        };

        modal.querySelector('[data-action="decrease-cols"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            colsInput.value = Math.max(1, parseInt(colsInput.value) - 1);
            updateTablePreview();
        };
        
        modal.querySelector('[data-action="increase-cols"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            colsInput.value = Math.min(30, parseInt(colsInput.value) + 1);
            updateTablePreview();
        };
        
        modal.querySelector('[data-action="decrease-rows"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            rowsInput.value = Math.max(1, parseInt(rowsInput.value) - 1);
            updateTablePreview();
        };
        
        modal.querySelector('[data-action="increase-rows"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            rowsInput.value = Math.min(30, parseInt(rowsInput.value) + 1);
            updateTablePreview();
        };

        tableWidthSelect.addEventListener('change', () => {
            if (tableWidthSelect.value === 'custom') {
                customWidthContainer.style.display = 'flex';
            } else {
                customWidthContainer.style.display = 'none';
            }
        });

        colsInput.addEventListener('input', () => {
            colsInput.value = Math.min(30, Math.max(1, parseInt(colsInput.value) || 1));
            updateTablePreview();
        });
        
        rowsInput.addEventListener('input', () => {
            rowsInput.value = Math.min(30, Math.max(1, parseInt(rowsInput.value) || 1));
            updateTablePreview();
        });

        updateTablePreview();

        modal.querySelector('[data-action="insert"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const cols = parseInt(colsInput.value) || 3;
            const rows = parseInt(rowsInput.value) || 3;
            const borderStyle = modal.querySelector('.t2-table-border-style').value;
            
            let tableWidth;
            if (tableWidthSelect.value === 'custom') {
                const customWidth = parseInt(customWidthInput.value) || 100;
                tableWidth = Math.min(100, Math.max(10, customWidth)) + '%';
            } else {
                tableWidth = tableWidthSelect.value;
            }
            
            closeModal();
            
            setTimeout(() => {
                const table = this.createTable(cols, rows, tableWidth, borderStyle);
                const tableWrapper = this.createTableWrapper(table);
                this.insertTableWithLineBreaks(tableWrapper);
            }, 10);
        };

        modal.querySelector('[data-action="cancel"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
        };
    }

    createTable(cols, rows, width, borderStyle) {
        const table = document.createElement('table');
        table.className = 't2-table';
        table.style.width = width;
        table.style.borderCollapse = 'collapse';
        table.setAttribute('border', '1');
        table.setAttribute('data-t2-table', 'true');

        const borderColor = '#ccc';
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        for (let col = 0; col < cols; col++) {
            const th = document.createElement('th');
            th.style.border = `1px ${borderStyle} ${borderColor}`;
            th.style.padding = '8px';
            th.style.backgroundColor = '#f5f5f5';
            th.textContent = `헤더 ${col + 1}`;
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (let row = 1; row < rows; row++) {
            const tr = document.createElement('tr');
            for (let col = 0; col < cols; col++) {
                const td = document.createElement('td');
                td.style.border = `1px ${borderStyle} ${borderColor}`;
                td.style.padding = '8px';
                td.innerHTML = `<br>`;
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        return table;
    }

    insertTableWithLineBreaks(tableWrapper) {
        const selection = window.getSelection();
        let range;
        
        if (selection.rangeCount > 0) {
            range = selection.getRangeAt(0);
            // 선택 영역이 에디터 내부인지 확인
            if (!this.editor.editor.contains(range.commonAncestorContainer)) {
                range = null;
            }
        }

        if (!range) {
            // 에디터 끝에 새로운 줄 추가 후 위치 지정
            const p = document.createElement('p');
            p.innerHTML = '<br>';
            this.editor.editor.appendChild(p);
            range = document.createRange();
            range.selectNodeContents(p);
            range.collapse(false);
        }

        const topBreak = document.createElement('p');
        topBreak.innerHTML = '<br>';
        const bottomBreak = document.createElement('p');
        bottomBreak.innerHTML = '<br>';
        
        const fragment = document.createDocumentFragment();
        fragment.appendChild(topBreak);
        fragment.appendChild(tableWrapper);
        fragment.appendChild(bottomBreak);
        
        range.deleteContents();
        range.insertNode(fragment);

        const table = tableWrapper.querySelector('.t2-table');
        if (table) {
            this.setupTableControlEvents(tableWrapper.querySelector('.t2-table-controls'), table);
            this.setupTableCellEditing(table);
            this.setupTableResizing(table);
        }
        
        this.cleanupEmptyLines(tableWrapper);

        // 커서를 테이블 아래 빈 줄로 이동
        const newRange = document.createRange();
        newRange.setStart(bottomBreak, 0);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
        bottomBreak.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        this.editor.normalizeContent();
        
        if (this.editor.collab) {
            this.editor.collab.recordChange();
        } else {
            this.editor.createUndoPoint();
        }

        this.editor.autoSave();
    }

    createTableWrapper(table) {
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 't2-table-wrapper';
        tableWrapper.contentEditable = false;
        tableWrapper.style.position = 'relative';

        const cols = table.querySelector('tr')?.children.length || 0;
        const rows = table.querySelectorAll('tr').length;
        const cellWidth = 50;
        const padding = 12 * 2;
        const tableWidth = cols * (cellWidth + padding);
        const mediaBlockWidth = 320;
        const editorWidth = this.editor.editor.clientWidth;
        const needsScroll = tableWidth > mediaBlockWidth || tableWidth > editorWidth;

        if (needsScroll) {
            const scrollWrapper = document.createElement('div');
            scrollWrapper.className = 't2-table-scroll-wrapper';
            scrollWrapper.appendChild(table);
            tableWrapper.appendChild(scrollWrapper);
            table.classList.add('t2-table-large');
        } else {
            tableWrapper.appendChild(table);
        }

        const tableControls = this.createTableControls(table, rows, cols);
        tableWrapper.appendChild(tableControls);

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 't2-table-download-btn';
        downloadBtn.innerHTML = '<span class="material-icons">download</span>';
        downloadBtn.style.cssText = 'position: absolute; bottom: 8px; left: 8px; right: auto;';
        downloadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.exportTableToCSV(table);
        });
        tableWrapper.appendChild(downloadBtn);

        const moveControls = this.createMoveControls();
        tableWrapper.appendChild(moveControls);

        return tableWrapper;
    }

    createTableControls(table, rows, cols) {
        const tableControls = document.createElement('div');
        tableControls.className = 't2-table-controls';
        tableControls.innerHTML = `
            <div class="t2-table-control-group">
                <span>가로:</span>
                <button class="t2-btn t2-table-control-btn" data-action="add-col">
                    <span class="material-icons">add</span>
                </button>
                <button class="t2-btn t2-table-control-btn" data-action="remove-col">
                    <span class="material-icons">remove</span>
                </button>
            </div>
            <div class="t2-table-control-group">
                <span>세로:</span>
                <button class="t2-btn t2-table-control-btn" data-action="add-row">
                    <span class="material-icons">add</span>
                </button>
                <button class="t2-btn t2-table-control-btn" data-action="remove-row">
                    <span class="material-icons">remove</span>
                </button>
            </div>
            <button class="t2-btn t2-table-delete-btn" data-action="delete-table">
                <span class="material-icons">close</span>
            </button>
        `;
        return tableControls;
    }

    createMoveControls() {
        const moveWrapper = document.createElement('div');
        moveWrapper.className = 't2-move-controls';
        moveWrapper.contentEditable = false;
        moveWrapper.style.cssText = `
            position: absolute;
            bottom: 8px;
            right: 8px;
            display: inline-flex;
            background: rgba(50, 50, 50, 0.9);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            z-index: 10;
        `;

        moveWrapper.innerHTML = `
            <button class="t2-btn t2-move-btn" type="button" data-direction="up" 
                style="padding: 6px 12px; border: none; border-radius: 0; border-right: 2px solid rgba(255,255,255,0.3); background: transparent; color: white; transition: all 0.2s; cursor: pointer;">
                <span class="material-icons" style="font-size: 20px;">arrow_upward</span>
            </button>
            <button class="t2-btn t2-move-btn" type="button" data-direction="down"
                style="padding: 6px 12px; border: none; border-radius: 0; background: transparent; color: white; transition: all 0.2s; cursor: pointer;">
                <span class="material-icons" style="font-size: 20px;">arrow_downward</span>
            </button>
        `;

        const upBtn = moveWrapper.querySelector('[data-direction="up"]');
        const downBtn = moveWrapper.querySelector('[data-direction="down"]');

        [upBtn, downBtn].forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.background = 'rgba(255,255,255,0.15)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = 'transparent';
            });
        });

        upBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.moveBlock('up', moveWrapper);
        });

        downBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.moveBlock('down', moveWrapper);
        });

        return moveWrapper;
    }

    moveBlock(direction, controlElement) {
        const tableWrapper = controlElement.closest('.t2-table-wrapper');
        if (!tableWrapper) return;

        const sibling = direction === 'up' ? tableWrapper.previousElementSibling : tableWrapper.nextElementSibling;
        
        if (!sibling) return;

        if (direction === 'up') {
            tableWrapper.parentNode.insertBefore(tableWrapper, sibling);
        } else {
            tableWrapper.parentNode.insertBefore(tableWrapper, sibling.nextElementSibling);
        }

        if (this.editor.collab) {
            this.editor.collab.recordChange();
        } else {
            this.editor.createUndoPoint();
        }
        
        this.editor.autoSave();
    }

    setupTableControlEvents(controls, table) {
        const updateTableScroll = () => {
            const cols = table.querySelector('tr')?.children.length || 0;
            const rows = table.querySelectorAll('tr').length;
            const cellWidth = 50;
            const padding = 12 * 2;
            const tableWidth = cols * (cellWidth + padding);
            const mediaBlockWidth = 320;
            const editorWidth = this.editor.editor.clientWidth;
            const needsScroll = tableWidth > mediaBlockWidth || tableWidth > editorWidth;

            const wrapper = table.closest('.t2-table-wrapper');
            const scrollWrapper = table.closest('.t2-table-scroll-wrapper');

            if (needsScroll && !scrollWrapper) {
                const newScrollWrapper = document.createElement('div');
                newScrollWrapper.className = 't2-table-scroll-wrapper';
                wrapper.insertBefore(newScrollWrapper, table);
                newScrollWrapper.appendChild(table);
                table.classList.add('t2-table-large');
            } else if (!needsScroll && scrollWrapper) {
                wrapper.insertBefore(table, scrollWrapper);
                scrollWrapper.remove();
                table.classList.remove('t2-table-large');
            }
        };

        const recordChange = () => {
            if (this.editor.collab) {
                this.editor.collab.recordChange();
            } else {
                this.editor.createUndoPoint();
            }
        };

        controls.querySelector('[data-action="add-col"]').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rows = table.querySelectorAll('tr');
            const colCount = rows[0].children.length;
            rows.forEach((row, rowIndex) => {
                const cell = rowIndex === 0 ? document.createElement('th') : document.createElement('td');
                cell.style.border = rows[0].children[0].style.border;
                cell.style.padding = '8px';
                if (rowIndex === 0) {
                    cell.style.backgroundColor = '#f5f5f5';
                    cell.textContent = `헤더 ${colCount + 1}`;
                } else {
                    cell.innerHTML = '<br>';
                }
                row.appendChild(cell);
                this.setupCellEditing(cell);
            });
            updateTableScroll();
            recordChange();
        });

        controls.querySelector('[data-action="remove-col"]').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rows = table.querySelectorAll('tr');
            if (rows[0].children.length <= 1) return;
            rows.forEach(row => row.removeChild(row.lastChild));
            updateTableScroll();
            recordChange();
        });

        controls.querySelector('[data-action="add-row"]').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rows = table.querySelectorAll('tr');
            const colCount = rows[0].children.length;
            const tbody = table.querySelector('tbody') || table;
            const newRow = document.createElement('tr');
            for (let col = 0; col < colCount; col++) {
                const td = document.createElement('td');
                td.style.border = rows[0].children[0].style.border;
                td.style.padding = '8px';
                td.innerHTML = '<br>';
                newRow.appendChild(td);
                this.setupCellEditing(td);
            }
            tbody.appendChild(newRow);
            updateTableScroll();
            recordChange();
        });

        controls.querySelector('[data-action="remove-row"]').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rows = table.querySelectorAll('tr');
            if (rows.length <= 1) return;
            const tbody = table.querySelector('tbody') || table;
            tbody.removeChild(tbody.lastChild);
            updateTableScroll();
            recordChange();
        });

        controls.querySelector('[data-action="delete-table"]').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const wrapper = table.closest('.t2-table-wrapper');
            if (wrapper) {
                wrapper.remove();
                recordChange();
            }
        });

        updateTableScroll();
    }

    setupTableCellEditing(table) {
        const cells = table.querySelectorAll('th, td');
        cells.forEach(cell => {
            this.setupCellEditing(cell);
        });
    }

    setupCellEditing(cell) {
        cell.contentEditable = true;
        
        cell.addEventListener('click', (e) => {
            e.stopPropagation();
            
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(cell);
            selection.removeAllRanges();
            selection.addRange(range);
        });
        
        cell.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.execCommand('insertHTML', false, '<br>');
            }
        });

        cell.addEventListener('input', () => {
            if (this.editor.collab) {
                this.editor.collab.recordChange();
            }
        });
    }

    setupTableResizing(table) {
        let isResizing = false;
        let currentTh = null;
        let startX = 0;
        let startWidth = 0;
        
        const headers = table.querySelectorAll('th');
        headers.forEach(th => {
            th.addEventListener('mousedown', (e) => {
                const thRect = th.getBoundingClientRect();
                if (thRect.right - e.clientX <= 5) {
                    isResizing = true;
                    currentTh = th;
                    startX = e.clientX;
                    startWidth = th.offsetWidth;
                    
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';
                    
                    e.preventDefault();
                    e.stopPropagation();
                }
            });
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const diffX = e.clientX - startX;
            const newWidth = Math.max(30, startWidth + diffX);
            
            currentTh.style.width = `${newWidth}px`;
            
            const colIndex = Array.from(currentTh.parentNode.children).indexOf(currentTh);
            const rows = table.querySelectorAll('tr');
            
            rows.forEach(row => {
                const cell = row.children[colIndex];
                if (cell) {
                    cell.style.width = `${newWidth}px`;
                }
            });
            
            e.preventDefault();
        });
        
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                currentTh = null;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                
                if (this.editor.collab) {
                    this.editor.collab.recordChange();
                } else {
                    this.editor.createUndoPoint();
                }
            }
        });
    }

    exportTableToCSV(table) {
        const rows = Array.from(table.querySelectorAll('tr'));
        const csvRows = [];

        rows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('th, td'));
            const rowData = cells.map(cell => {
                let text = cell.textContent.trim();
                if (text.includes('"') || text.includes(',')) {
                    text = `"${text.replace(/"/g, '""')}"`;
                }
                return text;
            });
            csvRows.push(rowData.join(','));
        });

        const csvContent = csvRows.join('\n');
        T2Utils.downloadTextFile(csvContent, `table_export_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
    }

    initializeTableBlocks() {
        console.log('Initializing table blocks...');
        
        this.editor.editor.querySelectorAll('.table-responsive').forEach(responsiveWrapper => {
            const table = responsiveWrapper.querySelector('table');
            if (table) {
                if (!table.classList.contains('t2-table')) table.classList.add('t2-table');

                const tableWrapper = this.createTableWrapper(table);
                responsiveWrapper.parentNode.insertBefore(tableWrapper, responsiveWrapper);
                responsiveWrapper.remove();

                this.setupTableControlEvents(tableWrapper.querySelector('.t2-table-controls'), table);
                this.setupTableCellEditing(table);
                this.setupTableResizing(table);
                this.cleanupEmptyLines(tableWrapper);
            }
        });

        this.editor.editor.querySelectorAll('table.t2-table').forEach(table => {
            let tableWrapper = table.closest('.t2-table-wrapper');

            if (!tableWrapper) {
                tableWrapper = this.createTableWrapper(table);
                table.parentNode.insertBefore(tableWrapper, table);
                tableWrapper.appendChild(table);

                this.setupTableControlEvents(tableWrapper.querySelector('.t2-table-controls'), table);
                this.setupTableCellEditing(table);
                this.setupTableResizing(table);
                this.cleanupEmptyLines(tableWrapper);
            } else {
                tableWrapper.style.position = 'relative';
                tableWrapper.contentEditable = false;
                
                if (tableWrapper.parentNode.nodeName === 'P') {
                    const p = tableWrapper.parentNode;
                    p.parentNode.insertBefore(tableWrapper, p);
                    p.remove();
                }
                
                const existingControls = tableWrapper.querySelector('.t2-table-controls');
                if (existingControls) {
                    existingControls.remove();
                }
                const cols = table.querySelector('tr')?.children.length || 0;
                const rows = table.querySelectorAll('tr').length;
                const newControls = this.createTableControls(table, rows, cols);
                tableWrapper.appendChild(newControls);
                this.setupTableControlEvents(newControls, table);
                
                const existingDownloadBtn = tableWrapper.querySelector('.t2-table-download-btn');
                if (existingDownloadBtn) {
                    existingDownloadBtn.remove();
                }
                const downloadBtn = document.createElement('button');
                downloadBtn.className = 't2-table-download-btn';
                downloadBtn.innerHTML = '<span class="material-icons">download</span>';
                downloadBtn.style.cssText = 'position: absolute; bottom: 8px; left: 8px; right: auto;';
                downloadBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.exportTableToCSV(table);
                });
                tableWrapper.appendChild(downloadBtn);
                
                const existingMoveControls = tableWrapper.querySelector('.t2-move-controls');
                if (existingMoveControls) {
                    existingMoveControls.remove();
                }
                const moveControls = this.createMoveControls();
                tableWrapper.appendChild(moveControls);
                
                this.setupTableCellEditing(table);
                this.setupTableResizing(table);
                
                this.cleanupEmptyLines(tableWrapper);
            }
        });
        
        console.log('Table blocks initialization complete');
    }

    cleanupEmptyLines(tableWrapper) {
        let prev = tableWrapper.previousElementSibling;
        let emptyCount = 0;
        const toRemove = [];
        
        while (prev && prev.tagName === 'P' && 
               !prev.textContent.trim() && 
               (prev.innerHTML === '<br>' || prev.querySelector('br'))) {
            emptyCount++;
            if (emptyCount > 1) {
                toRemove.push(prev);
            }
            prev = prev.previousElementSibling;
        }
        
        let next = tableWrapper.nextElementSibling;
        emptyCount = 0;
        
        while (next && next.tagName === 'P' && 
               !next.textContent.trim() && 
               (next.innerHTML === '<br>' || next.querySelector('br'))) {
            emptyCount++;
            if (emptyCount > 1) {
                toRemove.push(next);
            }
            next = next.nextElementSibling;
        }
        
        toRemove.forEach(el => el.remove());
    }
}

window.T2TablePlugin = T2TablePlugin;
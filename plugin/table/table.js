// T2Editor/plugin/table/table.js

class T2TablePlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['insertTable'];

        // [SEC/IDEMPOTENT] editor.lib.php가 setContent 후 플러그인 초기화를
        // fallback으로 한 번 더 호출할 수 있으므로, 셀/테이블 이벤트를 WeakSet으로
        // 멱등 처리한다.
        this._cellsWithEditing = new WeakSet();
        this._tablesWithResizing = new WeakSet();
        this._controlsWithEvents = new WeakSet();
    }


    handleCommand(command, button) {
        switch(command) {
            case 'insertTable':
                this.showTableModal();
                break;
        }
    }



    // ── [SEC-PLUGIN-BOUNDARY] core.js / utils.js 공통 경계 재사용 ─────────────
    sanitizeTableHTML(html) {
        if (!html || typeof html !== 'string') return '';

        if (this.editor && typeof this.editor.sanitizePluginHTML === 'function') {
            return this.editor.sanitizePluginHTML(html, 'table');
        }

        // core.js가 아직 로드되지 않은 비정상 순서에서도 최소 방어를 유지한다.
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        tempDiv.querySelectorAll('script,object,embed,base,meta,link[rel="import"],iframe,style')
            .forEach(el => el.remove());
        tempDiv.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (/^on/i.test(attr.name) || attr.name === 'srcdoc') {
                    el.removeAttribute(attr.name);
                    return;
                }
                if (attr.name === 'href') {
                    const safe = (typeof T2Utils !== 'undefined' && T2Utils.sanitizeURL)
                        ? T2Utils.sanitizeURL(attr.value, 'href')
                        : this.basicSafeUrl(attr.value, 'href');
                    if (!safe) el.removeAttribute(attr.name);
                }
                if (attr.name === 'src') {
                    const safe = (typeof T2Utils !== 'undefined' && T2Utils.sanitizeURL)
                        ? T2Utils.sanitizeURL(attr.value, 'src')
                        : this.basicSafeUrl(attr.value, 'src');
                    if (!safe) el.removeAttribute(attr.name);
                }
            });
        });
        return tempDiv.innerHTML;
    }

    basicSafeUrl(value, context = 'href') {
        if (!value) return '';
        const normalized = String(value).replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^(javascript|vbscript):/.test(normalized)) return '';
        if (context === 'href' && /^data:/.test(normalized)) return '';
        return String(value);
    }

    clampInt(value, min, max, fallback) {
        const parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    }

    normalizeBorderStyle(value) {
        const allowed = new Set(['solid', 'dashed', 'dotted', 'double']);
        return allowed.has(value) ? value : 'solid';
    }

    normalizeTableWidth(value) {
        const raw = String(value || '100%').trim();
        if (raw === '75%' || raw === '50%' || raw === '100%') return raw;
        const match = raw.match(/^(\d{1,3})%$/);
        if (match) return `${this.clampInt(match[1], 10, 100, 100)}%`;
        return '100%';
    }

    createMaterialIcon(name, outlined = false) {
        const icon = document.createElement('span');
        icon.className = outlined ? 'material-icons-outlined' : 'material-icons';
        icon.textContent = String(name || '');
        return icon;
    }

    appendMaterialIcon(target, name, outlined = false) {
        target.textContent = '';
        target.appendChild(this.createMaterialIcon(name, outlined));
    }

    createEmptyParagraph() {
        const p = document.createElement('p');
        p.appendChild(document.createElement('br'));
        return p;
    }

    setEmptyCellBreak(cell) {
        cell.textContent = '';
        cell.appendChild(document.createElement('br'));
    }

    createActionButton(className, action, iconName, options = {}) {
        const button = document.createElement('button');
        button.className = className;
        button.type = options.type || 'button';
        if (action) button.setAttribute(options.actionAttr || 'data-action', action);
        if (options.style) button.style.cssText = options.style;
        if (options.ariaLabel) button.setAttribute('aria-label', options.ariaLabel);
        button.appendChild(this.createMaterialIcon(iconName, !!options.outlined));
        return button;
    }

    sanitizeEmbeddedContentElement(el) {
        const tag = el.tagName.toLowerCase();

        Array.from(el.attributes).forEach(attr => {
            const name = attr.name.toLowerCase();
            if (/^on/i.test(name) || name === 'srcdoc' || name === 'style') {
                el.removeAttribute(attr.name);
                return;
            }

            if (tag === 'a') {
                if (name === 'href') {
                    const safe = (typeof T2Utils !== 'undefined' && T2Utils.sanitizeURL)
                        ? T2Utils.sanitizeURL(attr.value, 'href')
                        : this.basicSafeUrl(attr.value, 'href');
                    if (safe) el.setAttribute('href', safe);
                    else el.removeAttribute('href');
                    return;
                }
                if (!['title', 'target', 'rel'].includes(name)) el.removeAttribute(attr.name);
                return;
            }

            if (tag === 'img') {
                if (name === 'src') {
                    const safe = (typeof T2Utils !== 'undefined' && T2Utils.sanitizeURL)
                        ? T2Utils.sanitizeURL(attr.value, 'src')
                        : this.basicSafeUrl(attr.value, 'src');
                    if (safe) el.setAttribute('src', safe);
                    else el.removeAttribute('src');
                    return;
                }
                if (!['alt', 'title', 'width', 'height'].includes(name)) el.removeAttribute(attr.name);
                return;
            }

            if ((tag === 'td' || tag === 'th') && ['colspan', 'rowspan'].includes(name)) {
                const safeSpan = this.clampInt(attr.value, 1, 100, 1);
                el.setAttribute(name, String(safeSpan));
                return;
            }

            if (tag === 'th' && name === 'scope') return;

            // 표 내부 일반 콘텐츠는 class/style/data-* 등 저장 오염 요인을 제거한다.
            el.removeAttribute(attr.name);
        });

        if (tag === 'a') {
            const href = el.getAttribute('href');
            if (href) {
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener noreferrer');
            }
        }
    }

    normalizeExternalTable(table) {
        if (!table || table.tagName !== 'TABLE') return null;

        // core 프로필 통과 후에도 표 플러그인 저장 구조에 불필요한 요소는 제거한다.
        table.querySelectorAll('script,object,embed,base,meta,iframe,style,form,input,button,textarea,select')
            .forEach(el => el.remove());

        const allowedTags = new Set([
            'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col',
            'br', 'a', 'img', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'p', 'div',
            'ul', 'ol', 'li'
        ]);

        Array.from(table.querySelectorAll('*')).forEach(el => {
            const tag = el.tagName.toLowerCase();
            if (!allowedTags.has(tag)) {
                el.replaceWith(document.createTextNode(el.textContent || ''));
                return;
            }
            this.sanitizeEmbeddedContentElement(el);
        });

        Array.from(table.attributes).forEach(attr => table.removeAttribute(attr.name));
        table.className = 't2-table';
        table.setAttribute('border', '1');
        table.setAttribute('data-t2-table', 'true');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';

        table.querySelectorAll('td, th').forEach(cell => {
            cell.style.border = '1px solid #ccc';
            cell.style.padding = '8px';
            if (cell.tagName === 'TH') cell.style.backgroundColor = '#f5f5f5';
            if (!cell.textContent.trim() && !cell.querySelector('img, a, br')) {
                this.setEmptyCellBreak(cell);
            }
        });

        return table;
    }

    parseSanitizedHTML(html) {
        const tempDiv = document.createElement('div');
        // sanitizeTableHTML()을 먼저 통과한 문자열만 이 함수로 들어온다.
        tempDiv.innerHTML = html;
        return tempDiv;
    }

    handlePaste(clipboardData) {
        const htmlText = clipboardData.getData('text/html');

        if (htmlText && htmlText.includes('<table')) {
            // [SEC-PLUGIN-BOUNDARY] 클립보드 HTML은 비신뢰 입력이므로
            // core.js의 table 프로필 새니타이저를 먼저 통과시킨 뒤 파싱한다.
            const sanitizedHTML = this.sanitizeTableHTML(htmlText);
            const tempDiv = this.parseSanitizedHTML(sanitizedHTML);

            const tables = Array.from(tempDiv.querySelectorAll('table'));
            tables.forEach(origTable => {
                const table = this.normalizeExternalTable(origTable.cloneNode(true));
                if (!table) return;

                const tableWrapper = this.createTableWrapper(table);
                this.insertTableWithLineBreaks(tableWrapper);
            });

            if (!tables.length) return false;

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
            const cols = this.clampInt(colsInput.value, 1, 30, 3);
            const rows = this.clampInt(rowsInput.value, 1, 30, 3);

            tableWarning.style.display = (cols > 10 || rows > 10) ? 'block' : 'none';

            const scale = Math.min(1, 140 / Math.max(cols * 16, rows * 16));
            const table = document.createElement('table');
            table.className = 't2-preview-table';
            table.style.transform = `scale(${scale})`;
            table.style.transformOrigin = 'top left';

            const headerRow = document.createElement('tr');
            for (let col = 0; col < cols; col++) {
                const th = document.createElement('th');
                th.style.width = '16px';
                th.style.height = '16px';
                th.style.border = '1px solid #ccc';
                th.style.background = '#f5f5f5';
                headerRow.appendChild(th);
            }
            table.appendChild(headerRow);

            for (let row = 1; row < rows; row++) {
                const tr = document.createElement('tr');
                for (let col = 0; col < cols; col++) {
                    const td = document.createElement('td');
                    td.style.width = '16px';
                    td.style.height = '16px';
                    td.style.border = '1px solid #ccc';
                    tr.appendChild(td);
                }
                table.appendChild(tr);
            }

            previewContainer.replaceChildren(table);
        };

        modal.querySelector('[data-action="decrease-cols"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            colsInput.value = Math.max(1, this.clampInt(colsInput.value, 1, 30, 3) - 1);
            updateTablePreview();
        };
        
        modal.querySelector('[data-action="increase-cols"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            colsInput.value = Math.min(30, this.clampInt(colsInput.value, 1, 30, 3) + 1);
            updateTablePreview();
        };
        
        modal.querySelector('[data-action="decrease-rows"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            rowsInput.value = Math.max(1, this.clampInt(rowsInput.value, 1, 30, 3) - 1);
            updateTablePreview();
        };
        
        modal.querySelector('[data-action="increase-rows"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            rowsInput.value = Math.min(30, this.clampInt(rowsInput.value, 1, 30, 3) + 1);
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
            colsInput.value = this.clampInt(colsInput.value, 1, 30, 1);
            updateTablePreview();
        });
        
        rowsInput.addEventListener('input', () => {
            rowsInput.value = this.clampInt(rowsInput.value, 1, 30, 1);
            updateTablePreview();
        });

        updateTablePreview();

        modal.querySelector('[data-action="insert"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const cols = this.clampInt(colsInput.value, 1, 30, 3);
            const rows = this.clampInt(rowsInput.value, 1, 30, 3);
            const borderStyle = this.normalizeBorderStyle(modal.querySelector('.t2-table-border-style').value);
            
            let tableWidth;
            if (tableWidthSelect.value === 'custom') {
                const customWidth = this.clampInt(customWidthInput.value, 10, 100, 100);
                tableWidth = `${customWidth}%`;
            } else {
                tableWidth = this.normalizeTableWidth(tableWidthSelect.value);
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
        cols = this.clampInt(cols, 1, 30, 3);
        rows = this.clampInt(rows, 1, 30, 3);
        width = this.normalizeTableWidth(width);
        borderStyle = this.normalizeBorderStyle(borderStyle);

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
                this.setEmptyCellBreak(td);
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
            const p = this.createEmptyParagraph();
            this.editor.editor.appendChild(p);
            range = document.createRange();
            range.selectNodeContents(p);
            range.collapse(false);
        }

        const topBreak = this.createEmptyParagraph();
        const bottomBreak = this.createEmptyParagraph();

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
        tableWrapper.setAttribute('data-t2-block', 'table');
        tableWrapper.contentEditable = false;
        tableWrapper.style.position = 'relative';

        if (!table.classList.contains('t2-table')) table.classList.add('t2-table');
        table.setAttribute('data-t2-table', 'true');

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
        downloadBtn.type = 'button';
        downloadBtn.style.cssText = 'position: absolute; bottom: 8px; left: 8px; right: auto;';
        downloadBtn.appendChild(this.createMaterialIcon('download'));
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

        const createGroup = (labelText, actions) => {
            const group = document.createElement('div');
            group.className = 't2-table-control-group';

            const label = document.createElement('span');
            label.textContent = labelText;
            group.appendChild(label);

            actions.forEach(({ action, icon, label: ariaLabel }) => {
                group.appendChild(this.createActionButton(
                    't2-btn t2-table-control-btn',
                    action,
                    icon,
                    { ariaLabel }
                ));
            });

            return group;
        };

        tableControls.appendChild(createGroup('가로:', [
            { action: 'add-col', icon: 'add', label: '열 추가' },
            { action: 'remove-col', icon: 'remove', label: '열 삭제' },
        ]));

        tableControls.appendChild(createGroup('세로:', [
            { action: 'add-row', icon: 'add', label: '행 추가' },
            { action: 'remove-row', icon: 'remove', label: '행 삭제' },
        ]));

        tableControls.appendChild(this.createActionButton(
            't2-btn t2-table-delete-btn',
            'delete-table',
            'close',
            { ariaLabel: '테이블 삭제' }
        ));

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

        const baseStyle = 'padding: 6px 12px; border: none; border-radius: 0; background: transparent; color: white; transition: all 0.2s; cursor: pointer;';
        const upBtn = this.createActionButton('t2-btn t2-move-btn', 'up', 'arrow_upward', {
            actionAttr: 'data-direction',
            style: `${baseStyle} border-right: 2px solid rgba(255,255,255,0.3);`,
            ariaLabel: '위로 이동'
        });
        const downBtn = this.createActionButton('t2-btn t2-move-btn', 'down', 'arrow_downward', {
            actionAttr: 'data-direction',
            style: baseStyle,
            ariaLabel: '아래로 이동'
        });

        upBtn.querySelector('.material-icons').style.fontSize = '20px';
        downBtn.querySelector('.material-icons').style.fontSize = '20px';

        moveWrapper.appendChild(upBtn);
        moveWrapper.appendChild(downBtn);

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
        if (!controls || this._controlsWithEvents.has(controls)) return;
        this._controlsWithEvents.add(controls);

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

            if (!wrapper) return;

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
            this.editor.autoSave();
        };

        controls.querySelector('[data-action="add-col"]').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rows = table.querySelectorAll('tr');
            if (!rows.length) return;
            const colCount = rows[0].children.length;
            rows.forEach((row, rowIndex) => {
                const cell = rowIndex === 0 ? document.createElement('th') : document.createElement('td');
                cell.style.border = rows[0].children[0]?.style.border || '1px solid #ccc';
                cell.style.padding = '8px';
                if (rowIndex === 0) {
                    cell.style.backgroundColor = '#f5f5f5';
                    cell.textContent = `헤더 ${colCount + 1}`;
                } else {
                    this.setEmptyCellBreak(cell);
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
            if (!rows.length || rows[0].children.length <= 1) return;
            rows.forEach(row => row.lastElementChild && row.removeChild(row.lastElementChild));
            updateTableScroll();
            recordChange();
        });

        controls.querySelector('[data-action="add-row"]').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rows = table.querySelectorAll('tr');
            if (!rows.length) return;
            const colCount = rows[0].children.length;
            const tbody = table.querySelector('tbody') || table;
            const newRow = document.createElement('tr');
            for (let col = 0; col < colCount; col++) {
                const td = document.createElement('td');
                td.style.border = rows[0].children[0]?.style.border || '1px solid #ccc';
                td.style.padding = '8px';
                this.setEmptyCellBreak(td);
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
            if (tbody.lastElementChild) tbody.removeChild(tbody.lastElementChild);
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
        if (!cell || this._cellsWithEditing.has(cell)) return;
        this._cellsWithEditing.add(cell);

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
                const selection = window.getSelection();
                if (!selection.rangeCount || !cell.contains(selection.anchorNode)) {
                    cell.appendChild(document.createElement('br'));
                    return;
                }
                const range = selection.getRangeAt(0);
                range.deleteContents();
                const br = document.createElement('br');
                range.insertNode(br);
                range.setStartAfter(br);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        });

        cell.addEventListener('input', () => {
            if (this.editor.collab) {
                this.editor.collab.recordChange();
            }
        });
    }


    setupTableResizing(table) {
        if (!table || this._tablesWithResizing.has(table)) return;
        this._tablesWithResizing.add(table);

        let isResizing = false;
        let currentTh = null;
        let startX = 0;
        let startWidth = 0;

        table.addEventListener('mousedown', (e) => {
            const th = e.target.closest('th');
            if (!th || !table.contains(th)) return;

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

        document.addEventListener('mousemove', (e) => {
            if (!isResizing || !currentTh) return;

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
                this.editor.autoSave();
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
                const originalParent = table.parentNode;
                const originalNext = table.nextSibling;
                tableWrapper = this.createTableWrapper(table);
                if (originalParent) originalParent.insertBefore(tableWrapper, originalNext);

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
                downloadBtn.appendChild(this.createMaterialIcon('download'));
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
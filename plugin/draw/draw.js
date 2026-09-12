//Path: T2Editor/plugin/draw/draw.js

class T2DrawPlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['insertDrawing'];
        this.currentDrawingBlock = null;
        this.canvas = null;
        this.ctx = null;
        this.isDrawing = false;
        this.currentTool = 'pen';
        this.currentColor = '#000000';
        this.currentSize = 8;
        this.history = [];
        this.historyStep = -1;

        // ── [FIX-타이밍] 에디터에 이미 콘텐츠가 있으면 직접 초기화 ─────────
        // code.js / file.js 와 동일한 패턴.
        // core.js processContentSet 이 먼저 소비된 경우 onContentSet 을 받지 못하므로
        // 생성자에서 fallback 으로 실행한다.
        setTimeout(() => {
            if (this.editor.editor && this.editor.editor.innerHTML.trim()) {
                this.initializeDrawingBlocks();
            }
        }, 150);

        console.log('T2DrawPlugin initialized');
    }

    // ── [SEC] URL sanitizer ───────────────────────────────────────────────
    _sanitizeURL(url, context = 'href') {
        if (typeof T2Utils !== 'undefined' && T2Utils.sanitizeURL) {
            return T2Utils.sanitizeURL(String(url || ''), context);
        }
        const value = String(url || '');
        const normalized = value
            .replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '')
            .toLowerCase();
        if (/^(javascript|vbscript):/.test(normalized)) return '';
        if (context === 'href' && /^data:/.test(normalized)) return '';
        return value;
    }

    generateBlockId() {
        return `drawing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    handleCommand(command, button) {
        if (command === 'insertDrawing') {
            const placeholderBlock = this.createPlaceholderBlock();
            this.insertPlaceholderAtCursor(placeholderBlock);
            this.openDrawingModal(placeholderBlock);
        }
    }

    onContentSet(html) {
        console.log('Draw plugin: onContentSet called');
        setTimeout(() => {
            this.initializeDrawingBlocks();
        }, 50);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // createPlaceholderBlock
    // ─────────────────────────────────────────────────────────────────────────
    // [FIX-PERSIST] 블록 생성 시점부터 data-t2-block / data-block-id 를 기록한다.
    createPlaceholderBlock() {
        const block = document.createElement('div');
        block.className = 't2-media-block t2-drawing-block';
        block.contentEditable = false;
        block.style.position = 'relative';
        block.dataset.drawingBlock = 'true';
        block.dataset.placeholder  = 'true';

        // [FIX-PERSIST] 블록 식별용 data 속성
        block.setAttribute('data-t2-block', 'drawing');
        block.setAttribute('data-block-id', this.generateBlockId());

        const container = document.createElement('div');
        container.dataset.originalWidth  = '800';
        container.dataset.originalHeight = '600';
        container.setAttribute('data-t2-block', 'drawing');

        const img = document.createElement('img');
        img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        img.alt = 'Drawing';
        img.dataset.width  = '800';
        img.dataset.height = '600';

        container.appendChild(img);

        const loadingIndicator = document.createElement('div');
        loadingIndicator.className   = 't2-drawing-loading';
        loadingIndicator.textContent = '그림을 그리는 중...';
        container.appendChild(loadingIndicator);

        block.appendChild(container);
        return block;
    }

    insertPlaceholderAtCursor(placeholderBlock) {
        try {
            const selection = window.getSelection();
            if (!selection.rangeCount) {
                this.editor.editor.appendChild(placeholderBlock);
                return;
            }

            const range        = selection.getRangeAt(0);
            const currentBlock = this.editor.getClosestBlock(range.startContainer);

            if (currentBlock && currentBlock !== this.editor.editor) {
                currentBlock.parentNode.insertBefore(
                    placeholderBlock, currentBlock.nextSibling
                );
            } else {
                this.editor.editor.appendChild(placeholderBlock);
            }

            const bottomBreak = document.createElement('p');
            bottomBreak.innerHTML = '<br>';
            placeholderBlock.parentNode.insertBefore(
                bottomBreak, placeholderBlock.nextSibling
            );
        } catch (error) {
            console.error('Placeholder insertion error:', error);
            this.editor.editor.appendChild(placeholderBlock);
        }

        this.editor.normalizeContent();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 그림 모달
    // ─────────────────────────────────────────────────────────────────────────
    openDrawingModal(existingBlock = null) {
        const existingOverlay = document.querySelector('.t2-modal-overlay');
        if (existingOverlay) existingOverlay.remove();

        this.currentDrawingBlock = existingBlock;
        const isPlaceholder = existingBlock?.dataset.placeholder === 'true';

        const overlay = document.createElement('div');
        overlay.className = 't2-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 't2-draw-modal-v2';
        modal.innerHTML = `
            <div class="t2-draw-header-v2">
                <h2 class="t2-draw-title">${isPlaceholder ? '그림 그리기' : '그림 수정'}</h2>
                <button class="t2-draw-close-v2" data-action="close">
                    <span class="material-icons">close</span>
                </button>
            </div>

            <!-- Mobile/Tablet Toolbar -->
            <div class="t2-draw-toolbar-mobile">
                <div class="t2-draw-toolbar-scroll">
                    <div class="t2-draw-tools-mobile">
                        <button class="t2-draw-tool-v2 active" data-tool="pen" title="펜">
                            <span class="material-icons">edit</span>
                        </button>
                        <button class="t2-draw-tool-v2" data-tool="eraser" title="지우개">
                            <span class="material-icons">auto_fix_high</span>
                        </button>
                    </div>

                    <div class="t2-draw-brush-control">
                        <div class="t2-brush-preview" style="width: 8px; height: 8px; background-color: #000000;"></div>
                        <input type="range" class="t2-draw-size-slider" min="1" max="50" value="8">
                        <span class="t2-brush-size-text">8px</span>
                    </div>

                    <div class="t2-draw-actions-mobile">
                        <button class="t2-draw-action-v2" data-action="undo" title="실행취소" disabled>
                            <span class="material-icons">undo</span>
                        </button>
                        <button class="t2-draw-action-v2" data-action="redo" title="다시실행" disabled>
                            <span class="material-icons">redo</span>
                        </button>
                        <button class="t2-draw-action-v2" data-action="clear" title="전체 지우기">
                            <span class="material-icons">delete_sweep</span>
                        </button>
                    </div>

                    <div class="t2-draw-colors-mobile">
                        <div class="t2-color-swatch active" data-color="#000000" style="background: #000000;"></div>
                        <div class="t2-color-swatch" data-color="#ef4444" style="background: #ef4444;"></div>
                        <div class="t2-color-swatch" data-color="#3b82f6" style="background: #3b82f6;"></div>
                        <div class="t2-color-swatch" data-color="#22c55e" style="background: #22c55e;"></div>
                        <div class="t2-color-swatch" data-color="#facc15" style="background: #facc15;"></div>
                        <div class="t2-color-swatch" data-color="#a855f7" style="background: #a855f7;"></div>
                        <input type="color" class="t2-draw-color-picker" value="#000000">
                    </div>
                </div>
            </div>

            <div class="t2-draw-content-wrapper">
                <!-- Desktop Sidebar -->
                <div class="t2-draw-sidebar-desktop">
                    <div class="t2-draw-tools-desktop">
                        <button class="t2-draw-tool-v2 active" data-tool="pen" title="펜">
                            <span class="material-icons">edit</span>
                        </button>
                        <button class="t2-draw-tool-v2" data-tool="eraser" title="지우개">
                            <span class="material-icons">auto_fix_high</span>
                        </button>
                    </div>

                    <div class="t2-draw-brush-control-desktop">
                        <div class="t2-brush-preview-desktop" style="width: 8px; height: 8px; background-color: #000000;"></div>
                        <input type="range" class="t2-draw-size-slider-desktop" min="1" max="50" value="8">
                        <span class="t2-brush-size-text-desktop">8px</span>
                    </div>

                    <div class="t2-draw-actions-desktop">
                        <button class="t2-draw-action-v2" data-action="undo" title="실행취소" disabled>
                            <span class="material-icons">undo</span>
                        </button>
                        <button class="t2-draw-action-v2" data-action="redo" title="다시실행" disabled>
                            <span class="material-icons">redo</span>
                        </button>
                        <button class="t2-draw-action-v2" data-action="clear" title="전체 지우기">
                            <span class="material-icons">delete_sweep</span>
                        </button>
                    </div>

                    <div class="t2-draw-colors-desktop">
                        <div class="t2-color-swatch active" data-color="#000000" style="background: #000000;"></div>
                        <div class="t2-color-swatch" data-color="#ef4444" style="background: #ef4444;"></div>
                        <div class="t2-color-swatch" data-color="#3b82f6" style="background: #3b82f6;"></div>
                        <div class="t2-color-swatch" data-color="#22c55e" style="background: #22c55e;"></div>
                        <input type="color" class="t2-draw-color-picker" value="#000000">
                    </div>
                </div>

                <!-- Canvas Area -->
                <div class="t2-draw-canvas-area">
                    <canvas class="t2-draw-canvas-v2" width="800" height="600"></canvas>
                </div>
            </div>

            <div class="t2-draw-footer-v2">
                <button class="t2-btn-cancel-v2" data-action="cancel">취소</button>
                <button class="t2-btn-primary-v2" data-action="insert">${isPlaceholder ? '추가하기' : '수정 완료'}</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        this.setupCanvas(modal, existingBlock, isPlaceholder);
        this.setupEventListeners(modal, overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.handleCancel(overlay);
        });
    }

    setupCanvas(modal, existingBlock, isPlaceholder) {
        this.canvas = modal.querySelector('.t2-draw-canvas-v2');
        this.ctx    = this.canvas.getContext('2d', { willReadFrequently: true });

        this.resetContext();
        this.history     = [];
        this.historyStep = -1;

        if (existingBlock && !isPlaceholder) {
            this.loadExistingImage(existingBlock);
        } else {
            this.fillWhiteBackground();
            this.saveHistory();
        }

        this.setupDrawingEvents();
    }

    resetContext() {
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1.0;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.lineCap     = 'round';
        this.ctx.lineJoin    = 'round';
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.fillStyle   = '#ffffff';
    }

    loadExistingImage(existingBlock) {
        const img = existingBlock.querySelector('img');
        const placeholder1px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

        // img 또는 data-drawing-url 에서 URL 복구
        let srcUrl = img?.src || '';
        if (!srcUrl || srcUrl === placeholder1px || srcUrl === window.location.href) {
            srcUrl = existingBlock.getAttribute('data-drawing-url') || '';
        }

        if (srcUrl && srcUrl !== placeholder1px) {
            const tempImg = new Image();
            try {
                const imgUrl       = new URL(srcUrl, window.location.href);
                const isSameOrigin = imgUrl.origin === window.location.origin;
                if (!isSameOrigin) tempImg.crossOrigin = 'anonymous';
            } catch (_) { /* 상대 경로 파싱 실패 무시 */ }

            tempImg.onload = () => {
                try {
                    this.canvas.width  = tempImg.width;
                    this.canvas.height = tempImg.height;
                    this.resetContext();
                    this.fillWhiteBackground();
                    this.ctx.drawImage(tempImg, 0, 0);
                    this.saveHistory();
                    this.updateHistoryButtons();
                } catch (error) {
                    console.error('Image drawing error:', error);
                    this.fillWhiteBackground();
                    this.saveHistory();
                }
            };

            tempImg.onerror = () => {
                this.fillWhiteBackground();
                this.saveHistory();
            };

            tempImg.src = srcUrl;
        } else {
            this.fillWhiteBackground();
            this.saveHistory();
        }
    }

    fillWhiteBackground() {
        this.resetContext();
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    setupDrawingEvents() {
        const startDrawing = (e) => {
            const rect   = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width  / rect.width;
            const scaleY = this.canvas.height / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top)  * scaleY;

            this.isDrawing = true;
            this.ctx.beginPath();
            this.ctx.moveTo(x, y);
        };

        const draw = (e) => {
            if (!this.isDrawing) return;

            const rect   = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width  / rect.width;
            const scaleY = this.canvas.height / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top)  * scaleY;

            this.ctx.lineCap   = 'round';
            this.ctx.lineJoin  = 'round';
            this.ctx.lineWidth = this.currentSize;

            if (this.currentTool === 'pen') {
                this.ctx.globalCompositeOperation = 'source-over';
                this.ctx.strokeStyle = this.currentColor;
            } else if (this.currentTool === 'eraser') {
                this.ctx.globalCompositeOperation = 'destination-out';
                this.ctx.strokeStyle = 'rgba(0,0,0,1)';
            }

            this.ctx.lineTo(x, y);
            this.ctx.stroke();
        };

        const stopDrawing = () => {
            if (this.isDrawing) {
                this.isDrawing = false;
                this.ctx.globalCompositeOperation = 'source-over';
                this.ctx.beginPath();
                this.saveHistory();
            }
        };

        this.canvas.addEventListener('mousedown', startDrawing);
        this.canvas.addEventListener('mousemove', draw);
        this.canvas.addEventListener('mouseup',   stopDrawing);
        this.canvas.addEventListener('mouseout',  stopDrawing);

        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const t = e.touches[0];
            this.canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY }));
        });
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const t = e.touches[0];
            this.canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY }));
        });
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.canvas.dispatchEvent(new MouseEvent('mouseup', {}));
        });
    }

    setupEventListeners(modal, overlay) {
        modal.querySelectorAll('[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.t2-draw-tool-v2').forEach(b => b.classList.remove('active'));
                modal.querySelectorAll(`[data-tool="${btn.dataset.tool}"]`).forEach(b => b.classList.add('active'));
                this.currentTool = btn.dataset.tool;
            });
        });

        modal.querySelectorAll('.t2-color-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                modal.querySelectorAll('.t2-color-swatch').forEach(s => s.classList.remove('active'));
                modal.querySelectorAll(`[data-color="${swatch.dataset.color}"]`).forEach(s => s.classList.add('active'));
                this.currentColor = swatch.dataset.color;
                modal.querySelectorAll('.t2-draw-color-picker').forEach(p => p.value = this.currentColor);
                this.updateBrushPreviews();
            });
        });

        modal.querySelectorAll('.t2-draw-color-picker').forEach(picker => {
            picker.addEventListener('input', (e) => {
                this.currentColor = e.target.value;
                modal.querySelectorAll('.t2-draw-color-picker').forEach(p => p.value = this.currentColor);
                modal.querySelectorAll('.t2-color-swatch').forEach(s => s.classList.remove('active'));
                this.updateBrushPreviews();
            });
        });

        const updateSize = (value) => {
            this.currentSize = parseInt(value);
            modal.querySelectorAll('.t2-draw-size-slider, .t2-draw-size-slider-desktop').forEach(s => s.value = value);
            this.updateBrushPreviews();
        };

        modal.querySelectorAll('.t2-draw-size-slider, .t2-draw-size-slider-desktop').forEach(slider => {
            slider.addEventListener('input', (e) => updateSize(e.target.value));
        });

        modal.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                switch (action) {
                    case 'close':
                    case 'cancel': this.handleCancel(overlay); break;
                    case 'insert': this.insertDrawing(overlay); break;
                    case 'undo':   this.undo();  break;
                    case 'redo':   this.redo();  break;
                    case 'clear':
                        if (confirm('전체 내용을 지우시겠습니까?')) this.clearCanvas();
                        break;
                }
            });
        });

        this.updateBrushPreviews();
    }

    updateBrushPreviews() {
        const modal = this.canvas.closest('.t2-draw-modal-v2');
        if (!modal) return;
        modal.querySelectorAll('.t2-brush-preview, .t2-brush-preview-desktop').forEach(p => {
            p.style.width           = this.currentSize + 'px';
            p.style.height          = this.currentSize + 'px';
            p.style.backgroundColor = this.currentColor;
        });
        modal.querySelectorAll('.t2-brush-size-text, .t2-brush-size-text-desktop').forEach(t => {
            t.textContent = this.currentSize + 'px';
        });
    }

    handleCancel(overlay) {
        if (this.currentDrawingBlock?.dataset.placeholder === 'true') {
            this.currentDrawingBlock.remove();
        }
        this.closeModal(overlay);
    }

    saveHistory() {
        this.historyStep++;
        if (this.historyStep < this.history.length) this.history.length = this.historyStep;

        try {
            this.history.push({
                imageData: this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height),
                width:  this.canvas.width,
                height: this.canvas.height
            });
        } catch (error) {
            console.error('History save error:', error);
        }

        this.updateHistoryButtons();
    }

    undo() {
        if (this.historyStep > 0) { this.historyStep--; this.loadFromHistory(); }
    }

    redo() {
        if (this.historyStep < this.history.length - 1) { this.historyStep++; this.loadFromHistory(); }
    }

    loadFromHistory() {
        const item = this.history[this.historyStep];
        if (item?.imageData) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.putImageData(item.imageData, 0, 0);
            this.updateHistoryButtons();
        }
    }

    updateHistoryButtons() {
        const modal = this.canvas.closest('.t2-draw-modal-v2');
        if (!modal) return;
        modal.querySelectorAll('[data-action="undo"]').forEach(b => { b.disabled = this.historyStep <= 0; });
        modal.querySelectorAll('[data-action="redo"]').forEach(b => { b.disabled = this.historyStep >= this.history.length - 1; });
    }

    clearCanvas() {
        this.resetContext();
        this.fillWhiteBackground();
        this.saveHistory();
    }

    async insertDrawing(overlay) {
        try {
            if (this.isDrawing) {
                this.isDrawing = false;
                this.ctx.globalCompositeOperation = 'source-over';
                this.ctx.beginPath();
            }

            this.resetContext();

            const blob = await new Promise((resolve, reject) => {
                this.canvas.toBlob(b => {
                    if (b && b.size > 0) resolve(b);
                    else reject(new Error('Empty blob'));
                }, 'image/png', 1.0);
            });

            const fileName = `drawing_${Date.now()}.png`;
            const file     = new File([blob], fileName, { type: blob.type });

            const formData = new FormData();
            formData.append('bf_file[]', file);
            formData.append('uid', this.editor.generateUid());

            const response = await fetch(
                `${t2editor_url}/plugin/image/image_upload.php`,
                { method: 'POST', body: formData }
            );

            if (!response.ok) throw new Error(`Server error: ${response.status}`);

            const data = await response.json();

            if (data.success && data.files && data.files.length > 0) {
                this.updateDrawingBlock(data.files[0]);
                this.closeModal(overlay);
            } else {
                throw new Error(data.message || 'Upload failed');
            }
        } catch (error) {
            console.error('Drawing upload error:', error);
            alert('그림 저장 중 오류:\n' + error.message);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // updateDrawingBlock — 업로드 완료 후 블록 DOM 갱신 + 영속 데이터 기록
    // ─────────────────────────────────────────────────────────────────────────
    // [FIX-PERSIST] video.js createVideoBlock() 패턴을 따라
    //   · wrapper + container 양쪽에 data-t2-block / data-drawing-url 이중 기록
    //   · .t2-drawing-source[href] fallback anchor: CMS 가 img 를 제거해도 href 로 URL 복구
    updateDrawingBlock(fileData) {
        if (!this.currentDrawingBlock) return;

        const drawingUrl = fileData.url    || '';
        const drawingW   = fileData.width  || 800;
        const drawingH   = fileData.height || 600;

        // ── img 갱신 ────────────────────────────────────────────────────────
        const img = this.currentDrawingBlock.querySelector('img');
        if (img) {
            img.src            = drawingUrl;
            img.dataset.width  = drawingW;
            img.dataset.height = drawingH;
        }

        // ── container 갱신 + 데이터 기록 ────────────────────────────────────
        // [FIX-ESCAPE] 직계 자식 div 만 탐색 — 컨트롤 div 가 잡히는 것을 방지
        const container = this.currentDrawingBlock.querySelector(':scope > div:not(.t2-media-controls):not(.t2-move-controls)');
        if (container) {
            container.dataset.originalWidth  = drawingW;
            container.dataset.originalHeight = drawingH;

            container.setAttribute('data-t2-block',       'drawing');
            container.setAttribute('data-drawing-url',    drawingUrl);
            container.setAttribute('data-drawing-width',  String(drawingW));
            container.setAttribute('data-drawing-height', String(drawingH));

            const loadingIndicator = container.querySelector('.t2-drawing-loading');
            if (loadingIndicator) loadingIndicator.remove();

            // [FIX-PERSIST] fallback anchor (video.js 의 .t2-video-source 와 동일 전략)
            // display:none 대신 width/height:0 + overflow:hidden + aria-hidden
            let anchor = container.querySelector('.t2-drawing-source');
            if (!anchor) {
                anchor = document.createElement('a');
                anchor.className = 't2-drawing-source';
                anchor.setAttribute('aria-hidden', 'true');
                anchor.setAttribute('tabindex', '-1');
                anchor.style.cssText =
                    'position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;';
                container.appendChild(anchor);
            }
            anchor.href = this._sanitizeURL(drawingUrl, 'href') || '';
        }

        // ── wrapper 식별 데이터 기록 ─────────────────────────────────────────
        // [FIX-PERSIST] class 가 소실돼도 data-t2-block="drawing" 으로 식별 가능
        this.currentDrawingBlock.setAttribute('data-t2-block',       'drawing');
        this.currentDrawingBlock.setAttribute('data-drawing-url',    drawingUrl);
        this.currentDrawingBlock.setAttribute('data-drawing-width',  String(drawingW));
        this.currentDrawingBlock.setAttribute('data-drawing-height', String(drawingH));
        if (!this.currentDrawingBlock.getAttribute('data-block-id')) {
            this.currentDrawingBlock.setAttribute('data-block-id', this.generateBlockId());
        }

        delete this.currentDrawingBlock.dataset.placeholder;

        // ── controls 재생성 ──────────────────────────────────────────────────
        const existingControls = this.currentDrawingBlock.querySelector('.t2-media-controls');
        if (existingControls) existingControls.remove();
        this.currentDrawingBlock.appendChild(this.createDrawingControls());
        this.setupDrawingBlockEvents(this.currentDrawingBlock);

        // ── move controls — 항상 제거 후 재생성 (이벤트 없는 죽은 버튼 방지) ──
        const existingMoveControls = this.currentDrawingBlock.querySelector('.t2-move-controls');
        if (existingMoveControls) existingMoveControls.remove();
        this.currentDrawingBlock.appendChild(this.createMoveControls());

        this.editor.createUndoPoint();
        this.editor.autoSave();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // createDrawingControls
    // ─────────────────────────────────────────────────────────────────────────
    createDrawingControls() {
        const controls = document.createElement('div');
        controls.className       = 't2-media-controls';
        controls.contentEditable = false;
        controls.innerHTML = `
            <button class="t2-btn t2-edit-drawing" title="그림 수정" type="button">
                <span class="material-icons">edit</span>
            </button>
            <button class="t2-btn delete-btn" title="그림 삭제" type="button">
                <span class="material-icons">delete</span>
            </button>
        `;
        return controls;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // createMoveControls — 알약형 가로 바 메뉴 (code.js / video.js 동일 패턴)
    // ─────────────────────────────────────────────────────────────────────────
    createMoveControls() {
        const moveWrapper = document.createElement('div');
        moveWrapper.className       = 't2-move-controls';
        moveWrapper.contentEditable = false;
        moveWrapper.style.cssText   = `
            position: absolute;
            bottom: -35px;
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
                style="padding:6px 12px;border:none;border-radius:0;border-right:2px solid rgba(255,255,255,0.3);background:transparent;color:white;transition:all 0.2s;cursor:pointer;">
                <span class="material-icons" style="font-size:20px;">arrow_upward</span>
            </button>
            <button class="t2-btn t2-move-btn" type="button" data-direction="down"
                style="padding:6px 12px;border:none;border-radius:0;background:transparent;color:white;transition:all 0.2s;cursor:pointer;">
                <span class="material-icons" style="font-size:20px;">arrow_downward</span>
            </button>
        `;

        const upBtn   = moveWrapper.querySelector('[data-direction="up"]');
        const downBtn = moveWrapper.querySelector('[data-direction="down"]');

        [upBtn, downBtn].forEach(btn => {
            btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.15)'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
        });

        upBtn.addEventListener('click',   (e) => { e.preventDefault(); e.stopPropagation(); this.moveBlock('up',   moveWrapper); });
        downBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.moveBlock('down', moveWrapper); });

        return moveWrapper;
    }

    moveBlock(direction, controlElement) {
        const mediaBlock = controlElement.closest('.t2-media-block');
        if (!mediaBlock) return;

        const sibling = direction === 'up'
            ? mediaBlock.previousElementSibling
            : mediaBlock.nextElementSibling;
        if (!sibling) return;

        if (direction === 'up') {
            mediaBlock.parentNode.insertBefore(mediaBlock, sibling);
        } else {
            mediaBlock.parentNode.insertBefore(mediaBlock, sibling.nextElementSibling);
        }

        this.editor.createUndoPoint();
        this.editor.autoSave();

        if (this.editor.getPlugin('collab')) {
            this.editor.getPlugin('collab')._debounceUpdate();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // setupDrawingBlockEvents
    // ─────────────────────────────────────────────────────────────────────────
    // [FIX-이벤트] cloneNode() 로 기존 리스너를 완전히 초기화한 뒤 재연결.
    // initializeDrawingBlocks() 가 여러 번 호출돼도 중복 리스너가 쌓이지 않는다.
    setupDrawingBlockEvents(block) {
        const editBtn   = block.querySelector('.t2-edit-drawing');
        const deleteBtn = block.querySelector('.delete-btn');

        if (editBtn) {
            const fresh = editBtn.cloneNode(true);
            editBtn.parentNode.replaceChild(fresh, editBtn);
            fresh.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openDrawingModal(block);
            });
        }

        if (deleteBtn) {
            const fresh = deleteBtn.cloneNode(true);
            deleteBtn.parentNode.replaceChild(fresh, deleteBtn);
            fresh.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (confirm('이 그림을 삭제하시겠습니까?')) {
                    block.remove();
                    this.editor.createUndoPoint();
                    this.editor.autoSave();
                }
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // initializeDrawingBlocks — video.js 패턴의 4단계 탐지 + URL 복구 전략
    // ─────────────────────────────────────────────────────────────────────────
    //
    // [FIX-PERSIST] CMS(그누보드5 등) 가 class / data-* / img 를 부분 제거해도
    // 아래 4단계 탐지 전략 중 하나라도 통과하면 블록을 복구한다.
    //
    // 탐지 우선순위:
    //   전략 1: .t2-drawing-block           — class 생존 (정상 케이스)
    //   전략 2: [data-t2-block="drawing"]   — class 소실, data 속성 생존
    //   전략 3: img[data-drawing-url]       — data-* 소실, img 구조 생존
    //   전략 4: .t2-drawing-source[href]    — 최후 수단: fallback anchor 만 생존
    //
    // URL 복구 우선순위 (_resolveDrawingUrl):
    //   img.src → wrapper data-drawing-url → container data-drawing-url
    //   → .t2-drawing-source[href]
    //
    // 복구 후 data 속성 / fallback anchor 를 재기록해 다음 수정 시에도 영속 유지.
    // ─────────────────────────────────────────────────────────────────────────
    initializeDrawingBlocks() {
        console.log('Initializing drawing blocks...');

        const editorEl  = this.editor.editor;
        const allBlocks = new Set();

        // 에디터 직계 자식 루트 노드 추출 헬퍼
        const getRootBlock = (el) => {
            if (!el || el === editorEl) return null;
            let node = el;
            while (node.parentElement && node.parentElement !== editorEl) {
                node = node.parentElement;
            }
            return node.parentElement === editorEl ? node : null;
        };

        const addBlock = (el) => {
            if (!el) return;
            const root = getRootBlock(el);
            if (root) allBlocks.add(root);
        };

        // 전략 1: class 기반
        editorEl.querySelectorAll('.t2-drawing-block').forEach(el => addBlock(el));

        // 전략 2: [data-t2-block="drawing"] — class 소실 케이스
        editorEl.querySelectorAll('[data-t2-block="drawing"]').forEach(el => addBlock(el));

        // 전략 3: img[data-drawing-url] — data-* 소실, img 구조는 살아있는 케이스
        editorEl.querySelectorAll('img[data-drawing-url]').forEach(el => {
            addBlock(el.closest('div') || el.parentElement);
        });

        // 전략 4: .t2-drawing-source[href] — fallback anchor 만 살아있는 케이스
        editorEl.querySelectorAll('.t2-drawing-source[href]').forEach(el => {
            addBlock(el.closest('div') || el.parentElement);
        });

        allBlocks.forEach(block => {
            // 그리기 진행 중인 placeholder 블록은 건드리지 않음
            if (block.dataset.placeholder === 'true') return;

            // 다른 플러그인 블록 제외
            if (block.classList.contains('t2-video-block') ||
                block.classList.contains('t2-code-block')  ||
                block.classList.contains('t2-file-block')  ||
                block.classList.contains('t2-table-wrapper')) return;

            // ── URL 복구 헬퍼 ───────────────────────────────────────────────
            const _resolveDrawingUrl = () => {
                const placeholder1px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

                // 우선순위 1: img.src (가장 직접적)
                const img = block.querySelector('img');
                if (img && img.src &&
                    img.src !== placeholder1px &&
                    img.src !== window.location.href) {
                    return img.src;
                }
                // 우선순위 2: wrapper data-drawing-url
                const wUrl = block.getAttribute('data-drawing-url');
                if (wUrl) return wUrl;
                // 우선순위 3: container data-drawing-url (직계 자식 div 우선)
                const container = block.querySelector(':scope > div') || block.querySelector('div');
                if (container) {
                    const cUrl = container.getAttribute('data-drawing-url');
                    if (cUrl) return cUrl;
                }
                // 우선순위 4: .t2-drawing-source[href]
                const anchor = block.querySelector('.t2-drawing-source[href]');
                if (anchor) {
                    const href = anchor.getAttribute('href');
                    if (href) return href;
                }
                return null;
            };

            const drawingUrl = _resolveDrawingUrl();
            if (!drawingUrl) {
                console.warn('[T2Draw] URL 복구 실패, 블록 건너뜀:', block);
                return;
            }

            // ── 필수 클래스·속성 복원 ─────────────────────────────────────
            block.classList.add('t2-media-block', 't2-drawing-block');
            block.contentEditable = false;
            block.style.position  = 'relative';
            block.setAttribute('data-t2-block',    'drawing');
            block.setAttribute('data-drawing-url', drawingUrl);
            if (!block.getAttribute('data-block-id')) {
                block.setAttribute('data-block-id', this.generateBlockId());
            }

            // ── <P> 래핑 탈출 ──────────────────────────────────────────────
            if (block.parentNode && block.parentNode.nodeName === 'P') {
                const p = block.parentNode;
                p.parentNode.insertBefore(block, p);
                const pText = (p.textContent || '').replace(/\u200B/g, '').trim();
                if (!pText && !p.querySelector('img, iframe, video')) p.remove();
            }

            // ── container 확보 (직계 자식 div 만 탐색) ────────────────────
            // [FIX-ESCAPE] querySelector('div:first-child') 는 모든 자손을 뒤지므로
            // :scope > div 로 직계 자식만 탐색한다.
            // 컨테이너 div 가 아예 없으면 새로 생성 — 이것이 img 탈출의 근본 원인.
            let container = block.querySelector(':scope > div:not(.t2-media-controls):not(.t2-move-controls)');
            if (!container) {
                container = document.createElement('div');
                block.insertBefore(container, block.firstChild);
            }

            // ── img 복원 및 컨테이너 귀속 보장 ───────────────────────────
            // [FIX-ESCAPE] img 가 container 바깥(block 직계 자식 등)에 있으면
            // container 안으로 강제 이동. 이미지 탈출 현상의 직접 수정.
            let img = block.querySelector('img');
            if (!img) {
                img = document.createElement('img');
                img.alt = 'Drawing';
                container.insertBefore(img, container.firstChild);
            } else if (!container.contains(img)) {
                // img 가 container 외부에 있으면 container 첫 번째 자식으로 이동
                container.insertBefore(img, container.firstChild);
            }
            if (!img.src || img.src === window.location.href) {
                img.src = drawingUrl;
            }

            // ── 치수 복구 ──────────────────────────────────────────────────
            const drawingW = block.getAttribute('data-drawing-width')  ||
                             container.getAttribute('data-drawing-width')  ||
                             img.dataset.width  || '800';
            const drawingH = block.getAttribute('data-drawing-height') ||
                             container.getAttribute('data-drawing-height') ||
                             img.dataset.height || '600';

            // ── [FIX-PERSIST] wrapper / container / img 데이터 재기록 ─────
            // 다음 저장 → 수정 사이클에서도 영속성 보장
            block.setAttribute('data-drawing-width',  drawingW);
            block.setAttribute('data-drawing-height', drawingH);

            container.setAttribute('data-t2-block',       'drawing');
            container.setAttribute('data-drawing-url',    drawingUrl);
            container.setAttribute('data-drawing-width',  drawingW);
            container.setAttribute('data-drawing-height', drawingH);
            container.dataset.originalWidth  = drawingW;
            container.dataset.originalHeight = drawingH;

            img.dataset.width  = drawingW;
            img.dataset.height = drawingH;

            // ── [FIX-PERSIST] fallback anchor 갱신 / 재생성 ───────────────
            let anchor = container.querySelector('.t2-drawing-source');
            if (!anchor) {
                anchor = document.createElement('a');
                anchor.className = 't2-drawing-source';
                anchor.setAttribute('aria-hidden', 'true');
                anchor.setAttribute('tabindex', '-1');
                anchor.style.cssText =
                    'position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;';
                container.appendChild(anchor);
            }
            anchor.href = this._sanitizeURL(drawingUrl, 'href') || '';

            // ── controls 제거 후 재생성 ────────────────────────────────────
            const existingControls = block.querySelector('.t2-media-controls');
            if (existingControls) existingControls.remove();
            block.appendChild(this.createDrawingControls());
            this.setupDrawingBlockEvents(block);

            // ── move controls 제거 후 재생성 ──────────────────────────────
            const existingMoveControls = block.querySelector('.t2-move-controls');
            if (existingMoveControls) existingMoveControls.remove();
            block.appendChild(this.createMoveControls());
        });

        console.log('Drawing blocks initialization complete');
    }

    closeModal(overlay) {
        if (overlay && overlay.parentNode) overlay.remove();
        this.canvas              = null;
        this.ctx                 = null;
        this.history             = [];
        this.historyStep         = -1;
        this.currentDrawingBlock = null;
    }
}

window.T2DrawPlugin = T2DrawPlugin;
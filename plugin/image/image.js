// T2Editor/plugin/image/image.js

class T2ImagePlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['insertImage'];
        this.config = null;
        this.uploadQueue = [];
        this.maxConcurrentUploads = 3;
        this.currentUploads = 0;
        this.maxRetries = 3;
        this._nsfwApiPromise = null;
        this.loadConfig();
    }

    async loadConfig() {
        try {
            const response = await fetch(`${t2editor_url}/config/get_upload_config.php`);
            this.config = await response.json();
        } catch (error) {
            console.error('Failed to load upload config:', error);
            this.config = {
                maxUploadSize: 50,
                allowedExtensions: {
                    image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico']
                },
                acceptStrings: {
                    image: '.jpg,.jpeg,.png,.gif,.webp,.bmp,.svg,.ico'
                }
            };
        }
    }

    // ─── NSFW 필터 (브라우저/서버) ───────────────────────────────────────────────

    getNSFWApi() {
        if (!this._nsfwApiPromise) {
            this._nsfwApiPromise = (async () => {
                try {
                    const module = await import(window.T2EDITOR_NSFW_BROWSER_URL);
                    const NSFWFilterAPI = module.default;
                    const api = new NSFWFilterAPI({
                        modelUrl: window.T2EDITOR_NSFW_SERVER_URL + '?action=get_model'
                    });
                    await api.load();
                    return api;
                } catch (e) {
                    console.error('[T2NSFW] API 초기화 실패:', e);
                    throw e;
                }
            })();
        }
        return this._nsfwApiPromise;
    }

    async checkNSFW(file) {
        try {
            if (window.T2EDITOR_NSFW_MODE === 'browser') {
                const api = await this.getNSFWApi();
                const result = await api.classify(file);
                return { isNsfw: result.label === 'unsafe', prob: result.prob, error: false };
            } else {
                const formData = new FormData();
                formData.append('image', file);
                const resp = await fetch(window.T2EDITOR_NSFW_SERVER_URL + '?action=classify', {
                    method: 'POST',
                    body: formData
                });
                if (!resp.ok) {
                    const errorText = await resp.text();
                    throw new Error(`HTTP ${resp.status}: ${errorText}`);
                }
                const data = await resp.json();
                if (!data.ok) {
                    throw new Error(data.error || '서버 응답 오류');
                }
                return { isNsfw: data.label === 'unsafe', prob: data.prob, error: false };
            }
        } catch (e) {
            console.error('[T2NSFW] 검사 실패:', e);
            return { 
                isNsfw: false, 
                prob: 0, 
                error: true, 
                errorMessage: e.message || '알 수 없는 오류',
                errorType: e.name || 'Error'
            };
        }
    }

    async applyNSFWFilter(imageDataArray) {
        // NSFW 비활성화 시 필터링 없이 그대로 반환
        if (!window.T2EDITOR_NSFW_ENABLED) {
            return { allowed: imageDataArray, hasWarning: false, hasError: false };
        }

        const allowed = [];
        let hasWarning = false;
        let hasError = false;

        for (const imageData of imageDataArray) {
            if (!imageData.file) {
                allowed.push(imageData);
                continue;
            }

            const result = await this.checkNSFW(imageData.file);
            imageData.nsfwResult = result;

            if (result.error) {
                // 오류 발생 시 로그만 남기고 일단 허용하되, 사용자에게 경고 표시
                hasError = true;
                console.warn('[T2NSFW] 검사 오류 (허용하되 경고 표시):', imageData.file.name, result.errorMessage);
                allowed.push(imageData);
            } else if (result.isNsfw) {
                if (window.T2EDITOR_NSFW_ALLOW_SUSPICIOUS) {
                    hasWarning = true;
                    allowed.push(imageData);
                } else {
                    console.warn('[T2NSFW] 업로드 취소:', imageData.file.name, `(prob: ${result.prob.toFixed(3)})`);
                }
            } else {
                allowed.push(imageData);
            }
        }

        return { allowed, hasWarning, hasError };
    }

    showNSFWWarningModal() {
        if (!document.getElementById('t2-nsfw-modal-styles')) {
            const style = document.createElement('style');
            style.id = 't2-nsfw-modal-styles';
            style.textContent = `
                @keyframes t2NsfwOverlayIn {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                }
                @keyframes t2NsfwModalIn {
                    from { opacity: 0; transform: translate(-50%, -46%) scale(0.94); }
                    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                }
                @keyframes t2NsfwProgressShrink {
                    from { width: 100%; }
                    to   { width: 0%; }
                }
                #t2-nsfw-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.52);
                    backdrop-filter: blur(6px) saturate(120%);
                    -webkit-backdrop-filter: blur(6px) saturate(120%);
                    z-index: 999990;
                    animation: t2NsfwOverlayIn 0.22s ease forwards;
                }
                #t2-nsfw-modal {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    z-index: 999991;
                    width: min(460px, 88vw);
                    background: rgba(255, 255, 255, 0.15);
                    backdrop-filter: blur(28px) saturate(180%);
                    -webkit-backdrop-filter: blur(28px) saturate(180%);
                    border: 1px solid rgba(255, 255, 255, 0.30);
                    border-top-color: rgba(255, 255, 255, 0.45);
                    border-radius: 22px;
                    box-shadow:
                        0 0 0 0.5px rgba(255,255,255,0.18) inset,
                        0 1px 0 rgba(255,255,255,0.35) inset,
                        0 24px 64px rgba(0, 0, 0, 0.50),
                        0 6px 20px rgba(0, 0, 0, 0.28);
                    padding: 26px 26px 20px;
                    color: #ffffff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif;
                    animation: t2NsfwModalIn 0.30s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
                    user-select: none;
                }
                #t2-nsfw-modal .t2nsfw-header {
                    display: flex;
                    align-items: center;
                    gap: 13px;
                    margin-bottom: 15px;
                }
                #t2-nsfw-modal .t2nsfw-icon-wrap {
                    flex-shrink: 0;
                    width: 44px;
                    height: 44px;
                    background: rgba(255, 149, 0, 0.22);
                    border: 1.5px solid rgba(255, 149, 0, 0.55);
                    border-radius: 13px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 22px;
                    line-height: 1;
                }
                #t2-nsfw-modal .t2nsfw-title {
                    font-size: 16.5px;
                    font-weight: 700;
                    letter-spacing: -0.4px;
                    color: #fff;
                    text-shadow: 0 1px 6px rgba(0,0,0,0.35);
                    line-height: 1.3;
                }
                #t2-nsfw-modal .t2nsfw-subtitle {
                    font-size: 11px;
                    font-weight: 500;
                    color: rgba(255, 200, 100, 0.85);
                    margin-top: 2px;
                    letter-spacing: 0.1px;
                }
                #t2-nsfw-modal .t2nsfw-body {
                    font-size: 13px;
                    line-height: 1.75;
                    color: rgba(255, 255, 255, 0.86);
                    text-shadow: 0 1px 4px rgba(0,0,0,0.22);
                    margin-bottom: 18px;
                    word-break: keep-all;
                    word-wrap: break-word;
                }
                #t2-nsfw-modal .t2nsfw-body em {
                    font-style: normal;
                    color: rgba(255, 220, 100, 0.95);
                    font-weight: 600;
                }
                #t2-nsfw-modal .t2nsfw-sep {
                    height: 1px;
                    background: linear-gradient(90deg,
                        rgba(255,255,255,0.0),
                        rgba(255,255,255,0.18) 30%,
                        rgba(255,255,255,0.18) 70%,
                        rgba(255,255,255,0.0)
                    );
                    margin-bottom: 16px;
                }
                #t2-nsfw-modal .t2nsfw-footer {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 14px;
                }
                #t2-nsfw-modal .t2nsfw-timer-wrap {
                    flex: 1;
                    min-width: 0;
                }
                #t2-nsfw-modal .t2nsfw-timer-label {
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.52);
                    margin-bottom: 6px;
                    letter-spacing: 0.05px;
                }
                #t2-nsfw-modal .t2nsfw-progress-bg {
                    height: 3px;
                    background: rgba(255, 255, 255, 0.15);
                    border-radius: 2px;
                    overflow: hidden;
                }
                #t2-nsfw-modal .t2nsfw-progress-fill {
                    height: 100%;
                    width: 100%;
                    border-radius: 2px;
                    background: linear-gradient(90deg,
                        rgba(255, 149, 0, 0.65),
                        rgba(255, 214, 10, 0.80)
                    );
                    transform-origin: left center;
                }
                #t2-nsfw-modal .t2nsfw-close-btn {
                    flex-shrink: 0;
                    padding: 8px 20px;
                    background: rgba(255, 255, 255, 0.16);
                    border: 1px solid rgba(255, 255, 255, 0.28);
                    border-radius: 11px;
                    color: rgba(255, 255, 255, 0.92);
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    white-space: nowrap;
                    font-family: inherit;
                    letter-spacing: -0.2px;
                    transition: background 0.18s ease, border-color 0.18s ease;
                    line-height: 1;
                }
                #t2-nsfw-modal .t2nsfw-close-btn:hover {
                    background: rgba(255, 255, 255, 0.26);
                    border-color: rgba(255, 255, 255, 0.40);
                }
                #t2-nsfw-modal .t2nsfw-close-btn:active {
                    background: rgba(255, 255, 255, 0.32);
                    transform: scale(0.97);
                }
            `;
            document.head.appendChild(style);
        }

        document.getElementById('t2-nsfw-overlay')?.remove();
        document.getElementById('t2-nsfw-modal')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 't2-nsfw-overlay';

        const modal = document.createElement('div');
        modal.id = 't2-nsfw-modal';
        modal.setAttribute('role', 'alertdialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 't2nsfw-title-text');
        modal.innerHTML = `
            <div class="t2nsfw-header">
                <div class="t2nsfw-icon-wrap" aria-hidden="true">⚠️</div>
                <div>
                    <div class="t2nsfw-title" id="t2nsfw-title-text">성인 이미지 의심 감지</div>
                    <div class="t2nsfw-subtitle">NSFW Content Detected</div>
                </div>
            </div>
            <div class="t2nsfw-body">
                업로드된 이미지에서 <em>19금(성인) 콘텐츠가 의심</em>됩니다.<br>
                해당 이미지를 게시한 이후 발생하는 <em>모든 법적 책임은 작성자 본인</em>에게 있으며,
                운영자 및 서비스 제공자는 이에 대한 책임을 지지 않습니다.<br>
                게시 전 관련 법령을 반드시 확인하시기 바랍니다.
            </div>
            <div class="t2nsfw-sep"></div>
            <div class="t2nsfw-footer">
                <div class="t2nsfw-timer-wrap">
                    <div class="t2nsfw-timer-label" id="t2nsfw-timer-label">10초 후 자동으로 닫힙니다</div>
                    <div class="t2nsfw-progress-bg">
                        <div class="t2nsfw-progress-fill" id="t2nsfw-progress-fill"></div>
                    </div>
                </div>
                <button class="t2nsfw-close-btn" id="t2nsfw-close-btn" type="button">닫기</button>
            </div>
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        let closed = false;
        const closeModal = () => {
            if (closed) return;
            closed = true;
            clearInterval(tickInterval);
            clearTimeout(autoCloseTimer);
            overlay.style.transition = 'opacity 0.20s ease';
            modal.style.transition = 'opacity 0.20s ease, transform 0.20s ease';
            overlay.style.opacity = '0';
            modal.style.opacity = '0';
            modal.style.transform = 'translate(-50%, -52%) scale(0.96)';
            setTimeout(() => {
                overlay.remove();
                modal.remove();
            }, 210);
        };

        overlay.addEventListener('click', closeModal);
        document.getElementById('t2nsfw-close-btn').addEventListener('click', closeModal);

        let secondsLeft = 10;
        const timerLabel = document.getElementById('t2nsfw-timer-label');
        const progressFill = document.getElementById('t2nsfw-progress-fill');

        const tickInterval = setInterval(() => {
            secondsLeft--;
            if (timerLabel) {
                timerLabel.textContent = `${secondsLeft}초 후 자동으로 닫힙니다`;
            }
        }, 1000);

        const autoCloseTimer = setTimeout(closeModal, 10000);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (progressFill) {
                    progressFill.style.animation = 't2NsfwProgressShrink 10s linear forwards';
                }
            });
        });
    }

    // 오류 알림 모달 추가
    showNSFWErrorModal(errorDetails) {
        const errorText = typeof errorDetails === 'string' ? errorDetails : 'NSFW 검사 중 오류가 발생했습니다. 일부 이미지는 검사 없이 업로드됩니다.';
        
        if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
            T2Utils.showNotification(errorText, 'warning', 5000);
        } else {
            alert(errorText);
        }
    }

    // ─── 이미지 업로드 모달 ─────────────────────────────────

    showImageUploadModal() {
        if (!this.config) {
            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                T2Utils.showNotification('설정을 불러오는 중입니다. 잠시 후 다시 시도해주세요.', 'warning');
            } else {
                alert('설정을 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
            }
            return;
        }

        const isNsfwEnabled = window.T2EDITOR_NSFW_ENABLED === true;
        // 간소화된 상태바: 컨테이너 없이, 아이콘 + 문구 + 배지만 표시
        const statusBarHtml = isNsfwEnabled ? `
            <div class="t2-nsfw-status-bar-simple">
                <span class="material-icons t2-nsfw-status-icon-simple">auto_awesome</span>
                <span class="t2-nsfw-status-text-simple">Protected by T2Editor SafeAI</span>
                <span class="t2-nsfw-status-badge-simple" id="t2-nsfw-global-badge">검사 대기</span>
            </div>
        ` : '';

        const modalContent = `
            <div class="t2-image-editor-modal">
                <h3>이미지 추가</h3>
                <div class="t2-image-upload-area">
                    <span class="material-icons">cloud_upload</span>
                    <div class="t2-image-upload-text">클릭하여 이미지 선택</div>
                    <div class="t2-image-upload-hint">(또는 이미지를 여기로 드래그하세요)<br>최대 ${this.config.maxUploadSize}MB (최대 15개)</div>
                    <input type="file" name="bf_file[]" accept="${this.config.acceptStrings.image}" multiple>
                    <input type="hidden" name="uid" value="${this.editor.generateUid()}">
                </div>
                <div class="t2-preview-drag-hint">
                    <span class="material-icons">swap_horiz</span>
                    <span>이미지를 좌우로 드래그하여 순서를 변경할 수 있습니다</span>
                </div>
                <div class="t2-image-preview-grid"></div>
                ${statusBarHtml}
                <div class="t2-btn-group">
                    <button type="button" class="t2-btn" data-action="cancel">취소</button>
                    <button type="button" class="t2-btn" data-action="upload" disabled>추가</button>
                </div>
            </div>
        `;

        const modal = T2Utils.createModal(modalContent);
        this.setupModalEvents(modal);
    }

    setupModalEvents(modal) {
        const previewGrid = modal.querySelector('.t2-image-preview-grid');
        const fileInput = modal.querySelector('input[type="file"]');
        const uploadBtn = modal.querySelector('[data-action="upload"]');
        const uploadArea = modal.querySelector('.t2-image-upload-area');
        const dragHint = modal.querySelector('.t2-preview-drag-hint');
        const globalBadge = modal.querySelector('#t2-nsfw-global-badge');
        
        const previewFiles = new Map(); // Map<File, {previewItem, nsfwResult, statusElement}>
        let draggedItem = null;
        let lastDragOverItem = null;
        let pendingChecks = 0;
        let completedChecks = 0;
        let errorChecks = 0;

        const isNsfwEnabled = window.T2EDITOR_NSFW_ENABLED === true;

        const updateOrderNumbers = () => {
            const items = previewGrid.querySelectorAll('.t2-preview-item');
            items.forEach((item, index) => {
                const orderBadge = item.querySelector('.t2-preview-order');
                if (orderBadge) {
                    orderBadge.textContent = index + 1;
                }
            });
        };

        const updateGlobalBadge = () => {
            if (!globalBadge || !isNsfwEnabled) return;
            if (pendingChecks > 0) {
                globalBadge.textContent = `검사중 (${completedChecks}/${completedChecks + pendingChecks})`;
                globalBadge.classList.add('loading');
                globalBadge.classList.remove('safe', 'warning', 'error');
            } else {
                const total = previewFiles.size;
                if (total === 0) {
                    globalBadge.textContent = '검사 대기';
                    globalBadge.classList.remove('loading', 'safe', 'warning', 'error');
                } else {
                    const entries = Array.from(previewFiles.values());
                    const errorCount = entries.filter(v => v.nsfwResult && v.nsfwResult.error).length;
                    const unsafeCount = entries.filter(v => v.nsfwResult && !v.nsfwResult.error && v.nsfwResult.isNsfw).length;
                    const safeCount = entries.filter(v => v.nsfwResult && !v.nsfwResult.error && !v.nsfwResult.isNsfw).length;
                    
                    if (errorCount > 0) {
                        globalBadge.textContent = `오류 ${errorCount}건`;
                        globalBadge.classList.add('error');
                        globalBadge.classList.remove('safe', 'warning', 'loading');
                    } else if (unsafeCount > 0) {
                        globalBadge.textContent = `의심 ${unsafeCount}건 발견`;
                        globalBadge.classList.add('warning');
                        globalBadge.classList.remove('safe', 'loading', 'error');
                    } else {
                        globalBadge.textContent = `전체 안전 (${safeCount}건)`;
                        globalBadge.classList.add('safe');
                        globalBadge.classList.remove('warning', 'loading', 'error');
                    }
                }
            }
        };

        const updateUploadButton = () => {
            const hasAny = previewFiles.size > 0;
            // 오류가 있어도 업로드는 가능하도록 (사용자 판단에 맡김)
            uploadBtn.disabled = !hasAny || (isNsfwEnabled && pendingChecks > 0);
        };

        const showDragHint = () => {
            if (previewFiles.size > 1 && dragHint) {
                setTimeout(() => {
                    dragHint.classList.add('show');
                }, 100);
            }
        };

        const updatePreviewStatus = (previewItem, result) => {
            const statusDiv = previewItem.querySelector('.t2-nsfw-preview-status');
            if (!statusDiv) return;
            
            if (!result) {
                statusDiv.innerHTML = `<span class="material-icons loading">pending</span><span>검사중...</span>`;
                statusDiv.className = 't2-nsfw-preview-status loading';
            } else if (result.error) {
                statusDiv.innerHTML = `<span class="material-icons error">error_outline</span><span>오류</span>`;
                statusDiv.className = 't2-nsfw-preview-status error';
                // 툴팁으로 오류 메시지 표시
                if (result.errorMessage) {
                    statusDiv.title = `검사 오류: ${result.errorMessage}`;
                }
            } else if (result.isNsfw) {
                statusDiv.innerHTML = `<span class="material-icons warning">warning</span><span>의심됨</span>`;
                statusDiv.className = 't2-nsfw-preview-status warning';
                statusDiv.title = `불안전 콘텐츠 의심 (확률: ${(result.prob * 100).toFixed(1)}%)`;
            } else {
                statusDiv.innerHTML = `<span class="material-icons safe">check_circle</span><span>안전</span>`;
                statusDiv.className = 't2-nsfw-preview-status safe';
                statusDiv.title = `안전한 콘텐츠 (확률: ${(result.prob * 100).toFixed(1)}%)`;
            }
        };

        const handleFiles = async (files) => {
            const remainingSlots = 15 - previewFiles.size;
            const filesToProcess = Array.from(files).slice(0, remainingSlots);
            
            if (files.length > remainingSlots) {
                if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                    T2Utils.showNotification(`최대 15개까지만 업로드할 수 있습니다. ${filesToProcess.length}개만 추가됩니다.`, 'warning');
                }
            }

            for (const file of filesToProcess) {
                if (!this.validateImageFile(file)) continue;

                // NSFW 활성화된 경우에만 검사 관련 카운터 증가
                if (isNsfwEnabled) {
                    pendingChecks++;
                    updateGlobalBadge();
                    updateUploadButton();
                }

                const reader = new FileReader();
                reader.onload = (e) => {
                    const previewItem = document.createElement('div');
                    previewItem.className = 't2-preview-item';
                    previewItem.draggable = true;
                    
                    // NSFW 상태 영역은 활성화된 경우에만 추가
                    const nsfwStatusHtml = isNsfwEnabled ? `
                        <div class="t2-nsfw-preview-status loading">
                            <span class="material-icons loading">pending</span>
                            <span>검사중...</span>
                        </div>
                    ` : '';
                    
                    previewItem.innerHTML = `
                        <div class="t2-preview-order">${previewFiles.size + 1}</div>
                        <img src="${e.target.result}" alt="Preview">
                        ${nsfwStatusHtml}
                        <button type="button" class="t2-preview-remove">
                            <span class="material-icons">close</span>
                        </button>
                    `;

                    // 드래그 이벤트
                    previewItem.addEventListener('dragstart', (e) => {
                        draggedItem = previewItem;
                        previewItem.classList.add('dragging');
                        e.dataTransfer.effectAllowed = 'move';
                    });
                    previewItem.addEventListener('dragend', () => {
                        draggedItem = null;
                        previewItem.classList.remove('dragging');
                        if (lastDragOverItem) {
                            lastDragOverItem.classList.remove('drag-over');
                            lastDragOverItem = null;
                        }
                        updateOrderNumbers();
                    });
                    previewItem.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (draggedItem && draggedItem !== previewItem) {
                            if (lastDragOverItem && lastDragOverItem !== previewItem) {
                                lastDragOverItem.classList.remove('drag-over');
                            }
                            previewItem.classList.add('drag-over');
                            lastDragOverItem = previewItem;
                            const rect = previewItem.getBoundingClientRect();
                            const midpoint = rect.left + rect.width / 2;
                            if (e.clientX < midpoint) {
                                previewGrid.insertBefore(draggedItem, previewItem);
                            } else {
                                previewGrid.insertBefore(draggedItem, previewItem.nextSibling);
                            }
                        }
                    });
                    previewItem.addEventListener('dragleave', () => {
                        previewItem.classList.remove('drag-over');
                    });

                    // 터치 이벤트 (간략화)
                    let touchStartX, touchDirection = null, isTouchDragging = false;
                    previewItem.addEventListener('touchstart', (e) => {
                        touchStartX = e.touches[0].clientX;
                        touchDirection = null;
                        isTouchDragging = false;
                    });
                    previewItem.addEventListener('touchmove', (e) => {
                        const deltaX = Math.abs(e.touches[0].clientX - touchStartX);
                        if (!touchDirection && deltaX > 15) {
                            touchDirection = 'horizontal';
                        }
                        if (touchDirection === 'horizontal' && deltaX > 30) {
                            isTouchDragging = true;
                            e.preventDefault();
                            previewItem.classList.add('dragging');
                            const targetItem = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY)?.closest('.t2-preview-item');
                            if (targetItem && targetItem !== previewItem) {
                                if (lastDragOverItem && lastDragOverItem !== targetItem) {
                                    lastDragOverItem.classList.remove('drag-over');
                                }
                                targetItem.classList.add('drag-over');
                                lastDragOverItem = targetItem;
                                const rect = targetItem.getBoundingClientRect();
                                const midpoint = rect.left + rect.width / 2;
                                if (e.touches[0].clientX < midpoint) {
                                    previewGrid.insertBefore(previewItem, targetItem);
                                } else {
                                    previewGrid.insertBefore(previewItem, targetItem.nextSibling);
                                }
                            }
                        }
                    });
                    previewItem.addEventListener('touchend', () => {
                        previewItem.classList.remove('dragging');
                        if (lastDragOverItem) {
                            lastDragOverItem.classList.remove('drag-over');
                            lastDragOverItem = null;
                        }
                        if (isTouchDragging) updateOrderNumbers();
                        touchDirection = null;
                    });

                    const removeBtn = previewItem.querySelector('.t2-preview-remove');
                    removeBtn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const entry = previewFiles.get(file);
                        if (isNsfwEnabled && entry) {
                            if (entry.nsfwResult === undefined && pendingChecks > 0) {
                                pendingChecks--;
                            } else if (entry.nsfwResult && entry.nsfwResult.error && errorChecks > 0) {
                                errorChecks--;
                            } else if (entry.nsfwResult && !entry.nsfwResult.error && completedChecks > 0) {
                                completedChecks--;
                            }
                        }
                        previewFiles.delete(file);
                        previewItem.remove();
                        updateOrderNumbers();
                        if (isNsfwEnabled) {
                            updateGlobalBadge();
                            updateUploadButton();
                        }
                        if (previewFiles.size <= 1 && dragHint) dragHint.classList.remove('show');
                    };

                    const statusElement = isNsfwEnabled ? previewItem.querySelector('.t2-nsfw-preview-status') : null;
                    previewFiles.set(file, { previewItem, nsfwResult: null, statusElement });
                    previewGrid.appendChild(previewItem);
                    updateOrderNumbers();
                    showDragHint();

                    // NSFW 활성화된 경우에만 검사 실행
                    if (isNsfwEnabled) {
                        this.checkNSFW(file).then(result => {
                            const entry = previewFiles.get(file);
                            if (entry) {
                                entry.nsfwResult = result;
                                updatePreviewStatus(entry.previewItem, result);
                                pendingChecks--;
                                
                                if (result.error) {
                                    errorChecks++;
                                    console.warn('[T2NSFW] 개별 이미지 검사 오류:', file.name, result.errorMessage);
                                } else {
                                    completedChecks++;
                                }
                                
                                updateGlobalBadge();
                                updateUploadButton();
                            }
                        }).catch(err => {
                            // 이 catch는 checkNSFW 내부에서 이미 잡히므로 일반적으로 실행되지 않음
                            console.error('[T2NSFW] 예상치 못한 오류:', err);
                            const entry = previewFiles.get(file);
                            if (entry) {
                                const errorResult = { isNsfw: false, prob: 0, error: true, errorMessage: err.message };
                                entry.nsfwResult = errorResult;
                                updatePreviewStatus(entry.previewItem, errorResult);
                                pendingChecks--;
                                errorChecks++;
                                updateGlobalBadge();
                                updateUploadButton();
                            }
                        });
                    } else {
                        // NSFW 비활성화: 결과 없이 바로 완료 처리
                        const entry = previewFiles.get(file);
                        if (entry) {
                            entry.nsfwResult = { isNsfw: false, prob: 0, error: false };
                        }
                    }
                };
                reader.readAsDataURL(file);
            }
        };

        fileInput.onchange = (e) => handleFiles(e.target.files);
        T2Utils.setupDragAndDrop(uploadArea, handleFiles);
        
        modal.querySelector('[data-action="cancel"]').onclick = () => modal.remove();

        modal.querySelector('[data-action="upload"]').onclick = async () => {
            if (previewFiles.size === 0) return;
            if (isNsfwEnabled && pendingChecks > 0) {
                if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                    T2Utils.showNotification('모든 이미지 검사가 완료될 때까지 기다려주세요.', 'warning');
                } else {
                    alert('모든 이미지 검사가 완료될 때까지 기다려주세요.');
                }
                return;
            }

            // 허용된 이미지 필터링
            const orderedItems = Array.from(previewGrid.querySelectorAll('.t2-preview-item')).map(item => {
                for (const [file, data] of previewFiles.entries()) {
                    if (data.previewItem === item) return { file, result: data.nsfwResult };
                }
                return null;
            }).filter(Boolean);

            let allowedImages = [];
            let hasWarning = false;
            let hasError = false;
            let errorMessages = [];

            if (isNsfwEnabled) {
                for (const { file, result } of orderedItems) {
                    if (!result) continue;
                    
                    if (result.error) {
                        hasError = true;
                        errorMessages.push(`${file.name}: ${result.errorMessage || '검사 오류'}`);
                        allowedImages.push(file); // 오류 발생해도 업로드는 허용 (사용자 판단)
                    } else if (result.isNsfw) {
                        if (window.T2EDITOR_NSFW_ALLOW_SUSPICIOUS) {
                            hasWarning = true;
                            allowedImages.push(file);
                        } else {
                            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                                T2Utils.showNotification(`"${file.name}" 은(는) 19금 의심으로 업로드가 취소되었습니다.`, 'warning');
                            }
                        }
                    } else {
                        allowedImages.push(file);
                    }
                }
            } else {
                // NSFW 비활성화: 모든 이미지 허용
                allowedImages = orderedItems.map(item => item.file);
            }

            if (allowedImages.length === 0) {
                if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                    T2Utils.showNotification('업로드할 이미지가 없습니다.', 'error');
                } else {
                    alert('업로드할 이미지가 없습니다.');
                }
                return;
            }

            if (hasError) {
                // 오류 알림 표시
                this.showNSFWErrorModal(`일부 이미지(${errorMessages.length}개)의 검사에 실패했습니다.\n${errorMessages.slice(0, 3).join('\n')}${errorMessages.length > 3 ? '...' : ''}`);
            }

            if (hasWarning) {
                this.showNSFWWarningModal();
            }

            await this.handleMultipleImageInsert(allowedImages);
            modal.remove();
        };
    }

    // ─── 기존 메서드 ─────────────────────────────────────────

    handleCommand(command, button) {
        if (command === 'insertImage') {
            this.showImageUploadModal();
        }
    }

    onContentSet(html) {
        console.log('Image plugin: onContentSet called');
        setTimeout(() => {
            this.initializeImageBlocks();
        }, 50);
    }

    async handlePaste(e) {
        const clipboardData = e.clipboardData || window.clipboardData;
        if (!clipboardData) return false;
        
        let handled = false;
        
        if (clipboardData.items) {
            const imageFiles = [];
            for (let i = 0; i < clipboardData.items.length; i++) {
                const item = clipboardData.items[i];
                if (item.type.indexOf('image') !== -1) {
                    const file = item.getAsFile();
                    if (file) imageFiles.push(file);
                }
            }
            if (imageFiles.length > 0) {
                e.preventDefault();
                await this.handleMultipleImageInsert(imageFiles);
                handled = true;
            }
        }
        
        if (!handled) {
            const htmlData = clipboardData.getData('text/html');
            if (htmlData) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = htmlData;
                const images = tempDiv.querySelectorAll('img');
                if (images.length > 0) {
                    e.preventDefault();
                    await this.handlePastedImages(images);
                    handled = true;
                }
            }
        }
        
        return handled;
    }

    async handlePastedImages(images) {
        const imageDataArray = [];
        for (const img of images) {
            const src = img.src;
            const width = img.naturalWidth || parseInt(img.width) || 320;
            const height = img.naturalHeight || parseInt(img.height) || 180;
            if (src.startsWith('data:image/')) {
                try {
                    const blob = await this.dataURLtoBlob(src);
                    const file = new File([blob], 'pasted-image.png', { type: blob.type });
                    const imageData = await this.processImageFile(file);
                    if (imageData) imageDataArray.push(imageData);
                } catch (error) {
                    console.error('Failed to process base64 image:', error);
                }
            } else {
                const blockId = this.generateBlockId();
                imageDataArray.push({
                    url: src,
                    width: width,
                    height: height,
                    blockId: blockId,
                    isUploading: false
                });
            }
        }
        
        if (imageDataArray.length > 0) {
            const { allowed, hasWarning, hasError } = await this.applyNSFWFilter(imageDataArray);
            if (hasError) {
                this.showNSFWErrorModal('일부 이미지의 NSFW 검사 중 오류가 발생했습니다.');
            }
            if (hasWarning) this.showNSFWWarningModal();
            if (allowed.length > 0) {
                this.insertImageBlocks(allowed);
                allowed.forEach(imageData => {
                    if (imageData.file) this.queueUpload(imageData.file, imageData.blockId);
                });
            }
        }
    }

    dataURLtoBlob(dataURL) {
        return new Promise((resolve, reject) => {
            try {
                const arr = dataURL.split(',');
                const mime = arr[0].match(/:(.*?);/)[1];
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) u8arr[n] = bstr.charCodeAt(n);
                resolve(new Blob([u8arr], { type: mime }));
            } catch (error) {
                reject(error);
            }
        });
    }

    validateImageFile(file) {
        if (!this.config) {
            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                T2Utils.showNotification('설정을 불러오는 중입니다.', 'warning');
            }
            return false;
        }
        const fileExt = file.name.toLowerCase().split('.').pop();
        if (!this.config.allowedExtensions.image.includes(fileExt)) {
            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                T2Utils.showNotification('지원하지 않는 이미지 형식입니다.', 'error');
            } else {
                alert('지원하지 않는 이미지 형식입니다.');
            }
            return false;
        }
        const maxSize = this.config.maxUploadSize * 1024 * 1024;
        if (file.size > maxSize) {
            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                T2Utils.showNotification(`파일 크기가 너무 큽니다. (최대 ${this.config.maxUploadSize}MB)`, 'error');
            } else {
                alert(`파일 크기가 너무 큽니다. (최대 ${this.config.maxUploadSize}MB)`);
            }
            return false;
        }
        return true;
    }

    async processImageFile(file) {
        if (!this.validateImageFile(file)) return null;
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64Url = e.target.result;
                const img = new Image();
                img.onload = () => {
                    const blockId = this.generateBlockId();
                    resolve({
                        url: base64Url,
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                        blockId: blockId,
                        isUploading: true,
                        file: file
                    });
                };
                img.onerror = () => reject(new Error('이미지 로드 실패'));
                img.src = base64Url;
            };
            reader.onerror = () => reject(new Error('파일 읽기 실패'));
            reader.readAsDataURL(file);
        });
    }

    async handleMultipleImageInsert(files) {
        try {
            const imageDataArray = await Promise.all(files.map(file => this.processImageFile(file)));
            const validImages = imageDataArray.filter(data => data !== null);
            if (validImages.length === 0) return;
            const { allowed, hasWarning, hasError } = await this.applyNSFWFilter(validImages);
            if (hasError) {
                this.showNSFWErrorModal('일부 이미지의 검사 중 오류가 발생했습니다.');
            }
            if (hasWarning) this.showNSFWWarningModal();
            if (allowed.length > 0) {
                this.insertImageBlocks(allowed);
                allowed.forEach(imageData => this.queueUpload(imageData.file, imageData.blockId));
            }
        } catch (error) {
            console.error('Multiple image insert error:', error);
            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                T2Utils.showNotification('일부 이미지 처리에 실패했습니다.', 'error');
            }
        }
    }

    queueUpload(file, blockId, retryCount = 0) {
        this.uploadQueue.push({ file, blockId, retryCount });
        this.processUploadQueue();
    }

    async processUploadQueue() {
        if (this.currentUploads >= this.maxConcurrentUploads || this.uploadQueue.length === 0) return;
        const uploadTask = this.uploadQueue.shift();
        this.currentUploads++;
        try {
            await this.uploadToServer(uploadTask.file, uploadTask.blockId);
        } catch (error) {
            console.error('Upload failed:', error);
            if (uploadTask.retryCount < this.maxRetries) {
                if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                    T2Utils.showNotification(`업로드 재시도 중... (${uploadTask.retryCount + 1}/${this.maxRetries})`, 'info');
                }
                uploadTask.retryCount++;
                this.uploadQueue.unshift(uploadTask);
            } else {
                if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                    T2Utils.showNotification('이미지 업로드에 실패했습니다.', 'error');
                }
                this.markUploadFailed(uploadTask.blockId);
            }
        } finally {
            this.currentUploads--;
            this.processUploadQueue();
        }
    }

    async uploadToServer(file, blockId) {
        const formData = new FormData();
        formData.append('bf_file[]', file);
        formData.append('uid', this.editor.generateUid());
        const response = await fetch(`${t2editor_url}/plugin/image/image_upload.php`, {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        if (data.success && data.files.length > 0) {
            this.updateImageBlock(blockId, data.files[0]);
        } else {
            throw new Error(data.message || '업로드 실패');
        }
    }

    updateImageBlock(blockId, fileData) {
        const block = this.editor.editor.querySelector(`[data-block-id="${blockId}"]`);
        if (!block) return;
        const img = block.querySelector('img');
        if (img) {
            img.src = fileData.url;
            img.dataset.width = fileData.width;
            img.dataset.height = fileData.height;
        }
        block.removeAttribute('data-uploading');
        const uploadIndicator = block.querySelector('.t2-upload-indicator');
        if (uploadIndicator) uploadIndicator.remove();
    }

    markUploadFailed(blockId) {
        const block = this.editor.editor.querySelector(`[data-block-id="${blockId}"]`);
        if (!block) return;
        block.setAttribute('data-upload-failed', 'true');
        const uploadIndicator = block.querySelector('.t2-upload-indicator');
        if (uploadIndicator) uploadIndicator.innerHTML = '<span class="material-icons" style="color: #f44336;">error</span>';
    }

    insertImageBlocks(files) {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const currentBlock = this.editor.getClosestBlock(range.startContainer);
        if (currentBlock && currentBlock !== this.editor.editor) {
            const topBreak = document.createElement('p');
            if (this.editor.isIOS || this.editor.isSafari) topBreak.innerHTML = '<br>';
            else topBreak.innerHTML = '\u200B<br>';
            currentBlock.parentNode.insertBefore(topBreak, currentBlock.nextSibling);
            let lastElement = topBreak;
            files.forEach((file, index) => {
                const mediaBlock = this.createImageBlock(file);
                lastElement.parentNode.insertBefore(mediaBlock, lastElement.nextSibling);
                lastElement = mediaBlock;
                if (index < files.length - 1) {
                    const breakLine = document.createElement('p');
                    breakLine.textContent = '\u200B';
                    lastElement.parentNode.insertBefore(breakLine, lastElement.nextSibling);
                    lastElement = breakLine;
                }
            });
            const bottomBreak = document.createElement('p');
            bottomBreak.textContent = '\u200B';
            lastElement.parentNode.insertBefore(bottomBreak, lastElement.nextSibling);
            files.forEach((file, index) => {
                const blocks = this.editor.editor.querySelectorAll('.t2-media-block');
                if (blocks[blocks.length - files.length + index]) {
                    this.cleanupEmptyLines(blocks[blocks.length - files.length + index]);
                }
            });
            const newRange = document.createRange();
            newRange.setStartAfter(bottomBreak);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
            this.editor.createUndoPoint();
            this.editor.autoSave();
        }
    }

    createImageBlock(file) {
        const mediaBlock = document.createElement('div');
        mediaBlock.className = 't2-media-block';
        mediaBlock.contentEditable = false;
        mediaBlock.style.position = 'relative';
        const blockId = file.blockId || this.generateBlockId();
        mediaBlock.setAttribute('data-block-id', blockId);
        if (file.isUploading) mediaBlock.setAttribute('data-uploading', 'true');
        const container = document.createElement('div');
        container.style.width = file.width + 'px';
        container.style.maxWidth = '100%';
        container.style.margin = '0 auto';
        container.style.position = 'relative';
        container.dataset.originalWidth = file.width;
        container.dataset.originalHeight = file.height;
        const img = document.createElement('img');
        img.src = file.url;
        img.style.width = '100%';
        img.dataset.width = file.width;
        img.dataset.height = file.height;
        container.appendChild(img);
        if (file.isUploading) {
            const uploadIndicator = document.createElement('div');
            uploadIndicator.className = 't2-upload-indicator';
            uploadIndicator.style.cssText = `
                position: absolute;
                top: 10px;
                right: 10px;
                background: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 5px 10px;
                border-radius: 4px;
                font-size: 12px;
                display: flex;
                align-items: center;
                gap: 5px;
            `;
            uploadIndicator.innerHTML = `
                <span class="material-icons" style="font-size: 14px; animation: spin 1s linear infinite;">sync</span>
                <span>업로드 중...</span>
            `;
            container.appendChild(uploadIndicator);
            if (!document.querySelector('style[data-t2-spin]')) {
                const style = document.createElement('style');
                style.setAttribute('data-t2-spin', 'true');
                style.textContent = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
                document.head.appendChild(style);
            }
        }
        mediaBlock.appendChild(container);
        const controls = this.createMediaControls(container, img, blockId);
        mediaBlock.appendChild(controls);
        const moveControls = this.createMoveControls();
        mediaBlock.appendChild(moveControls);
        return mediaBlock;
    }

    createMediaControls(container, mediaElement, blockId) {
        const controls = document.createElement('div');
        controls.className = 't2-media-controls';
        controls.contentEditable = false;
        const width = parseInt(mediaElement.dataset.width) || parseInt(container.style.width) || 320;
        const height = parseInt(mediaElement.dataset.height) || parseInt(container.style.height) || 180;
        const editorWidth = this.editor.editor.clientWidth;
        const maxWidthPercentage = Math.min(100, Math.floor((editorWidth / width) * 100));
        const currentWidth = parseInt(container.style.width) || width;
        const percentage = container.dataset.sliderPercentage || Math.round((currentWidth / width) * 100);
        controls.innerHTML = `
            <button class="t2-btn delete-btn" type="button">
                <span class="material-icons">delete</span>
            </button>
            <input type="range" min="30" max="${maxWidthPercentage}" value="${percentage}" class="size-slider" style="width: 100px;">
        `;
        const sizeSlider = controls.querySelector('.size-slider');
        if (sizeSlider) {
            const resizeObserver = new ResizeObserver(() => {
                const newEditorWidth = this.editor.editor.clientWidth;
                const newMaxPercentage = Math.min(100, Math.floor((newEditorWidth / width) * 100));
                sizeSlider.max = newMaxPercentage;
                if (parseInt(sizeSlider.value) > newMaxPercentage) {
                    sizeSlider.value = newMaxPercentage;
                    const newWidth = Math.round((width * newMaxPercentage) / 100);
                    container.style.width = `${newWidth}px`;
                    container.style.maxWidth = '100%';
                    mediaElement.style.width = '100%';
                    container.dataset.sliderPercentage = newMaxPercentage;
                }
            });
            resizeObserver.observe(this.editor.editor);
            let isSliding = false;
            let slideTimer = null;
            sizeSlider.addEventListener('mousedown', () => { isSliding = true; });
            sizeSlider.addEventListener('mouseup', () => {
                isSliding = false;
                if (this.editor.getPlugin('collab')) this.editor.getPlugin('collab')._debounceUpdate();
            });
            sizeSlider.addEventListener('input', (e) => {
                const percentage = parseInt(e.target.value);
                const newWidth = Math.round((width * percentage) / 100);
                container.style.width = `${newWidth}px`;
                container.style.maxWidth = '100%';
                mediaElement.style.width = '100%';
                container.dataset.sliderPercentage = percentage;
                if (isSliding) {
                    if (slideTimer) clearTimeout(slideTimer);
                    slideTimer = setTimeout(() => {
                        if (this.editor.getPlugin('collab')) this.editor.getPlugin('collab')._debounceUpdate();
                    }, 300);
                }
            });
            const updateSliderFromDOM = () => {
                const currentPercentage = container.dataset.sliderPercentage;
                if (currentPercentage && parseInt(sizeSlider.value) !== parseInt(currentPercentage)) {
                    sizeSlider.value = currentPercentage;
                }
            };
            setInterval(updateSliderFromDOM, 100);
        }
        const deleteBtn = controls.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const mediaBlock = controls.closest('.t2-media-block');
                if (mediaBlock) {
                    mediaBlock.remove();
                    this.editor.createUndoPoint();
                    this.editor.autoSave();
                    if (this.editor.getPlugin('collab')) this.editor.getPlugin('collab')._debounceUpdate();
                }
            });
        }
        return controls;
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
            btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.15)'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
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
        const mediaBlock = controlElement.closest('.t2-media-block');
        if (!mediaBlock) return;
        const sibling = direction === 'up' ? mediaBlock.previousElementSibling : mediaBlock.nextElementSibling;
        if (!sibling) return;
        if (direction === 'up') mediaBlock.parentNode.insertBefore(mediaBlock, sibling);
        else mediaBlock.parentNode.insertBefore(mediaBlock, sibling.nextElementSibling);
        this.editor.createUndoPoint();
        this.editor.autoSave();
        if (this.editor.getPlugin('collab')) this.editor.getPlugin('collab')._debounceUpdate();
    }

    cleanupEmptyLines(imageBlock) {
        let prev = imageBlock.previousElementSibling;
        let emptyCount = 0;
        const toRemove = [];
        while (prev && prev.tagName === 'P' && !prev.textContent.trim() && (prev.innerHTML === '<br>' || prev.querySelector('br'))) {
            emptyCount++;
            if (emptyCount > 1) toRemove.push(prev);
            prev = prev.previousElementSibling;
        }
        let next = imageBlock.nextElementSibling;
        emptyCount = 0;
        while (next && next.tagName === 'P' && !next.textContent.trim() && (next.innerHTML === '<br>' || next.querySelector('br'))) {
            emptyCount++;
            if (emptyCount > 1) toRemove.push(next);
            next = next.nextElementSibling;
        }
        toRemove.forEach(el => el.remove());
    }

    initializeImageBlocks() {
        console.log('Initializing image blocks...');
        this.editor.editor.querySelectorAll('img:not(.t2-media-block img)').forEach(img => {
            const width = parseInt(img.style.width) || img.naturalWidth || 320;
            const height = parseInt(img.style.height) || img.naturalHeight || 180;
            const mediaBlock = this.createImageBlock({
                url: img.src,
                width: width,
                height: height
            });
            img.parentNode.replaceChild(mediaBlock, img);
            this.cleanupEmptyLines(mediaBlock);
        });
        this.editor.editor.querySelectorAll('.t2-media-block').forEach(block => {
            if (block.querySelector('iframe, video')) return;
            const container = block.querySelector('div:first-child');
            const mediaElement = container?.querySelector('img');
            if (mediaElement) {
                block.contentEditable = false;
                block.style.position = 'relative';
                if (!block.getAttribute('data-block-id')) block.setAttribute('data-block-id', this.generateBlockId());
                const currentWidth = parseInt(container.style.width) || 320;
                const currentHeight = parseInt(container.style.height) || 180;
                if (!container.style.maxWidth) container.style.maxWidth = '100%';
                if (!container.style.margin) container.style.margin = '0 auto';
                mediaElement.style.width = '100%';
                if (!container.dataset.originalWidth) container.dataset.originalWidth = mediaElement.dataset.width || currentWidth;
                if (!container.dataset.originalHeight) container.dataset.originalHeight = mediaElement.dataset.height || currentHeight;
                if (block.parentNode.nodeName === 'P') {
                    const p = block.parentNode;
                    p.parentNode.insertBefore(block, p);
                    p.remove();
                }
                const existingControls = block.querySelector('.t2-media-controls');
                if (existingControls) existingControls.remove();
                const controls = this.createMediaControls(container, mediaElement, block.getAttribute('data-block-id'));
                block.appendChild(controls);
                const existingMoveControls = block.querySelector('.t2-move-controls');
                if (existingMoveControls) existingMoveControls.remove();
                const moveControls = this.createMoveControls();
                block.appendChild(moveControls);
                this.cleanupEmptyLines(block);
            }
        });
        console.log('Image blocks initialization complete');
    }

    generateBlockId() {
        return `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

window.T2ImagePlugin = T2ImagePlugin;

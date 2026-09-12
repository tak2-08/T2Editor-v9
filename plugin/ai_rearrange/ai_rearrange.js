// Path: T2Editor/plugin/ai_rearrange/ai_rearrange.js

class T2Ai_rearrangePlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['rearrangeContent'];
        this.modal = null;
        this.isProcessing = false;
        this.pendingCommands = null;
        this.pendingIndexed = null;
        this.currentInstruction = null;
        
        this.detailEditMode = false;
        this.detailEditOverlay = null;
        this.detailEditModal = null;
        this.detailEditExitButton = null;
        this.selectedElements = [];
        this.detailEditGuide = null;
        this.scrollHandler = null;
        this.resizeHandler = null;
        
        this.retryCount = 0;
        this.maxRetries = 15;
        this.delayAfter = 5;
        this.delayMs = 1500;
        this.isRetrying = false;
        
        const baseUrl = 'https://dsclub.kr/api/ai/t2editor/groq/interaction_content/index.php';
        
        this.apiUrl = baseUrl;
        this.limitsUrl = baseUrl + '?mode=limits';
        this.modelListUrl = baseUrl + '?mode=models';
        
        this.sharedSecret = 'dsclubT2Editor2025';
        this.rateLimitSecret = 'RateLimitSecret2025!@#';
        
        this.rateLimit = {
            ip: { remaining: null, limit: null },
            domain: { remaining: null, limit: null }
        };
        
        this.maxInputChars = null;
        this.aiModels = [];
        this.fallbackModels = ['Groq AI 모델 자동 선택'];
        
        this.limitsLoaded = false;
        this.rateLimitsLoaded = false;
        this.limitsLoadPromise = this.loadLimits();
        this.loadModelList();
        
        console.log('T2Ai_rearrangePlugin initialized');
    }

    async loadLimits() {
        try {
            const response = await fetch(this.limitsUrl, {
                method: 'GET',
                cache: 'no-cache',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.max_input_chars) {
                this.maxInputChars = data.max_input_chars;
            } else {
                this.maxInputChars = 10000;
            }
            
            if (data.ip_limit && data.domain_limit) {
                this.rateLimit.ip.limit = data.ip_limit;
                this.rateLimit.domain.limit = data.domain_limit;
            }
            
            this.limitsLoaded = true;
            
            console.log('Rearrangement limits loaded:', {
                maxInputChars: this.maxInputChars,
                rateLimit: this.rateLimit
            });
        } catch (error) {
            console.error('Failed to load rearrangement limits:', error);
            this.maxInputChars = 10000;
            this.limitsLoaded = false;
        }
    }

    async loadModelList() {
        try {
            const response = await fetch(this.modelListUrl, {
                method: 'GET',
                cache: 'no-cache'
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.models && Array.isArray(data.models) && data.models.length > 0) {
                    this.aiModels = data.models;
                    console.log('AI models loaded:', this.aiModels.length);
                    return;
                }
            }
        } catch (error) {
            console.warn('Failed to load model list:', error);
        }
        
        this.aiModels = this.fallbackModels;
        console.log('Using fallback AI models');
    }

    async loadRateLimits() {
        const licenseToken = window.T2EDITOR_LICENSE_TOKEN;
        if (!licenseToken) {
            console.warn('License token not available for rate limit load');
            this.rateLimit.ip.remaining = this.rateLimit.ip.limit;
            this.rateLimit.domain.remaining = this.rateLimit.domain.limit;
            this.rateLimitsLoaded = true;
            return;
        }

        try {
            const domainSig = await this.generateDomainSignature();
            const timestamp = Math.floor(Date.now() / 1000);
            const verifyHash = await this.generateVerifyHash(licenseToken, timestamp);
            
            const headers = {
                'Content-Type': 'application/json',
                'X-Domain-Timestamp': domainSig.timestamp,
                'X-Domain-Nonce': domainSig.nonce,
                'X-Domain-Signature': domainSig.signature,
                'X-T2Editor-License': licenseToken,
                'X-T2Editor-Timestamp': timestamp.toString(),
                'X-T2Editor-Verify': verifyHash
            };

            if (this.sharedSecret) {
                const signature = await this.generateSignature('');
                headers['X-DSCLUB-SIGN'] = signature;
            }

            const response = await fetch(this.apiUrl, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            
            if (data._rate_limit) {
                this.rateLimit.ip.remaining = data._rate_limit.ip.remaining ?? this.rateLimit.ip.limit;
                this.rateLimit.domain.remaining = data._rate_limit.domain.remaining ?? this.rateLimit.domain.limit;
                this.rateLimitsLoaded = true;
                console.log('Rate limits loaded:', this.rateLimit);
            } else {
                this.rateLimit.ip.remaining = this.rateLimit.ip.limit;
                this.rateLimit.domain.remaining = this.rateLimit.domain.limit;
                this.rateLimitsLoaded = true;
            }
        } catch (error) {
            console.error('Failed to load rate limits:', error);
            this.rateLimit.ip.remaining = this.rateLimit.ip.limit;
            this.rateLimit.domain.remaining = this.rateLimit.domain.limit;
            this.rateLimitsLoaded = true;
        }
    }

    handleCommand(command, button) {
        if (command === 'rearrangeContent') {
            this.openRearrangeModal();
        }
    }

    async openRearrangeModal() {
        if (!this.limitsLoaded) {
            try {
                await this.limitsLoadPromise;
            } catch (error) {
                console.error('Limits loading failed:', error);
            }
        }

        if (!this.rateLimitsLoaded) {
            await this.loadRateLimits();
        }

        if (this.modal) {
            this.modal.remove();
        }

        const overlay = document.createElement('div');
        overlay.className = 't2-rearrange-modal-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10001;
        `;

        const modal = document.createElement('div');
        modal.className = 't2-rearrange-modal';
        modal.style.cssText = `
            background: white;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
            width: 95%;
            max-width: 900px;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 20px;
            border-bottom: 1px solid #e5e7eb;
            display: flex;
            align-items: center;
            justify-content: space-between;
        `;
        header.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="material-icons" style="color: #667eea;">auto_fix_high</span>
                <h3 style="margin: 0; font-size: 18px; font-weight: 600;">AI 콘텐츠 재배치</h3>
            </div>
            <button class="t2-rearrange-close" style="
                background: none;
                border: none;
                cursor: pointer;
                padding: 5px;
                display: flex;
                align-items: center;
                color: #6b7280;
            ">
                <span class="material-icons">close</span>
            </button>
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            flex: 1;
            padding: 20px;
            overflow-y: auto;
            background: white;
        `;

        const currentContent = this.analyzeContent();
        
        content.innerHTML = `
            <div style="margin-bottom: 20px;">
                <label style="display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 8px;">
                    현재 콘텐츠 구조
                </label>
                <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; max-height: 150px; overflow-y: auto; font-family: monospace; font-size: 12px; color: #6b7280;">
                    ${currentContent.summary}
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <label style="display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 8px;">
                    AI에게 요청할 작업
                </label>
                <div style="position: relative;">
                    <textarea 
                        class="t2-rearrange-instruction" 
                        placeholder="예: 이미지를 제일 위로 옮기고, 중요한 내용을 강조해주세요"
                        maxlength="${this.maxInputChars || 10000}"
                        style="
                            width: 100%;
                            min-height: 100px;
                            padding: 12px 12px 30px 12px;
                            border: 1px solid #e5e7eb;
                            border-radius: 8px;
                            font-size: 14px;
                            resize: vertical;
                            font-family: inherit;
                            box-sizing: border-box;
                            outline: none;
                        "
                    ></textarea>
                    <div class="t2-ai-char-count" style="
                        position: absolute;
                        bottom: 8px;
                        right: 12px;
                        font-size: 12px;
                        color: #9ca3af;
                        pointer-events: none;
                    ">0/${this.maxInputChars || 10000}자</div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-top: 10px; gap: 12px;">
                    <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; max-width: 280px;">
                        <button class="t2-rearrange-powered" style="
                            padding: 6px 12px;
                            background: none;
                            color: #6b7280;
                            border: 1px solid #e5e7eb;
                            border-radius: 9px;
                            font-size: 12px;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            gap: 6px;
                            transition: all 0.2s;
                            width: 100%;
                        " onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='none'">
                            <span class="material-icons" style="font-size: 16px;">auto_awesome</span>
                            Powered by AI
                        </button>
                        ${this.getRateLimitBadgeHTML()}
                        <div style="font-size: 10px; color: #9ca3af; padding: 0 4px; line-height: 1.3;">
                            본 서비스는 Groq의 AI API를 이용하며<br>DSc(dsclub.kr)가 재가공하여 제공합니다<br>* 일부 콘텐츠는 법적·윤리적·DSc 자체 기준에 따라 입/출력 내용을 제한 및 필터링할 수 있습니다.
                        </div>
                    </div>
                </div>
            </div>

            <div class="t2-rearrange-result" style="display: none;">
                <label style="display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 12px;">
                    AI 처리 결과 미리보기
                </label>
                <div class="t2-rearrange-comparison" style="
                    display: flex;
                    gap: 16px;
                    margin-bottom: 16px;
                ">
                    <div class="t2-rearrange-original" style="flex: 1; min-width: 0;">
                        <div style="font-size: 12px; color: #6b7280; margin-bottom: 6px;">원본 구조</div>
                        <div style="
                            background: #f9fafb;
                            border: 1px solid #e5e7eb;
                            border-radius: 8px;
                            padding: 12px;
                            max-height: 200px;
                            overflow-x: auto;
                            overflow-y: auto;
                            font-family: monospace;
                            font-size: 11px;
                            color: #6b7280;
                            white-space: pre-wrap;
                            word-wrap: break-word;
                        ">${currentContent.summary}</div>
                    </div>
                    <div class="t2-rearrange-preview-container" style="flex: 1; min-width: 0;">
                        <div style="font-size: 12px; color: #6b7280; margin-bottom: 6px;">수정된 구조</div>
                        <div class="t2-rearrange-preview" style="
                            background: #f0f9ff;
                            border: 1px solid #bae6fd;
                            border-radius: 8px;
                            padding: 12px;
                            max-height: 200px;
                            overflow-x: auto;
                            overflow-y: auto;
                            font-family: monospace;
                            font-size: 11px;
                            color: #0369a1;
                            white-space: pre-wrap;
                            word-wrap: break-word;
                        "></div>
                    </div>
                </div>
                <div class="t2-rearrange-commands" style="
                    background: #f9fafb;
                    border: 1px solid #e5e7eb;
                    border-radius: 8px;
                    padding: 12px;
                    margin-bottom: 16px;
                ">
                    <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">적용될 명령어</div>
                    <div class="t2-rearrange-commands-list" style="
                        font-size: 11px;
                        color: #374151;
                        line-height: 1.4;
                    "></div>
                </div>
            </div>
        `;

        const footer = document.createElement('div');
        footer.style.cssText = `
            padding: 15px 20px;
            border-top: 1px solid #e5e7eb;
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            background: white;
        `;
        footer.innerHTML = `
            <button class="t2-rearrange-detail-edit" style="
                padding: 8px 20px;
                background: #7C6EF5;
                color: #fff;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
            ">
                <span class="material-icons t2-detail-edit-icon" style="font-size: 18px;">library_add_check</span>
                <span class="t2-rearrange-detail-edit-text">세부 편집</span>
            </button>
            <button class="t2-rearrange-execute" style="
                padding: 8px 20px;
                background: #4E80ED;
                color: white;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
            ">
                <span class="material-icons" style="font-size: 18px;">auto_awesome</span>
                <span class="t2-rearrange-execute-text">생성하기</span>
            </button>
            <button class="t2-rearrange-regenerate" style="
                padding: 8px 20px;
                background: #f59e0b;
                color: white;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                display: none;
                align-items: center;
                gap: 8px;
            ">
                <span class="material-icons" style="font-size: 18px;">refresh</span>
                <span class="t2-rearrange-execute-text">재작성</span>
            </button>
            <button class="t2-rearrange-apply" style="
                padding: 8px 20px;
                background: #10b981;
                color: white;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                display: none;
                align-items: center;
                gap: 8px;
            ">
                <span class="material-icons" style="font-size: 18px;">check</span>
                <span class="t2-rearrange-execute-text">적용하기</span>
            </button>
        `;

        modal.appendChild(header);
        modal.appendChild(content);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        this.modal = overlay;

        this.setupMobileLayout();

        const closeBtn = header.querySelector('.t2-rearrange-close');
        const detailEditBtn = footer.querySelector('.t2-rearrange-detail-edit');
        const executeBtn = footer.querySelector('.t2-rearrange-execute');
        const regenerateBtn = footer.querySelector('.t2-rearrange-regenerate');
        const applyBtn = footer.querySelector('.t2-rearrange-apply');
        const instructionArea = content.querySelector('.t2-rearrange-instruction');
        const poweredBtn = content.querySelector('.t2-rearrange-powered');
        const charCount = content.querySelector('.t2-ai-char-count');

        closeBtn.addEventListener('click', () => this.closeModal());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeModal();
        });

        detailEditBtn.addEventListener('click', () => {
            this.enableDetailEditMode();
        });

        executeBtn.addEventListener('click', () => {
            const instruction = instructionArea.value.trim();
            if (instruction) {
                this.currentInstruction = instruction;
                this.executeRearrange(instruction, currentContent.indexed);
            }
        });

        regenerateBtn.addEventListener('click', () => {
            if (this.currentInstruction) {
                this.executeRearrange(this.currentInstruction, this.pendingIndexed);
            }
        });

        applyBtn.addEventListener('click', () => {
            this.applyPendingCommands();
        });

        poweredBtn.addEventListener('click', () => {
            this.showAiInfoPopup();
        });

        instructionArea.addEventListener('input', () => {
            const length = instructionArea.value.length;
            charCount.textContent = `${length}/${this.maxInputChars || 10000}자`;
            
            if (length >= this.maxInputChars) {
                charCount.style.color = '#ef4444';
            } else if (length >= this.maxInputChars * 0.9) {
                charCount.style.color = '#f59e0b';
            } else {
                charCount.style.color = '#9ca3af';
            }
        });

        instructionArea.focus();
    }

    enableDetailEditMode() {
        this.closeModal();
        this.detailEditMode = true;
        this.selectedElements = [];
        
        this.editor.editor.contentEditable = false;
        this.editor.container.style.position = 'relative';
        
        const guide = document.createElement('div');
        guide.className = 't2-detail-edit-guide';
        guide.innerHTML = `
            <div class="t2-detail-edit-guide-text">
                수정할 콘텐츠를 클릭하여 선택하세요 (여러 개 선택 가능)
            </div>
            <div class="t2-detail-edit-guide-subtext">
                선택한 콘텐츠를 다시 클릭하면 선택 취소됩니다
            </div>
        `;
        this.editor.container.appendChild(guide);
        this.detailEditGuide = guide;
        
        const exitButton = document.createElement('div');
        exitButton.className = 't2-detail-edit-exit-button';
        exitButton.innerHTML = `
            <span class="t2-detail-edit-exit-icon">
                <span class="material-icons" style="font-size: 14px;">close</span>
            </span>
            <span>세부 편집 취소</span>
        `;
        exitButton.addEventListener('click', () => this.disableDetailEditMode());
        this.editor.container.appendChild(exitButton);
        this.detailEditExitButton = exitButton;
        
        this.setupDetailEditElements();
        
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                this.disableDetailEditMode();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    setupDetailEditElements() {
        const elements = this.editor.editor.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, .t2-media-block, .t2-code-block, .t2-table-wrapper');
        
        elements.forEach(element => {
            let isNested = false;
            let parent = element.parentElement;
            while (parent && parent !== this.editor.editor) {
                if (parent.classList.contains('t2-media-block') || 
                    parent.classList.contains('t2-code-block') || 
                    parent.classList.contains('t2-table-wrapper')) {
                    isNested = true;
                    break;
                }
                parent = parent.parentElement;
            }
            
            if (isNested) return;
            
            const isImageBlock = element.classList.contains('t2-media-block') && 
                                element.querySelector('img') && 
                                !element.classList.contains('t2-drawing-block');
            
            element.style.cursor = 'pointer';
            element.style.transition = 'all 0.3s ease';
            
            const clickHandler = (e) => {
                e.stopPropagation();
                e.preventDefault();
                
                if (isImageBlock) {
                    this.showImageEditMessage();
                    return;
                }
                
                const index = this.selectedElements.indexOf(element);
                if (index > -1) {
                    this.selectedElements.splice(index, 1);
                    element.classList.remove('t2-detail-edit-selected');
                } else {
                    this.selectedElements.push(element);
                    element.classList.add('t2-detail-edit-selected');
                }
                
                if (this.selectedElements.length > 0) {
                    this.showDetailEditModal();
                } else if (this.detailEditModal) {
                    this.detailEditModal.remove();
                    this.detailEditModal = null;
                }
            };
            
            element.addEventListener('click', clickHandler);
            
            element.addEventListener('mouseenter', () => {
                if (!element.classList.contains('t2-detail-edit-selected')) {
                    element.style.boxShadow = '0 0 15px rgba(102, 126, 234, 0.3)';
                }
            });
            
            element.addEventListener('mouseleave', () => {
                if (!element.classList.contains('t2-detail-edit-selected')) {
                    element.style.boxShadow = '';
                }
            });
        });
    }

    showImageEditMessage() {
        if (this.imageMessageTimeout) {
            clearTimeout(this.imageMessageTimeout);
        }
        const existingMessage = document.querySelector('.t2-image-edit-message');
        if (existingMessage) {
            existingMessage.remove();
        }
        
        const message = document.createElement('div');
        message.className = 't2-image-edit-message';
        message.textContent = 'T2Editor AI는 아직 이미지를 수정하지 못해요.';
        
        document.body.appendChild(message);
        
        this.imageMessageTimeout = setTimeout(() => {
            if (message.parentNode) {
                message.remove();
            }
        }, 3500);
    }

    calculateModalPosition() {
        if (!this.detailEditModal || this.selectedElements.length !== 1) return;

        const element = this.selectedElements[0];
        const toolbar = this.editor.container.querySelector('.t2-toolbar');
        const editorDiv = this.editor.editor;
        
        const toolbarRect = toolbar.getBoundingClientRect();
        const containerRect = this.editor.container.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const editorRect = editorDiv.getBoundingClientRect();
        
        const modalWidth = 400;
        const modalHeight = 140;
        const padding = 10;
        
        const toolbarBottom = toolbarRect.bottom - containerRect.top;
        const elementBottom = elementRect.bottom - containerRect.top;
        
        // 에디터 영역의 실제 경계 계산 (스크롤 고려)
        const editorVisibleTop = Math.max(toolbarBottom, editorRect.top - containerRect.top);
        const editorVisibleBottom = editorRect.bottom - containerRect.top;
        
        let top = Math.max(elementBottom + padding, toolbarBottom + padding);
        let left = (elementRect.left - containerRect.left) + (elementRect.width / 2) - (modalWidth / 2);
        
        // 좌우 경계 체크
        if (left < padding) {
            left = padding;
        }
        if (left + modalWidth > this.editor.container.clientWidth - padding) {
            left = this.editor.container.clientWidth - modalWidth - padding;
        }
        
        // 하단 경계 체크 - 에디터 하단을 넘어가지 않도록
        if (top + modalHeight > editorVisibleBottom - padding) {
            // 요소 위쪽에 배치
            const elementTop = elementRect.top - containerRect.top;
            top = elementTop - modalHeight - padding;
            
            // 위쪽에 배치해도 툴바와 겹치면 툴바 아래로
            if (top < toolbarBottom + padding) {
                top = toolbarBottom + padding;
            }
        }
        
        // 최종적으로 에디터 가시 영역 내에 있도록 보정
        top = Math.max(editorVisibleTop + padding, Math.min(top, editorVisibleBottom - modalHeight - padding));
        
        this.detailEditModal.style.left = `${left}px`;
        this.detailEditModal.style.top = `${top}px`;
    }

    showDetailEditModal() {
        if (this.detailEditModal) {
            this.detailEditModal.remove();
        }
        
        if (this.selectedElements.length === 0) return;
        
        const modal = document.createElement('div');
        modal.className = 't2-detail-edit-pill-modal';
        
        const isMultiple = this.selectedElements.length > 1;
        
        if (isMultiple) {
            modal.classList.add('multiple-selection');
        }
        
        const countText = this.selectedElements.length === 1 ? '이 콘텐츠를' : `${this.selectedElements.length}개의 콘텐츠를`;
        
        modal.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                <span class="material-icons t2-detail-edit-icon" style="
                    color: #667eea;
                    font-size: 24px;
                    background: linear-gradient(135deg, #667eea, #8b5cf6);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                ">auto_awesome</span>
                <span style="font-weight: 600; font-size: 16px; color: #111827;">
                    ${countText} 어떻게 수정할까요?
                </span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <input 
                    type="text" 
                    class="t2-detail-edit-input"
                    placeholder="예: 더 자세하게 설명해줘"
                    maxlength="${this.maxInputChars || 10000}"
                    style="
                        flex: 1;
                        padding: 10px 14px;
                        border: 2px solid #e5e7eb;
                        border-radius: 12px;
                        font-size: 14px;
                        outline: none;
                        transition: all 0.3s ease;
                    "
                />
                <button class="t2-detail-edit-generate" style="
                    width: 44px;
                    height: 44px;
                    background: #7C6EF5;
                    border: none;
                    border-radius: 12px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.3s ease;
                    flex-shrink: 0;
                ">
                    <span class="material-icons t2-detail-edit-icon" style="color: white; font-size: 24px;">auto_awesome</span>
                </button>
            </div>
        `;
        
        this.editor.container.appendChild(modal);
        this.detailEditModal = modal;
        
        if (!isMultiple) {
            this.calculateModalPosition();
            
            this.scrollHandler = () => {
                if (this.selectedElements.length === 1 && this.detailEditModal) {
                    this.calculateModalPosition();
                }
            };
            
            this.resizeHandler = () => {
                if (this.selectedElements.length === 1 && this.detailEditModal) {
                    this.calculateModalPosition();
                }
            };
            
            this.editor.container.addEventListener('scroll', this.scrollHandler);
            this.editor.editor.addEventListener('scroll', this.scrollHandler);
            window.addEventListener('resize', this.resizeHandler);
        } else {
            const toolbar = this.editor.container.querySelector('.t2-toolbar');
            const containerRect = this.editor.container.getBoundingClientRect();
            const toolbarRect = toolbar.getBoundingClientRect();
            const editorDiv = this.editor.editor;
            const editorRect = editorDiv.getBoundingClientRect();
            
            const modalWidth = 400;
            const modalHeight = 140;
            
            const toolbarBottom = toolbarRect.bottom - containerRect.top;
            const visibleEditorTop = Math.max(0, toolbarBottom);
            const visibleEditorBottom = editorRect.bottom - containerRect.top;
            const visibleEditorHeight = visibleEditorBottom - visibleEditorTop;
            
            const centerTop = visibleEditorTop + (visibleEditorHeight / 2) - (modalHeight / 2);
            const centerLeft = (this.editor.container.clientWidth / 2) - (modalWidth / 2);
            
            modal.style.left = `${centerLeft}px`;
            modal.style.top = `${centerTop}px`;
            
            this.scrollHandler = () => {
                if (this.selectedElements.length > 1 && this.detailEditModal) {
                    const toolbar = this.editor.container.querySelector('.t2-toolbar');
                    const containerRect = this.editor.container.getBoundingClientRect();
                    const toolbarRect = toolbar.getBoundingClientRect();
                    const editorDiv = this.editor.editor;
                    const editorRect = editorDiv.getBoundingClientRect();
                    
                    const toolbarBottom = toolbarRect.bottom - containerRect.top;
                    const visibleEditorTop = Math.max(0, toolbarBottom);
                    const visibleEditorBottom = editorRect.bottom - containerRect.top;
                    const visibleEditorHeight = visibleEditorBottom - visibleEditorTop;
                    
                    const centerTop = visibleEditorTop + (visibleEditorHeight / 2) - (modalHeight / 2);
                    const centerLeft = (this.editor.container.clientWidth / 2) - (modalWidth / 2);
                    
                    this.detailEditModal.style.left = `${centerLeft}px`;
                    this.detailEditModal.style.top = `${centerTop}px`;
                }
            };
            
            this.resizeHandler = () => {
                if (this.selectedElements.length > 1 && this.detailEditModal) {
                    const toolbar = this.editor.container.querySelector('.t2-toolbar');
                    const containerRect = this.editor.container.getBoundingClientRect();
                    const toolbarRect = toolbar.getBoundingClientRect();
                    const editorDiv = this.editor.editor;
                    const editorRect = editorDiv.getBoundingClientRect();
                    
                    const toolbarBottom = toolbarRect.bottom - containerRect.top;
                    const visibleEditorTop = Math.max(0, toolbarBottom);
                    const visibleEditorBottom = editorRect.bottom - containerRect.top;
                    const visibleEditorHeight = visibleEditorBottom - visibleEditorTop;
                    
                    const centerTop = visibleEditorTop + (visibleEditorHeight / 2) - (modalHeight / 2);
                    const centerLeft = (this.editor.container.clientWidth / 2) - (modalWidth / 2);
                    
                    this.detailEditModal.style.left = `${centerLeft}px`;
                    this.detailEditModal.style.top = `${centerTop}px`;
                }
            };
            
            this.editor.container.addEventListener('scroll', this.scrollHandler);
            this.editor.editor.addEventListener('scroll', this.scrollHandler);
            window.addEventListener('resize', this.resizeHandler);
        }
        
        if (this.rateLimit.ip.remaining !== null) {
            const rateLimitDisplay = document.createElement('div');
            rateLimitDisplay.className = 't2-detail-edit-rate-limit';
            rateLimitDisplay.textContent = `사용 가능: ${this.rateLimit.ip.remaining}/${this.rateLimit.ip.limit || '?'}`;
            modal.appendChild(rateLimitDisplay);
        }
        
        const input = modal.querySelector('.t2-detail-edit-input');
        const generateBtn = modal.querySelector('.t2-detail-edit-generate');
        
        input.addEventListener('focus', () => {
            input.style.borderColor = '#667eea';
            input.style.boxShadow = '0 0 0 3px rgba(102, 126, 234, 0.1)';
        });
        
        input.addEventListener('blur', () => {
            input.style.borderColor = '#e5e7eb';
            input.style.boxShadow = 'none';
        });
        
        generateBtn.addEventListener('click', () => {
            const instruction = input.value.trim();
            if (instruction) {
                this.retryCount = 0;
                this.isRetrying = false;
                this.executeDetailEdit(instruction);
            }
        });
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const instruction = input.value.trim();
                if (instruction) {
                    this.retryCount = 0;
                    this.isRetrying = false;
                    this.executeDetailEdit(instruction);
                }
            }
        });
        
        input.focus();
    }

    showCustomPopup(message, duration = 3000) {
        const existingPopup = document.querySelector('.t2-custom-popup-overlay');
        if (existingPopup) {
            existingPopup.remove();
        }
        
        const overlay = document.createElement('div');
        overlay.className = 't2-custom-popup-overlay';
        
        const popup = document.createElement('div');
        popup.className = 't2-custom-popup';
        popup.innerHTML = `
            <div class="t2-custom-popup-icon material-icons">sentiment_dissatisfied</div>
            <div>${message}</div>
        `;
        
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        
        setTimeout(() => {
            overlay.style.animation = 'fadeOut 0.3s ease-in';
            setTimeout(() => {
                if (overlay.parentNode) {
                    overlay.remove();
                }
            }, 300);
        }, duration);
        
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        overlay.addEventListener('click', () => {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        });
    }

    serializeElementForPartialEdit(element) {
        if (element.classList.contains('t2-code-block')) {
            const codeElement = element.querySelector('code');
            const codeContent = codeElement ? codeElement.textContent : element.textContent;
            return `[code]${codeContent.trim()}[/code]`;
        }
        
        if (element.classList.contains('t2-table-wrapper')) {
            const table = element.querySelector('table');
            if (!table) return element.textContent;
            
            let tableData = [];
            const rows = table.querySelectorAll('tr');
            
            rows.forEach(row => {
                const cells = row.querySelectorAll('th, td');
                const cellData = Array.from(cells).map(cell => {
                    return cell.textContent.trim().replace(/\n/g, ' ');
                }).join(',');
                
                if (cellData) tableData.push(cellData);
            });
            
            return `[table]${tableData.join('\\\\n')}[/table]`;
        }
        
        if (element.classList.contains('t2-media-block') && element.querySelector('img')) {
            const img = element.querySelector('img');
            return `[img]${img.src}[/img]`;
        }
        
        if (element.classList.contains('t2-file-block')) {
            const fileName = element.querySelector('.t2-file-name') || element;
            return fileName.textContent.trim();
        }
        
        return this.convertHtmlToSpecialFormat(element.innerHTML);
    }

    convertHtmlToSpecialFormat(html) {
        let result = html;
        
        result = result.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi, 
            '[link:$2]$1[/link]');
        
        result = result.replace(/<(strong|b)(?:\s[^>]*)?>(.*?)<\/\1>/gi, '[bold]$2[/bold]');
        
        result = result.replace(/<(em|i)(?:\s[^>]*)?>(.*?)<\/\1>/gi, '[italic]$2[/italic]');
        
        result = result.replace(/<u(?:\s[^>]*)?>(.*?)<\/u>/gi, '[underlined]$1[/underlined]');
        
        result = result.replace(/<(s|del|strike)(?:\s[^>]*)?>(.*?)<\/\1>/gi, '[strikethrough]$2[/strikethrough]');
        
        result = result.replace(/<span\s+[^>]*style=["'][^"']*color:\s*([^;"']+)[^"']*["'][^>]*>(.*?)<\/span>/gi, 
            (match, color, content) => {
                const hexColor = this.rgbToHexColor(color.trim());
                return `[tcolor:${hexColor}]${content}[/tcolor]`;
            });
        
        result = result.replace(/<[^>]+>/g, '');
        
        const textarea = document.createElement('textarea');
        textarea.innerHTML = result;
        result = textarea.value;
        
        return result.trim();
    }

    rgbToHexColor(color) {
        if (color.startsWith('#')) return color;
        
        const rgb = color.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
            const r = parseInt(rgb[0]);
            const g = parseInt(rgb[1]);
            const b = parseInt(rgb[2]);
            return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        }
        
        return '#000000';
    }

    async executeDetailEdit(instruction) {
        const input = this.detailEditModal.querySelector('.t2-detail-edit-input');
        const generateBtn = this.detailEditModal.querySelector('.t2-detail-edit-generate');
        
        generateBtn.disabled = true;
        generateBtn.style.opacity = '0.6';
        input.disabled = true;
        
        generateBtn.innerHTML = `
            <div style="
                width: 20px;
                height: 20px;
                border: 3px solid rgba(255,255,255,0.3);
                border-top-color: white;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            "></div>
        `;
        
        if (this.retryCount >= this.delayAfter) {
            await new Promise(resolve => setTimeout(resolve, this.delayMs));
        }
        
        try {
            const licenseToken = window.T2EDITOR_LICENSE_TOKEN;
            if (!licenseToken) {
                throw new Error('라이센스 토큰이 없습니다');
            }
            
            const domainSig = await this.generateDomainSignature();
            const timestamp = Math.floor(Date.now() / 1000);
            const verifyHash = await this.generateVerifyHash(licenseToken, timestamp);
            
            let combinedContent = '';
            this.selectedElements.forEach((element, index) => {
                const content = this.serializeElementForPartialEdit(element);
                if (content) {
                    combinedContent += `[T:${index + 1}] ${content}\n`;
                }
            });
            
            if (!combinedContent.trim()) {
                throw new Error('선택된 콘텐츠가 비어있습니다');
            }
            
            console.log('부분 편집 요청 데이터:', {
                content: combinedContent,
                instruction: instruction
            });
            
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Domain-Timestamp': domainSig.timestamp,
                    'X-Domain-Nonce': domainSig.nonce,
                    'X-Domain-Signature': domainSig.signature,
                    'X-T2Editor-License': licenseToken,
                    'X-T2Editor-Timestamp': timestamp.toString(),
                    'X-T2Editor-Verify': verifyHash
                },
                body: JSON.stringify({
                    content: combinedContent,
                    instruction: instruction
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }
            
            console.log('부분 편집 응답 데이터:', data);
            
            if (data._rate_limit) {
                this.rateLimit.ip.remaining = data._rate_limit.ip.remaining;
                this.rateLimit.domain.remaining = data._rate_limit.domain.remaining;
            }
            
            this.retryCount = 0;
            this.isRetrying = false;
            
            if (data.commands && data.commands.length > 0) {
                this.applyPartialEditCommands(data.commands);
            } else {
                throw new Error('AI에서 유효한 응답을 받지 못했습니다');
            }
            
            this.selectedElements.forEach(el => {
                el.classList.remove('t2-detail-edit-selected');
            });
            this.selectedElements = [];
            
            if (this.detailEditModal) {
                this.detailEditModal.remove();
                this.detailEditModal = null;
            }
            
            if (this.scrollHandler) {
                this.editor.container.removeEventListener('scroll', this.scrollHandler);
                this.editor.editor.removeEventListener('scroll', this.scrollHandler);
                this.scrollHandler = null;
            }
            
            if (this.resizeHandler) {
                window.removeEventListener('resize', this.resizeHandler);
                this.resizeHandler = null;
            }
            
            this.editor.normalizeContent();
            this.editor.createUndoPoint();
            this.editor.autoSave();
            
        } catch (error) {
            console.error('세부 편집 오류:', error);
            
            if (this.retryCount < this.maxRetries) {
                this.retryCount++;
                console.log(`재요청 시도 중... (${this.retryCount}/${this.maxRetries})`);
                
                generateBtn.disabled = false;
                generateBtn.style.opacity = '1';
                generateBtn.innerHTML = '<span class="material-icons t2-detail-edit-icon" style="color: white; font-size: 24px;">auto_awesome</span>';
                input.disabled = false;
                
                setTimeout(() => {
                    this.executeDetailEdit(instruction);
                }, 100);
                
            } else {
                this.showCustomPopup('T2Editor가 많이 바빠요. 나중에 다시 시도해주세요.');
                this.disableDetailEditMode();
                
                generateBtn.disabled = false;
                generateBtn.style.opacity = '1';
                generateBtn.innerHTML = '<span class="material-icons t2-detail-edit-icon" style="color: white; font-size: 24px;">auto_awesome</span>';
                input.disabled = false;
            }
        }
    }

    applyPartialEditCommands(commands) {
        commands.forEach(cmd => {
            if (cmd.cmd === 'edit' && cmd.target && cmd.text) {
                const match = cmd.target.match(/^T:(\d+)$/);
                if (match) {
                    const index = parseInt(match[1]) - 1;
                    if (index >= 0 && index < this.selectedElements.length) {
                        const element = this.selectedElements[index];
                        this.applyEditedContent(element, cmd.text);
                    }
                }
            }
        });
    }

    applyEditedContent(element, specialFormatContent) {
        const htmlContent = this.convertSpecialFormatToHtml(specialFormatContent);
        
        if (element.classList.contains('t2-code-block')) {
            const codeElement = element.querySelector('code');
            if (codeElement) {
                const codeContent = this.extractCodeContent(specialFormatContent);
                codeElement.textContent = codeContent;
                codeElement.classList.remove('code-placeholder');
            }
        } else if (element.classList.contains('t2-table-wrapper')) {
            const newTableHtml = this.convertTableSpecialFormatToHtml(specialFormatContent);
            if (newTableHtml) {
                element.innerHTML = newTableHtml;
            }
        } else {
            element.innerHTML = htmlContent;
        }
    }

    convertSpecialFormatToHtml(specialFormat) {
        let html = specialFormat;
        
        html = html.replace(/\[code\](.*?)\[\/code\]/gis, '<pre><code>$1</code></pre>');
        
        html = html.replace(/\[img\](.*?)\[\/img\]/gi, '<img src="$1" style="max-width: 100%;" />');
        
        html = html.replace(/\[table\](.*?)\[\/table\]/gis, (match, tableData) => {
            return this.convertTableSpecialFormatToHtml(match);
        });
        
        html = html.replace(/\[link:([^\]]+)\](.*?)\[\/link\]/gi, '<a href="$2" target="_blank">$1</a>');
        
        html = html.replace(/\[bold\](.*?)\[\/bold\]/gi, '<strong>$1</strong>');
        
        html = html.replace(/\[italic\](.*?)\[\/italic\]/gi, '<em>$1</em>');
        
        html = html.replace(/\[underlined\](.*?)\[\/underlined\]/gi, '<u>$1</u>');
        
        html = html.replace(/\[strikethrough\](.*?)\[\/strikethrough\]/gi, '<s>$1</s>');
        
        html = html.replace(/\[tcolor:(#[0-9A-Fa-f]{6})\](.*?)\[\/tcolor\]/gi, '<span style="color: $1">$2</span>');
        
        return html;
    }

    extractCodeContent(specialFormat) {
        const match = specialFormat.match(/\[code\](.*?)\[\/code\]/s);
        return match ? match[1].trim() : specialFormat;
    }

    convertTableSpecialFormatToHtml(specialFormat) {
        const match = specialFormat.match(/\[table\](.*?)\[\/table\]/s);
        if (!match) return null;
        
        const tableData = match[1];
        const rows = tableData.split(/\\\\n|\n/).filter(row => row.trim());
        
        let html = '<table border="1" style="border-collapse: collapse; width: 100%;">';
        
        rows.forEach((row, index) => {
            const cells = row.split(',').map(cell => cell.trim());
            const tag = index === 0 ? 'th' : 'td';
            
            html += '<tr>';
            cells.forEach(cell => {
                html += `<${tag} style="padding: 8px; border: 1px solid #ccc;">${cell}</${tag}>`;
            });
            html += '</tr>';
        });
        
        html += '</table>';
        return html;
    }

    disableDetailEditMode() {
        this.detailEditMode = false;
        this.selectedElements = [];
        
        this.editor.editor.contentEditable = true;
        
        if (this.detailEditGuide) {
            this.detailEditGuide.remove();
            this.detailEditGuide = null;
        }
        
        if (this.detailEditModal) {
            this.detailEditModal.remove();
            this.detailEditModal = null;
        }
        
        if (this.detailEditExitButton) {
            this.detailEditExitButton.remove();
            this.detailEditExitButton = null;
        }
        
        if (this.scrollHandler) {
            this.editor.container.removeEventListener('scroll', this.scrollHandler);
            this.editor.editor.removeEventListener('scroll', this.scrollHandler);
            this.scrollHandler = null;
        }
        
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
        
        this.editor.container.style.position = '';
        
        const selected = this.editor.editor.querySelectorAll('.t2-detail-edit-selected');
        selected.forEach(el => {
            el.classList.remove('t2-detail-edit-selected');
            el.style.cursor = '';
            el.style.boxShadow = '';
        });
        
        const elements = this.editor.editor.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, .t2-media-block, .t2-code-block, .t2-table-wrapper');
        elements.forEach(el => {
            const newEl = el.cloneNode(true);
            el.parentNode.replaceChild(newEl, el);
        });
    }

    setupMobileLayout() {
        const checkMobile = () => {
            const comparison = this.modal?.querySelector('.t2-rearrange-comparison');
            if (!comparison) return;

            if (window.innerWidth <= 768) {
                comparison.style.flexDirection = 'column';
                comparison.style.gap = '12px';
            } else {
                comparison.style.flexDirection = 'row';
                comparison.style.gap = '16px';
            }
        };

        checkMobile();
        window.addEventListener('resize', checkMobile);
    }

    getRateLimitBadgeHTML() {
        const ipRemaining = this.rateLimit.ip.remaining ?? this.rateLimit.ip.limit ?? '?';
        const domainRemaining = this.rateLimit.domain.remaining ?? this.rateLimit.domain.limit ?? '?';
        const ipLimit = this.rateLimit.ip.limit ?? '?';
        const domainLimit = this.rateLimit.domain.limit ?? '?';
        
        return `
            <div class="t2-rate-limit-container" style="display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; opacity: 0.6; width: 100%;">
                <div class="rate-limit-badge" style="
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 8px;
                    background: ${ipRemaining <= 3 ? '#fef2f2' : '#f9fafb'};
                    border: 1px solid ${ipRemaining <= 3 ? '#fecaca' : '#e5e7eb'};
                    border-radius: 6px;
                    font-size: 11px;
                    color: ${ipRemaining <= 3 ? '#991b1b' : '#6b7280'};
                ">
                    <span class="material-icons" style="font-size: 14px;">${ipRemaining <= 3 ? 'warning' : 'person'}</span>
                    <span>내 요청: ${ipRemaining}/${ipLimit}</span>
                </div>
                <div class="rate-limit-badge" style="
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 8px;
                    background: ${domainRemaining <= 30 ? '#fef2f2' : '#f9fafb'};
                    border: 1px solid ${domainRemaining <= 30 ? '#fecaca' : '#e5e7eb'};
                    border-radius: 6px;
                    font-size: 11px;
                    color: ${domainRemaining <= 30 ? '#991b1b' : '#6b7280'};
                ">
                    <span class="material-icons" style="font-size: 14px;">${domainRemaining <= 30 ? 'warning' : 'public'}</span>
                    <span>서버 요청: ${domainRemaining}/${domainLimit}</span>
                </div>
            </div>
        `;
    }

    updateRateLimitDisplay(inputArea) {
        const container = inputArea?.querySelector('.t2-rate-limit-container');
        if (!container) return;
        container.outerHTML = this.getRateLimitBadgeHTML();
    }

    showAiInfoPopup() {
        const existingPopup = document.querySelector('.t2-ai-info-popup');
        if (existingPopup) {
            existingPopup.remove();
        }

        const popup = document.createElement('div');
        popup.className = 't2-ai-info-popup';

        const modelList = this.aiModels.map(model => `<li style="margin: 4px 0; font-size: 13px; color: #6b7280;">${model}</li>`).join('');

        popup.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="material-icons" style="color: #667eea; font-size: 28px;">auto_awesome</span>
                    <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #111827;">AI 콘텐츠 재배치 정보</h3>
                </div>
                <button class="t2-ai-info-close" style="
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 5px;
                    display: flex;
                    align-items: center;
                    color: #6b7280;
                ">
                    <span class="material-icons">close</span>
                </button>
            </div>
            <div style="color: #374151; line-height: 1.6;">
                <p style="margin: 0 0 16px 0; font-size: 14px;">
                    AI 콘텐츠 재배치는 기존 콘텐츠의 구조를 분석하여 사용자의 지시에 따라 자동으로 재배치, 편집, 서식 적용을 수행합니다.
                </p>
                <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #111827;">
                        <span class="material-icons t2-detail-edit-icon" style="font-size: 18px; vertical-align: middle; color: #667eea;">edit</span>
                        세부 편집 모드
                    </h4>
                    <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #6b7280;">
                        <li>개별 텍스트, 이미지, 코드블럭, 테이블을 클릭하여 선택합니다</li>
                        <li>여러 요소를 선택할 수 있으며, 다시 클릭하면 선택 취소됩니다</li>
                        <li>선택한 요소만 AI가 수정하여 빠르고 정확한 편집이 가능합니다</li>
                        <li>ESC 키 또는 하단 취소 버튼으로 편집 모드를 종료할 수 있습니다</li>
                    </ul>
                </div>
                <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #111827;">
                        <span class="material-icons" style="font-size: 18px; vertical-align: middle; color: #3b82f6;">model_training</span>
                        사용 가능한 AI 모델
                    </h4>
                    <ul style="margin: 0; padding-left: 20px; max-height: 200px; overflow-y: auto;">
                        ${modelList}
                    </ul>
                </div>
                <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; margin-bottom: 12px; opacity: 0.7;">
                    <h4 style="margin: 0 0 6px 0; font-size: 12px; font-weight: 500; color: #6b7280;">
                        <span class="material-icons" style="font-size: 14px;">info</span>
                        요청 제한
                    </h4>
                    <p style="margin: 0; font-size: 11px; color: #6b7280; line-height: 1.5;">
                        IP당 하루 최대 ${this.rateLimit.ip.limit}회 · 도메인당 하루 최대 ${this.rateLimit.domain.limit}회 · 매일 자정(KST) 초기화
                    </p>
                </div>
                <p style="margin: 0; font-size: 13px; color: #6b7280;">
                    <span class="material-icons" style="font-size: 16px; vertical-align: middle; color: #10b981;">check_circle</span>
                    요청마다 가장 적합한 모델이 자동으로 선택되어 답변을 생성합니다.
                </p>
                <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                    <p style="margin: 0; font-size: 11px; color: #9ca3af; line-height: 1.5;">
                        본 AI 서비스는 Groq의 AI API를 이용하며, DSc(dsclub.kr)가 재가공하여 제공합니다.
                    </p>
                </div>
            </div>
        `;

        document.body.appendChild(popup);

        const closeBtn = popup.querySelector('.t2-ai-info-close');
        let autoCloseTimer = null;

        const closePopup = () => {
            if (autoCloseTimer) {
                clearTimeout(autoCloseTimer);
            }
            popup.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => {
                popup.remove();
            }, 300);
        };

        closeBtn.addEventListener('click', closePopup);

        const overlay = document.createElement('div');
        overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 10001;`;
        document.body.insertBefore(overlay, popup);
        overlay.addEventListener('click', () => {
            overlay.remove();
            closePopup();
        });

        autoCloseTimer = setTimeout(() => {
            overlay.remove();
            closePopup();
        }, 10000);
    }

    analyzeContent() {
        const indexed = {
            text: [],
            images: [],
            videos: [],
            codes: [],
            tables: [],
            files: []
        };

        let summary = '';
        let textIndex = 1;

        Array.from(this.editor.editor.childNodes).forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.classList?.contains('t2-media-block')) {
                    const img = node.querySelector('img');
                    const video = node.querySelector('video');
                    
                    if (img && !node.classList.contains('t2-drawing-block')) {
                        indexed.images.push({ element: node, id: `IMG:${indexed.images.length + 1}` });
                        summary += `[IMG:${indexed.images.length}] 이미지\n`;
                    } else if (video) {
                        indexed.videos.push({ element: node, id: `VIDEO:${indexed.videos.length + 1}` });
                        summary += `[VIDEO:${indexed.videos.length}] 비디오\n`;
                    }
                } else if (node.classList?.contains('t2-code-block')) {
                    const codeEl = node.querySelector('code');
                    const codeText = codeEl ? codeEl.textContent.trim() : '';
                    indexed.codes.push({ element: node, id: `CODE:${indexed.codes.length + 1}`, content: codeText });
                    summary += `[CODE:${indexed.codes.length}] 코드블록\n`;
                } else if (node.classList?.contains('t2-table-wrapper')) {
                    indexed.tables.push({ element: node, id: `TABLE:${indexed.tables.length + 1}`, content: '테이블' });
                    summary += `[TABLE:${indexed.tables.length}] 테이블\n`;
                } else if (node.classList?.contains('t2-file-block')) {
                    indexed.files.push({ element: node, id: `FILE:${indexed.files.length + 1}` });
                    summary += `[FILE:${indexed.files.length}] 파일\n`;
                } else if (node.tagName === 'P' || node.tagName === 'DIV' ||
                           node.tagName === 'H1' || node.tagName === 'H2' ||
                           node.tagName === 'H3' || node.tagName === 'H4' ||
                           node.tagName === 'H5' || node.tagName === 'H6') {
                    // 문장 분리 없이 DOM 노드 하나당 텍스트 블록 1개로 인덱싱
                    // (문장 분리하면 같은 element에 여러 ID가 매핑되어 move 명령이 오작동)
                    const text = node.textContent.trim();
                    if (text && text !== '') {
                        const content = this.convertHtmlToSpecialFormat(node.innerHTML);
                        indexed.text.push({ element: node, id: `T:${textIndex}`, content: content || text });
                        summary += `[T:${textIndex}] ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}\n`;
                        textIndex++;
                    }
                }
            }
        });

        return { indexed, summary: summary || '(빈 콘텐츠)' };
    }

    splitIntoSentences(text) {
        const protectedPatterns = [
            /\[code[\s\S]*?\[\/code\]/gi,
            /\[img[\s\S]*?\[\/img\]/gi,
            /\[table[\s\S]*?\[\/table\]/gi,
            /\[link:[^\]]+\][\s\S]*?\[\/link\]/gi
        ];
        
        let protectedText = text;
        const protectedBlocks = [];
        
        protectedPatterns.forEach((pattern, i) => {
            protectedText = protectedText.replace(pattern, (match) => {
                const key = `___PROTECTED${i}_${protectedBlocks.length}___`;
                protectedBlocks.push({ key, value: match });
                return key;
            });
        });

        let sentences = protectedText.split(/(?<=[.!?])\s+/);
        
        sentences = sentences.map(sentence => {
            protectedBlocks.forEach(block => {
                sentence = sentence.replace(block.key, block.value);
            });
            return sentence.trim();
        }).filter(sentence => sentence.length > 0);

        return sentences.length > 0 ? sentences : [text];
    }

    buildIndexedContent(indexed) {
        let content = '';
        
        const allElements = [
            ...indexed.text,
            ...indexed.images,
            ...indexed.videos,
            ...indexed.codes,
            ...indexed.tables,
            ...indexed.files
        ].sort((a, b) => {
            const aPos = Array.from(this.editor.editor.childNodes).indexOf(a.element);
            const bPos = Array.from(this.editor.editor.childNodes).indexOf(b.element);
            return aPos - bPos;
        });

        allElements.forEach(item => {
            // 서버 parsePT()가 인식하는 [ID] 내용 형식으로 전송
            if (item.content) {
                content += `[${item.id}] ${item.content}\n`;
            } else {
                content += `[${item.id}]\n`;
            }
        });

        return content;
    }

    async executeRearrange(instruction, indexed) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        const resultArea = this.modal.querySelector('.t2-rearrange-result');
        const previewArea = this.modal.querySelector('.t2-rearrange-preview');
        const commandsList = this.modal.querySelector('.t2-rearrange-commands-list');
        const executeBtn = this.modal.querySelector('.t2-rearrange-execute');
        const regenerateBtn = this.modal.querySelector('.t2-rearrange-regenerate');
        const applyBtn = this.modal.querySelector('.t2-rearrange-apply');

        resultArea.style.display = 'block';
        executeBtn.disabled = true;
        executeBtn.style.opacity = '0.6';
        executeBtn.style.cursor = 'not-allowed';
        regenerateBtn.style.display = 'none';
        applyBtn.style.display = 'none';

        previewArea.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 15px; padding: 40px 0;">
                <div style="
                    width: 40px;
                    height: 40px;
                    border: 3px solid #e5e7eb;
                    border-top-color: #667eea;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                "></div>
                <p style="color: #6b7280; margin: 0;">AI가 콘텐츠를 분석하고 있습니다...</p>
            </div>
        `;

        try {
            const licenseToken = window.T2EDITOR_LICENSE_TOKEN;
            if (!licenseToken) {
                throw new Error('라이센스 토큰이 없습니다');
            }

            const domainSig = await this.generateDomainSignature();
            const timestamp = Math.floor(Date.now() / 1000);
            const verifyHash = await this.generateVerifyHash(licenseToken, timestamp);

            const contentStr = this.buildIndexedContent(indexed);

            if (!contentStr.trim()) {
                throw new Error('편집할 콘텐츠가 없습니다. 에디터에 내용을 입력해주세요.');
            }

            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Domain-Timestamp': domainSig.timestamp,
                    'X-Domain-Nonce': domainSig.nonce,
                    'X-Domain-Signature': domainSig.signature,
                    'X-T2Editor-License': licenseToken,
                    'X-T2Editor-Timestamp': timestamp.toString(),
                    'X-T2Editor-Verify': verifyHash
                },
                body: JSON.stringify({
                    mode: 'rearrange',
                    content: contentStr,
                    instruction: instruction
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            if (!data.commands || !Array.isArray(data.commands)) {
                throw new Error('잘못된 응답 형식');
            }

            if (data._rate_limit) {
                this.rateLimit.ip.remaining = data._rate_limit.ip.remaining;
                this.rateLimit.domain.remaining = data._rate_limit.domain.remaining;
                this.updateRateLimitDisplay();
            }

            this.pendingCommands = data.commands;
            this.pendingIndexed = indexed;

            const previewSummary = await this.generatePreviewSummary(indexed, data.commands);
            previewArea.textContent = previewSummary;

            commandsList.innerHTML = data.commands.length > 0
                ? data.commands.map(cmd => 
                    `<div style="margin-bottom: 4px;">${this.getCommandDescription(cmd)}</div>`
                  ).join('')
                : '<div style="color: #6b7280; font-style: italic;">변경사항 없음</div>';

            regenerateBtn.style.display = 'flex';
            applyBtn.style.display = 'flex';
            executeBtn.style.display = 'none';

        } catch (error) {
            console.error('재배치 오류:', error);
            previewArea.innerHTML = `
                <div style="padding: 20px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                        <span class="material-icons">error_outline</span>
                        <strong>오류 발생</strong>
                    </div>
                    <p style="margin: 0;">${error.message}</p>
                </div>
            `;
        } finally {
            this.isProcessing = false;
            executeBtn.disabled = false;
            executeBtn.style.opacity = '1';
            executeBtn.style.cursor = 'pointer';
        }
    }

    async generatePreviewSummary(indexed, commands) {
        let summary = '';
        let textIndex = 1;

        const allElements = [
            ...indexed.text,
            ...indexed.images,
            ...indexed.videos,
            ...indexed.codes,
            ...indexed.tables,
            ...indexed.files
        ];

        allElements.forEach(item => {
            if (item.content) {
                summary += `[${item.id}] ${item.content.substring(0, 50)}${item.content.length > 50 ? '...' : ''}\n`;
                textIndex++;
            } else {
                summary += `[${item.id}]\n`;
            }
        });

        if (commands.length > 0) {
            summary += `\n// ${commands.length}개의 변경사항이 적용됩니다:\n`;
            commands.forEach(cmd => {
                summary += `// ${this.getCommandDescription(cmd).replace('• ', '')}\n`;
            });
        }

        return summary || '(변경사항 없음)';
    }

    async applyPendingCommands() {
        if (!this.pendingCommands || !this.pendingIndexed) {
            return;
        }

        try {
            await this.applyCommands(this.pendingCommands, this.pendingIndexed);
            this.closeModal();
        } catch (error) {
            console.error('명령어 적용 오류:', error);
            alert('명령어 적용 중 오류가 발생했습니다: ' + error.message);
        }
    }

    async applyCommands(commands, indexed) {
        const allIndexed = {
            ...indexed.text.reduce((acc, item) => ({ ...acc, [item.id]: item }), {}),
            ...indexed.images.reduce((acc, item) => ({ ...acc, [item.id]: item }), {}),
            ...indexed.videos.reduce((acc, item) => ({ ...acc, [item.id]: item }), {}),
            ...indexed.codes.reduce((acc, item) => ({ ...acc, [item.id]: item }), {}),
            ...indexed.tables.reduce((acc, item) => ({ ...acc, [item.id]: item }), {}),
            ...indexed.files.reduce((acc, item) => ({ ...acc, [item.id]: item }), {})
        };

        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];
            await this.executeCommand(cmd, allIndexed);
        }

        this.editor.normalizeContent();
        this.editor.createUndoPoint();
        this.editor.autoSave();
    }

    async executeCommand(cmd, indexed) {
        try {
            switch (cmd.cmd) {
                case 'move': {
                    const fromItem = indexed[cmd.from];
                    if (fromItem && fromItem.element) {
                        // element를 먼저 부모에서 제거한 뒤 원하는 위치에 삽입
                        const parent = this.editor.editor;
                        const el = fromItem.element;
                        parent.removeChild(el);

                        // 제거 후 남은 childNodes 기준으로 target position 계산 (1-based)
                        const targetPos = parseInt(cmd.to) - 1;
                        const children = Array.from(parent.childNodes);

                        if (targetPos <= 0) {
                            parent.insertBefore(el, parent.firstChild);
                        } else if (targetPos >= children.length) {
                            parent.appendChild(el);
                        } else {
                            parent.insertBefore(el, children[targetPos]);
                        }
                    }
                    break;
                }

                case 'edit': {
                    const editItem = indexed[cmd.target];
                    if (editItem && editItem.element && cmd.text) {
                        const formattedHTML = this.convertSpecialFormatToHtml(cmd.text);
                        if (editItem.element.classList.contains('t2-code-block')) {
                            const codeEl = editItem.element.querySelector('code');
                            if (codeEl) {
                                const codeContent = this.extractCodeContent(cmd.text);
                                codeEl.textContent = codeContent;
                                codeEl.classList.remove('code-placeholder');
                            }
                        } else if (editItem.element.classList.contains('t2-table-wrapper')) {
                            const newTableHtml = this.convertTableSpecialFormatToHtml(cmd.text);
                            if (newTableHtml) {
                                editItem.element.innerHTML = newTableHtml;
                            }
                        } else {
                            editItem.element.innerHTML = formattedHTML;
                        }
                    }
                    break;
                }

                case 'format': {
                    const formatItem = indexed[cmd.target];
                    if (formatItem && formatItem.element && cmd.style) {
                        this.applyStyleFormat(formatItem.element, cmd.style);
                    }
                    break;
                }

                case 'delete': {
                    const deleteItem = indexed[cmd.target];
                    if (deleteItem && deleteItem.element) {
                        deleteItem.element.remove();
                        // indexed에서도 제거하여 이후 명령에서 참조 오류 방지
                        delete indexed[cmd.target];
                    }
                    break;
                }

                case 'insert':
                    await this.insertElement(cmd, indexed);
                    break;
            }
        } catch (error) {
            console.error('명령 실행 오류:', error, cmd);
        }
    }

    applyStyleFormat(element, style) {
        if (style.includes('bold')) {
            element.style.fontWeight = 'bold';
        }
        if (style.includes('italic')) {
            element.style.fontStyle = 'italic';
        }
        if (style.includes('underline')) {
            element.style.textDecoration = 'underline';
        }
        if (style.includes('strike')) {
            element.style.textDecoration = 'line-through';
        }
        if (style.includes('color:')) {
            const color = style.match(/color:(#[0-9A-Fa-f]{6})/);
            if (color) {
                element.style.color = color[1];
            }
        }
    }

    async insertElement(cmd, indexed) {
        const afterItem = indexed[cmd.after];
        let newElement;

        switch (cmd.type) {
            case 'image':
                const imagePlugin = this.editor.getPlugin('image');
                if (imagePlugin && cmd.content && cmd.content.url) {
                    newElement = imagePlugin.createImageBlock({
                        url: cmd.content.url,
                        width: 320,
                        height: 180,
                        blockId: imagePlugin.generateBlockId()
                    });
                }
                break;

            case 'code':
                const codePlugin = this.editor.getPlugin('code');
                if (codePlugin && cmd.content) {
                    newElement = codePlugin.createCodeBlock();
                    const codeElement = newElement.querySelector('code');
                    if (codeElement && cmd.content.code) {
                        codeElement.textContent = cmd.content.code;
                        codeElement.classList.remove('code-placeholder');
                    }
                }
                break;
        }

        if (newElement && afterItem && afterItem.element) {
            afterItem.element.parentNode.insertBefore(newElement, afterItem.element.nextSibling);
        } else if (newElement) {
            this.editor.editor.appendChild(newElement);
        }
    }

    getCommandDescription(cmd) {
        switch (cmd.cmd) {
            case 'move': return `• ${cmd.from}을(를) ${cmd.to}번째 줄로 이동`;
            case 'edit': return `• ${cmd.target} 내용 수정`;
            case 'format': return `• ${cmd.target}에 ${cmd.style} 적용`;
            case 'insert': return `• ${cmd.type} 추가 (${cmd.after} 뒤)`;
            case 'delete': return `• ${cmd.target} 삭제`;
            default: return '• 알 수 없는 작업';
        }
    }

    async generateDomainSignature() {
        const domain = window.location.hostname;
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonce = Math.random().toString(36).substring(2, 15);
        const data = `${domain}|${timestamp}|${nonce}`;
        const signature = await this.hmacSha256(data, this.rateLimitSecret);
        return { domain, timestamp, nonce, signature };
    }

    async hmacSha256(message, secret) {
        const encoder = new TextEncoder();
        const keyData = encoder.encode(secret);
        const messageData = encoder.encode(message);
        const key = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', key, messageData);
        return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    async generateVerifyHash(licenseToken, timestamp) {
        const data = `${licenseToken}|${timestamp}|${this.rateLimitSecret}`;
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    async generateSignature(text) {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const key = encoder.encode(this.sharedSecret);
        
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            key,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);
        return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    closeModal() {
        this.pendingCommands = null;
        this.pendingIndexed = null;
        this.currentInstruction = null;
        this.retryCount = 0;
        this.isRetrying = false;
        
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
        
        if (this.detailEditMode) {
            this.disableDetailEditMode();
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

window.T2Ai_rearrangePlugin = T2Ai_rearrangePlugin;
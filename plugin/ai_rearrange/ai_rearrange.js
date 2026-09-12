// Path: T2Editor/plugin/ai_rearrange/ai_rearrange.js

class T2Ai_rearrangePlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['rearrangeContent'];
        this.modal = null;
        this.isProcessing = false;
        this.pendingCommands = null;
        this.pendingIndexed = null;
        this.pendingRearrangeReview = null;
        this.currentInstruction = null;
        
        this.detailEditMode = false;
        this.detailEditOverlay = null;
        this.detailEditModal = null;
        this.detailEditExitButton = null;
        this.selectedElements = [];
        this.detailEditGuide = null;
        this.detailEditReviewPanel = null;
        this.rearrangeReviewPanel = null;
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

    getRearrangePromptSuggestions() {
        return [
            '구조 먼저',
            '반복 줄이기',
            '톤 정리',
            '핵심부터 배치',
            '긴 문단 나누기',
            '중복 표현 제거',
            '소제목 정리',
            '문장 흐름 자연스럽게',
            '목록으로 정리',
            '중요 내용 강조',
            '마무리 문단 정돈',
            '불필요한 수식어 줄이기',
            '이미지 설명 앞으로',
            '공식적인 톤으로',
            '부드러운 톤으로',
            '읽기 쉽게 재배열'
        ];
    }

    getRandomRearrangePromptSuggestions(count = 6) {
        const prompts = this.getRearrangePromptSuggestions().slice();
        for (let i = prompts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [prompts[i], prompts[j]] = [prompts[j], prompts[i]];
        }
        return prompts.slice(0, Math.min(count, prompts.length));
    }

    buildRearrangePromptHintsHTML(count = 6) {
        return this.getRandomRearrangePromptSuggestions(count).map((prompt) => `
            <button
                class="t2-ai-prompt-hint"
                type="button"
                data-prompt="${this.escapeAttr(prompt)}"
                aria-label="요청에 ${this.escapeAttr(prompt)} 삽입"
            >${this.escapeHtml(prompt)}</button>
        `).join('');
    }

    insertInstructionSuggestion(textarea, suggestion) {
        if (!textarea) return;

        const prompt = String(suggestion ?? '').trim();
        if (!prompt) return;

        const currentValue = textarea.value || '';
        const selectionStart = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : currentValue.length;
        const selectionEnd = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : selectionStart;
        const before = currentValue.slice(0, selectionStart);
        const after = currentValue.slice(selectionEnd);
        const leading = before.length === 0 || /\s$/.test(before) ? '' : '\n';
        const trailing = after.length === 0 || /^\s/.test(after) ? '' : '\n';
        const nextValue = `${before}${leading}${prompt}${trailing}${after}`;
        const maxInputChars = this.safePositiveInt(this.maxInputChars, 10000);

        if (nextValue.length > maxInputChars) {
            this.showCustomPopup('요청 입력 한도를 초과합니다. 일부 내용을 줄인 뒤 다시 선택해주세요.');
            textarea.focus();
            return;
        }

        textarea.value = nextValue;
        const nextCursor = before.length + leading.length + prompt.length;
        textarea.focus();
        textarea.setSelectionRange(nextCursor, nextCursor);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // ── [SEC-PLUGIN-BOUNDARY] utils.js/core.js 공통 보안 경계 래퍼 ─────────────
    // 플러그인 내부의 HTML/속성/URL/DOM 쓰기 경로는 아래 헬퍼를 통해 통일한다.
    escapeHtml(value) {
        if (window.T2Utils && typeof T2Utils.escapeHtml === 'function') {
            return T2Utils.escapeHtml(String(value ?? ''));
        }
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    }

    escapeAttr(value) {
        if (window.T2Utils && typeof T2Utils.escapeAttr === 'function') {
            return T2Utils.escapeAttr(value);
        }
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    sanitizeUrl(url, context = 'href') {
        if (window.T2Utils && typeof T2Utils.sanitizeURL === 'function') {
            return T2Utils.sanitizeURL(String(url ?? ''), context);
        }

        const raw = String(url ?? '');
        const normalized = raw.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^(javascript|vbscript):/.test(normalized)) return '';
        if (context === 'href' && /^data:/.test(normalized)) return '';
        if (context === 'iframe-src') return '';
        return raw;
    }

    sanitizeImageUrl(url) {
        const safe = this.sanitizeUrl(url, 'src');
        if (!safe) return '';

        // utils.js의 src 경계는 정상 이미지 data URI를 허용한다.
        // 이 플러그인의 이미지 컨텍스트에서는 data URI를 이미지 MIME으로 한정한다.
        const normalized = safe.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (normalized.startsWith('data:') && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(normalized)) {
            return '';
        }
        return safe;
    }

    sanitizePluginHTML(html, pluginName = 'ai_rearrange') {
        const raw = String(html ?? '');
        if (this.editor && typeof this.editor.sanitizePluginHTML === 'function') {
            return this.editor.sanitizePluginHTML(raw, pluginName);
        }

        const temp = document.createElement('div');
        temp.innerHTML = raw;
        temp.querySelectorAll('script,object,embed,base,meta,iframe,link[rel="import"]').forEach(el => el.remove());
        temp.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (/^on/i.test(attr.name) || attr.name === 'srcdoc') {
                    el.removeAttribute(attr.name);
                    return;
                }
                if (attr.name === 'href') {
                    const safe = this.sanitizeUrl(attr.value, 'href');
                    if (safe) el.setAttribute('href', safe); else el.removeAttribute('href');
                    return;
                }
                if (attr.name === 'src') {
                    const safe = el.tagName.toLowerCase() === 'img'
                        ? this.sanitizeImageUrl(attr.value)
                        : this.sanitizeUrl(attr.value, 'src');
                    if (safe) el.setAttribute('src', safe); else el.removeAttribute('src');
                }
            });
        });
        return temp.innerHTML;
    }

    sanitizeUIHTML(html) {
        const temp = document.createElement('div');
        temp.innerHTML = String(html ?? '');

        temp.querySelectorAll('script,object,embed,base,meta,iframe,link[rel="import"]').forEach(el => el.remove());
        temp.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (/^on/i.test(attr.name) || attr.name === 'srcdoc') {
                    el.removeAttribute(attr.name);
                    return;
                }
                if (attr.name === 'href') {
                    const safe = this.sanitizeUrl(attr.value, 'href');
                    if (safe) el.setAttribute('href', safe); else el.removeAttribute('href');
                    return;
                }
                if (attr.name === 'src') {
                    const safe = el.tagName.toLowerCase() === 'img'
                        ? this.sanitizeImageUrl(attr.value)
                        : this.sanitizeUrl(attr.value, 'src');
                    if (safe) el.setAttribute('src', safe); else el.removeAttribute('src');
                }
            });
        });
        return temp.innerHTML;
    }

    setSafeUIHTML(target, html) {
        if (!target) return;
        target.innerHTML = this.sanitizeUIHTML(html);
    }

    setSafeInnerHTML(target, html, pluginName = 'ai_rearrange') {
        if (!target) return;
        target.innerHTML = this.sanitizePluginHTML(html, pluginName);
    }

    safePositiveInt(value, fallback = 0) {
        const num = Number(value);
        return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
    }

    safeNonNegativeInt(value, fallback = null) {
        const num = Number(value);
        return Number.isFinite(num) && num >= 0 ? Math.floor(num) : fallback;
    }

    safeCounterValue(value, fallback = '?') {
        if (value === null || value === undefined || value === '') return fallback;
        const num = Number(value);
        if (Number.isFinite(num)) return String(Math.max(0, Math.floor(num)));
        return this.escapeHtml(value);
    }

    isCounterAtOrBelow(value, threshold) {
        const num = Number(value);
        return Number.isFinite(num) && num <= threshold;
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
            
            this.maxInputChars = this.safePositiveInt(data.max_input_chars, 10000);
            
            if (data.ip_limit && data.domain_limit) {
                this.rateLimit.ip.limit = this.safeNonNegativeInt(data.ip_limit, this.rateLimit.ip.limit);
                this.rateLimit.domain.limit = this.safeNonNegativeInt(data.domain_limit, this.rateLimit.domain.limit);
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
                    this.aiModels = data.models.map(model => String(model ?? '')).filter(Boolean);
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
                this.rateLimit.ip.remaining = this.safeNonNegativeInt(data._rate_limit.ip.remaining, this.rateLimit.ip.limit);
                this.rateLimit.domain.remaining = this.safeNonNegativeInt(data._rate_limit.domain.remaining, this.rateLimit.domain.limit);
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

        const modal = document.createElement('div');
        modal.className = 't2-rearrange-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 't2-rearrange-title');

        const currentContent = this.analyzeContent();
        const maxInputChars = this.safePositiveInt(this.maxInputChars, 10000);

        const header = document.createElement('div');
        header.className = 't2-rearrange-header';
        this.setSafeUIHTML(header, `
            <div class="t2-rearrange-title-block">
                <span class="material-icons t2-rearrange-title-icon" aria-hidden="true">auto_fix_high</span>
                <div class="t2-rearrange-title-copy">
                    <div class="t2-rearrange-eyebrow">AI 문서 정리</div>
                    <h3 id="t2-rearrange-title">구조와 문장을 정돈합니다</h3>
                    <p>요청한 기준에 맞춰 콘텐츠 순서, 문장 톤, 형식을 조정합니다.</p>
                </div>
            </div>
            <button class="t2-rearrange-close" type="button" aria-label="닫기">
                <span class="material-icons" aria-hidden="true">close</span>
            </button>
        `);

        const content = document.createElement('div');
        content.className = 't2-rearrange-content';

        this.setSafeUIHTML(content, `
            <div class="t2-ai-workspace">
                <section class="t2-ai-section t2-ai-context-section" aria-label="현재 콘텐츠 구조">
                    <div class="t2-ai-section-head">
                        <label class="t2-ai-section-label">현재 구조</label>
                        <p class="t2-ai-section-desc">AI가 참고할 블록 단위 요약입니다.</p>
                    </div>
                    <div class="t2-ai-content-map t2-ai-content-map--context" tabindex="0">${this.escapeHtml(currentContent.summary)}</div>
                </section>

                <section class="t2-ai-section t2-ai-section--request" aria-label="AI 작업 요청">
                    <div class="t2-ai-section-head">
                        <label class="t2-ai-section-label" for="t2-rearrange-instruction">요청</label>
                        <p class="t2-ai-section-desc">순서, 강조 방식, 문장 톤을 구체적으로 적어주세요.</p>
                    </div>
                    <div class="t2-ai-input-shell">
                        <textarea
                            id="t2-rearrange-instruction"
                            class="t2-rearrange-instruction"
                            placeholder="예: 이미지를 먼저 보여주고, 핵심 문단을 앞쪽으로 옮겨 자연스럽게 정리해줘"
                            maxlength="${this.escapeAttr(maxInputChars)}"
                        ></textarea>
                        <div class="t2-ai-char-count">0/${this.escapeHtml(maxInputChars)}자</div>
                    </div>
                    <div class="t2-ai-prompt-hints" aria-label="요청 제안">
                        ${this.buildRearrangePromptHintsHTML(6)}
                    </div>
                </section>

                <section class="t2-ai-provider-card" aria-label="T2Editor AI 정보">
                    ${this.getRateLimitBadgeHTML()}
                    <button class="t2-rearrange-powered" type="button">
                        <span>Powered by T2Editor AI</span>
                    </button>
                    <p class="t2-ai-disclosure">
                        Groq API를 기반으로 DSc(dsclub.kr)가 재가공해 제공합니다. 법적·윤리적·서비스 기준에 따라 일부 요청과 출력은 제한될 수 있습니다.
                    </p>
                </section>
            </div>

            <section class="t2-rearrange-result" aria-label="AI 처리 결과" style="display: none;">
                <div class="t2-ai-section-head">
                    <label class="t2-ai-section-label">적용 전 확인</label>
                    <p class="t2-ai-section-desc">수정 전과 정리 후를 split diff로 비교한 뒤 적용하세요.</p>
                </div>
                <div class="t2-rearrange-diff-preview-shell" aria-live="polite">
                    <div class="t2-rearrange-preview"></div>
                </div>
                <div class="t2-rearrange-commands">
                    <div class="t2-ai-panel-label">적용될 작업</div>
                    <div class="t2-rearrange-commands-list"></div>
                </div>
            </section>
        `);

        const footer = document.createElement('div');
        footer.className = 't2-rearrange-footer';
        this.setSafeUIHTML(footer, `
            <button class="t2-rearrange-detail-edit" type="button">
                <span class="material-icons t2-detail-edit-icon" aria-hidden="true">library_add_check</span>
                <span class="t2-rearrange-detail-edit-text">선택 편집</span>
            </button>
            <button class="t2-rearrange-execute" type="button">
                <span class="material-icons" aria-hidden="true">auto_awesome</span>
                <span class="t2-rearrange-execute-text">정리 생성</span>
            </button>
            <button class="t2-rearrange-regenerate" type="button" style="display: none;">
                <span class="material-icons" aria-hidden="true">refresh</span>
                <span class="t2-rearrange-execute-text">다시 생성</span>
            </button>
            <button class="t2-rearrange-apply" type="button" style="display: none;">
                <span class="material-icons" aria-hidden="true">check</span>
                <span class="t2-rearrange-execute-text">변경 적용</span>
            </button>
        `);

        const workspace = content.querySelector('.t2-ai-workspace');
        const providerCard = content.querySelector('.t2-ai-provider-card');
        if (workspace && providerCard) {
            workspace.insertBefore(footer, providerCard);
        }

        modal.appendChild(header);
        modal.appendChild(content);
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
        const suggestionButtons = content.querySelectorAll('.t2-ai-prompt-hint');

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
            if (this.currentInstruction && this.pendingIndexed) {
                this.executeRearrange(this.currentInstruction, this.pendingIndexed);
            }
        });

        applyBtn.addEventListener('click', () => {
            if (this.pendingCommands && this.pendingIndexed) {
                this.applyCommands(this.pendingCommands, this.pendingIndexed);
                this.closeModal();
            }
        });

        poweredBtn.addEventListener('click', () => {
            this.showAiInfoPopup();
        });

        suggestionButtons.forEach((button) => {
            button.addEventListener('click', () => {
                this.insertInstructionSuggestion(instructionArea, button.dataset.prompt || button.textContent || '');
            });
        });

        instructionArea.addEventListener('input', () => {
            const length = instructionArea.value.length;
            const limit = this.safePositiveInt(this.maxInputChars, 10000);
            charCount.textContent = `${length}/${limit}자`;
            charCount.classList.toggle('is-danger', length >= limit);
            charCount.classList.toggle('is-warning', length < limit && length >= limit * 0.9);
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
        this.setSafeUIHTML(guide, `
            <div class="t2-detail-edit-guide-text">편집할 블록을 선택하세요</div>
            <div class="t2-detail-edit-guide-subtext">여러 블록을 선택할 수 있고, 다시 클릭하면 해제됩니다.</div>
        `);
        this.editor.container.appendChild(guide);
        this.detailEditGuide = guide;
        
        const exitButton = document.createElement('div');
        exitButton.className = 't2-detail-edit-exit-button';
        this.setSafeUIHTML(exitButton, `
            <span class="t2-detail-edit-exit-icon">
                <span class="material-icons" aria-hidden="true">close</span>
            </span>
            <span>선택 편집 종료</span>
        `);
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
            element.style.transition = 'background-color 0.16s ease, outline-color 0.16s ease';
            
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
                    element.classList.add('t2-detail-edit-hovered');
                }
            });
            
            element.addEventListener('mouseleave', () => {
                element.classList.remove('t2-detail-edit-hovered');
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
        message.textContent = '이미지 직접 수정은 아직 지원하지 않습니다.';
        
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
        
        const countText = this.selectedElements.length === 1 ? '선택한 블록' : `선택한 ${this.selectedElements.length}개 블록`;
        
        this.setSafeUIHTML(modal, `
            <div class="t2-detail-edit-head">
                <span class="material-icons t2-detail-edit-icon" aria-hidden="true">auto_awesome</span>
                <span class="t2-detail-edit-title">${this.escapeHtml(countText)}을 어떻게 다듬을까요?</span>
            </div>
            <div class="t2-detail-edit-row">
                <input
                    type="text"
                    class="t2-detail-edit-input"
                    placeholder="예: 더 간결하게 정리해줘"
                    maxlength="${this.escapeAttr(this.safePositiveInt(this.maxInputChars, 10000))}"
                />
                <button class="t2-detail-edit-generate" type="button" aria-label="선택한 블록 수정">
                    <span class="material-icons t2-detail-edit-icon" aria-hidden="true">auto_awesome</span>
                </button>
            </div>
        `);
        
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
            rateLimitDisplay.textContent = `남은 요청 ${this.rateLimit.ip.remaining}/${this.rateLimit.ip.limit || '?'}`;
            modal.appendChild(rateLimitDisplay);
        }
        
        const input = modal.querySelector('.t2-detail-edit-input');
        const generateBtn = modal.querySelector('.t2-detail-edit-generate');
        
        input.addEventListener('focus', () => {
            input.classList.add('is-focused');
        });
        
        input.addEventListener('blur', () => {
            input.classList.remove('is-focused');
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
        this.setSafeUIHTML(popup, `
            <div class="t2-custom-popup-icon material-icons" aria-hidden="true">info</div>
            <div>${this.escapeHtml(message)}</div>
        `);
        
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
        
        this.setSafeUIHTML(generateBtn, '<span class="t2-ai-spinner t2-ai-spinner--button" aria-hidden="true"></span>');
        
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
            
            const detailEditSnapshots = this.createDetailEditSnapshots();
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
                this.rateLimit.ip.remaining = this.safeNonNegativeInt(data._rate_limit.ip.remaining, this.rateLimit.ip.limit);
                this.rateLimit.domain.remaining = this.safeNonNegativeInt(data._rate_limit.domain.remaining, this.rateLimit.domain.limit);
            }
            
            this.retryCount = 0;
            this.isRetrying = false;
            
            let detailEditChanges = [];
            if (data.commands && data.commands.length > 0) {
                detailEditChanges = this.applyPartialEditCommands(data.commands, detailEditSnapshots);
            } else {
                throw new Error('AI에서 유효한 응답을 받지 못했습니다');
            }
            
            this.editor.normalizeContent();
            this.editor.createUndoPoint();
            this.editor.autoSave();
            this.disableDetailEditMode();
            this.showDetailEditSplitReview(detailEditChanges, instruction);
            
        } catch (error) {
            console.error('선택 편집 오류:', error);
            
            if (this.retryCount < this.maxRetries) {
                this.retryCount++;
                console.log(`재요청 시도 중... (${this.retryCount}/${this.maxRetries})`);
                
                generateBtn.disabled = false;
                generateBtn.style.opacity = '1';
                this.setSafeUIHTML(generateBtn, '<span class="material-icons t2-detail-edit-icon" aria-hidden="true">auto_awesome</span>');
                input.disabled = false;
                
                setTimeout(() => {
                    this.executeDetailEdit(instruction);
                }, 100);
                
            } else {
                this.showCustomPopup('요청이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
                this.disableDetailEditMode();
                
                generateBtn.disabled = false;
                generateBtn.style.opacity = '1';
                this.setSafeUIHTML(generateBtn, '<span class="material-icons t2-detail-edit-icon" aria-hidden="true">auto_awesome</span>');
                input.disabled = false;
            }
        }
    }

    createDetailEditSnapshots() {
        return this.selectedElements.map((element, index) => ({
            target: `T:${index + 1}`,
            index,
            label: this.getDetailEditBlockLabel(element, index),
            beforeText: this.getElementReviewText(element)
        }));
    }

    getDetailEditBlockLabel(element, index) {
        const tagName = String(element?.tagName || '').toLowerCase();
        if (element?.classList?.contains('t2-code-block')) return `코드 블록 ${index + 1}`;
        if (element?.classList?.contains('t2-table-wrapper')) return `표 블록 ${index + 1}`;
        if (element?.classList?.contains('t2-media-block')) return `미디어 블록 ${index + 1}`;
        if (/^h[1-6]$/.test(tagName)) return `제목 블록 ${index + 1}`;
        return `텍스트 블록 ${index + 1}`;
    }

    getElementReviewText(element) {
        if (!element) return '';

        if (element.classList?.contains('t2-code-block')) {
            const codeElement = element.querySelector('code');
            return this.normalizeReviewText(codeElement ? codeElement.textContent : element.textContent);
        }

        if (element.classList?.contains('t2-table-wrapper')) {
            const rows = Array.from(element.querySelectorAll('tr')).map(row => {
                return Array.from(row.querySelectorAll('th, td'))
                    .map(cell => this.normalizeReviewText(cell.textContent))
                    .join(' | ');
            }).filter(Boolean);

            if (rows.length > 0) return rows.join('\n');
        }

        if (element.classList?.contains('t2-media-block')) {
            const image = element.querySelector('img');
            const iframe = element.querySelector('iframe');
            const video = element.querySelector('video');
            const mediaLabel = image ? '이미지' : iframe ? '임베드' : video ? '비디오' : '미디어';
            const mediaText = element.textContent || image?.alt || image?.getAttribute('src') || iframe?.getAttribute('src') || video?.getAttribute('src') || '';
            return this.normalizeReviewText(`[${mediaLabel}] ${mediaText}`);
        }

        return this.normalizeReviewText(element.textContent || '');
    }

    normalizeReviewText(value) {
        return String(value ?? '')
            .replace(/\u00a0/g, ' ')
            .replace(/[\t ]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    applyPartialEditCommands(commands, snapshots = []) {
        const changes = [];

        commands.forEach(cmd => {
            if (cmd.cmd === 'edit' && cmd.target && cmd.text) {
                const match = cmd.target.match(/^T:(\d+)$/);
                if (match) {
                    const index = parseInt(match[1], 10) - 1;
                    if (index >= 0 && index < this.selectedElements.length) {
                        const element = this.selectedElements[index];
                        const snapshot = snapshots[index] || {};
                        const beforeText = snapshot.beforeText || this.getElementReviewText(element);

                        this.applyEditedContent(element, cmd.text);

                        const afterText = this.getElementReviewText(element);
                        if (beforeText !== afterText) {
                            changes.push({
                                target: cmd.target,
                                index,
                                label: snapshot.label || this.getDetailEditBlockLabel(element, index),
                                beforeText,
                                afterText
                            });
                        }
                    }
                }
            }
        });

        return changes;
    }

    showDetailEditSplitReview(changes, instruction) {
        const validChanges = Array.isArray(changes)
            ? changes.filter(change => this.normalizeReviewText(change.beforeText) !== this.normalizeReviewText(change.afterText))
            : [];

        if (this.detailEditReviewPanel) {
            this.detailEditReviewPanel.remove();
            this.detailEditReviewPanel = null;
        }

        if (validChanges.length === 0) {
            this.showCustomPopup('선택 편집이 완료됐지만 표시할 텍스트 변경사항은 없습니다.');
            return;
        }

        const panel = document.createElement('section');
        panel.className = 't2-detail-edit-review-panel';
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', '선택 편집 변경 비교');

        const instructionText = this.normalizeReviewText(instruction);
        const summaryText = validChanges.length === 1
            ? '1개 블록이 수정되었습니다.'
            : `${validChanges.length}개 블록이 수정되었습니다.`;

        this.setSafeUIHTML(panel, `
            <div class="t2-detail-edit-review-head">
                <div class="t2-detail-edit-review-title-block">
                    <span class="t2-detail-edit-review-kicker">선택 편집 결과</span>
                    <h3>변경 비교</h3>
                    <p>${this.escapeHtml(summaryText)} 왼쪽은 수정 전, 오른쪽은 적용 결과입니다. split diff 방식으로 줄 번호와 변경 위치를 표시합니다.</p>
                    ${instructionText ? `<p class="t2-detail-edit-review-request">요청: ${this.escapeHtml(instructionText)}</p>` : ''}
                </div>
                <button class="t2-detail-edit-review-close" type="button" aria-label="비교 닫기">
                    <span class="material-icons" aria-hidden="true">close</span>
                    <span>닫기</span>
                </button>
            </div>
            <div class="t2-detail-edit-review-list">
                ${validChanges.map(change => this.getDetailEditSplitReviewItemHTML(change)).join('')}
            </div>
        `);

        const toolbar = this.editor.container.querySelector('.t2-toolbar');
        const editorArea = this.editor.editor;
        if (toolbar && toolbar.parentNode === this.editor.container) {
            toolbar.insertAdjacentElement('afterend', panel);
        } else if (editorArea && editorArea.parentNode === this.editor.container) {
            this.editor.container.insertBefore(panel, editorArea);
        } else {
            this.editor.container.prepend(panel);
        }

        this.detailEditReviewPanel = panel;

        const closeButton = panel.querySelector('.t2-detail-edit-review-close');
        closeButton?.addEventListener('click', () => {
            panel.remove();
            if (this.detailEditReviewPanel === panel) this.detailEditReviewPanel = null;
        });

        requestAnimationFrame(() => {
            panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
    }

    getDetailEditSplitReviewItemHTML(change) {
        const diffRows = this.getSplitDiffRowsHTML(change.beforeText, change.afterText);

        return `
            <article class="t2-detail-edit-review-item">
                <div class="t2-detail-edit-review-item-head">
                    <span>${this.escapeHtml(change.label || change.target || '수정된 블록')}</span>
                    <span>split diff</span>
                </div>
                <div class="t2-detail-edit-diff-frame" role="table" aria-label="${this.escapeHtml(change.label || change.target || '수정된 블록')} 변경 diff">
                    <div class="t2-detail-edit-diff-table">
                        <div class="t2-detail-edit-diff-header" role="row">
                            <div class="t2-detail-edit-diff-line-number" role="columnheader" aria-label="수정 전 줄 번호"></div>
                            <div class="t2-detail-edit-diff-header-cell" role="columnheader">수정 전</div>
                            <div class="t2-detail-edit-diff-line-number" role="columnheader" aria-label="수정 후 줄 번호"></div>
                            <div class="t2-detail-edit-diff-header-cell" role="columnheader">수정 후</div>
                        </div>
                        <div class="t2-detail-edit-diff-body" role="rowgroup">
                            ${diffRows}
                        </div>
                    </div>
                </div>
            </article>
        `;
    }

    getSplitDiffRowsHTML(beforeText, afterText) {
        const beforeLines = this.normalizeDiffLines(beforeText);
        const afterLines = this.normalizeDiffLines(afterText);

        if (beforeLines.length === 0 && afterLines.length === 0) {
            return `
                <div class="t2-detail-edit-diff-row is-context" role="row">
                    <div class="t2-detail-edit-diff-line-number" role="cell"></div>
                    <div class="t2-detail-edit-diff-cell is-empty" role="cell"><span class="t2-ai-diff-empty">(내용 없음)</span></div>
                    <div class="t2-detail-edit-diff-line-number" role="cell"></div>
                    <div class="t2-detail-edit-diff-cell is-empty" role="cell"><span class="t2-ai-diff-empty">(내용 없음)</span></div>
                </div>
            `;
        }

        const rows = this.buildSplitDiffPairs(beforeLines, afterLines);
        return rows.map(row => this.getSplitDiffRowHTML(row)).join('');
    }

    normalizeDiffLines(value) {
        const text = String(value ?? '')
            .replace(/\u00a0/g, ' ')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim();

        return text.length > 0 ? text.split('\n') : [];
    }

    buildSplitDiffPairs(beforeLines, afterLines) {
        if (beforeLines.length * afterLines.length > 40000) {
            return [{
                type: 'modified',
                beforeLine: beforeLines.length > 0 ? 1 : null,
                afterLine: afterLines.length > 0 ? 1 : null,
                beforeText: beforeLines.join('\n'),
                afterText: afterLines.join('\n')
            }];
        }

        const ops = this.buildLineDiffOperations(beforeLines, afterLines);
        const rows = [];

        for (let i = 0; i < ops.length;) {
            const op = ops[i];

            if (op.type === 'equal') {
                rows.push({
                    type: 'context',
                    beforeLine: op.beforeLine,
                    afterLine: op.afterLine,
                    beforeText: op.text,
                    afterText: op.text
                });
                i++;
                continue;
            }

            const removed = [];
            const added = [];

            while (i < ops.length && ops[i].type !== 'equal') {
                if (ops[i].type === 'remove') removed.push(ops[i]);
                if (ops[i].type === 'add') added.push(ops[i]);
                i++;
            }

            const maxRows = Math.max(removed.length, added.length);
            for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
                const before = removed[rowIndex] || null;
                const after = added[rowIndex] || null;

                if (before && after) {
                    rows.push({
                        type: 'modified',
                        beforeLine: before.beforeLine,
                        afterLine: after.afterLine,
                        beforeText: before.text,
                        afterText: after.text
                    });
                } else if (before) {
                    rows.push({
                        type: 'removed',
                        beforeLine: before.beforeLine,
                        afterLine: null,
                        beforeText: before.text,
                        afterText: ''
                    });
                } else if (after) {
                    rows.push({
                        type: 'added',
                        beforeLine: null,
                        afterLine: after.afterLine,
                        beforeText: '',
                        afterText: after.text
                    });
                }
            }
        }

        return rows;
    }

    buildLineDiffOperations(beforeLines, afterLines) {
        const rows = beforeLines.length + 1;
        const cols = afterLines.length + 1;
        const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

        for (let i = beforeLines.length - 1; i >= 0; i--) {
            for (let j = afterLines.length - 1; j >= 0; j--) {
                if (beforeLines[i] === afterLines[j]) {
                    dp[i][j] = dp[i + 1][j + 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
                }
            }
        }

        const ops = [];
        let i = 0;
        let j = 0;

        while (i < beforeLines.length && j < afterLines.length) {
            if (beforeLines[i] === afterLines[j]) {
                ops.push({
                    type: 'equal',
                    beforeLine: i + 1,
                    afterLine: j + 1,
                    text: beforeLines[i]
                });
                i++;
                j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                ops.push({
                    type: 'remove',
                    beforeLine: i + 1,
                    text: beforeLines[i]
                });
                i++;
            } else {
                ops.push({
                    type: 'add',
                    afterLine: j + 1,
                    text: afterLines[j]
                });
                j++;
            }
        }

        while (i < beforeLines.length) {
            ops.push({
                type: 'remove',
                beforeLine: i + 1,
                text: beforeLines[i]
            });
            i++;
        }

        while (j < afterLines.length) {
            ops.push({
                type: 'add',
                afterLine: j + 1,
                text: afterLines[j]
            });
            j++;
        }

        return ops;
    }

    getSplitDiffRowHTML(row) {
        const beforeNumber = row.beforeLine ? String(row.beforeLine) : '';
        const afterNumber = row.afterLine ? String(row.afterLine) : '';

        let beforeClass = 'is-context';
        let afterClass = 'is-context';
        let beforeHtml = this.getDiffLineTextHTML(row.beforeText);
        let afterHtml = this.getDiffLineTextHTML(row.afterText);

        if (row.type === 'modified') {
            const inline = this.getInlineLineDiffHTML(row.beforeText, row.afterText);
            beforeClass = 'is-removed';
            afterClass = 'is-added';
            beforeHtml = inline.before;
            afterHtml = inline.after;
        } else if (row.type === 'removed') {
            beforeClass = 'is-removed';
            afterClass = 'is-empty';
            afterHtml = '';
        } else if (row.type === 'added') {
            beforeClass = 'is-empty';
            afterClass = 'is-added';
            beforeHtml = '';
        }

        return `
            <div class="t2-detail-edit-diff-row is-${this.escapeHtml(row.type)}" role="row">
                <div class="t2-detail-edit-diff-line-number ${beforeClass}" role="cell">${this.escapeHtml(beforeNumber)}</div>
                <div class="t2-detail-edit-diff-cell ${beforeClass}" role="cell">${beforeHtml}</div>
                <div class="t2-detail-edit-diff-line-number ${afterClass}" role="cell">${this.escapeHtml(afterNumber)}</div>
                <div class="t2-detail-edit-diff-cell ${afterClass}" role="cell">${afterHtml}</div>
            </div>
        `;
    }

    getDiffLineTextHTML(value) {
        const text = String(value ?? '');
        return text.length > 0 ? this.escapeHtml(text) : '<span class="t2-ai-diff-blank-line">&nbsp;</span>';
    }

    getInlineLineDiffHTML(beforeLine, afterLine) {
        const before = String(beforeLine ?? '');
        const after = String(afterLine ?? '');

        if (before === after) {
            const safe = this.getDiffLineTextHTML(before);
            return { before: safe, after: safe };
        }

        const beforeTokens = this.tokenizeReviewText(before);
        const afterTokens = this.tokenizeReviewText(after);

        if (beforeTokens.length === 0) {
            return {
                before: '<span class="t2-ai-diff-blank-line">&nbsp;</span>',
                after: this.wrapDiffTokens(afterTokens, 'is-added')
            };
        }

        if (afterTokens.length === 0) {
            return {
                before: this.wrapDiffTokens(beforeTokens, 'is-removed'),
                after: '<span class="t2-ai-diff-blank-line">&nbsp;</span>'
            };
        }

        if (beforeTokens.length * afterTokens.length > 90000) {
            return {
                before: `<span class="t2-ai-diff-token is-removed">${this.escapeHtml(before)}</span>`,
                after: `<span class="t2-ai-diff-token is-added">${this.escapeHtml(after)}</span>`
            };
        }

        return this.buildTokenDiffHTML(beforeTokens, afterTokens);
    }

    getSideBySideDiffHTML(beforeText, afterText) {
        const before = this.normalizeReviewText(beforeText);
        const after = this.normalizeReviewText(afterText);

        if (before === after) {
            const safe = this.escapeHtml(before || '(내용 없음)');
            return { before: safe, after: safe };
        }

        const beforeTokens = this.tokenizeReviewText(before);
        const afterTokens = this.tokenizeReviewText(after);

        if (beforeTokens.length === 0) {
            return {
                before: '<span class="t2-ai-diff-empty">(내용 없음)</span>',
                after: this.wrapDiffTokens(afterTokens, 'is-added')
            };
        }

        if (afterTokens.length === 0) {
            return {
                before: this.wrapDiffTokens(beforeTokens, 'is-removed'),
                after: '<span class="t2-ai-diff-empty">(내용 없음)</span>'
            };
        }

        if (beforeTokens.length * afterTokens.length > 90000) {
            return {
                before: `<span class="t2-ai-diff-token is-removed">${this.escapeHtml(before)}</span>`,
                after: `<span class="t2-ai-diff-token is-added">${this.escapeHtml(after)}</span>`
            };
        }

        return this.buildTokenDiffHTML(beforeTokens, afterTokens);
    }

    tokenizeReviewText(text) {
        return String(text || '').split(/(\s+)/).filter(token => token.length > 0);
    }

    wrapDiffTokens(tokens, className) {
        return tokens.map(token => {
            if (/^\s+$/.test(token)) return this.escapeHtml(token);
            return `<span class="t2-ai-diff-token ${className}">${this.escapeHtml(token)}</span>`;
        }).join('');
    }

    buildTokenDiffHTML(beforeTokens, afterTokens) {
        const rows = beforeTokens.length + 1;
        const cols = afterTokens.length + 1;
        const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

        for (let i = beforeTokens.length - 1; i >= 0; i--) {
            for (let j = afterTokens.length - 1; j >= 0; j--) {
                if (beforeTokens[i] === afterTokens[j]) {
                    dp[i][j] = dp[i + 1][j + 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
                }
            }
        }

        const beforeParts = [];
        const afterParts = [];
        let i = 0;
        let j = 0;

        while (i < beforeTokens.length && j < afterTokens.length) {
            if (beforeTokens[i] === afterTokens[j]) {
                const safe = this.escapeHtml(beforeTokens[i]);
                beforeParts.push(safe);
                afterParts.push(safe);
                i++;
                j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                const token = beforeTokens[i];
                beforeParts.push(/^\s+$/.test(token) ? this.escapeHtml(token) : `<span class="t2-ai-diff-token is-removed">${this.escapeHtml(token)}</span>`);
                i++;
            } else {
                const token = afterTokens[j];
                afterParts.push(/^\s+$/.test(token) ? this.escapeHtml(token) : `<span class="t2-ai-diff-token is-added">${this.escapeHtml(token)}</span>`);
                j++;
            }
        }

        while (i < beforeTokens.length) {
            const token = beforeTokens[i++];
            beforeParts.push(/^\s+$/.test(token) ? this.escapeHtml(token) : `<span class="t2-ai-diff-token is-removed">${this.escapeHtml(token)}</span>`);
        }

        while (j < afterTokens.length) {
            const token = afterTokens[j++];
            afterParts.push(/^\s+$/.test(token) ? this.escapeHtml(token) : `<span class="t2-ai-diff-token is-added">${this.escapeHtml(token)}</span>`);
        }

        return {
            before: beforeParts.join('') || '<span class="t2-ai-diff-empty">(내용 없음)</span>',
            after: afterParts.join('') || '<span class="t2-ai-diff-empty">(내용 없음)</span>'
        };
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
                this.setSafeInnerHTML(element, newTableHtml, 'table');
            }
        } else {
            this.setSafeInnerHTML(element, htmlContent, 'ai_rearrange');
        }
    }

    convertSpecialFormatToHtml(specialFormat) {
        const placeholders = [];
        const makePlaceholder = (html) => {
            const key = '\uE000T2AI' + placeholders.length + '\uE000';
            placeholders.push({ key, html });
            return key;
        };

        let source = String(specialFormat ?? '');

        // 블록성 토큰은 먼저 플레이스홀더로 보호한 뒤 인라인 파서를 통과시킨다.
        source = source.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (match, code) => {
            return makePlaceholder('<pre><code>' + this.escapeHtml(code) + '</code></pre>');
        });

        source = source.replace(/\[table\]([\s\S]*?)\[\/table\]/gi, (match) => {
            return makePlaceholder(this.convertTableSpecialFormatToHtml(match) || '');
        });

        source = source.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (match, rawUrl) => {
            const safeSrc = this.sanitizeImageUrl(rawUrl.trim());
            if (!safeSrc) return '';
            return makePlaceholder('<img src="' + this.escapeAttr(safeSrc) + '" style="max-width: 100%;" alt="" />');
        });

        const parseInline = (text) => {
            const raw = String(text ?? '');
            let out = '';
            let i = 0;

            const findNextToken = (from) => {
                const candidates = [
                    { type: 'link', open: '[link:', close: '[/link]' },
                    { type: 'bold', open: '[bold]', close: '[/bold]' },
                    { type: 'italic', open: '[italic]', close: '[/italic]' },
                    { type: 'underlined', open: '[underlined]', close: '[/underlined]' },
                    { type: 'strikethrough', open: '[strikethrough]', close: '[/strikethrough]' },
                    { type: 'tcolor', open: '[tcolor:', close: '[/tcolor]' },
                ];
                let found = null;
                candidates.forEach(candidate => {
                    const pos = raw.toLowerCase().indexOf(candidate.open, from);
                    if (pos !== -1 && (!found || pos < found.pos)) {
                        found = { ...candidate, pos };
                    }
                });
                return found;
            };

            while (i < raw.length) {
                const token = findNextToken(i);
                if (!token) {
                    out += this.escapeHtml(raw.slice(i));
                    break;
                }

                out += this.escapeHtml(raw.slice(i, token.pos));

                if (token.type === 'link') {
                    const labelEnd = raw.indexOf(']', token.pos + token.open.length);
                    if (labelEnd === -1) {
                        out += this.escapeHtml(raw.slice(token.pos, token.pos + token.open.length));
                        i = token.pos + token.open.length;
                        continue;
                    }
                    const closePos = raw.toLowerCase().indexOf(token.close, labelEnd + 1);
                    if (closePos === -1) {
                        out += this.escapeHtml(raw.slice(token.pos, labelEnd + 1));
                        i = labelEnd + 1;
                        continue;
                    }
                    const label = raw.slice(token.pos + token.open.length, labelEnd);
                    const hrefRaw = raw.slice(labelEnd + 1, closePos).trim();
                    const safeHref = this.sanitizeUrl(hrefRaw, 'href');
                    const safeLabel = parseInline(label);
                    out += safeHref
                        ? '<a href="' + this.escapeAttr(safeHref) + '" target="_blank" rel="noopener noreferrer">' + safeLabel + '</a>'
                        : safeLabel;
                    i = closePos + token.close.length;
                    continue;
                }

                if (token.type === 'tcolor') {
                    const colorEnd = raw.indexOf(']', token.pos + token.open.length);
                    if (colorEnd === -1) {
                        out += this.escapeHtml(raw.slice(token.pos, token.pos + token.open.length));
                        i = token.pos + token.open.length;
                        continue;
                    }
                    const closePos = raw.toLowerCase().indexOf(token.close, colorEnd + 1);
                    if (closePos === -1) {
                        out += this.escapeHtml(raw.slice(token.pos, colorEnd + 1));
                        i = colorEnd + 1;
                        continue;
                    }
                    const color = raw.slice(token.pos + token.open.length, colorEnd).trim();
                    const inner = raw.slice(colorEnd + 1, closePos);
                    const parsed = parseInline(inner);
                    out += /^#[0-9A-Fa-f]{6}$/.test(color)
                        ? '<span style="color: ' + this.escapeAttr(color) + '">' + parsed + '</span>'
                        : parsed;
                    i = closePos + token.close.length;
                    continue;
                }

                const closePos = raw.toLowerCase().indexOf(token.close, token.pos + token.open.length);
                if (closePos === -1) {
                    out += this.escapeHtml(raw.slice(token.pos, token.pos + token.open.length));
                    i = token.pos + token.open.length;
                    continue;
                }

                const inner = raw.slice(token.pos + token.open.length, closePos);
                const parsed = parseInline(inner);
                const tagMap = {
                    bold: 'strong',
                    italic: 'em',
                    underlined: 'u',
                    strikethrough: 's',
                };
                const tag = tagMap[token.type];
                out += tag ? '<' + tag + '>' + parsed + '</' + tag + '>' : parsed;
                i = closePos + token.close.length;
            }

            return out;
        };

        let html = parseInline(source);
        placeholders.forEach(item => {
            html = html.split(this.escapeHtml(item.key)).join(item.html).split(item.key).join(item.html);
        });

        return this.sanitizePluginHTML(html, 'ai_rearrange');
    }

    extractCodeContent(specialFormat) {
        const raw = String(specialFormat ?? '');
        const match = raw.match(/\[code\]([\s\S]*?)\[\/code\]/i);
        return match ? match[1].trim() : raw;
    }

    convertTableSpecialFormatToHtml(specialFormat) {
        const match = String(specialFormat ?? '').match(/\[table\]([\s\S]*?)\[\/table\]/i);
        if (!match) return null;
        
        const tableData = match[1];
        const rows = tableData.split(/\\\\n|\n/).filter(row => row.trim());
        if (!rows.length) return null;
        
        let html = '<table border="1" style="border-collapse: collapse; width: 100%;">';
        
        rows.forEach((row, index) => {
            const cells = row.split(',').map(cell => cell.trim());
            const tag = index === 0 ? 'th' : 'td';
            
            html += '<tr>';
            cells.forEach(cell => {
                html += '<' + tag + ' style="padding: 8px; border: 1px solid #ccc;">' + this.escapeHtml(cell) + '</' + tag + '>';
            });
            html += '</tr>';
        });
        
        html += '</table>';
        return this.sanitizePluginHTML(html, 'table');
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
            el.classList.remove('t2-detail-edit-selected', 't2-detail-edit-hovered');
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
        // Layout is handled by CSS media queries. This method remains for API compatibility.
    }

    getRateLimitBadgeHTML() {
        const ipRemainingRaw = this.rateLimit.ip.remaining ?? this.rateLimit.ip.limit;
        const domainRemainingRaw = this.rateLimit.domain.remaining ?? this.rateLimit.domain.limit;
        const ipRemaining = this.safeCounterValue(ipRemainingRaw);
        const domainRemaining = this.safeCounterValue(domainRemainingRaw);
        const ipLimit = this.safeCounterValue(this.rateLimit.ip.limit);
        const domainLimit = this.safeCounterValue(this.rateLimit.domain.limit);
        const ipWarn = this.isCounterAtOrBelow(ipRemainingRaw, 3);
        const domainWarn = this.isCounterAtOrBelow(domainRemainingRaw, 30);
        
        return [
            '<div class="t2-rate-limit-container" aria-label="AI 요청 한도">',
            '  <div class="t2-rate-limit-badge' + (ipWarn ? ' is-warning' : '') + '">',
            '    <span class="t2-rate-limit-label">내 요청</span>',
            '    <span class="t2-rate-limit-value">' + this.escapeHtml(ipRemaining) + '/' + this.escapeHtml(ipLimit) + '</span>',
            '  </div>',
            '  <div class="t2-rate-limit-badge' + (domainWarn ? ' is-warning' : '') + '">',
            '    <span class="t2-rate-limit-label">서버 요청</span>',
            '    <span class="t2-rate-limit-value">' + this.escapeHtml(domainRemaining) + '/' + this.escapeHtml(domainLimit) + '</span>',
            '  </div>',
            '</div>'
        ].join('');
    }

    updateRateLimitDisplay(inputArea) {
        const root = inputArea || this.modal || document;
        const container = root?.querySelector?.('.t2-rate-limit-container');
        if (!container) return;

        const wrapper = document.createElement('div');
        this.setSafeUIHTML(wrapper, this.getRateLimitBadgeHTML());
        const next = wrapper.firstElementChild;
        if (next) container.replaceWith(next);
    }

    showAiInfoPopup() {
        const existingPopup = document.querySelector('.t2-ai-info-popup');
        if (existingPopup) {
            existingPopup.remove();
        }

        const popup = document.createElement('div');
        popup.className = 't2-ai-info-popup';
        popup.setAttribute('role', 'dialog');
        popup.setAttribute('aria-modal', 'true');
        popup.setAttribute('aria-labelledby', 't2-ai-info-title');

        const modelList = this.aiModels.map(model => `<li>${this.escapeHtml(model)}</li>`).join('');

        this.setSafeUIHTML(popup, `
            <div class="t2-ai-info-header">
                <div class="t2-ai-info-title-block">
                    <span class="material-icons t2-ai-info-icon" aria-hidden="true">auto_awesome</span>
                    <h3 id="t2-ai-info-title">T2Editor AI 안내</h3>
                </div>
                <button class="t2-ai-info-close" type="button" aria-label="닫기">
                    <span class="material-icons" aria-hidden="true">close</span>
                </button>
            </div>
            <div class="t2-ai-info-body">
                <p>
                    T2Editor AI는 현재 콘텐츠 구조를 분석한 뒤, 사용자의 요청에 맞춰 재배치·문장 편집·서식 조정을 수행합니다.
                </p>
                <section class="t2-ai-info-card">
                    <h4>
                        <span class="material-icons t2-detail-edit-icon" aria-hidden="true">edit</span>
                        선택 편집
                    </h4>
                    <ul>
                        <li>텍스트, 코드블록, 테이블 등 수정할 블록을 직접 선택합니다.</li>
                        <li>여러 블록을 함께 선택할 수 있습니다.</li>
                        <li>ESC 키 또는 하단 버튼으로 선택 편집을 종료할 수 있습니다.</li>
                    </ul>
                </section>
                <section class="t2-ai-info-card">
                    <h4>사용 가능한 모델</h4>
                    <ul class="t2-ai-model-list">${modelList}</ul>
                </section>
                <section class="t2-ai-info-card t2-ai-info-card--muted">
                    <h4>요청 제한</h4>
                    <p>
                        IP당 하루 ${this.safeCounterValue(this.rateLimit.ip.limit)}회 · 도메인당 하루 ${this.safeCounterValue(this.rateLimit.domain.limit)}회까지 사용할 수 있습니다. 기준은 매일 자정(KST)에 초기화됩니다.
                    </p>
                </section>
                <p class="t2-ai-info-note">
                    요청마다 적합한 모델이 자동 선택됩니다. Groq API를 기반으로 DSc(dsclub.kr)가 재가공해 제공합니다.
                </p>
            </div>
        `);

        document.body.appendChild(popup);

        const closeBtn = popup.querySelector('.t2-ai-info-close');
        closeBtn.addEventListener('click', () => popup.remove());

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                popup.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
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
        
        const allElements = this.getIndexedItemsInDomOrder(indexed);

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

        this.setSafeUIHTML(previewArea, `
            <div class="t2-ai-loading-state">
                <span class="t2-ai-spinner" aria-hidden="true"></span>
                <p>콘텐츠 구조를 분석하고 있습니다.</p>
            </div>
        `);

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
                this.rateLimit.ip.remaining = this.safeNonNegativeInt(data._rate_limit.ip.remaining, this.rateLimit.ip.limit);
                this.rateLimit.domain.remaining = this.safeNonNegativeInt(data._rate_limit.domain.remaining, this.rateLimit.domain.limit);
                this.updateRateLimitDisplay();
            }

            this.pendingCommands = data.commands;
            this.pendingIndexed = indexed;
            const rearrangeReviewChanges = this.buildRearrangeReviewChanges(indexed, data.commands);
            this.pendingRearrangeReview = { changes: rearrangeReviewChanges, instruction };
            this.setSafeUIHTML(previewArea, this.getRearrangeDiffPreviewHTML(rearrangeReviewChanges));

            this.setSafeUIHTML(commandsList, data.commands.length > 0
                ? data.commands.map(cmd => 
                    `<div class="t2-ai-command-item">${this.escapeHtml(this.getCommandDescription(cmd))}</div>`
                  ).join('')
                : '<div class="t2-ai-empty-result">변경사항 없음</div>');

            regenerateBtn.style.display = 'flex';
            applyBtn.style.display = 'flex';
            executeBtn.style.display = 'none';

        } catch (error) {
            this.pendingRearrangeReview = null;
            console.error('재배치 오류:', error);
            this.setSafeUIHTML(previewArea, `
                <div class="t2-ai-error-state">
                    <div class="t2-ai-error-title">
                        <span class="material-icons" aria-hidden="true">error_outline</span>
                        <strong>처리하지 못했습니다</strong>
                    </div>
                    <p>${this.escapeHtml(error.message)}</p>
                </div>
            `);
        } finally {
            this.isProcessing = false;
            executeBtn.disabled = false;
            executeBtn.style.opacity = '1';
            executeBtn.style.cursor = 'pointer';
        }
    }

    buildRearrangeReviewChanges(indexed, commands) {
        const beforeItems = this.getIndexedReviewItems(indexed);
        const afterItems = beforeItems.map(item => ({ ...item }));
        const getIndexById = (id) => afterItems.findIndex(item => item.id === id);
        let insertedCount = 1;

        (Array.isArray(commands) ? commands : []).forEach(cmd => {
            if (!cmd || !cmd.cmd) return;

            switch (cmd.cmd) {
                case 'move': {
                    const fromIndex = getIndexById(cmd.from);
                    if (fromIndex === -1) return;
                    const [moved] = afterItems.splice(fromIndex, 1);
                    const targetNumber = Number.parseInt(cmd.to, 10);
                    const targetIndex = Number.isFinite(targetNumber)
                        ? Math.max(0, Math.min(afterItems.length, targetNumber - 1))
                        : afterItems.length;
                    afterItems.splice(targetIndex, 0, moved);
                    break;
                }

                case 'edit': {
                    const editIndex = getIndexById(cmd.target);
                    if (editIndex === -1 || !cmd.text) return;
                    afterItems[editIndex].text = this.getCommandReviewText(cmd.text, afterItems[editIndex]);
                    break;
                }

                case 'delete': {
                    const deleteIndex = getIndexById(cmd.target);
                    if (deleteIndex !== -1) afterItems.splice(deleteIndex, 1);
                    break;
                }

                case 'insert': {
                    const inserted = this.getInsertedReviewItem(cmd, insertedCount++);
                    const afterIndex = getIndexById(cmd.after);
                    if (afterIndex === -1) {
                        afterItems.push(inserted);
                    } else {
                        afterItems.splice(afterIndex + 1, 0, inserted);
                    }
                    break;
                }
            }
        });

        const beforeText = this.serializeReviewItems(beforeItems);
        const afterText = this.serializeReviewItems(afterItems);

        if (this.normalizeReviewText(beforeText) === this.normalizeReviewText(afterText)) {
            return [];
        }

        return [{
            label: '문서 전체',
            beforeText,
            afterText
        }];
    }

    getIndexedReviewItems(indexed) {
        return this.getIndexedItemsInDomOrder(indexed).map(item => ({
            id: item.id,
            label: this.getIndexedReviewLabel(item),
            text: this.getIndexedReviewText(item)
        }));
    }

    getIndexedItemsInDomOrder(indexed) {
        const safeIndexed = indexed || {};
        const allElements = [
            ...(safeIndexed.text || []),
            ...(safeIndexed.images || []),
            ...(safeIndexed.videos || []),
            ...(safeIndexed.codes || []),
            ...(safeIndexed.tables || []),
            ...(safeIndexed.files || [])
        ];

        const childNodes = Array.from(this.editor?.editor?.childNodes || []);
        return allElements.sort((a, b) => {
            const aPos = childNodes.indexOf(a.element);
            const bPos = childNodes.indexOf(b.element);
            return (aPos === -1 ? Number.MAX_SAFE_INTEGER : aPos) - (bPos === -1 ? Number.MAX_SAFE_INTEGER : bPos);
        });
    }

    getIndexedReviewLabel(item) {
        const id = String(item?.id || 'BLOCK');
        if (id.startsWith('T:')) return '텍스트';
        if (id.startsWith('IMG:')) return '이미지';
        if (id.startsWith('VIDEO:')) return '비디오';
        if (id.startsWith('CODE:')) return '코드';
        if (id.startsWith('TABLE:')) return '테이블';
        if (id.startsWith('FILE:')) return '파일';
        return '블록';
    }

    getIndexedReviewText(item) {
        if (!item) return '';
        if (item.content) return this.getCommandReviewText(item.content, item);
        if (item.element) return this.getElementReviewText(item.element);
        return '';
    }

    getCommandReviewText(value, item = null) {
        const raw = String(value ?? '');
        if (!raw.trim()) return '';

        if (item?.id?.startsWith('CODE:') || /\[code\][\s\S]*?\[\/code\]/i.test(raw)) {
            return this.normalizeReviewText(this.extractCodeContent(raw));
        }

        if (item?.id?.startsWith('TABLE:') || /\[table\][\s\S]*?\[\/table\]/i.test(raw)) {
            return this.normalizeReviewText(this.getTableSpecialFormatReviewText(raw));
        }

        const html = this.convertSpecialFormatToHtml(raw);
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return this.normalizeReviewText(temp.textContent || raw);
    }

    getTableSpecialFormatReviewText(value) {
        const raw = String(value ?? '');
        const match = raw.match(/\[table\]([\s\S]*?)\[\/table\]/i);
        const tableData = match ? match[1] : raw;
        return tableData
            .split(/\\\\n|\n/)
            .map(row => row.split(',').map(cell => cell.trim()).filter(Boolean).join(' | '))
            .filter(Boolean)
            .join('\n');
    }

    getInsertedReviewItem(cmd, insertedCount) {
        const type = String(cmd?.type || 'block').toLowerCase();
        const id = `NEW:${insertedCount}`;
        let label = '추가 블록';
        let text = '';

        if (type === 'image') {
            label = '추가 이미지';
            text = cmd?.content?.url ? `[이미지] ${cmd.content.url}` : '[이미지]';
        } else if (type === 'code') {
            label = '추가 코드';
            text = cmd?.content?.code || '[코드]';
        } else if (cmd?.content) {
            label = '추가 콘텐츠';
            text = typeof cmd.content === 'string' ? cmd.content : JSON.stringify(cmd.content);
        }

        return {
            id,
            label,
            text: this.normalizeReviewText(text)
        };
    }

    serializeReviewItems(items) {
        return (Array.isArray(items) ? items : []).map((item, index) => {
            const id = item.id || `BLOCK:${index + 1}`;
            const label = item.label || '블록';
            const text = this.normalizeReviewText(item.text) || '(내용 없음)';
            return `[${id}] ${label}\n${text}`;
        }).join('\n\n');
    }

    getRearrangeDiffPreviewHTML(changes) {
        const validChanges = Array.isArray(changes)
            ? changes.filter(change => this.normalizeReviewText(change.beforeText) !== this.normalizeReviewText(change.afterText))
            : [];

        if (validChanges.length === 0) {
            return `
                <div class="t2-ai-empty-result">
                    텍스트 기준 변경사항은 없습니다. 적용될 작업 목록을 확인하세요.
                </div>
            `;
        }

        return `
            <div class="t2-rearrange-diff-preview">
                ${validChanges.map(change => this.getDetailEditSplitReviewItemHTML(change)).join('')}
            </div>
        `;
    }

    showRearrangeSplitReview(changes, instruction) {
        const validChanges = Array.isArray(changes)
            ? changes.filter(change => this.normalizeReviewText(change.beforeText) !== this.normalizeReviewText(change.afterText))
            : [];

        if (this.rearrangeReviewPanel) {
            this.rearrangeReviewPanel.remove();
            this.rearrangeReviewPanel = null;
        }

        if (validChanges.length === 0) return;

        const panel = document.createElement('section');
        panel.className = 't2-detail-edit-review-panel t2-rearrange-review-panel';
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', '정리 생성 변경 비교');

        const instructionText = this.normalizeReviewText(instruction);
        this.setSafeUIHTML(panel, `
            <div class="t2-detail-edit-review-head">
                <div class="t2-detail-edit-review-title-block">
                    <span class="t2-detail-edit-review-kicker">정리 생성 결과</span>
                    <h3>변경 비교</h3>
                    <p>왼쪽은 수정 전, 오른쪽은 적용 결과입니다. split diff 방식으로 줄 번호와 변경 위치를 표시합니다.</p>
                    ${instructionText ? `<p class="t2-detail-edit-review-request">요청: ${this.escapeHtml(instructionText)}</p>` : ''}
                </div>
                <button class="t2-detail-edit-review-close" type="button" aria-label="비교 닫기">
                    <span class="material-icons" aria-hidden="true">close</span>
                    <span>닫기</span>
                </button>
            </div>
            <div class="t2-detail-edit-review-list">
                ${validChanges.map(change => this.getDetailEditSplitReviewItemHTML(change)).join('')}
            </div>
        `);

        const toolbar = this.editor.container.querySelector('.t2-toolbar');
        const editorArea = this.editor.editor;
        if (toolbar && toolbar.parentNode === this.editor.container) {
            toolbar.insertAdjacentElement('afterend', panel);
        } else if (editorArea && editorArea.parentNode === this.editor.container) {
            this.editor.container.insertBefore(panel, editorArea);
        } else {
            this.editor.container.prepend(panel);
        }

        this.rearrangeReviewPanel = panel;

        const closeButton = panel.querySelector('.t2-detail-edit-review-close');
        closeButton?.addEventListener('click', () => {
            panel.remove();
            if (this.rearrangeReviewPanel === panel) this.rearrangeReviewPanel = null;
        });

        requestAnimationFrame(() => {
            panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
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

        const reviewPayload = this.pendingRearrangeReview;

        try {
            await this.applyCommands(this.pendingCommands, this.pendingIndexed);
            this.closeModal();
            if (reviewPayload?.changes?.length) {
                this.showRearrangeSplitReview(reviewPayload.changes, reviewPayload.instruction);
            }
        } catch (error) {
            console.error('명령어 적용 오류:', error);
            alert('명령어 적용 중 오류가 발생했습니다: ' + String(error.message || '알 수 없는 오류'));
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
                                this.setSafeInnerHTML(editItem.element, newTableHtml, 'table');
                            }
                        } else {
                            this.setSafeInnerHTML(editItem.element, formattedHTML, 'ai_rearrange');
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
        style = String(style || '');
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
                    const safeUrl = this.sanitizeImageUrl(cmd.content.url);
                    if (!safeUrl) break;
                    newElement = imagePlugin.createImageBlock({
                        url: safeUrl,
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
        this.pendingRearrangeReview = null;
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

}

window.T2Ai_rearrangePlugin = T2Ai_rearrangePlugin;
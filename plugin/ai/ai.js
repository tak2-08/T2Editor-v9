// Path: T2Editor/plugin/ai/ai.js
class T2AiPlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['insertAI'];
        this.modal = null;
        this.currentResponse = null;
        this.currentPrompt = null;

        // [수정됨] 끝에 /index.php를 명시하여 폴더 요청에 의한 리디렉션(301)과 헤더 유실 방지
        const baseUrl = 'https://dsclub.kr/api/ai/t2editor/groq/interaction/index.php';
        
        this.apiUrl = baseUrl;

        this.modelListUrl = baseUrl + '?mode=models';
        this.limitsUrl = baseUrl + '?mode=limits';
        
        this.sharedSecret = 'dsclubT2Editor2025';
        this.rateLimitSecret = 'RateLimitSecret2025!@#';
        
        this.maxInputChars = null;
        this.maxOutputChars = null;
        this.maxOutputTokens = null;
        this.charToTokenRatio = null;
        
        this.rateLimit = {
            ip: { remaining: null, limit: null },
            domain: { remaining: null, limit: null }
        };
        
        this.aiModels = [];
        this.fallbackModels = ['모델 리스트 로드에 실패했어요, 나중에 다시 시도해주세요.'];
        
        this.limitsLoaded = false;
        this.rateLimitsLoaded = false;
        this.limitsLoadPromise = this.loadLimits();
        this.loadModelList();
        
        console.log('T2AiPlugin initialized with commands:', this.commands);
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
            
            if (data.ip_limit && data.domain_limit) {
                this.rateLimit.ip.limit = data.ip_limit;
                this.rateLimit.domain.limit = data.domain_limit;
            }
            
            if (data.max_input_chars) this.maxInputChars = data.max_input_chars;
            if (data.max_output_chars) this.maxOutputChars = data.max_output_chars;
            if (data.max_output_tokens) this.maxOutputTokens = data.max_output_tokens;
            if (data.char_to_token_ratio) this.charToTokenRatio = data.char_to_token_ratio;
            
            this.limitsLoaded = true;
            
            console.log('Limits loaded successfully:', {
                rateLimit: this.rateLimit,
                maxInputChars: this.maxInputChars,
                maxOutputChars: this.maxOutputChars,
                maxOutputTokens: this.maxOutputTokens
            });
        } catch (error) {
            console.error('Failed to load limits:', error);
            this.limitsLoaded = false;
            throw error;
        }
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
                'X-Domain': domainSig.domain, // [수정됨] 도메인 명시적 전달 추가
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

    handleCommand(command, button) {
        console.log('AI Plugin handling command:', command);
        if (command === 'insertAI') {
            this.openAiModal();
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

    getRateLimitBadgeHTML() {
        const ipRemaining = this.rateLimit.ip.remaining ?? this.rateLimit.ip.limit ?? '?';
        const domainRemaining = this.rateLimit.domain.remaining ?? this.rateLimit.domain.limit ?? '?';
        const ipLimit = this.rateLimit.ip.limit ?? '?';
        const domainLimit = this.rateLimit.domain.limit ?? '?';
        
        const isIpWarning = ipRemaining <= 3;
        const isDomainWarning = domainRemaining <= 30;

        return `
            <div class="t2-rate-limit-container">
                <div class="rate-limit-badge ${isIpWarning ? 'warning' : ''}">
                    <span class="material-icons">${isIpWarning ? 'warning' : 'person'}</span>
                    <span>내 요청: ${ipRemaining}/${ipLimit}</span>
                </div>
                <div class="rate-limit-badge ${isDomainWarning ? 'warning' : ''}">
                    <span class="material-icons">${isDomainWarning ? 'warning' : 'public'}</span>
                    <span>서버 요청: ${domainRemaining}/${domainLimit}</span>
                </div>
            </div>
        `;
    }

    async openAiModal() {
        try {
            await this.limitsLoadPromise;
        } catch (error) {
            alert('서버 설정을 불러올 수 없습니다.\n\n' + error.message + '\n\nURL: ' + this.limitsUrl);
            return;
        }

        if (!this.limitsLoaded || this.maxInputChars === null) {
            alert('서버 설정을 불러오지 못했습니다. 페이지를 새로고침 후 다시 시도해주세요.');
            return;
        }

        if (!this.rateLimitsLoaded) {
            await this.loadRateLimits();
        }

        if (this.modal) {
            this.modal.remove();
        }

        const overlay = document.createElement('div');
        overlay.className = 't2-ai-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 't2-ai-modal';

        const header = document.createElement('div');
        header.className = 't2-ai-header';
        header.innerHTML = `
            <div class="t2-ai-title-group">
                <span class="material-icons t2-ai-icon-gradient">auto_awesome</span>
                <h3 class="t2-ai-title">AI 글쓰기</h3>
            </div>
            <button class="t2-ai-close">
                <span class="material-icons">close</span>
            </button>
        `;

        const inputArea = document.createElement('div');
        inputArea.className = 't2-ai-input-area';
        inputArea.innerHTML = `
            <div class="t2-ai-textarea-wrapper">
                <textarea 
                    class="t2-ai-input" 
                    placeholder="어떤 내용을 작성하고 싶으신가요? (예: 제품 소개글 작성, 블로그 포스트 작성 등)"
                    maxlength="${this.maxInputChars}"
                ></textarea>
                <div class="t2-ai-char-count">0/${this.maxInputChars}자</div>
            </div>
            <div class="t2-ai-controls">
                <div class="t2-ai-info-group">
                    <button class="t2-ai-powered">
                        <span class="material-icons" style="font-size: 16px;">auto_awesome</span>
                        Powered by AI
                    </button>
                    ${this.getRateLimitBadgeHTML()}
                    <div class="t2-ai-legal-text">
                        본 서비스는 Groq의 AI API를 이용하며<br>DSc(dsclub.kr)가 재가공하여 제공합니다<br>* 일부 콘텐츠는 법적·윤리적·DSc 자체 기준에 따라 입/출력 내용을 제한 및 필터링할 수 있습니다.
                    </div>
                </div>
                <button class="t2-ai-generate">
                    <span class="material-icons" style="font-size: 18px;">auto_awesome</span>
                    <span class="t2-ai-generate-text">생성하기</span>
                </button>
            </div>
        `;

        const resultArea = document.createElement('div');
        resultArea.className = 't2-ai-result-area';

        const footer = document.createElement('div');
        footer.className = 't2-ai-footer';
        footer.innerHTML = `
            <button class="t2-ai-insert">
                <span class="material-icons" style="font-size: 18px;">add</span>
                추가하기
            </button>
        `;

        modal.appendChild(header);
        modal.appendChild(inputArea);
        modal.appendChild(resultArea);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        this.modal = overlay;

        const closeBtn = header.querySelector('.t2-ai-close');
        const generateBtn = inputArea.querySelector('.t2-ai-generate');
        const insertBtn = footer.querySelector('.t2-ai-insert');
        const textarea = inputArea.querySelector('.t2-ai-input');
        const charCount = inputArea.querySelector('.t2-ai-char-count');
        const poweredBtn = inputArea.querySelector('.t2-ai-powered');

        const updateCharCount = () => {
            const length = textarea.value.length;
            charCount.textContent = `${length}/${this.maxInputChars}자`;
            charCount.classList.remove('warning', 'error');
            
            if (length >= this.maxInputChars) {
                charCount.classList.add('error');
            } else if (length >= this.maxInputChars * 0.9) {
                charCount.classList.add('warning');
            }
        };

        textarea.addEventListener('input', updateCharCount);

        closeBtn.addEventListener('click', () => this.closeModal());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeModal();
        });

        generateBtn.addEventListener('click', () => {
            const prompt = textarea.value.trim();
            if (prompt) {
                this.generateContent(prompt, resultArea, footer, inputArea);
            }
        });

        insertBtn.addEventListener('click', () => {
            if (this.currentResponse) {
                this.insertToEditor(this.currentResponse);
                this.closeModal();
            }
        });

        poweredBtn.addEventListener('click', () => {
            this.showAiInfoPopup();
        });

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                generateBtn.click();
            }
        });

        textarea.focus();
    }

    updateRateLimitDisplay(inputArea) {
        const container = inputArea.querySelector('.t2-rate-limit-container');
        if (!container) {
            console.warn('Rate limit container not found');
            return;
        }

        const newHTML = this.getRateLimitBadgeHTML();
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newHTML;

        const newContainer = tempDiv.querySelector('.t2-rate-limit-container');
        if (newContainer) {
            container.innerHTML = newContainer.innerHTML;
            console.log('Rate limit display updated:', this.rateLimit);
        } else {
            console.warn('New rate limit container not parsed correctly');
        }
    }

    showAiInfoPopup() {
        const existingPopup = document.querySelector('.t2-ai-info-popup');
        if (existingPopup) {
            existingPopup.remove();
        }

        const popup = document.createElement('div');
        popup.className = 't2-ai-info-popup';
        
        const modelList = this.aiModels.map(model => `<li style="margin: 4px 0;">${model}</li>`).join('');

        popup.innerHTML = `
            <div class="t2-ai-info-header">
                <div class="t2-ai-info-title-group">
                    <span class="material-icons" style="color: #3b82f6; font-size: 28px;">auto_awesome</span>
                    <h3 class="t2-ai-info-title">T2Editor AI 정보</h3>
                </div>
                <button class="t2-ai-info-close t2-ai-close">
                    <span class="material-icons">close</span>
                </button>
            </div>
            <div class="t2-ai-info-content">
                <p style="margin: 0 0 16px 0; font-size: 14px;">
                    T2Editor Ai 서비스는 다양한 AI 모델들 중 가장 적합한 모델을 활용하여 최적의 답변을 제공하며, 에디터에 상호작용을 통해 텍스트, 이미지, 코드, 표, 링크 등 다양한 요소를 자동으로 구성합니다.
                </p>
                <div class="t2-ai-info-box">
                    <h4>
                        <span class="material-icons" style="font-size: 18px; vertical-align: middle; color: #3b82f6;">auto_mode</span>
                        사용 가능한 AI 모델
                    </h4>
                    <ul>
                        ${modelList}
                    </ul>
                </div>
                <div class="t2-ai-info-box-blue">
                    <h4>
                        <span class="material-icons" style="font-size: 14px; vertical-align: middle;">text_fields</span>
                        생성 제한
                    </h4>
                    <p>
                        입력: 최대 ${this.maxInputChars}자<br>
                        생성에 ${this.maxOutputTokens}토큰 사용 가능
                    </p>
                </div>
                <div class="t2-ai-info-box-gray">
                    <h4>
                        <span class="material-icons" style="font-size: 14px; vertical-align: middle;">info</span>
                        요청 제한
                    </h4>
                    <p>
                        IP당 하루 최대 ${this.rateLimit.ip.limit}회 · 도메인당 하루 최대 ${this.rateLimit.domain.limit}회 · 매일 자정(KST) 초기화
                    </p>
                </div>
                <p style="margin: 0; font-size: 13px; color: #6b7280;">
                    <span class="material-icons" style="font-size: 16px; vertical-align: middle; color: #10b981;">check_circle</span>
                    요청마다 가장 적합한 모델이 자동으로 선택되어 답변을 생성합니다.
                </p>
                <div class="t2-ai-info-footer">
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
            popup.classList.add('closing');
            setTimeout(() => {
                popup.remove();
            }, 300);
        };

        closeBtn.addEventListener('click', closePopup);

        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 10001;
        `;
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

    async generateContent(prompt, resultArea, footer, inputArea) {
        this.currentPrompt = prompt;
        
        resultArea.style.display = 'block';
        resultArea.innerHTML = `
            <div class="t2-ai-loading">
                <div class="t2-ai-spinner"></div>
                <p style="color: #6b7280; margin: 0;">콘텐츠를 생성하고 있습니다...</p>
            </div>
        `;
        footer.style.display = 'none';

        try {
            const licenseToken = window.T2EDITOR_LICENSE_TOKEN;
            if (!licenseToken) {
                throw new Error('T2Editor 라이센스를 확인할 수 없습니다. 정품 T2Editor에서만 사용 가능합니다.');
            }

            const domainSig = await this.generateDomainSignature();
            const timestamp = Math.floor(Date.now() / 1000);
            const verifyHash = await this.generateVerifyHash(licenseToken, timestamp);
            
            const headers = {
                'Content-Type': 'application/json',
                'X-Domain': domainSig.domain, // [수정됨] 도메인 명시적 전달 추가
                'X-Domain-Timestamp': domainSig.timestamp,
                'X-Domain-Nonce': domainSig.nonce,
                'X-Domain-Signature': domainSig.signature,
                'X-T2Editor-License': licenseToken,
                'X-T2Editor-Timestamp': timestamp.toString(),
                'X-T2Editor-Verify': verifyHash
            };

            if (this.sharedSecret) {
                const signature = await this.generateSignature(prompt);
                headers['X-DSCLUB-SIGN'] = signature;
            }

            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ text: prompt })
            });

            const data = await response.json();
            
            if (data._rate_limit) {
                this.rateLimit.ip.remaining = data._rate_limit.ip.remaining;
                this.rateLimit.domain.remaining = data._rate_limit.domain.remaining;
                this.updateRateLimitDisplay(inputArea);
            }

            if (!response.ok) {
                if (response.status === 429) {
                    throw new Error(data.code === 'IP_RATE_LIMIT' 
                        ? `오늘의 요청 한도(${data.limit}회)를 초과했습니다. ${data.reset_at}에 초기화됩니다.`
                        : `서버의 요청 한도(${data.limit}회)를 초과했습니다. ${data.reset_at}에 초기화됩니다.`
                    );
                }
                if (response.status === 403 && data.code === 'INVALID_LICENSE') {
                    throw new Error(data.message || '정품 T2Editor에서만 사용 가능합니다.');
                }
                throw new Error(`HTTP ${response.status}: ${data.error || response.statusText}`);
            }

            console.log('API Response:', data);
            
            let generatedText = '';
            if (data.choices && data.choices[0] && data.choices[0].message) {
                generatedText = data.choices[0].message.content;
            } else if (data.response) {
                generatedText = data.response;
            } else if (data.text) {
                generatedText = data.text;
            } else if (typeof data === 'string') {
                generatedText = data;
            } else {
                throw new Error('응답 형식을 인식할 수 없습니다.');
            }

            this.currentResponse = generatedText;
            this.displayResult(generatedText, resultArea, footer, data._token_info);

        } catch (error) {
            console.error('AI 생성 오류:', error);
            resultArea.innerHTML = `
                <div class="t2-ai-error-box">
                    <div class="t2-ai-error-header">
                        <span class="material-icons">error_outline</span>
                        <strong>오류 발생</strong>
                    </div>
                    <p style="margin: 0;">${error.message}</p>
                </div>
            `;
            footer.style.display = 'none';
        }
    }

    renderPreview(text) {
        const parts = this.parseAndConvertBlocks(text);
        let html = '';
        
        parts.forEach(part => {
            if (part.type === 'text') {
                const lines = part.content.split('\n');
                lines.forEach(line => {
                    if (line.trim()) {
                        const formattedHTML = this.parseTextFormatting(line);
                        html += `<p>${formattedHTML}</p>`;
                    } else {
                        html += `<p><br></p>`;
                    }
                });
            } else if (part.type === 'code') {
                const language = part.language || 'plaintext';
                html += `
                    <div class="t2-ai-code-preview">
                        <div class="t2-ai-code-lang">${this.escapeHtml(language)}</div>
                        <pre class="t2-ai-code-block"><code>${this.escapeHtml(part.content)}</code></pre>
                    </div>
                `;
            } else if (part.type === 'image') {
                html += `
                    <div class="t2-ai-image-preview">
                        <img src="${this.escapeHtml(part.content)}" alt="AI 생성 이미지" />
                    </div>
                `;
            } else if (part.type === 'table') {
                const rows = this.parseTableData(part.content);
                if (rows.length > 0) {
                    html += '<div class="t2-ai-table-preview"><table>';
                    
                    html += '<thead><tr>';
                    rows[0].forEach(cell => {
                        html += `<th>${this.escapeHtml(cell)}</th>`;
                    });
                    html += '</tr></thead>';
                    
                    if (rows.length > 1) {
                        html += '<tbody>';
                        for (let i = 1; i < rows.length; i++) {
                            html += '<tr>';
                            rows[i].forEach(cell => {
                                html += `<td>${this.escapeHtml(cell || '')}</td>`;
                            });
                            html += '</tr>';
                        }
                        html += '</tbody>';
                    }
                    
                    html += '</table></div>';
                }
            } else if (part.type === 'link') {
                html += `
                    <p style="margin: 10px 0;">
                        <a href="${this.escapeHtml(part.content)}" 
                           target="_blank" 
                           rel="noopener noreferrer"
                           style="color: #3b82f6; text-decoration: none; font-weight: 500;">
                            ${this.escapeHtml(part.text)}
                        </a>
                    </p>
                `;
            }
        });
        
        return html;
    }

    displayResult(text, resultArea, footer, tokenInfo) {
        const renderedHTML = this.renderPreview(text);
        
        const textLength = text.length;
        const tokenLimitReached = tokenInfo && textLength >= tokenInfo.max_output_chars * 0.95;
        
        const limitWarning = tokenLimitReached ? `
            <div class="t2-ai-token-warning">
                <span class="material-icons" style="font-size: 16px;">info</span>
                <span>응답이 토큰 제한(${tokenInfo.max_output_tokens}토큰)에 도달했습니다.</span>
            </div>
        ` : '';
        
        resultArea.innerHTML = `
            <div style="position: relative;">
                <div class="t2-ai-preview-box t2-ai-preview-content">${renderedHTML}</div>
                ${limitWarning}
                <button class="t2-ai-regenerate-inline" style="bottom: ${tokenLimitReached ? '60px' : '12px'};">
                    <span class="material-icons" style="font-size: 16px;">refresh</span>
                    재작성
                </button>
            </div>
        `;
        
        const regenerateBtn = resultArea.querySelector('.t2-ai-regenerate-inline');
        regenerateBtn.addEventListener('click', () => {
            if (this.currentPrompt) {
                const inputArea = this.modal.querySelector('.t2-ai-input-area');
                this.generateContent(this.currentPrompt, resultArea, footer, inputArea);
            }
        });
        
        footer.style.display = 'flex';
    }

    parseAndConvertBlocks(text) {
        const parts = [];
        let currentIndex = 0;
        
        const patterns = [
            { regex: /\[code(?::([^\]]+))?\]([\s\S]*?)\[\/code\]/gi, type: 'code' },
            { regex: /\[img\](.*?)\[\/img\]/gi, type: 'image' },
            { regex: /\[table\]([\s\S]*?)\[\/table\]/gi, type: 'table' },
            { regex: /\[link:([^\]]+)\](.*?)\[\/link\]/gi, type: 'link' }
        ];
        
        const matches = [];
        patterns.forEach(pattern => {
            let match;
            while ((match = pattern.regex.exec(text)) !== null) {
                matches.push({
                    type: pattern.type,
                    start: match.index,
                    end: pattern.regex.lastIndex,
                    match: match
                });
            }
        });
        
        matches.sort((a, b) => a.start - b.start);
        
        matches.forEach(item => {
            if (currentIndex < item.start) {
                const textContent = text.substring(currentIndex, item.start).trim();
                if (textContent) {
                    parts.push({ type: 'text', content: textContent });
                }
            }
            
            if (item.type === 'code') {
                const language = item.match[1] || '';
                const code = item.match[2] || '';
                parts.push({ type: 'code', content: code, language: language });
            } else if (item.type === 'image') {
                const url = item.match[1].trim();
                parts.push({ type: 'image', content: url });
            } else if (item.type === 'table') {
                const tableData = item.match[1].trim();
                parts.push({ type: 'table', content: tableData });
            } else if (item.type === 'link') {
                const linkText = item.match[1].trim();
                const linkUrl = item.match[2].trim();
                parts.push({ type: 'link', content: linkUrl, text: linkText });
            }
            
            currentIndex = item.end;
        });
        
        if (currentIndex < text.length) {
            const textContent = text.substring(currentIndex).trim();
            if (textContent) {
                parts.push({ type: 'text', content: textContent });
            }
        }
        
        return parts;
    }

    parseTextFormatting(text) {
        const formatTags = [
            { tag: 'bold', open: '[bold]', close: '[/bold]', style: 'font-weight: bold;' },
            { tag: 'italic', open: '[italic]', close: '[/italic]', style: 'font-style: italic;' },
            { tag: 'underlined', open: '[underlined]', close: '[/underlined]', style: 'text-decoration: underline;' },
            { tag: 'strikethrough', open: '[strikethrough]', close: '[/strikethrough]', style: 'text-decoration: line-through;' }
        ];
        
        let result = text;
        
        result = result.replace(/\[tcolor:(#[0-9A-Fa-f]{6})\](.*?)\[\/tcolor\]/g, (match, color, content) => {
            const innerContent = this.parseTextFormatting(content);
            return `<span style="color: ${color};">${innerContent}</span>`;
        });
        
        formatTags.forEach(({ tag, open, close, style }) => {
            const regex = new RegExp(open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(.*?)' + close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            result = result.replace(regex, (match, content) => {
                const innerContent = this.parseTextFormatting(content);
                return `<span style="${style}">${innerContent}</span>`;
            });
        });
        
        result = result.replace(/\[link:(.*?)\](.*?)\[\/link\]/g, (match, text, url) => {
            const linkText = this.parseTextFormatting(text);
            return `<a href="${this.escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color: #3b82f6; text-decoration: none; font-weight: 500;">${linkText}</a>`;
        });
        
        return result;
    }

    insertToEditor(text) {
        const parts = this.parseAndConvertBlocks(text);
        
        // 에디터의 마지막 요소 찾기 (더 안정적)
        let currentBlock = this.editor.editor.lastElementChild;
        
        // 마지막 블록이 없거나 미디어 블록인 경우 새 p 태그 생성
        if (!currentBlock || 
            currentBlock.classList.contains('t2-media-block') ||
            currentBlock.classList.contains('t2-code-block') ||
            currentBlock.classList.contains('t2-table-wrapper') ||
            currentBlock.classList.contains('t2-file-block')) {
            
            const newP = document.createElement('p');
            newP.innerHTML = '<br>';
            this.editor.editor.appendChild(newP);
            currentBlock = newP;
        }
        
        parts.forEach(part => {
            if (part.type === 'text') {
                const lines = part.content.split('\n');
                lines.forEach(line => {
                    const p = document.createElement('p');
                    if (line.trim()) {
                        const formattedHTML = this.parseTextFormatting(line);
                        p.innerHTML = formattedHTML;
                    } else {
                        p.innerHTML = '<br>';
                    }
                    currentBlock.parentNode.insertBefore(p, currentBlock.nextSibling);
                    currentBlock = p;
                });
            } else if (part.type === 'code') {
                const codePlugin = this.editor.getPlugin('code');
                if (codePlugin) {
                    const codeBlock = codePlugin.createCodeBlock();
                    const codeElement = codeBlock.querySelector('code');
                    if (codeElement) {
                        codeElement.textContent = part.content;
                        codeElement.classList.remove('code-placeholder');
                    }
                    
                    const emptyP = document.createElement('p');
                    emptyP.innerHTML = '<br>';
                    currentBlock.parentNode.insertBefore(emptyP, currentBlock.nextSibling);
                    currentBlock = emptyP;
                    
                    currentBlock.parentNode.insertBefore(codeBlock, currentBlock.nextSibling);
                    currentBlock = codeBlock;
                }
            } else if (part.type === 'image') {
                const imagePlugin = this.editor.getPlugin('image');
                if (imagePlugin) {
                    const imageBlock = imagePlugin.createImageBlock({
                        url: part.content,
                        width: 320,
                        height: 180,
                        blockId: imagePlugin.generateBlockId()
                    });
                    
                    const emptyP = document.createElement('p');
                    emptyP.innerHTML = '<br>';
                    currentBlock.parentNode.insertBefore(emptyP, currentBlock.nextSibling);
                    currentBlock = emptyP;
                    
                    currentBlock.parentNode.insertBefore(imageBlock, currentBlock.nextSibling);
                    currentBlock = imageBlock;
                }
            } else if (part.type === 'table') {
                const tablePlugin = this.editor.getPlugin('table');
                if (tablePlugin) {
                    const rows = this.parseTableData(part.content);
                    if (rows.length > 0) {
                        const table = this.createTableFromData(rows);
                        const tableWrapper = tablePlugin.createTableWrapper(table);
                        
                        const emptyP = document.createElement('p');
                        emptyP.innerHTML = '<br>';
                        currentBlock.parentNode.insertBefore(emptyP, currentBlock.nextSibling);
                        currentBlock = emptyP;
                        
                        currentBlock.parentNode.insertBefore(tableWrapper, currentBlock.nextSibling);
                        currentBlock = tableWrapper;
                        
                        tablePlugin.setupTableControlEvents(tableWrapper.querySelector('.t2-table-controls'), table);
                        tablePlugin.setupTableCellEditing(table);
                        tablePlugin.setupTableResizing(table);
                    }
                }
            } else if (part.type === 'link') {
                const p = document.createElement('p');
                const link = this.createLinkElement(part.content, part.text);
                p.appendChild(link);
                
                currentBlock.parentNode.insertBefore(p, currentBlock.nextSibling);
                currentBlock = p;
                
                const linkPlugin = this.editor.getPlugin('link');
                if (linkPlugin && linkPlugin.setupLinkEvents) {
                    linkPlugin.setupLinkEvents(link);
                }
            }
        });
        
        const finalP = document.createElement('p');
        finalP.innerHTML = '<br>';
        currentBlock.parentNode.insertBefore(finalP, currentBlock.nextSibling);
        
        this.editor.normalizeContent();
        this.editor.createUndoPoint();
        this.editor.autoSave();
    }

    createLinkElement(url, text, newTab = true) {
        const link = document.createElement('a');
        link.href = url;
        link.textContent = text;
        
        if (newTab) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }
        
        link.style.color = '#4A90E2';
        link.style.textDecoration = 'none';
        
        return link;
    }

    parseTableData(tableText) {
        const lines = tableText.trim().split('\n');
        const rows = [];
        
        lines.forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine) {
                let cells;
                if (trimmedLine.includes('|')) {
                    cells = trimmedLine.split('|').map(c => c.trim()).filter(c => c);
                } else if (trimmedLine.includes('\t')) {
                    cells = trimmedLine.split('\t').map(c => c.trim());
                } else if (trimmedLine.includes(',')) {
                    cells = trimmedLine.split(',').map(c => c.trim());
                } else {
                    cells = [trimmedLine];
                }
                rows.push(cells);
            }
        });
        
        return rows;
    }

    createTableFromData(rows) {
        const table = document.createElement('table');
        table.className = 't2-table';
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.setAttribute('border', '1');
        table.setAttribute('data-t2-table', 'true');
        
        const borderStyle = 'solid';
        const borderColor = '#ccc';
        
        if (rows.length > 0) {
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            
            rows[0].forEach(cellText => {
                const th = document.createElement('th');
                th.style.border = `1px ${borderStyle} ${borderColor}`;
                th.style.padding = '8px';
                th.style.backgroundColor = '#f5f5f5';
                th.textContent = cellText;
                headerRow.appendChild(th);
            });
            
            thead.appendChild(headerRow);
            table.appendChild(thead);
        }
        
        if (rows.length > 1) {
            const tbody = document.createElement('tbody');
            
            for (let i = 1; i < rows.length; i++) {
                const tr = document.createElement('tr');
                
                rows[i].forEach(cellText => {
                    const td = document.createElement('td');
                    td.style.border = `1px ${borderStyle} ${borderColor}`;
                    td.style.padding = '8px';
                    td.textContent = cellText || '';
                    if (!cellText) {
                        td.innerHTML = '<br>';
                    }
                    tr.appendChild(td);
                });
                
                tbody.appendChild(tr);
            }
            
            table.appendChild(tbody);
        }
        
        return table;
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

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    closeModal() {
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
    }
}

window.T2AiPlugin = T2AiPlugin;

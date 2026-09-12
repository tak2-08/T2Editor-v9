// T2Editor/plugin/image/image.js

/**
 * 재시도가 의미 없는 영구적 실패를 나타내는 오류 클래스.
 * 서버가 success:false를 반환한 경우(잘못된 접근, 검증 실패 등)는
 * 재시도해도 동일하게 실패하므로 즉시 최종 오류로 처리한다.
 */
class NonRetryableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NonRetryableError';
    }
}

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
        this._nsfwModelLoaded = false;
        this._nsfwProgressCallback = null;
        this._activeImageUploadModal = null;
        this._safeAiNoticeBtn = null;
        this._safeAiModalCleanupObserver = null;
        this._savedEditorRange = null;  // 모달 열기 직전 에디터 커서 위치 저장용
        this.loadConfig();
    }

    // ── [SEC-PLUGIN-BOUNDARY] core.js / utils.js 공통 보안 경계 래퍼 ────────
    // 플러그인 내부에서 직접 HTML/URL/속성 값을 만들 때도 T2Utils 와
    // T2Editor.sanitizePluginHTML()/setPluginHTML() 의 정책을 우회하지 않는다.
    _escapeHtml(value) {
        return (typeof T2Utils !== 'undefined' && T2Utils.escapeHtml)
            ? T2Utils.escapeHtml(String(value ?? ''))
            : String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    }

    _escapeAttr(value) {
        return (typeof T2Utils !== 'undefined' && T2Utils.escapeAttr)
            ? T2Utils.escapeAttr(value)
            : String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#x27;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
    }

    _sanitizeURL(url, context = 'src') {
        if (typeof T2Utils !== 'undefined' && T2Utils.sanitizeURL) {
            return T2Utils.sanitizeURL(url, context);
        }
        const value = String(url || '');
        const normalized = value.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^(javascript|vbscript):/i.test(normalized)) return '';
        if (context === 'href' && /^data:/i.test(normalized)) return '';
        return value;
    }

    _sanitizeImageSrc(url) {
        const safe = this._sanitizeURL(url, 'src');
        if (!safe) return '';

        const raw = String(safe).trim();
        const normalized = raw.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();

        // image 플러그인은 이미지 소스만 허용한다. data: 는 image/* base64 만 통과.
        if (normalized.startsWith('data:')) {
            const compact = raw.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '');
            return /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=]+$/i.test(compact) ? compact : '';
        }

        // 알 수 없는 스킴(file:, ftp:, chrome: 등)은 차단하고, http(s)/프로토콜 상대/상대 경로만 허용.
        if (/^[a-z][a-z0-9+.-]*:/i.test(normalized) && !/^https?:/i.test(normalized)) {
            return '';
        }

        return raw;
    }

    _toBoundedInt(value, fallback, min = 1, max = 10000) {
        const num = Number.parseInt(value, 10);
        if (!Number.isFinite(num)) return fallback;
        return Math.min(max, Math.max(min, num));
    }

    _sanitizeBlockId(blockId) {
        const raw = String(blockId || '');
        return /^[a-zA-Z0-9_-]{1,80}$/.test(raw) ? raw : this.generateBlockId();
    }

    _findBlockById(blockId) {
        const wanted = String(blockId || '');
        if (!wanted || !this.editor || !this.editor.editor) return null;
        return Array.from(this.editor.editor.querySelectorAll('[data-block-id]'))
            .find(el => el.getAttribute('data-block-id') === wanted) || null;
    }

    _sanitizePluginHTML(html) {
        return (this.editor && typeof this.editor.sanitizePluginHTML === 'function')
            ? this.editor.sanitizePluginHTML(html, 'image')
            : html;
    }

    _setPluginHTML(target, html, debugLabel = 'image') {
        if (this.editor && typeof this.editor.setPluginHTML === 'function') {
            this.editor.setPluginHTML(target, html, { plugin: 'image', debugLabel });
        } else {
            target.innerHTML = this._sanitizePluginHTML(html);
        }
    }

    _setTrustedStaticHTML(target, html) {
        target.innerHTML = this._sanitizePluginHTML(html);
    }

    _normalizeUploadConfig(rawConfig) {
        const fallbackExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
        const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

        const maxUploadSize = this._toBoundedInt(raw.maxUploadSize ?? raw.maxSizeMB, 50, 1, 1024);
        const sourceExts = raw.allowedExtensions?.image || raw.extensions?.image || fallbackExts;
        const imageExts = Array.from(new Set(
            (Array.isArray(sourceExts) ? sourceExts : fallbackExts)
                .map(ext => String(ext).toLowerCase().replace(/^\./, '').trim())
                .filter(ext => /^[a-z0-9]{1,10}$/.test(ext))
                // ── [SEC-SVG] 스크립트 실행 가능 포맷은 서버 fallback 과 동일하게 제거
                .filter(ext => !['svg', 'svgz', 'ico'].includes(ext))
        ));

        const safeExts = imageExts.length ? imageExts : fallbackExts;
        const acceptSource = raw.acceptStrings?.image || raw.accept?.image || safeExts.map(ext => `.${ext}`).join(',');
        const acceptImage = String(acceptSource)
            .split(',')
            .map(v => v.trim().toLowerCase())
            .filter(v => /^\.[a-z0-9]{1,10}$/.test(v) && !['.svg', '.svgz', '.ico'].includes(v))
            .join(',') || safeExts.map(ext => `.${ext}`).join(',');

        return {
            maxUploadSize,
            allowedExtensions: { image: safeExts },
            acceptStrings: { image: acceptImage }
        };
    }

    async loadConfig() {
        // editor.lib.php 가 주입한 통합 업로드 설정을 우선 사용한다.
        // 없거나 구버전이면 기존 endpoint 를 fallback 으로만 호출한다.
        if (window.T2EDITOR_UPLOAD_CONFIG) {
            this.config = this._normalizeUploadConfig(window.T2EDITOR_UPLOAD_CONFIG);
            return;
        }

        try {
            const response = await fetch(`${t2editor_url}/config/get_upload_config.php`);
            this.config = this._normalizeUploadConfig(await response.json());
        } catch (error) {
            console.error('Failed to load upload config:', error);
            this.config = this._normalizeUploadConfig(null);
        }
    }

    getNSFWApi() {
        if (!this._nsfwApiPromise) {
            this._nsfwApiPromise = (async () => {
                try {
                    const module = await import(window.T2EDITOR_NSFW_BROWSER_URL);
                    const NSFWFilterAPI = module.default;
                    const api = new NSFWFilterAPI({
                        model: window.T2EDITOR_NSFW_BROWSER_MODEL || 'MobileNetV2Mid',
                        modelType: window.T2EDITOR_NSFW_BROWSER_MODEL_TYPE || 'graph',
                        modelUrl: window.T2EDITOR_NSFW_BROWSER_MODEL_URL || null,
                        backendPriority: Array.isArray(window.T2EDITOR_NSFW_BROWSER_BACKEND_PRIORITY)
                            ? window.T2EDITOR_NSFW_BROWSER_BACKEND_PRIORITY
                            : ['webgpu', 'webgl', 'wasm', 'cpu'],
                        assets: window.T2EDITOR_NSFW_RUNTIME_ASSETS || null,
                        onProgress: (info) => {
                            if (typeof this._nsfwProgressCallback === 'function') {
                                this._nsfwProgressCallback(info);
                            }
                        }
                    });
                    await api.load();
                    this._nsfwModelLoaded = true;
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
                return {
                    isNsfw: result.label !== 'safe',
                    isSuspicious: result.label === 'suspect',
                    isUnsafe: result.label === 'unsafe',
                    label: result.label,
                    prob: result.prob ?? result.nsfwScore ?? 0,
                    nsfwScore: result.nsfwScore ?? 0,
                    explicitScore: result.explicitScore ?? 0,
                    sexyScore: result.sexyScore ?? 0,
                    safeScore: result.safeScore ?? 0,
                    confidence: result.confidence || 'low',
                    predictions: result.predictions || [],
                    topPrediction: result.topPrediction || null,
                    backend: result.backend || null,
                    error: false
                };
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

                const label = data.label || (data.isNsfw ? 'unsafe' : 'safe');
                return {
                    isNsfw: label !== 'safe',
                    isSuspicious: label === 'suspect',
                    isUnsafe: label === 'unsafe',
                    label,
                    prob: Number(data.prob || 0),
                    nsfwScore: Number(data.nsfwScore || data.prob || 0),
                    explicitScore: Number(data.explicitScore || 0),
                    sexyScore: Number(data.sexyScore || 0),
                    safeScore: Number(data.safeScore || 0),
                    confidence: data.confidence || 'low',
                    predictions: Array.isArray(data.predictions) ? data.predictions : [],
                    topPrediction: data.topPrediction || null,
                    backend: data.backend || null,
                    error: false
                };
            }
        } catch (e) {
            console.error('[T2NSFW] 검사 실패:', e);
            return {
                isNsfw: false,
                isSuspicious: false,
                isUnsafe: false,
                label: 'error',
                prob: 0,
                nsfwScore: 0,
                explicitScore: 0,
                sexyScore: 0,
                safeScore: 0,
                error: true,
                errorMessage: e.message || '알 수 없는 오류',
                errorType: e.name || 'Error'
            };
        }
    }

    shouldWarnForNSFW(result) {
        return !!(result && !result.error && (result.label === 'suspect' || result.label === 'unsafe'));
    }

    async resolveNSFWResult(imageData) {
        if (!imageData || !imageData.file) {
            return {
                isNsfw: false,
                isSuspicious: false,
                isUnsafe: false,
                label: 'safe',
                prob: 0,
                nsfwScore: 0,
                explicitScore: 0,
                sexyScore: 0,
                safeScore: 1,
                error: false
            };
        }

        if (imageData.nsfwResult && imageData.nsfwResult.label) {
            return imageData.nsfwResult;
        }

        const result = await this.checkNSFW(imageData.file);
        imageData.nsfwResult = result;
        return result;
    }

    async applyNSFWFilter(imageDataArray) {
        if (!window.T2EDITOR_NSFW_ENABLED) {
            return { allowed: imageDataArray, hasWarning: false, hasError: false, hasBlocked: false };
        }

        const allowed = [];
        let hasWarning = false;
        let hasError = false;
        let hasBlocked = false;

        for (const imageData of imageDataArray) {
            if (!imageData.file) {
                allowed.push(imageData);
                continue;
            }

            const result = await this.resolveNSFWResult(imageData);

            if (result.error) {
                hasError = true;
                console.warn('[T2NSFW] 검사 오류 (허용하되 경고 표시):', imageData.file.name, result.errorMessage);
                allowed.push(imageData);
            } else if (this.shouldWarnForNSFW(result)) {
                if (window.T2EDITOR_NSFW_ALLOW_SUSPICIOUS) {
                    hasWarning = true;
                    allowed.push(imageData);
                } else {
                    hasBlocked = true;
                    console.warn('[T2NSFW] 업로드 취소:', imageData.file.name, `(label: ${result.label}, score: ${Number(result.nsfwScore || result.prob || 0).toFixed(3)})`);
                }
            } else {
                allowed.push(imageData);
            }
        }

        return { allowed, hasWarning, hasError, hasBlocked };
    }

    showNSFWWarningModal() {
        return new Promise((resolve) => {
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
                        flex-direction: column;
                        gap: 10px;
                    }
                    #t2-nsfw-modal .t2nsfw-timer-wrap {
                        width: 100%;
                    }
                    #t2-nsfw-modal .t2nsfw-timer-label {
                        font-size: 11px;
                        color: rgba(255, 255, 255, 0.45);
                        margin-bottom: 7px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        letter-spacing: 0.05px;
                    }
                    #t2-nsfw-modal .t2nsfw-timer-seconds {
                        font-size: 11px;
                        color: rgba(255, 200, 80, 0.65);
                        font-variant-numeric: tabular-nums;
                    }
                    #t2-nsfw-modal .t2nsfw-progress-bg {
                        height: 4px;
                        background: rgba(255, 255, 255, 0.12);
                        border-radius: 3px;
                        overflow: hidden;
                    }
                    #t2-nsfw-modal .t2nsfw-progress-fill {
                        height: 100%;
                        width: 100%;
                        border-radius: 3px;
                        background: linear-gradient(90deg,
                            rgba(255, 80, 80, 0.70),
                            rgba(255, 149, 0, 0.75)
                        );
                        transform-origin: left center;
                    }
                    #t2-nsfw-modal .t2nsfw-btn-row {
                        display: flex;
                        gap: 8px;
                    }
                    #t2-nsfw-modal .t2nsfw-close-btn {
                        flex: 1;
                        padding: 10px 0;
                        background: rgba(255, 255, 255, 0.09);
                        border: 1px solid rgba(255, 255, 255, 0.18);
                        border-radius: 11px;
                        color: rgba(255, 255, 255, 0.65);
                        font-size: 13px;
                        font-weight: 500;
                        cursor: pointer;
                        font-family: inherit;
                        letter-spacing: -0.2px;
                        transition: background 0.18s ease, border-color 0.18s ease;
                        line-height: 1;
                        text-align: center;
                    }
                    #t2-nsfw-modal .t2nsfw-close-btn:hover {
                        background: rgba(255, 255, 255, 0.18);
                        border-color: rgba(255, 255, 255, 0.30);
                        color: rgba(255, 255, 255, 0.85);
                    }
                    #t2-nsfw-modal .t2nsfw-close-btn:active {
                        background: rgba(255, 255, 255, 0.24);
                        transform: scale(0.97);
                    }
                    #t2-nsfw-modal .t2nsfw-confirm-btn {
                        flex: 1;
                        padding: 10px 0;
                        background: rgba(255, 149, 0, 0.28);
                        border: 1px solid rgba(255, 180, 60, 0.55);
                        border-radius: 11px;
                        color: rgba(255, 235, 160, 0.98);
                        font-size: 13px;
                        font-weight: 700;
                        cursor: pointer;
                        font-family: inherit;
                        letter-spacing: -0.2px;
                        transition: background 0.18s ease, border-color 0.18s ease;
                        line-height: 1;
                        text-align: center;
                    }
                    #t2-nsfw-modal .t2nsfw-confirm-btn:hover {
                        background: rgba(255, 149, 0, 0.42);
                        border-color: rgba(255, 180, 60, 0.75);
                    }
                    #t2-nsfw-modal .t2nsfw-confirm-btn:active {
                        background: rgba(255, 149, 0, 0.52);
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
            this._setTrustedStaticHTML(modal, `
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
                        <div class="t2nsfw-timer-label">
                            <span id="t2nsfw-timer-label">10초 후 자동으로 취소됩니다</span>
                            <span class="t2nsfw-timer-seconds" id="t2nsfw-timer-seconds">10s</span>
                        </div>
                        <div class="t2nsfw-progress-bg">
                            <div class="t2nsfw-progress-fill" id="t2nsfw-progress-fill"></div>
                        </div>
                    </div>
                    <div class="t2nsfw-btn-row">
                        <button class="t2nsfw-close-btn" id="t2nsfw-close-btn" type="button">취소하기</button>
                        <button class="t2nsfw-confirm-btn" id="t2nsfw-confirm-btn" type="button">그래도 추가하기</button>
                    </div>
                </div>
            `);

            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            let resolved = false;
            const closeModal = (proceed) => {
                if (resolved) return;
                resolved = true;
                clearInterval(tickInterval);
                clearTimeout(autoCloseTimer);
                overlay.style.transition = 'opacity 0.20s ease';
                modal.style.transition = 'opacity 0.20s ease, transform 0.20s ease';
                overlay.style.opacity = '0';
                modal.style.opacity = '0';
                modal.style.transform = 'translate(-50%, -52%) scale(0.96)';
                setTimeout(() => {
                    document.removeEventListener('keydown', escHandler);
                    overlay.remove();
                    modal.remove();
                    resolve(proceed);
                }, 210);
            };

            overlay.addEventListener('click', () => closeModal(false));
            document.getElementById('t2nsfw-close-btn').addEventListener('click', () => closeModal(false));
            document.getElementById('t2nsfw-confirm-btn').addEventListener('click', () => closeModal(true));

            const escHandler = (event) => {
                if (event.key === 'Escape') closeModal(false);
            };
            document.addEventListener('keydown', escHandler);
            document.getElementById('t2nsfw-close-btn')?.focus();

            let secondsLeft = 10;
            const timerLabel = document.getElementById('t2nsfw-timer-label');
            const timerSeconds = document.getElementById('t2nsfw-timer-seconds');
            const progressFill = document.getElementById('t2nsfw-progress-fill');

            const tickInterval = setInterval(() => {
                secondsLeft--;
                if (timerLabel) {
                    timerLabel.textContent = `${secondsLeft}초 후 자동으로 취소됩니다`;
                }
                if (timerSeconds) {
                    timerSeconds.textContent = `${secondsLeft}s`;
                }
            }, 1000);

            const autoCloseTimer = setTimeout(() => closeModal(false), 10000);

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (progressFill) {
                        progressFill.style.animation = 't2NsfwProgressShrink 10s linear forwards';
                    }
                });
            });
        });
    }

    showNSFWBlockedModal() {
        return new Promise((resolve) => {
            document.querySelector('.t2-nsfw-blocked-overlay')?.remove();
            document.querySelector('.t2-nsfw-blocked-modal')?.remove();

            if (!document.getElementById('t2-nsfw-blocked-modal-styles')) {
                const style = document.createElement('style');
                style.id = 't2-nsfw-blocked-modal-styles';
                style.textContent = `
                    @keyframes t2NsfwBlockedOverlayIn { from { opacity:0; } to { opacity:1; } }
                    @keyframes t2NsfwBlockedModalIn {
                        from { opacity:0; transform:translate(-50%,-46%) scale(0.94); }
                        to   { opacity:1; transform:translate(-50%,-50%) scale(1); }
                    }
                    .t2-nsfw-blocked-overlay {
                        position:fixed; inset:0;
                        background:rgba(0,0,0,0.52);
                        backdrop-filter:blur(6px) saturate(120%);
                        -webkit-backdrop-filter:blur(6px) saturate(120%);
                        z-index:999990;
                        animation:t2NsfwBlockedOverlayIn 0.22s ease forwards;
                    }
                    .t2-nsfw-blocked-modal {
                        position:fixed; top:50%; left:50%;
                        transform:translate(-50%,-50%);
                        z-index:999991;
                        width:min(420px,88vw);
                        background:rgba(255,255,255,0.12);
                        backdrop-filter:blur(28px) saturate(180%);
                        -webkit-backdrop-filter:blur(28px) saturate(180%);
                        border:1px solid rgba(255,80,80,0.38);
                        border-top-color:rgba(255,120,120,0.50);
                        border-radius:22px;
                        box-shadow:
                            0 0 0 0.5px rgba(255,80,80,0.16) inset,
                            0 1px 0 rgba(255,255,255,0.18) inset,
                            0 24px 64px rgba(0,0,0,0.50),
                            0 6px 20px rgba(0,0,0,0.28);
                        padding:26px 26px 22px;
                        color:#fff;
                        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR','Apple SD Gothic Neo',sans-serif;
                        animation:t2NsfwBlockedModalIn 0.30s cubic-bezier(0.34,1.56,0.64,1) forwards;
                        user-select:none;
                    }
                    .t2-nsfw-blocked-modal .t2nsfw-blk-header {
                        display:flex; align-items:center; gap:13px; margin-bottom:15px;
                    }
                    .t2-nsfw-blocked-modal .t2nsfw-blk-icon {
                        flex-shrink:0; width:44px; height:44px;
                        background:rgba(255,60,60,0.22);
                        border:1.5px solid rgba(255,80,80,0.55);
                        border-radius:13px; display:flex; align-items:center;
                        justify-content:center;
                        font-family:'Material Icons'; font-size:22px; line-height:1;
                        color:rgba(255,160,140,0.95);
                    }
                    .t2-nsfw-blocked-modal .t2nsfw-blk-title {
                        font-size:16px; font-weight:700; letter-spacing:-0.4px;
                        color:#fff; text-shadow:0 1px 6px rgba(0,0,0,0.35); line-height:1.3;
                    }
                    .t2-nsfw-blocked-modal .t2nsfw-blk-subtitle {
                        font-size:11px; font-weight:500;
                        color:rgba(255,160,140,0.80); margin-top:2px; letter-spacing:0.1px;
                    }
                    .t2-nsfw-blocked-modal .t2nsfw-blk-body {
                        font-size:13px; line-height:1.75;
                        color:rgba(255,255,255,0.86);
                        text-shadow:0 1px 4px rgba(0,0,0,0.22);
                        margin-bottom:18px; word-break:keep-all; word-wrap:break-word;
                    }
                    .t2-nsfw-blocked-modal .t2nsfw-blk-sep {
                        height:1px;
                        background:linear-gradient(90deg,
                            rgba(255,80,80,0.0),
                            rgba(255,80,80,0.20) 30%,
                            rgba(255,80,80,0.20) 70%,
                            rgba(255,80,80,0.0));
                        margin-bottom:16px;
                    }
                    .t2-nsfw-blocked-modal .t2nsfw-blk-close-btn {
                        display:block; width:100%; box-sizing:border-box;
                        padding:10px 0;
                        background:rgba(255,255,255,0.11);
                        border:1px solid rgba(255,255,255,0.22);
                        border-radius:11px;
                        color:rgba(255,255,255,0.88);
                        font-size:13px; font-weight:500; cursor:pointer;
                        font-family:inherit; letter-spacing:-0.2px;
                        transition:background 0.18s ease, border-color 0.18s ease;
                        line-height:1; text-align:center;
                    }
                    .t2-nsfw-blocked-modal .t2nsfw-blk-close-btn:hover {
                        background:rgba(255,255,255,0.20);
                        border-color:rgba(255,255,255,0.35);
                    }
                    .t2-nsfw-blocked-modal .t2nsfw-blk-close-btn:active {
                        background:rgba(255,255,255,0.28); transform:scale(0.98);
                    }
                `;
                document.head.appendChild(style);
            }

            const overlay = document.createElement('div');
            overlay.className = 't2-nsfw-blocked-overlay';

            const modal = document.createElement('div');
            modal.className = 't2-nsfw-blocked-modal';
            modal.setAttribute('role', 'alertdialog');
            modal.setAttribute('aria-modal', 'true');
            this._setTrustedStaticHTML(modal, `
                <div class="t2nsfw-blk-header">
                    <div class="t2nsfw-blk-icon" aria-hidden="true">block</div>
                    <div>
                        <div class="t2nsfw-blk-title">성인 이미지 감지됨</div>
                        <div class="t2nsfw-blk-subtitle">NSFW Content Blocked</div>
                    </div>
                </div>
                <div class="t2nsfw-blk-body">
                    성인 이미지가 감지되었습니다.<br>
                    해당 이미지를 제거 후 다시 시도해주세요.
                </div>
                <div class="t2nsfw-blk-sep"></div>
                <button class="t2nsfw-blk-close-btn" type="button">닫기</button>
            `);

            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            let resolved = false;
            const closeModal = () => {
                if (resolved) return;
                resolved = true;
                overlay.style.transition = 'opacity 0.20s ease';
                modal.style.transition = 'opacity 0.20s ease, transform 0.20s ease';
                overlay.style.opacity = '0';
                modal.style.opacity = '0';
                modal.style.transform = 'translate(-50%, -52%) scale(0.96)';
                setTimeout(() => {
                    document.removeEventListener('keydown', escHandler);
                    overlay.remove();
                    modal.remove();
                    resolve();
                }, 210);
            };

            const escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
            document.addEventListener('keydown', escHandler);
            overlay.addEventListener('click', closeModal);
            modal.querySelector('.t2nsfw-blk-close-btn').addEventListener('click', closeModal);
            modal.querySelector('.t2nsfw-blk-close-btn')?.focus();
        });
    }

    showNSFWErrorModal(errorDetails) {
        const errorText = typeof errorDetails === 'string' ? errorDetails : 'NSFW 검사 중 오류가 발생했습니다. 일부 이미지는 검사 없이 업로드됩니다.';
        
        if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
            T2Utils.showNotification(errorText, 'warning', 5000);
        } else {
            alert(errorText);
        }
    }

    _disconnectSafeAIModalObserver() {
        if (this._safeAiModalCleanupObserver) {
            this._safeAiModalCleanupObserver.disconnect();
            this._safeAiModalCleanupObserver = null;
        }
    }

    _removeSafeAILegalNotice() {
        document.querySelector('.t2-safeai-legal-overlay')?.remove();
        document.querySelector('.t2-safeai-legal-modal')?.remove();
    }

    _cleanupSafeAIUI({ removeLegalNotice = true } = {}) {
        document.body.classList.remove('t2-image-upload-modal-open');
        this._nsfwProgressCallback = null;

        if (this._safeAiNoticeBtn) {
            this._safeAiNoticeBtn.remove();
            this._safeAiNoticeBtn = null;
        }

        if (removeLegalNotice) {
            this._removeSafeAILegalNotice();
        }
    }

    _watchImageUploadModal(modal, cleanupCallback) {
        this._disconnectSafeAIModalObserver();

        if (!modal || !document.body.contains(modal)) {
            return;
        }

        const observer = new MutationObserver(() => {
            if (!document.body.contains(modal)) {
                this._disconnectSafeAIModalObserver();
                cleanupCallback();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        this._safeAiModalCleanupObserver = observer;
    }

    showImageUploadModal() {
        if (!this.config) {
            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                T2Utils.showNotification('설정을 불러오는 중입니다. 잠시 후 다시 시도해주세요.', 'warning');
            } else {
                alert('설정을 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
            }
            return;
        }

        // 모달이 열리면 에디터가 포커스를 잃으므로, 열기 직전 커서 위치를 저장한다.
        this._saveEditorRange();

        const isNsfwEnabled = window.T2EDITOR_NSFW_ENABLED === true;
        const safeMaxUploadSize = this._escapeHtml(this.config.maxUploadSize);
        const safeAcceptImage = this._escapeAttr(this.config.acceptStrings.image);
        const safeUid = this._escapeAttr(this.editor.generateUid());
        const statusBarHtml = isNsfwEnabled ? `
            <div class="t2-nsfw-status-bar-simple">
                <div class="t2-nsfw-sb-main-row">
                    <span class="material-icons t2-nsfw-status-icon-simple" id="t2-nsfw-sb-icon">shield</span>
                    <span class="t2-nsfw-status-text-simple" id="t2-nsfw-sb-text">T2Editor SafeAI 검사 활성</span>
                    <span class="t2-nsfw-status-badge-simple" id="t2-nsfw-global-badge">대기</span>
                </div>
                <div class="t2-nsfw-model-bar" id="t2-nsfw-model-bar" aria-hidden="true">
                    <div class="t2-nsfw-model-bar-fill" id="t2-nsfw-model-bar-fill"></div>
                </div>
            </div>
        ` : '';

        const modalContent = `
            <div class="t2-image-editor-modal">
                <h3>이미지 추가</h3>
                <div class="t2-image-upload-area">
                    <span class="material-icons">cloud_upload</span>
                    <div class="t2-image-upload-text">클릭하거나 드래그하여 이미지 추가</div>
                    <div class="t2-image-upload-hint">최대 ${safeMaxUploadSize}MB · 최대 15개</div>
                    <input type="file" name="bf_file[]" accept="${safeAcceptImage}" multiple>
                    <input type="hidden" name="uid" value="${safeUid}">
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
                <div class="t2-image-editor-poweredby" aria-hidden="true">
                    Powered by <span class="t2-pb-t2">T2</span><span class="t2-pb-editor">Editor</span>
                </div>
            </div>
        `;

        this._disconnectSafeAIModalObserver();
        this._cleanupSafeAIUI();

        const modal = T2Utils.createModal(modalContent);
        this._activeImageUploadModal = modal;
        document.body.classList.add('t2-image-upload-modal-open');

        let noticeBtn = null;
        if (isNsfwEnabled) {
            noticeBtn = this._createSafeAINoticeBtn();
            this._safeAiNoticeBtn = noticeBtn;
            document.body.appendChild(noticeBtn);
        }

        this.setupModalEvents(modal, noticeBtn);
    }

    setupModalEvents(modal, noticeBtn = null) {
        let isModalCleanedUp = false;
        const _cleanupModal = () => {
            if (isModalCleanedUp) return;
            isModalCleanedUp = true;

            this._disconnectSafeAIModalObserver();

            if (modal && modal.isConnected) {
                modal.remove();
            }

            if (this._activeImageUploadModal === modal) {
                this._activeImageUploadModal = null;
            }

            if (noticeBtn && this._safeAiNoticeBtn !== noticeBtn) {
                noticeBtn.remove();
            }

            this._cleanupSafeAIUI();

            // 전체보기 키보드 핸들러 정리
            if (fullView && fullView._fvKeyHandler) {
                document.removeEventListener('keydown', fullView._fvKeyHandler);
                fullView._fvKeyHandler = null;
            }
        };

        this._watchImageUploadModal(modal, _cleanupModal);

        const previewGrid = modal.querySelector('.t2-image-preview-grid');
        const fileInput = modal.querySelector('input[type="file"]');
        const uploadBtn = modal.querySelector('[data-action="upload"]');
        const uploadArea = modal.querySelector('.t2-image-upload-area');
        const dragHint = modal.querySelector('.t2-preview-drag-hint');
        const globalBadge = modal.querySelector('#t2-nsfw-global-badge');
        const sbIcon = modal.querySelector('#t2-nsfw-sb-icon');
        const sbText = modal.querySelector('#t2-nsfw-sb-text');
        const modelBar = modal.querySelector('#t2-nsfw-model-bar');
        const modelBarFill = modal.querySelector('#t2-nsfw-model-bar-fill');
        
        const previewItems = new Map();
        let draggedItem = null;
        let lastDragOverItem = null;
        let pendingChecks = 0;
        let completedChecks = 0;
        let errorChecks = 0;

        // ── 이미지 전체보기(확대) 패널 ──────────────────────────────────
        const fullView = document.createElement('div');
        fullView.className = 't2-image-full-view';
        fullView.setAttribute('aria-label', '이미지 전체보기');
        previewGrid.insertAdjacentElement('afterend', fullView);

        const _fmtFileSize = (bytes) => {
            if (!Number.isFinite(bytes) || bytes < 0) return '–';
            if (bytes < 1024)        return `${bytes} B`;
            if (bytes < 1048576)     return `${(bytes / 1024).toFixed(1)} KB`;
            if (bytes < 1073741824)  return `${(bytes / 1048576).toFixed(2)} MB`;
            return `${(bytes / 1073741824).toFixed(2)} GB`;
        };

        const _getOrderedFvItems = () => {
            const ordered = [];
            previewGrid.querySelectorAll('.t2-preview-item').forEach(el => {
                for (const [f, d] of previewItems.entries()) {
                    if (d.previewItem === el) { ordered.push({ file: f, data: d }); break; }
                }
            });
            return ordered;
        };

        let _fvOpen = false;

        const _closeFv = () => {
            if (!_fvOpen) return;
            _fvOpen = false;
            fullView.classList.remove('active');
            previewGrid.style.display = '';
            if (dragHint) dragHint.style.display = '';
        };

        const _renderFv = (ordered, idx) => {
            const total = ordered.length;
            if (idx < 0 || idx >= total) return;

            const { file, data } = ordered[idx];
            const { imageData } = data;
            const safeSrc  = this._sanitizeImageSrc(imageData.url);
            const safeName = this._escapeHtml(file.name);
            const rawExt   = file.name.includes('.') ? file.name.split('.').pop() : '';
            const ext      = rawExt.toUpperCase() || '–';
            const sizeStr  = _fmtFileSize(file.size);
            const dimStr   = (imageData.width && imageData.height)
                ? `${imageData.width} × ${imageData.height}`
                : '–';

            // DOM 초기화
            while (fullView.firstChild) fullView.removeChild(fullView.firstChild);

            // ── 상단 조작 바 ──────────────────────────────────────────
            const topbar = document.createElement('div');
            topbar.className = 't2-fv-topbar';

            const backBtn = document.createElement('button');
            backBtn.type = 'button';
            backBtn.className = 't2-fv-back-btn';
            backBtn.setAttribute('aria-label', '목록으로 돌아가기');
            const backIcon = document.createElement('span');
            backIcon.className = 'material-icons';
            backIcon.setAttribute('aria-hidden', 'true');
            backIcon.textContent = 'arrow_back_ios_new';
            const backTxt = document.createElement('span');
            backTxt.textContent = '목록';
            backBtn.append(backIcon, backTxt);
            backBtn.addEventListener('click', _closeFv);

            const counter = document.createElement('div');
            counter.className = 't2-fv-counter';
            counter.setAttribute('aria-live', 'polite');
            counter.textContent = `${idx + 1} / ${total}`;

            const navDiv = document.createElement('div');
            navDiv.className = 't2-fv-nav';
            navDiv.setAttribute('role', 'group');
            navDiv.setAttribute('aria-label', '이미지 탐색');

            const prevBtn = document.createElement('button');
            prevBtn.type = 'button';
            prevBtn.className = 't2-fv-nav-btn';
            prevBtn.disabled = (idx === 0);
            prevBtn.setAttribute('aria-label', '이전 이미지');
            const prevIcon = document.createElement('span');
            prevIcon.className = 'material-icons';
            prevIcon.setAttribute('aria-hidden', 'true');
            prevIcon.textContent = 'chevron_left';
            prevBtn.appendChild(prevIcon);
            prevBtn.addEventListener('click', () => {
                const cur = _getOrderedFvItems();
                if (idx > 0) _renderFv(cur, idx - 1);
            });

            const nextBtn = document.createElement('button');
            nextBtn.type = 'button';
            nextBtn.className = 't2-fv-nav-btn';
            nextBtn.disabled = (idx === total - 1);
            nextBtn.setAttribute('aria-label', '다음 이미지');
            const nextIcon = document.createElement('span');
            nextIcon.className = 'material-icons';
            nextIcon.setAttribute('aria-hidden', 'true');
            nextIcon.textContent = 'chevron_right';
            nextBtn.appendChild(nextIcon);
            nextBtn.addEventListener('click', () => {
                const cur = _getOrderedFvItems();
                if (idx < cur.length - 1) _renderFv(cur, idx + 1);
            });

            navDiv.append(prevBtn, nextBtn);

            // ── 편집 버튼 (전체보기 topbar) ──────────────────────────
            const fvEditBtn = document.createElement('button');
            fvEditBtn.type = 'button';
            fvEditBtn.className = 't2-fv-edit-btn';
            fvEditBtn.setAttribute('aria-label', '이미지 편집');
            const fvEditIcon = document.createElement('span');
            fvEditIcon.className = 'material-icons';
            fvEditIcon.setAttribute('aria-hidden', 'true');
            fvEditIcon.textContent = 'tune';
            fvEditBtn.appendChild(fvEditIcon);
            fvEditBtn.addEventListener('click', async () => {
                const entry = previewItems.get(file);
                if (!entry) return;
                await this.showImageEditorModal(entry);
                // 편집 완료 후 전체보기 갱신 (URL·해상도 반영)
                const cur = _getOrderedFvItems();
                const newIdx = cur.findIndex(({ file: f }) => f === file);
                _renderFv(cur, newIdx !== -1 ? newIdx : idx);
            });

            topbar.append(backBtn, counter, fvEditBtn, navDiv);

            // ── 이미지 표시 영역 ──────────────────────────────────────
            const imgArea = document.createElement('div');
            imgArea.className = 't2-fv-image-area';
            const fvImg = document.createElement('img');
            fvImg.src = safeSrc;
            fvImg.alt = safeName;
            fvImg.draggable = false;
            imgArea.appendChild(fvImg);

            // ── 이미지 정보 바 ────────────────────────────────────────
            const infoBar = document.createElement('div');
            infoBar.className = 't2-fv-info-bar';
            infoBar.setAttribute('aria-label', '이미지 정보');

            const infoData = [
                { label: '이름',  value: file.name, cls: 't2-fv-info-name' },
                { label: '형식',  value: ext },
                { label: '해상도', value: `${dimStr} px` },
                { label: '크기',  value: sizeStr },
            ];
            infoData.forEach(({ label, value, cls }) => {
                const item = document.createElement('div');
                item.className = 't2-fv-info-item';

                const lbl = document.createElement('span');
                lbl.className = 't2-fv-info-label';
                lbl.textContent = label;

                const val = document.createElement('span');
                val.className = 't2-fv-info-value' + (cls ? ' ' + cls : '');
                val.textContent = value;
                val.title = value;

                item.append(lbl, val);
                infoBar.appendChild(item);
            });

            fullView.append(topbar, imgArea, infoBar);

            // 키보드 방향키 지원 (이 렌더링 스코프에서 이전 리스너 교체)
            fullView._fvKeyHandler && document.removeEventListener('keydown', fullView._fvKeyHandler);
            fullView._fvKeyHandler = (e) => {
                if (!_fvOpen) return;
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const c = _getOrderedFvItems();
                    if (idx > 0) _renderFv(c, idx - 1);
                } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const c = _getOrderedFvItems();
                    if (idx < c.length - 1) _renderFv(c, idx + 1);
                } else if (e.key === 'Escape') {
                    _closeFv();
                }
            };
            document.addEventListener('keydown', fullView._fvKeyHandler);
        };

        const _openFv = (file) => {
            const ordered = _getOrderedFvItems();
            const idx = ordered.findIndex(({ file: f }) => f === file);
            if (idx === -1) return;
            _fvOpen = true;
            previewGrid.style.display = 'none';
            if (dragHint) dragHint.style.display = 'none';
            fullView.classList.add('active');
            _renderFv(ordered, idx);
            // 전체보기 패널 내 첫 번째 버튼에 포커스
            requestAnimationFrame(() => {
                const firstBtn = fullView.querySelector('button');
                if (firstBtn) firstBtn.focus({ preventScroll: true });
            });
        };
        // ── /전체보기 설정 끝 ────────────────────────────────────────

        const isNsfwEnabled = window.T2EDITOR_NSFW_ENABLED === true;

        // ── 브라우저 모드에서 모델 로드 UI 처리 ──────────────────────
        if (isNsfwEnabled && window.T2EDITOR_NSFW_MODE === 'browser' && !this._nsfwModelLoaded) {
            let modelLoadTimers = [];

            const startModelLoadUI = () => {
                if (sbIcon) { sbIcon.textContent = 'sync'; sbIcon.classList.add('t2-nsfw-sb-spinning'); }
                if (sbText) sbText.textContent = 'AI 모델 불러오는 중';
                if (globalBadge) {
                    globalBadge.textContent = '0%';
                    globalBadge.className = 't2-nsfw-status-badge-simple t2-nsfw-sb-badge--loading';
                }
                if (modelBar) modelBar.classList.add('t2-nsfw-model-bar--active');
                if (modelBarFill) modelBarFill.style.width = '0%';
            };

            this._nsfwProgressCallback = ({ percent, message }) => {
                if (!modelBar) return;
                if (sbText && message) sbText.textContent = message;
                if (globalBadge && pendingChecks === 0) {
                    globalBadge.textContent = `${percent}%`;
                    globalBadge.className = 't2-nsfw-status-badge-simple t2-nsfw-sb-badge--loading';
                }
                if (modelBarFill) modelBarFill.style.width = `${percent}%`;
            };

            const completeModelLoadUI = () => {
                this._nsfwProgressCallback = null;

                // 즉시: 100% 채우기 + 그린 전환
                if (modelBarFill) modelBarFill.style.width = '100%';
                if (modelBar) modelBar.classList.add('t2-nsfw-model-bar--done');

                // 450ms: 완료 상태 표시 + 바 fade-out
                modelLoadTimers.push(setTimeout(() => {
                    if (sbIcon) {
                        sbIcon.textContent = 'check_circle';
                        sbIcon.classList.remove('t2-nsfw-sb-spinning');
                        sbIcon.classList.add('t2-nsfw-sb-ready');
                    }
                    if (sbText) sbText.textContent = 'SafeAI 준비 완료';
                    if (globalBadge && pendingChecks === 0) {
                        globalBadge.textContent = '준비됨';
                        globalBadge.className = 't2-nsfw-status-badge-simple safe';
                    }
                    if (modelBar) modelBar.classList.add('t2-nsfw-model-bar--complete');
                }, 450));

                // 800ms: 바 완전 접기
                modelLoadTimers.push(setTimeout(() => {
                    if (modelBar) {
                        modelBar.classList.remove(
                            't2-nsfw-model-bar--active',
                            't2-nsfw-model-bar--done',
                            't2-nsfw-model-bar--complete'
                        );
                    }
                }, 800));

                // 2200ms: 일반 활성 상태로 조용히 복귀
                modelLoadTimers.push(setTimeout(() => {
                    if (sbIcon) {
                        sbIcon.textContent = 'shield';
                        sbIcon.classList.remove('t2-nsfw-sb-ready');
                    }
                    if (sbText) sbText.textContent = 'SafeAI 검사 활성';
                    if (pendingChecks === 0) updateGlobalBadge();
                }, 2200));
            };

            const failModelLoadUI = () => {
                this._nsfwProgressCallback = null;
                if (sbIcon) { sbIcon.textContent = 'shield'; sbIcon.classList.remove('t2-nsfw-sb-spinning'); }
                if (sbText) sbText.textContent = 'SafeAI 검사 활성';
                if (modelBar) {
                    modelBar.classList.remove('t2-nsfw-model-bar--active', 't2-nsfw-model-bar--done');
                }
                if (globalBadge && pendingChecks === 0) {
                    globalBadge.textContent = '로드 오류';
                    globalBadge.className = 't2-nsfw-status-badge-simple error';
                }
            };

            startModelLoadUI();
            this.getNSFWApi().then(completeModelLoadUI).catch(failModelLoadUI);
        }

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
                const resolvedChecks = completedChecks + errorChecks;
                globalBadge.textContent = `검사중 (${resolvedChecks}/${resolvedChecks + pendingChecks})`;
                globalBadge.classList.add('loading');
                globalBadge.classList.remove('safe', 'warning', 'error');
            } else {
                const total = previewItems.size;
                if (total === 0) {
                    globalBadge.textContent = '검사 대기';
                    globalBadge.classList.remove('loading', 'safe', 'warning', 'error');
                } else {
                    const entries = Array.from(previewItems.values());
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
            const hasAny = previewItems.size > 0;
            uploadBtn.disabled = !hasAny || (isNsfwEnabled && pendingChecks > 0);
        };

        const showDragHint = () => {
            if (previewItems.size > 1 && dragHint) {
                setTimeout(() => {
                    dragHint.classList.add('show');
                }, 100);
            }
        };

        const updatePreviewStatus = (previewItem, result) => {
            const statusDiv = previewItem.querySelector('.t2-nsfw-preview-status');
            if (!statusDiv) return;

            const setStatus = (className, iconName, labelText, titleText = '') => {
                statusDiv.replaceChildren();

                const icon = document.createElement('span');
                icon.className = `material-icons ${className}`;
                icon.textContent = iconName;

                const label = document.createElement('span');
                label.textContent = labelText;

                statusDiv.append(icon, label);
                statusDiv.className = `t2-nsfw-preview-status ${className}`;
                statusDiv.title = titleText;
            };

            if (!result) {
                setStatus('loading', 'pending', '검사중...');
            } else if (result.error) {
                setStatus('error', 'error_outline', '오류', result.errorMessage ? `검사 오류: ${String(result.errorMessage)}` : '');
            } else if (result.isNsfw) {
                const prob = Number.isFinite(Number(result.prob)) ? Number(result.prob) : 0;
                setStatus('warning', 'warning', '의심됨', `불안전 콘텐츠 의심 (확률: ${(prob * 100).toFixed(1)}%)`);
            } else {
                const prob = Number.isFinite(Number(result.prob)) ? Number(result.prob) : 0;
                setStatus('safe', 'check_circle', '안전', `안전한 콘텐츠 (확률: ${(prob * 100).toFixed(1)}%)`);
            }
        };

        const createImageDataFromFile = (file) => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const base64Url = this._sanitizeImageSrc(e.target.result);
                    if (!base64Url) {
                        reject(new Error('허용되지 않는 이미지 데이터입니다.'));
                        return;
                    }
                    const img = new Image();
                    img.onload = () => {
                        const blockId = this.generateBlockId();
                        resolve({
                            url: base64Url,
                            width: img.naturalWidth,
                            height: img.naturalHeight,
                            blockId: blockId,
                            isUploading: true,
                            file: file,
                            nsfwResult: null
                        });
                    };
                    img.onerror = () => reject(new Error('이미지 로드 실패'));
                    img.src = base64Url;
                };
                reader.onerror = () => reject(new Error('파일 읽기 실패'));
                reader.readAsDataURL(file);
            });
        };

        const handleFiles = async (files) => {
            const remainingSlots = 15 - previewItems.size;
            const filesToProcess = Array.from(files).slice(0, remainingSlots);
            
            if (files.length > remainingSlots) {
                if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                    T2Utils.showNotification(`최대 15개까지만 업로드할 수 있습니다. ${filesToProcess.length}개만 추가됩니다.`, 'warning');
                }
            }

            for (const file of filesToProcess) {
                if (!this.validateImageFile(file)) continue;

                if (isNsfwEnabled) {
                    pendingChecks++;
                    updateGlobalBadge();
                    updateUploadButton();
                }

                try {
                    const imageData = await createImageDataFromFile(file);
                    
                    const previewItem = document.createElement('div');
                    previewItem.className = 't2-preview-item';
                    previewItem.draggable = true;

                    const orderBadge = document.createElement('div');
                    orderBadge.className = 't2-preview-order';
                    orderBadge.textContent = previewItems.size + 1;

                    const previewImg = document.createElement('img');
                    previewImg.src = this._sanitizeImageSrc(imageData.url);
                    previewImg.alt = 'Preview';
                    // 네이티브 이미지 드래그 차단 (브라우저 고유 drag ghost 방지)
                    previewImg.draggable = false;

                    previewItem.append(orderBadge, previewImg);

                    // 확대 힌트 아이콘 (호버/터치 시 표시)
                    const zoomHint = document.createElement('div');
                    zoomHint.className = 't2-preview-zoom-hint';
                    zoomHint.setAttribute('aria-hidden', 'true');
                    const zoomIcon = document.createElement('span');
                    zoomIcon.className = 'material-icons';
                    zoomIcon.textContent = 'zoom_in';
                    zoomHint.appendChild(zoomIcon);
                    previewItem.appendChild(zoomHint);

                    previewItem.setAttribute('tabindex', '0');
                    previewItem.setAttribute('role', 'button');
                    previewItem.setAttribute('aria-label', '이미지 크게 보기 (드래그하여 순서 변경)');
                    previewItem.title = '클릭하여 크게 보기 · 드래그하여 순서 변경';

                    if (isNsfwEnabled) {
                        const status = document.createElement('div');
                        status.className = 't2-nsfw-preview-status loading';

                        const statusIcon = document.createElement('span');
                        statusIcon.className = 'material-icons loading';
                        statusIcon.textContent = 'pending';

                        const statusText = document.createElement('span');
                        statusText.textContent = '검사중...';

                        status.append(statusIcon, statusText);
                        previewItem.appendChild(status);
                    }

                    const removeButton = document.createElement('button');
                    removeButton.type = 'button';
                    removeButton.className = 't2-preview-remove';
                    removeButton.setAttribute('aria-label', '이미지 제거');

                    const removeIcon = document.createElement('span');
                    removeIcon.className = 'material-icons';
                    removeIcon.textContent = 'close';

                    removeButton.appendChild(removeIcon);
                    previewItem.appendChild(removeButton);

                    // ── 편집 버튼 ────────────────────────────────────────
                    const editButton = document.createElement('button');
                    editButton.type = 'button';
                    editButton.className = 't2-preview-edit';
                    editButton.setAttribute('aria-label', '이미지 편집');
                    const editIcon = document.createElement('span');
                    editIcon.className = 'material-icons';
                    editIcon.textContent = 'tune';
                    editButton.appendChild(editIcon);
                    previewItem.appendChild(editButton);

                    previewItem.addEventListener('dragstart', (e) => {
                        draggedItem = previewItem;
                        previewItem.classList.add('dragging');
                        e.dataTransfer.effectAllowed = 'move';
                    });
                    // Android Chrome 롱프레스 컨텍스트 메뉴 차단
                    // (CSS pointer-events:none + -webkit-touch-callout:none 으로
                    //  iOS/이미지 전용 메뉴는 이미 막혀 있고, 이 핸들러는 나머지 브라우저 대응)
                    previewItem.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
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

                    // ── 클릭 → 전체보기 (드래그와 구분) ─────────────────
                    previewItem.addEventListener('click', (e) => {
                        if (e.target.closest('.t2-preview-remove')) return;
                        if (e.target.closest('.t2-preview-edit')) return;
                        // 터치 드래그 중이었으면 클릭 무시 후 플래그 초기화
                        if (isTouchDragging) { isTouchDragging = false; return; }
                        _openFv(file);
                    });
                    // 키보드 접근성 (Enter / Space)
                    previewItem.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            _openFv(file);
                        }
                    });

                    const removeBtn = previewItem.querySelector('.t2-preview-remove');
                    const statusElement = isNsfwEnabled ? previewItem.querySelector('.t2-nsfw-preview-status') : null;
                    
                    removeBtn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // 전체보기 중 삭제 → 목록으로 복귀
                        if (_fvOpen) _closeFv();
                        const entry = previewItems.get(file);
                        if (isNsfwEnabled && entry) {
                            if (entry.nsfwResult == null && pendingChecks > 0) {
                                pendingChecks = Math.max(0, pendingChecks - 1);
                            } else if (entry.nsfwResult && entry.nsfwResult.error && errorChecks > 0) {
                                errorChecks = Math.max(0, errorChecks - 1);
                            } else if (entry.nsfwResult && !entry.nsfwResult.error && completedChecks > 0) {
                                completedChecks = Math.max(0, completedChecks - 1);
                            }
                        }
                        previewItems.delete(file);
                        previewItem.remove();
                        updateOrderNumbers();
                        updateUploadButton();
                        if (isNsfwEnabled) {
                            updateGlobalBadge();
                        }
                        if (previewItems.size <= 1 && dragHint) dragHint.classList.remove('show');
                    };

                    previewItems.set(file, { previewItem, imageData, nsfwResult: null, statusElement });

                    // ── 편집 버튼 이벤트 ──────────────────────────────────
                    editButton.onclick = async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const entry = previewItems.get(file);
                        if (!entry) return;
                        await this.showImageEditorModal(entry);
                    };
                    previewGrid.appendChild(previewItem);
                    updateOrderNumbers();
                    showDragHint();
                    updateUploadButton();

                    if (isNsfwEnabled) {
                        this.checkNSFW(file).then(result => {
                            const entry = previewItems.get(file);
                            if (entry) {
                                entry.nsfwResult = result;
                                entry.imageData.nsfwResult = result;
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
                            console.error('[T2NSFW] 예상치 못한 오류:', err);
                            const entry = previewItems.get(file);
                            if (entry) {
                                const errorResult = { isNsfw: false, prob: 0, error: true, errorMessage: err.message };
                                entry.nsfwResult = errorResult;
                                entry.imageData.nsfwResult = errorResult;
                                updatePreviewStatus(entry.previewItem, errorResult);
                                pendingChecks = Math.max(0, pendingChecks - 1);
                                errorChecks++;
                                updateGlobalBadge();
                                updateUploadButton();
                            }
                        });
                    } else {
                        const entry = previewItems.get(file);
                        if (entry) {
                            entry.nsfwResult = { isNsfw: false, prob: 0, error: false };
                            entry.imageData.nsfwResult = { isNsfw: false, prob: 0, error: false };
                        }
                    }
                } catch (error) {
                    console.error('파일 처리 오류:', error);
                    if (isNsfwEnabled && pendingChecks > 0) {
                        pendingChecks--;
                        updateGlobalBadge();
                        updateUploadButton();
                    }
                    if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                        T2Utils.showNotification(`파일 "${file.name}" 처리 실패`, 'error');
                    }
                }
            }
        };

        fileInput.onchange = async (e) => {
            await handleFiles(e.target.files);
            e.target.value = '';
        };
        T2Utils.setupDragAndDrop(uploadArea, handleFiles);
        
        modal.querySelector('[data-action="cancel"]').onclick = () => _cleanupModal();

        modal.querySelector('[data-action="upload"]').onclick = async () => {
            if (previewItems.size === 0) return;
            if (isNsfwEnabled && pendingChecks > 0) {
                if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                    T2Utils.showNotification('모든 이미지 검사가 완료될 때까지 기다려주세요.', 'warning');
                } else {
                    alert('모든 이미지 검사가 완료될 때까지 기다려주세요.');
                }
                return;
            }

            const orderedItems = [];
            const orderedPreviewItems = previewGrid.querySelectorAll('.t2-preview-item');
            for (const previewItem of orderedPreviewItems) {
                for (const [file, data] of previewItems.entries()) {
                    if (data.previewItem === previewItem) {
                        orderedItems.push({ file, imageData: data.imageData, nsfwResult: data.nsfwResult });
                        break;
                    }
                }
            }

            let imageDataArray = orderedItems.map(item => item.imageData);
            let hasWarning = false;
            let hasError = false;
            let hasBlocked = false;

            if (isNsfwEnabled) {
                const filterResult = await this.applyNSFWFilter(imageDataArray);
                imageDataArray = filterResult.allowed;
                hasWarning = filterResult.hasWarning;
                hasError = filterResult.hasError;
                hasBlocked = filterResult.hasBlocked;
            }

            // false 케이스: 성인 이미지 차단됨 → 안내 모달 표시 후 업로드 모달 유지
            if (hasBlocked) {
                await this.showNSFWBlockedModal();
                return; // 이미지 추가 모달 유지
            }

            if (imageDataArray.length === 0) {
                if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                    T2Utils.showNotification('업로드할 이미지가 없습니다.', 'error');
                } else {
                    alert('업로드할 이미지가 없습니다.');
                }
                return;
            }

            if (hasError) {
                const errorMessages = imageDataArray.filter(d => d.nsfwResult && d.nsfwResult.error).map(d => `${d.file?.name}: ${d.nsfwResult?.errorMessage || '검사 오류'}`);
                this.showNSFWErrorModal(`일부 이미지(${errorMessages.length}개)의 검사에 실패했습니다.\n${errorMessages.slice(0, 3).join('\n')}${errorMessages.length > 3 ? '...' : ''}`);
            }

            // true 케이스: 경고 모달 — 사용자가 "그래도 추가하기"를 눌러야 에디터에 삽입
            if (hasWarning) {
                const proceed = await this.showNSFWWarningModal();
                if (!proceed) return; // "취소하기" 선택 → 업로드 모달 유지
            }

            this.insertImageBlocks(imageDataArray);

            imageDataArray.forEach(imageData => {
                if (imageData.file && imageData.isUploading) {
                    this.queueUpload(imageData.file, imageData.blockId);
                }
            });

            _cleanupModal();
        };
    }

    handleCommand(command, button) {
        if (command === 'insertImage') {
            // toolbar 버튼 클릭 시 showImageUploadModal보다 먼저 range를 저장한다.
            // (showImageUploadModal 내부에서도 저장하지만, e.preventDefault()로
            //  포커스 이동이 차단되기 전 시점에 한번 더 저장해 두는 이중 안전장치)
            this._saveEditorRange();
            this.showImageUploadModal();
        }
    }

    _createSafeAINoticeBtn() {
        const btn = document.createElement('button');
        btn.className = 't2-safeai-notice-btn';
        btn.type = 'button';
        btn.setAttribute('data-safeai-notice', 'true');
        const icon = document.createElement('span');
        icon.className = 'material-icons';
        icon.textContent = 'info';
        btn.append(icon, document.createTextNode('SafeAI 고지'));
        btn.title = 'T2Editor SafeAI 책임 한계 및 제3자 구성요소 고지';
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (!this._activeImageUploadModal || !document.body.contains(this._activeImageUploadModal)) {
                this._cleanupSafeAIUI();
                return;
            }

            this.showSafeAILegalNotice();
        };
        return btn;
    }

    showSafeAILegalNotice() {
        if (!this._activeImageUploadModal || !document.body.contains(this._activeImageUploadModal)) {
            this._cleanupSafeAIUI();
            return;
        }

        this._removeSafeAILegalNotice();

        const overlay = document.createElement('div');
        overlay.className = 't2-safeai-legal-overlay';

        const modal = document.createElement('div');
        modal.className = 't2-safeai-legal-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 't2-safeai-legal-title');

        this._setTrustedStaticHTML(modal, `
            <div class="t2-safeai-legal-header">
                <div class="t2-safeai-legal-header-left">
                    <div class="t2-safeai-legal-icon">
                        <span class="material-icons">shield</span>
                    </div>
                    <div>
                        <div class="t2-safeai-legal-title" id="t2-safeai-legal-title">T2Editor SafeAI 책임 한계 및 제3자 구성요소 고지</div>
                        <div class="t2-safeai-legal-version">Powered by NSFWJS</div>
                    </div>
                </div>
                <button class="t2-safeai-legal-close" type="button" id="t2-safeai-legal-close-btn" aria-label="닫기">
                    <span class="material-icons">close</span>
                </button>
            </div>
            <div class="t2-safeai-legal-body">
                <div class="t2-safeai-legal-section">
                    <div class="t2-safeai-legal-section-title">1. SafeAI 기능 개요</div>
                    <p>T2Editor SafeAI는 이미지 업로드 시 성인(NSFW), 폭력, 혐오 등 부적절한 콘텐츠를 자동 감지하는 AI 기반 사전 필터링 보조 기능입니다. 본 기능은 운영자가 명시적으로 활성화한 경우에만 동작하며, 브라우저 내(클라이언트) 또는 운영자 지정 서버에서 이미지를 분류합니다.</p>
                </div>
                <div class="t2-safeai-legal-divider"></div>
                <div class="t2-safeai-legal-section">
                    <div class="t2-safeai-legal-section-title">2. 제3자 구성요소 고지</div>
                    <p>본 기능은 다음 오픈소스 라이브러리 및 모델을 사용합니다.</p>
                    <div class="t2-safeai-legal-chip-row">
                        <div class="t2-safeai-legal-chip">
                            <span class="t2-safeai-legal-chip-name">NSFWJS</span>
                            <span class="t2-safeai-legal-chip-meta">infinitered · MIT License</span>
                            <span class="t2-safeai-legal-chip-meta">© Infinite Red, Inc. and contributors</span>
                        </div>
                        <div class="t2-safeai-legal-chip">
                            <span class="t2-safeai-legal-chip-name">TensorFlow.js</span>
                            <span class="t2-safeai-legal-chip-meta">Google LLC · Apache License 2.0</span>
                            <span class="t2-safeai-legal-chip-meta">© Google LLC</span>
                        </div>
                    </div>
                    <p style="margin-top:8px;">위 라이브러리 및 모델은 해당 저작자의 라이선스 조건에 따라 사용되며, T2Editor 개발자 및 서비스 운영자는 제3자 라이브러리의 결함·오동작·정확도 미달로 인한 결과에 대해 책임을 지지 않습니다.</p>
                </div>
                <div class="t2-safeai-legal-divider"></div>
                <div class="t2-safeai-legal-section">
                    <div class="t2-safeai-legal-section-title">3. 분류 정확도 및 한계</div>
                    <ul>
                        <li>AI 이미지 분류는 통계적 확률 모델에 기반하며 <strong>100% 정확도를 보장하지 않습니다.</strong></li>
                        <li>안전한 이미지가 부적절로 판정(오탐, False Positive)되거나, 부적절한 이미지가 안전으로 판정(미탐, False Negative)될 수 있습니다.</li>
                        <li>분류 결과는 참고 정보에 불과하며, 콘텐츠 게시 여부에 대한 최종 판단과 법적 책임은 전적으로 사용자(작성자) 본인에게 있습니다.</li>
                    </ul>
                </div>
                <div class="t2-safeai-legal-divider"></div>
                <div class="t2-safeai-legal-section">
                    <div class="t2-safeai-legal-section-title">4. 책임 한계</div>
                    <p><strong>가. 사용자 책임</strong><br>
                    업로드된 모든 콘텐츠의 합법성 판단 및 그에 따른 책임은 해당 콘텐츠를 업로드한 사용자(작성자) 본인에게 있습니다. SafeAI 검사 결과와 무관하게, 불법·유해·성인 콘텐츠 업로드로 인해 발생하는 모든 법적 분쟁, 행정적 제재, 손해배상 책임은 업로드한 사용자가 전적으로 부담합니다.</p>
                    <p><strong>나. 서비스 제공자 면책</strong><br>
                    T2Editor 개발자, 서비스 운영자 및 플랫폼 제공자는 다음 사유로 인한 결과에 대해 어떠한 법적 책임도 부담하지 않습니다.</p>
                    <ul>
                        <li>AI 모델의 오탐 또는 미탐으로 인해 부적절한 콘텐츠가 게시되거나 안전한 콘텐츠가 차단된 경우</li>
                        <li>SafeAI 기능 오류, 네트워크 장애, 모델 로드 실패 등으로 검사가 수행되지 않은 경우</li>
                        <li>제3자 라이브러리(NSFWJS, TensorFlow.js 등)의 결함 또는 버전 변경으로 인한 분류 오류</li>
                        <li>운영자 설정 오류 또는 부적절한 임계값 설정으로 인한 결과</li>
                    </ul>
                    <p><strong>다. 기능의 성격</strong><br>
                    본 SafeAI 기능은 법령상 의무 이행 수단이 아닌, 운영자의 자율적 콘텐츠 정책 보조 도구입니다. 본 기능의 적용이 관련 법령상 의무 이행을 보장하지 않으며, 운영자는 필요한 경우 별도의 법적 검토를 수행할 책임이 있습니다.</p>
                </div>
                <div class="t2-safeai-legal-divider"></div>
                <div class="t2-safeai-legal-section">
                    <div class="t2-safeai-legal-section-title">5. 개인정보 처리</div>
                    <ul>
                        <li><strong>브라우저(클라이언트) 모드:</strong> 이미지 분류는 사용자 기기 내에서만 수행되며, 이미지 데이터는 외부 서버로 전송되지 않습니다.</li>
                        <li><strong>서버 모드:</strong> 분류를 위해 이미지 데이터가 운영자 지정 서버로 전송될 수 있으며, 처리 방식은 해당 서비스 운영자의 개인정보처리방침을 따릅니다.</li>
                    </ul>
                </div>
                <div class="t2-safeai-legal-divider"></div>
                <div class="t2-safeai-legal-section">
                    <div class="t2-safeai-legal-section-title">6. 준거법 및 관할</div>
                    <p>본 고지는 대한민국 법률에 따라 해석되며, 본 기능의 사용과 관련된 분쟁은 관련 법령에서 정한 관할 법원에서 처리됩니다.</p>
                </div>
            </div>
            <div class="t2-safeai-legal-footer">
                <span class="t2-safeai-legal-footer-note">T2Editor SafeAI 안내</span>
                <button class="t2-safeai-legal-confirm-btn" type="button" id="t2-safeai-legal-confirm-btn">확인</button>
            </div>
        `);

        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        const closeNotice = () => {
            overlay.style.transition = 'opacity 0.18s ease';
            modal.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
            overlay.style.opacity = '0';
            modal.style.opacity = '0';
            modal.style.transform = 'translate(-50%, -52%) scale(0.96)';
            setTimeout(() => {
                document.removeEventListener('keydown', escHandler);
                overlay.remove();
                modal.remove();
            }, 190);
        };

        const escHandler = (e) => { if (e.key === 'Escape') closeNotice(); };
        document.addEventListener('keydown', escHandler);
        overlay.addEventListener('click', closeNotice);
        document.getElementById('t2-safeai-legal-close-btn').addEventListener('click', closeNotice);
        document.getElementById('t2-safeai-legal-confirm-btn').addEventListener('click', closeNotice);

        requestAnimationFrame(() => {
            document.getElementById('t2-safeai-legal-confirm-btn')?.focus();
        });
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
                tempDiv.innerHTML = (this.editor && typeof this.editor.sanitizePluginHTML === 'function')
                    ? this.editor.sanitizePluginHTML(htmlData, 'image')
                    : htmlData;
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
        // 비동기 처리 중 selection이 사라질 수 있으므로 진입 시점에 저장
        this._saveEditorRange();
        const imageDataArray = [];
        for (const img of images) {
            const src = this._sanitizeImageSrc(img.getAttribute('src') || img.src);
            if (!src) continue;

            const width = this._toBoundedInt(img.naturalWidth || img.width, 320, 1, 10000);
            const height = this._toBoundedInt(img.naturalHeight || img.height, 180, 1, 10000);
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
            const { allowed, hasWarning, hasError, hasBlocked } = await this.applyNSFWFilter(imageDataArray);
            if (hasError) {
                this.showNSFWErrorModal('일부 이미지의 NSFW 검사 중 오류가 발생했습니다.');
            }
            if (hasBlocked) {
                await this.showNSFWBlockedModal();
                return;
            }
            if (hasWarning) {
                const proceed = await this.showNSFWWarningModal();
                if (!proceed) return;
            }
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
                if (!this._sanitizeImageSrc(dataURL)) {
                    throw new Error('허용되지 않는 이미지 data URL입니다.');
                }
                const arr = dataURL.split(',');
                const mimeMatch = arr[0].match(/:(.*?);/);
                const mime = mimeMatch ? mimeMatch[1].toLowerCase() : '';
                if (!/^image\/(?:png|jpe?g|gif|webp|bmp)$/i.test(mime)) {
                    throw new Error('허용되지 않는 이미지 MIME 타입입니다.');
                }
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

        if (!file || typeof file.name !== 'string') {
            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                T2Utils.showNotification('올바르지 않은 파일입니다.', 'error');
            }
            return false;
        }

        const fileExt = file.name.toLowerCase().split('.').pop();
        const allowedExtensions = this.config.allowedExtensions?.image || [];
        if (!allowedExtensions.includes(fileExt)) {
            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                T2Utils.showNotification('지원하지 않는 이미지 형식입니다.', 'error');
            } else {
                alert('지원하지 않는 이미지 형식입니다.');
            }
            return false;
        }

        // [SEC-MIME] 확장자 allowlist 와 브라우저 MIME이 모두 이미지 계열인지 확인.
        // 일부 브라우저/OS에서 file.type 이 비어 있을 수 있으므로 빈 값은 서버 검증에 위임한다.
        const allowedMimeByExt = {
            jpg: ['image/jpeg'],
            jpeg: ['image/jpeg'],
            png: ['image/png'],
            gif: ['image/gif'],
            webp: ['image/webp'],
            bmp: ['image/bmp', 'image/x-ms-bmp']
        };
        const fileType = String(file.type || '').toLowerCase();
        if (fileType && !(allowedMimeByExt[fileExt] || []).includes(fileType)) {
            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                T2Utils.showNotification('파일 확장자와 MIME 타입이 일치하지 않습니다.', 'error');
            } else {
                alert('파일 확장자와 MIME 타입이 일치하지 않습니다.');
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
                const base64Url = this._sanitizeImageSrc(e.target.result);
                if (!base64Url) {
                    reject(new Error('허용되지 않는 이미지 데이터입니다.'));
                    return;
                }
                const img = new Image();
                img.onload = () => {
                    const blockId = this.generateBlockId();
                    resolve({
                        url: base64Url,
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                        blockId: blockId,
                        isUploading: true,
                        file: file,
                        nsfwResult: null
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
        // 비동기 처리(NSFW 검사 등) 중 selection을 잃을 수 있으므로 진입 시점에 저장
        this._saveEditorRange();
        try {
            const imageDataArray = await Promise.all(files.map(file => this.processImageFile(file)));
            const validImages = imageDataArray.filter(data => data !== null);
            if (validImages.length === 0) return;
            const { allowed, hasWarning, hasError, hasBlocked } = await this.applyNSFWFilter(validImages);
            if (hasError) {
                this.showNSFWErrorModal('일부 이미지의 검사 중 오류가 발생했습니다.');
            }
            if (hasBlocked) {
                await this.showNSFWBlockedModal();
                return;
            }
            if (hasWarning) {
                const proceed = await this.showNSFWWarningModal();
                if (!proceed) return;
            }
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

            // [FIX] NonRetryableError(서버 논리 거부·4xx)는 재시도해도 동일하게 실패한다.
            // 네트워크 오류·5xx 같은 일시적 장애만 재시도 대상으로 한정한다.
            const isRetryable = !(error instanceof NonRetryableError);

            if (isRetryable && uploadTask.retryCount < this.maxRetries) {
                uploadTask.retryCount++;

                // [FIX] 지수 백오프(1s → 2s → 4s): 딜레이 없이 즉시 재시도하면
                // 파일 N개 × maxRetries 횟수만큼 알림이 동시에 쏟아진다.
                const delayMs = 1000 * Math.pow(2, uploadTask.retryCount - 1);

                // [FIX] 알림은 첫 번째 재시도 시 1회만 표시한다.
                // 파일마다, 재시도마다 표시하면 겹쳐 뜨는 문제가 발생한다.
                if (uploadTask.retryCount === 1) {
                    if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                        T2Utils.showNotification('업로드 재시도 중...', 'info');
                    }
                }

                setTimeout(() => {
                    this.uploadQueue.unshift(uploadTask);
                    this.processUploadQueue();
                }, delayMs);
            } else {
                const errMsg = error && error.message ? error.message : '이미지 업로드에 실패했습니다.';
                if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                    T2Utils.showNotification(errMsg, 'error');
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

        // [FIX] generateUid() 가 UUID·hex 등 비숫자 문자를 포함하면
        // PHP 의 preg_replace('/[^0-9]/', '', ...) 이후 strlen > 20 또는
        // 빈 문자열이 되어 "잘못된 접근입니다." 를 반환하고 무한 재시도에 빠진다.
        // Date.now() 는 항상 13자리 숫자이므로 안전하다.
        formData.append('uid', String(Date.now()));

        const response = await fetch(`${t2editor_url}/plugin/image/image_upload.php`, {
            method: 'POST',
            body: formData
        });

        // HTTP 레벨 오류(4xx, 5xx) 먼저 확인
        // 4xx 는 재시도해도 동일하게 실패하므로 NonRetryableError 로 처리한다.
        if (!response.ok) {
            const isClientError = response.status >= 400 && response.status < 500;
            const ErrClass = isClientError ? NonRetryableError : Error;
            throw new ErrClass(`서버 오류 (HTTP ${response.status})`);
        }

        // [SEC] response.json() 대신 text() → trim() → JSON.parse() 를 사용해
        // PHP warning·BOM 등 JSON 앞 불필요한 출력으로 인한 파싱 실패를 방지한다.
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text.trim());
        } catch (e) {
            // 응답이 JSON이 아닌 경우 (PHP 오류 메시지 등) 콘솔에 원문 기록
            console.error('[T2Image] 업로드 응답 파싱 실패. 서버 응답 원문:', text.substring(0, 500));
            throw new Error('서버 응답을 처리할 수 없습니다. 콘솔을 확인해주세요.');
        }

        if (data.success && data.files && data.files.length > 0) {
            this.updateImageBlock(blockId, data.files[0]);
        } else {
            // [FIX] 서버가 success:false 를 반환한 것은 논리적 거부이므로
            // 재시도해도 같은 결과가 나온다 → NonRetryableError 로 즉시 최종 실패 처리.
            throw new NonRetryableError(data.message || '업로드 실패');
        }
    }

    updateImageBlock(blockId, fileData) {
        const block = this._findBlockById(blockId);
        if (!block) return;
        const safeUrl = this._sanitizeImageSrc(fileData && fileData.url);
        if (!safeUrl) {
            this.markUploadFailed(blockId);
            return;
        }
        const img = block.querySelector('img');
        if (img) {
            img.src = safeUrl;
            img.dataset.width = this._toBoundedInt(fileData.width, 320, 1, 10000);
            img.dataset.height = this._toBoundedInt(fileData.height, 180, 1, 10000);
        }
        block.removeAttribute('data-uploading');
        const uploadIndicator = block.querySelector('.t2-upload-indicator');
        if (uploadIndicator) uploadIndicator.remove();
    }

    markUploadFailed(blockId) {
        const block = this._findBlockById(blockId);
        if (!block) return;
        block.setAttribute('data-upload-failed', 'true');
        const uploadIndicator = block.querySelector('.t2-upload-indicator');
        if (uploadIndicator) {
            uploadIndicator.replaceChildren();
            const icon = document.createElement('span');
            icon.className = 'material-icons';
            icon.style.color = '#f44336';
            icon.textContent = 'error';
            uploadIndicator.appendChild(icon);
        }
    }

    insertImageBlocks(files) {
        // ── 삽입 위치 결정: 4단계 fallback ──────────────────────────────────
        const range = this._resolveEditorRange();
        if (!range) {
            console.warn('[T2Image] 삽입 위치를 결정할 수 없어 이미지 삽입을 건너뜁니다.');
            return;
        }

        const editorEl = this.editor.editor;
        const selection = window.getSelection();

        // selection을 결정된 range로 강제 복원
        try {
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
            }
        } catch (_) { /* 무시 */ }

        const currentBlock = this.editor.getClosestBlock(range.startContainer);

        // currentBlock이 null이거나 에디터 자신인 경우 → 에디터 끝 fallback
        const insertAfter = (currentBlock && currentBlock !== editorEl)
            ? currentBlock
            : (() => {
                const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE'];
                const children = Array.from(editorEl.childNodes);
                for (let i = children.length - 1; i >= 0; i--) {
                    const n = children[i];
                    if (n.nodeType === Node.ELEMENT_NODE && blockTags.includes(n.nodeName)) {
                        return n;
                    }
                }
                // 블록이 없으면 빈 p 생성
                const p = document.createElement('p');
                p.innerHTML = '<br>';
                editorEl.appendChild(p);
                return p;
            })();

        const topBreak = document.createElement('p');
        if (this.editor.isIOS || this.editor.isSafari) topBreak.innerHTML = '<br>';
        else topBreak.innerHTML = '\u200B<br>';
        insertAfter.parentNode.insertBefore(topBreak, insertAfter.nextSibling);
        let lastElement = topBreak;
        const insertedBlocks = [];
        files.forEach((file, index) => {
            const mediaBlock = this.createImageBlock(file);
            if (!mediaBlock) return;
            lastElement.parentNode.insertBefore(mediaBlock, lastElement.nextSibling);
            insertedBlocks.push(mediaBlock);
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
        insertedBlocks.forEach(block => this.cleanupEmptyLines(block));
        const newRange = document.createRange();
        newRange.setStartAfter(bottomBreak);
        newRange.collapse(true);
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(newRange);
        }
        // 삽입 완료 후 저장된 range 초기화
        this._savedEditorRange = null;
        this.editor.createUndoPoint();
        this.editor.autoSave();
    }

    createImageBlock(file) {
        const safeUrl = this._sanitizeImageSrc(file && file.url);
        if (!safeUrl) {
            console.warn('[T2Image][SEC] 이미지 URL이 보안 경계를 통과하지 못해 블록 생성을 건너뜁니다.');
            return null;
        }

        const mediaBlock = document.createElement('div');
        mediaBlock.className = 't2-media-block t2-image-block';
        mediaBlock.contentEditable = false;
        mediaBlock.style.position = 'relative';
        // 이미지 블록은 inline whitespace/baseline line box가 상하 여백으로 보이지 않도록
        // 블록 자체의 텍스트 라인 박스를 제거한다. 버튼/인디케이터는 CSS에서 복원한다.
        mediaBlock.style.lineHeight = '0';
        mediaBlock.style.fontSize = '0';

        const blockId = this._sanitizeBlockId(file.blockId || this.generateBlockId());
        const width = this._toBoundedInt(file.width, 320, 1, 10000);
        const height = this._toBoundedInt(file.height, 180, 1, 10000);

        mediaBlock.setAttribute('data-block-id', blockId);
        if (file.isUploading) mediaBlock.setAttribute('data-uploading', 'true');

        const uploadIndicatorHtml = file.isUploading ? `
            <div class="t2-upload-indicator"
                 style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.7);color:white;padding:5px 10px;border-radius:4px;font-size:12px;display:flex;align-items:center;gap:5px;">
                <span class="material-icons" style="font-size:14px;animation:spin 1s linear infinite;">sync</span>
                <span>업로드 중...</span>
            </div>
        ` : '';

        this._setPluginHTML(
            mediaBlock,
            `<div class="t2-image-container" style="width:${width}px;max-width:100%;margin:0 auto;position:relative;display:block;line-height:0;font-size:0;"><img src="${this._escapeAttr(safeUrl)}" alt="" style="width:100%;height:auto;display:block;vertical-align:top;">${uploadIndicatorHtml}</div>`,
            'image:createImageBlock'
        );

        const container = mediaBlock.querySelector('div:first-child');
        const img = container ? container.querySelector('img') : null;
        if (!container || !img) return null;

        // sanitizePluginHTML() 의 image 프로필은 data-* 를 최소 허용하므로,
        // 숫자 검증이 끝난 치수 메타데이터만 DOM API 로 재부여한다.
        container.dataset.originalWidth = width;
        container.dataset.originalHeight = height;
        img.dataset.width = width;
        img.dataset.height = height;

        if (file.isUploading && !document.querySelector('style[data-t2-spin]')) {
            const style = document.createElement('style');
            style.setAttribute('data-t2-spin', 'true');
            style.textContent = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
            document.head.appendChild(style);
        }

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
        const width = this._toBoundedInt(mediaElement.dataset.width || container.style.width, 320, 1, 10000);
        const height = this._toBoundedInt(mediaElement.dataset.height || container.style.height, 180, 1, 10000);
        const editorWidth = this._toBoundedInt(this.editor.editor.clientWidth, width, 1, 10000);
        const maxWidthPercentage = Math.max(30, Math.min(100, Math.floor((editorWidth / width) * 100)));
        const currentWidth = this._toBoundedInt(container.style.width, width, 1, 10000);
        const percentage = Math.max(30, Math.min(maxWidthPercentage,
            this._toBoundedInt(container.dataset.sliderPercentage || Math.round((currentWidth / width) * 100), maxWidthPercentage, 30, 100)
        ));

        const deleteBtnEl = document.createElement('button');
        deleteBtnEl.className = 't2-btn delete-btn';
        deleteBtnEl.type = 'button';

        const deleteIcon = document.createElement('span');
        deleteIcon.className = 'material-icons';
        deleteIcon.textContent = 'delete';
        deleteBtnEl.appendChild(deleteIcon);

        const sizeSlider = document.createElement('input');
        sizeSlider.type = 'range';
        sizeSlider.min = '30';
        sizeSlider.max = String(maxWidthPercentage);
        sizeSlider.value = String(percentage);
        sizeSlider.className = 'size-slider';
        sizeSlider.style.width = '100px';

        controls.append(deleteBtnEl, sizeSlider);
        if (sizeSlider) {
            const syncSliderFromContainer = () => {
                const currentPercentage = parseInt(container.dataset.sliderPercentage || sizeSlider.value, 10);
                if (!Number.isNaN(currentPercentage) && parseInt(sizeSlider.value, 10) !== currentPercentage) {
                    sizeSlider.value = currentPercentage;
                }
            };

            const resizeObserver = new ResizeObserver(() => {
                const newEditorWidth = this.editor.editor.clientWidth;
                const newMaxPercentage = Math.min(100, Math.floor((newEditorWidth / width) * 100));
                sizeSlider.max = newMaxPercentage;
                if (parseInt(sizeSlider.value, 10) > newMaxPercentage) {
                    sizeSlider.value = newMaxPercentage;
                    const newWidth = Math.round((width * newMaxPercentage) / 100);
                    container.style.width = `${newWidth}px`;
                    container.style.maxWidth = '100%';
                    mediaElement.style.width = '100%';
                    container.dataset.sliderPercentage = newMaxPercentage;
                }
                syncSliderFromContainer();
            });
            resizeObserver.observe(this.editor.editor);

            const mutationObserver = new MutationObserver(syncSliderFromContainer);
            mutationObserver.observe(container, {
                attributes: true,
                attributeFilter: ['data-slider-percentage', 'style']
            });

            controls._cleanupObservers = () => {
                resizeObserver.disconnect();
                mutationObserver.disconnect();
            };

            let isSliding = false;
            let slideTimer = null;
            sizeSlider.addEventListener('mousedown', () => { isSliding = true; });
            sizeSlider.addEventListener('mouseup', () => {
                isSliding = false;
                if (this.editor.getPlugin('collab')) this.editor.getPlugin('collab')._debounceUpdate();
            });
            sizeSlider.addEventListener('input', (e) => {
                const percentage = parseInt(e.target.value, 10);
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
        }
        const deleteBtn = controls.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const mediaBlock = controls.closest('.t2-media-block');
                if (controls._cleanupObservers) controls._cleanupObservers();
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

        const createButton = (direction, iconName) => {
            const btn = document.createElement('button');
            btn.className = 't2-btn t2-move-btn';
            btn.type = 'button';
            btn.dataset.direction = direction;
            btn.style.cssText =
                'padding:6px 12px;border:none;border-radius:0;background:transparent;color:white;transition:all 0.2s;cursor:pointer;';
            if (direction === 'up') {
                btn.style.borderRight = '2px solid rgba(255,255,255,0.3)';
            }

            const icon = document.createElement('span');
            icon.className = 'material-icons';
            icon.style.fontSize = '20px';
            icon.textContent = iconName;
            btn.appendChild(icon);

            return btn;
        };

        const upBtn = createButton('up', 'arrow_upward');
        const downBtn = createButton('down', 'arrow_downward');
        moveWrapper.append(upBtn, downBtn);

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

    _isEmptyEditorParagraph(node) {
        if (!node || node.tagName !== 'P') return false;
        if (node.querySelector('img, iframe, video, audio, table, pre, code, .t2-media-block, .t2-table-wrapper')) return false;
        const text = (node.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim();
        if (text) return false;
        const html = (node.innerHTML || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim().toLowerCase();
        return !html || html === '<br>' || html === '<br/>' || html === '<br />' || /^(&nbsp;|\s|<br\s*\/?>)*$/i.test(html);
    }

    cleanupEmptyLines(imageBlock) {
        // core.js 공통 정책이 있으면 비디오 블록과 동일하게
        // 블록 위/아래에 ZWSP 기반 커서 착지 문단을 강제한다.
        if (this.editor && typeof this.editor.ensureBlockBoundaryLines === 'function') {
            this.editor.ensureBlockBoundaryLines(imageBlock);
            return;
        }

        const normalizeBoundary = (p, includeBreak) => {
            if (!p) return;
            if (this.editor && (this.editor.isIOS || this.editor.isSafari)) {
                p.innerHTML = '<br>';
                return;
            }
            p.replaceChildren(document.createTextNode('\u200B'));
            if (includeBreak) p.appendChild(document.createElement('br'));
        };

        let prev = imageBlock.previousElementSibling;
        if (!this._isEmptyEditorParagraph(prev)) {
            prev = document.createElement('p');
            prev.appendChild(document.createTextNode('\u200B'));
            prev.appendChild(document.createElement('br'));
            imageBlock.parentNode.insertBefore(prev, imageBlock);
        } else {
            normalizeBoundary(prev, true);
        }

        let next = imageBlock.nextElementSibling;
        if (!this._isEmptyEditorParagraph(next)) {
            next = document.createElement('p');
            next.textContent = '\u200B';
            imageBlock.parentNode.insertBefore(next, imageBlock.nextSibling);
        } else {
            normalizeBoundary(next, false);
        }

        let extraPrev = prev ? prev.previousElementSibling : null;
        while (this._isEmptyEditorParagraph(extraPrev)) {
            const current = extraPrev;
            extraPrev = extraPrev.previousElementSibling;
            current.remove();
        }

        let extraNext = next ? next.nextElementSibling : null;
        while (this._isEmptyEditorParagraph(extraNext)) {
            const current = extraNext;
            extraNext = extraNext.nextElementSibling;
            current.remove();
        }
    }

    initializeImageBlocks() {
        console.log('Initializing image blocks...');
        this.editor.editor.querySelectorAll('img:not(.t2-media-block img)').forEach(img => {
            const width = parseInt(img.style.width) || img.naturalWidth || 320;
            const height = parseInt(img.style.height) || img.naturalHeight || 180;
            const mediaBlock = this.createImageBlock({
                url: img.getAttribute('src') || img.src,
                width: width,
                height: height
            });
            if (!mediaBlock) {
                img.remove();
                return;
            }
            img.parentNode.replaceChild(mediaBlock, img);
            this.cleanupEmptyLines(mediaBlock);
        });
        this.editor.editor.querySelectorAll('.t2-media-block').forEach(block => {
            if (block.querySelector('iframe, video')) return;
            const container = block.querySelector('div:first-child');
            const mediaElement = container?.querySelector('img');
            if (mediaElement) {
                block.contentEditable = false;
                block.classList.add('t2-image-block');
                block.style.position = 'relative';
                block.style.lineHeight = '0';
                block.style.fontSize = '0';
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

    // ── [플러그인 간 연동 API] ───────────────────────────────────────────────
    // 파일 플러그인 등 외부에서 단일 이미지 파일을 업로드할 때 사용하는 공개 API.
    // handleMultipleImageInsert()를 래핑하여 NSFW 검사·인라인 미리보기·
    // 큐 업로드 등 이미지 플러그인의 전체 업로드 흐름을 그대로 활용한다.
    // 따라서 파일 플러그인에서 이미지를 선택했을 때도 동일한 보안·UX가 적용된다.
    async uploadImageFile(file) {
        await this.handleMultipleImageInsert([file]);
    }

    // ── [이미지 편집 모달] 인스타/틱톡 스타일 사진 편집기 ──────────────────
    //
    // [REFACTOR] 다음 문제들을 해결한다:
    //   1) 필터/조정값이 실시간으로 안 보이는 문제 → 캔버스 엘리먼트에 CSS
    //      filter 를 직접 적용해 미리보기. 내보내기 시점에만 픽셀 베이크.
    //      (ctx.filter 는 iOS Safari 등 일부 환경에서 정상 동작하지 않는다.)
    //   2) 자르기를 드래그·줌으로 자유 편집 가능하게.
    //      · 모바일: 한 손가락 드래그 = 이동, 두 손가락 핀치 = 줌
    //      · 데스크톱: 드래그 = 이동, 마우스 휠 = 줌
    //      · 비율 자르기(1:1, 4:3 등): 항상 이미지의 실제 가로/세로에 맞춰
    //        최대 크기로 정확히 fit 되도록 계산.
    //   3) 보안 시스템 정합성:
    //      · 원본 확장자(jpg/png/webp)를 유지해 매직바이트 검사 충족
    //      · 원본 파일명을 보존(접미사만 추가)
    //      · canvas.toBlob() 사용으로 메모리 효율·iOS 호환성 향상
    //      · 결과 dataURL 은 기존과 동일하게 _sanitizeImageSrc 보안 경계 통과
    showImageEditorModal(entry) {
        return new Promise((resolve) => {
            const { previewItem, imageData } = entry;
            const previewImg = previewItem ? previewItem.querySelector('img') : null;

            // ── 필터 정의 ─────────────────────────────────────────────────
            const FILTERS = [
                { id: 'normal',   label: '원본',    css: '' },
                { id: 'vivid',    label: '선명',    css: 'saturate(1.5) contrast(1.1)' },
                { id: 'warm',     label: '따뜻',    css: 'sepia(0.25) saturate(1.3) brightness(1.05)' },
                { id: 'cool',     label: '쿨톤',    css: 'hue-rotate(15deg) saturate(0.85) brightness(1.05)' },
                { id: 'fade',     label: '페이드',  css: 'brightness(1.15) contrast(0.82) saturate(0.82)' },
                { id: 'mono',     label: '흑백',    css: 'grayscale(1)' },
                { id: 'noir',     label: '누아르',  css: 'grayscale(1) contrast(1.35) brightness(0.88)' },
                { id: 'vintage',  label: '빈티지',  css: 'sepia(0.42) contrast(0.88) brightness(1.08) saturate(1.1)' },
                { id: 'rose',     label: '로즈',    css: 'sepia(0.28) hue-rotate(-12deg) saturate(1.25)' },
                { id: 'cinema',   label: '시네마',  css: 'contrast(1.22) brightness(0.95) saturate(0.75)' },
                { id: 'summer',   label: '썸머',    css: 'brightness(1.08) saturate(1.4) hue-rotate(-5deg)' },
                { id: 'dream',    label: '드림',    css: 'brightness(1.12) contrast(0.90) saturate(1.35)' },
            ];

            // ── 상태 ──────────────────────────────────────────────────────
            let currentFilter = 'normal';
            let brightness  = 100;  // 50–150
            let contrast    = 100;  // 50–150
            let saturation  = 100;  // 0–200
            let warmth      = 0;    // -50 ~ +50
            let fade        = 0;    // 0–100
            let vignette    = 0;    // 0–100
            let rotation    = 0;    // 0, 90, 180, 270
            let flipH       = false;
            let activeTab   = 'filter';
            let cropAspect  = 'free';
            let origW = 0, origH = 0;

            // ── 크롭 박스 상태 (이미지 원본 좌표계 기준, 픽셀) ──────────────
            //   cropBox = { x, y, w, h }  — 회전 적용 후 좌표계
            //   사용자가 드래그/줌으로 자유 조절. 비율 버튼 누르면 비율 유지하며 재조정.
            let cropBox = null;

            const origImg = new Image();
            origImg.crossOrigin = 'anonymous';
            origImg.src = imageData.url;

            // ── 스타일 주입 (최초 1회) ────────────────────────────────────
            if (!document.getElementById('t2-img-editor-styles')) {
                const style = document.createElement('style');
                style.id = 't2-img-editor-styles';
                style.textContent = `
                    @keyframes t2EditorSlideUp {
                        from { transform: translateY(100%); opacity: 0; }
                        to   { transform: translateY(0);    opacity: 1; }
                    }
                    @keyframes t2EditorFadeIn {
                        from { opacity: 0; }
                        to   { opacity: 1; }
                    }
                    @keyframes t2EdAdjPulse {
                        0%,100% { transform: scale(1); }
                        50%     { transform: scale(1.12); }
                    }
                    .t2-img-editor-overlay {
                        position: fixed; inset: 0;
                        background: #000;
                        z-index: 1000000;
                        display: flex; flex-direction: column;
                        animation: t2EditorFadeIn 0.22s ease forwards;
                        touch-action: none;
                    }
                    /* ── 헤더 ── */
                    .t2-img-editor-header {
                        display: flex; align-items: center; justify-content: space-between;
                        padding: 0 16px;
                        height: 54px;
                        flex-shrink: 0;
                        border-bottom: 1px solid rgba(255,255,255,0.07);
                        background: #0d0d0d;
                    }
                    .t2-img-ed-cancel, .t2-img-ed-confirm {
                        background: none; border: none; cursor: pointer;
                        font-family: inherit; font-size: 14px; font-weight: 600;
                        padding: 8px 4px;
                        transition: opacity 0.15s, transform 0.15s;
                        letter-spacing: -0.2px;
                    }
                    .t2-img-ed-cancel { color: rgba(255,255,255,0.55); }
                    .t2-img-ed-cancel:hover { opacity: 0.75; }
                    .t2-img-ed-confirm {
                        color: #0A84FF;
                        padding: 7px 14px;
                        background: rgba(10,132,255,0.15);
                        border-radius: 20px;
                        border: 1px solid rgba(10,132,255,0.3);
                    }
                    .t2-img-ed-confirm:hover { background: rgba(10,132,255,0.28); }
                    .t2-img-ed-confirm:active { transform: scale(0.95); }
                    .t2-img-ed-title {
                        font-size: 15px; font-weight: 700;
                        color: #fff; letter-spacing: -0.3px;
                    }
                    /* ── 캔버스 영역 ── */
                    .t2-img-editor-canvas-wrap {
                        flex: 1; min-height: 0;
                        display: flex; align-items: center; justify-content: center;
                        background: #000; position: relative; overflow: hidden;
                    }
                    .t2-img-editor-canvas {
                        max-width: 100%; max-height: 100%;
                        display: block; object-fit: contain;
                        transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1);
                    }
                    .t2-img-editor-vignette {
                        position: absolute; inset: 0; pointer-events: none;
                        background: radial-gradient(ellipse at center,
                            transparent 40%, rgba(0,0,0,0.85) 100%);
                        opacity: 0; transition: opacity 0.2s;
                    }
                    .t2-img-ed-crop-overlay {
                        position: absolute;
                        pointer-events: auto;   /* 드래그 인터랙션 허용 */
                        border: 2px solid rgba(255,255,255,0.95);
                        box-shadow: 0 0 0 9999px rgba(0,0,0,0.55);
                        cursor: move;
                        touch-action: none;
                        box-sizing: border-box;
                    }
                    .t2-img-ed-crop-overlay::before,
                    .t2-img-ed-crop-overlay::after {
                        content: ''; position: absolute; pointer-events: none;
                        border-color: rgba(255,255,255,0.4);
                    }
                    /* 그리드: 3분할선 */
                    .t2-img-ed-crop-overlay::before {
                        top: 33.33%; bottom: 33.33%; left: 0; right: 0;
                        border-top: 1px solid rgba(255,255,255,0.35);
                        border-bottom: 1px solid rgba(255,255,255,0.35);
                    }
                    .t2-img-ed-crop-overlay::after {
                        left: 33.33%; right: 33.33%; top: 0; bottom: 0;
                        border-left: 1px solid rgba(255,255,255,0.35);
                        border-right: 1px solid rgba(255,255,255,0.35);
                    }
                    /* 모서리 핸들 (자유 자르기 모드에서만 표시) */
                    .t2-img-ed-crop-handle {
                        position: absolute; width: 22px; height: 22px;
                        background: transparent;
                        z-index: 2;
                        touch-action: none;
                    }
                    .t2-img-ed-crop-handle::after {
                        content: ''; position: absolute;
                        width: 14px; height: 14px;
                        background: #fff;
                        border-radius: 50%;
                        box-shadow: 0 0 0 2px rgba(0,0,0,0.35);
                        top: 50%; left: 50%; transform: translate(-50%,-50%);
                    }
                    .t2-img-ed-crop-handle.tl { top: -11px; left: -11px; cursor: nwse-resize; }
                    .t2-img-ed-crop-handle.tr { top: -11px; right: -11px; cursor: nesw-resize; }
                    .t2-img-ed-crop-handle.bl { bottom: -11px; left: -11px; cursor: nesw-resize; }
                    .t2-img-ed-crop-handle.br { bottom: -11px; right: -11px; cursor: nwse-resize; }
                    /* ── 탭바 ── */
                    .t2-img-editor-tabs {
                        display: flex; flex-shrink: 0;
                        background: #0d0d0d;
                        border-top: 1px solid rgba(255,255,255,0.07);
                    }
                    .t2-img-ed-tab {
                        flex: 1; display: flex; flex-direction: column;
                        align-items: center; justify-content: center;
                        gap: 3px; padding: 10px 0;
                        background: none; border: none; cursor: pointer;
                        color: rgba(255,255,255,0.40); font-family: inherit;
                        font-size: 10.5px; font-weight: 600;
                        letter-spacing: 0.2px; text-transform: uppercase;
                        transition: color 0.18s, background 0.18s;
                        position: relative;
                    }
                    .t2-img-ed-tab .material-icons { font-size: 20px; }
                    .t2-img-ed-tab.active {
                        color: #fff;
                        background: rgba(255,255,255,0.05);
                    }
                    .t2-img-ed-tab.active::after {
                        content: ''; position: absolute; top: 0; left: 20%; right: 20%;
                        height: 2px; background: #0A84FF; border-radius: 0 0 3px 3px;
                    }
                    /* ── 패널 공통 ── */
                    .t2-img-editor-panels {
                        flex-shrink: 0;
                        background: #0d0d0d;
                        border-top: 1px solid rgba(255,255,255,0.06);
                    }
                    .t2-img-ed-panel { display: none; }
                    .t2-img-ed-panel.active { display: block; }
                    /* ── 필터 패널 ── */
                    .t2-img-ed-filter-strip {
                        display: flex; gap: 12px;
                        overflow-x: auto; overflow-y: hidden;
                        padding: 14px 16px;
                        scrollbar-width: none;
                        -webkit-overflow-scrolling: touch;
                    }
                    .t2-img-ed-filter-strip::-webkit-scrollbar { display: none; }
                    .t2-img-ed-filter-item {
                        flex-shrink: 0; display: flex; flex-direction: column;
                        align-items: center; gap: 7px;
                        cursor: pointer; padding: 0;
                        -webkit-tap-highlight-color: transparent;
                    }
                    .t2-img-ed-filter-item canvas {
                        width: 68px; height: 68px; border-radius: 12px;
                        border: 2.5px solid transparent;
                        transition: border-color 0.18s, transform 0.18s, box-shadow 0.18s;
                        display: block;
                    }
                    .t2-img-ed-filter-item:hover canvas {
                        transform: scale(1.05);
                        box-shadow: 0 4px 14px rgba(0,0,0,0.5);
                    }
                    .t2-img-ed-filter-item.active canvas {
                        border-color: #0A84FF;
                        box-shadow: 0 0 0 3px rgba(10,132,255,0.3);
                    }
                    .t2-img-ed-filter-label {
                        font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.5);
                        letter-spacing: 0.1px; font-family: inherit;
                        transition: color 0.18s;
                    }
                    .t2-img-ed-filter-item.active .t2-img-ed-filter-label { color: #0A84FF; }
                    /* ── 조정 패널 ── */
                    .t2-img-ed-adjust-panel {
                        padding: 10px 0 8px;
                        max-height: 260px; overflow-y: auto;
                        scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent;
                    }
                    .t2-img-ed-adjust-panel::-webkit-scrollbar { width: 4px; }
                    .t2-img-ed-adjust-panel::-webkit-scrollbar-thumb {
                        background: rgba(255,255,255,0.15); border-radius: 2px;
                    }
                    .t2-img-ed-adjust-row {
                        display: flex; align-items: center; gap: 10px;
                        padding: 9px 18px;
                        transition: background 0.15s;
                    }
                    .t2-img-ed-adjust-row:hover { background: rgba(255,255,255,0.04); }
                    .t2-img-ed-adj-icon {
                        font-size: 18px !important; color: rgba(255,255,255,0.45);
                        flex-shrink: 0; width: 20px;
                    }
                    .t2-img-ed-adj-label {
                        font-size: 12px; font-weight: 600;
                        color: rgba(255,255,255,0.65); width: 44px; flex-shrink: 0;
                        letter-spacing: -0.1px;
                    }
                    .t2-img-ed-adj-slider-wrap { flex: 1; min-width: 0; }
                    .t2-img-ed-adj-slider {
                        width: 100%; height: 3px; appearance: none; -webkit-appearance: none;
                        background: rgba(255,255,255,0.2); border-radius: 2px;
                        outline: none; cursor: pointer;
                    }
                    .t2-img-ed-adj-slider::-webkit-slider-thumb {
                        -webkit-appearance: none; appearance: none;
                        width: 20px; height: 20px; border-radius: 50%;
                        background: #fff;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.5);
                        cursor: pointer; transition: transform 0.15s;
                    }
                    .t2-img-ed-adj-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
                    .t2-img-ed-adj-slider::-moz-range-thumb {
                        width: 20px; height: 20px; border-radius: 50%; border: none;
                        background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.5); cursor: pointer;
                    }
                    .t2-img-ed-adj-value {
                        font-size: 11.5px; font-weight: 700; color: rgba(255,255,255,0.4);
                        width: 32px; text-align: right; flex-shrink: 0;
                        font-variant-numeric: tabular-nums; letter-spacing: -0.2px;
                        transition: color 0.15s;
                    }
                    .t2-img-ed-adj-value.changed { color: #0A84FF; }
                    /* ── 자르기 패널 ── */
                    .t2-img-ed-crop-panel { padding: 14px 18px 16px; }
                    .t2-img-ed-crop-row {
                        display: flex; align-items: center; justify-content: center;
                        gap: 6px; margin-bottom: 14px;
                    }
                    .t2-img-ed-crop-tool-btn {
                        display: flex; flex-direction: column; align-items: center;
                        gap: 4px; padding: 10px 20px;
                        background: rgba(255,255,255,0.08);
                        border: 1px solid rgba(255,255,255,0.12);
                        border-radius: 12px; cursor: pointer; color: #fff;
                        font-family: inherit; font-size: 11px; font-weight: 600;
                        letter-spacing: 0.1px;
                        transition: background 0.15s, transform 0.15s;
                        -webkit-tap-highlight-color: transparent;
                    }
                    .t2-img-ed-crop-tool-btn .material-icons { font-size: 20px; }
                    .t2-img-ed-crop-tool-btn:hover { background: rgba(255,255,255,0.15); }
                    .t2-img-ed-crop-tool-btn:active { transform: scale(0.94); }
                    .t2-img-ed-crop-tool-btn.active { 
                        color: #0A84FF; background: rgba(10,132,255,0.15);
                        border-color: rgba(10,132,255,0.4);
                    }
                    .t2-img-ed-aspect-row {
                        display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
                    }
                    .t2-img-ed-aspect-btn {
                        padding: 6px 16px;
                        background: rgba(255,255,255,0.08);
                        border: 1px solid rgba(255,255,255,0.12);
                        border-radius: 20px; cursor: pointer;
                        color: rgba(255,255,255,0.55);
                        font-family: inherit; font-size: 12px; font-weight: 700;
                        letter-spacing: 0.2px;
                        transition: all 0.15s;
                        -webkit-tap-highlight-color: transparent;
                    }
                    .t2-img-ed-aspect-btn:hover { background: rgba(255,255,255,0.15); color: #fff; }
                    .t2-img-ed-aspect-btn.active {
                        background: rgba(10,132,255,0.2);
                        border-color: rgba(10,132,255,0.5);
                        color: #0A84FF;
                    }
                    /* ── 편집 완료 스핀 ── */
                    .t2-img-ed-saving {
                        position: absolute; inset: 0;
                        background: rgba(0,0,0,0.7); display: flex;
                        align-items: center; justify-content: center;
                        flex-direction: column; gap: 12px;
                        z-index: 10; color: #fff; font-size: 14px; font-weight: 600;
                    }
                    .t2-img-ed-saving .material-icons {
                        font-size: 36px; animation: t2EditorFadeIn 0.15s;
                        color: #0A84FF;
                    }
                `;
                document.head.appendChild(style);
            }

            // ── DOM 생성 ──────────────────────────────────────────────────
            const overlay = document.createElement('div');
            overlay.className = 't2-img-editor-overlay';

            const header = document.createElement('div');
            header.className = 't2-img-editor-header';
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 't2-img-ed-cancel';
            cancelBtn.textContent = '취소';
            const titleEl = document.createElement('span');
            titleEl.className = 't2-img-ed-title';
            titleEl.textContent = '편집';
            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.className = 't2-img-ed-confirm';
            confirmBtn.textContent = '완료';
            header.append(cancelBtn, titleEl, confirmBtn);

            const canvasWrap = document.createElement('div');
            canvasWrap.className = 't2-img-editor-canvas-wrap';
            const mainCanvas = document.createElement('canvas');
            mainCanvas.className = 't2-img-editor-canvas';
            const vignetteEl = document.createElement('div');
            vignetteEl.className = 't2-img-editor-vignette';
            const cropOverlay = document.createElement('div');
            cropOverlay.className = 't2-img-ed-crop-overlay';
            cropOverlay.style.display = 'none';
            // 자유 자르기용 모서리 핸들 4개 (free 모드에서만 표시)
            ['tl','tr','bl','br'].forEach(pos => {
                const h = document.createElement('div');
                h.className = `t2-img-ed-crop-handle ${pos}`;
                h.dataset.handle = pos;
                cropOverlay.appendChild(h);
            });
            canvasWrap.append(mainCanvas, vignetteEl, cropOverlay);

            const tabBar = document.createElement('div');
            tabBar.className = 't2-img-editor-tabs';
            const TABS = [
                { id: 'filter', icon: 'auto_awesome', label: '필터' },
                { id: 'adjust', icon: 'tune',          label: '조정' },
                { id: 'crop',   icon: 'crop',          label: '자르기' },
            ];
            TABS.forEach(t => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 't2-img-ed-tab' + (t.id === 'filter' ? ' active' : '');
                btn.dataset.tab = t.id;
                const icon = document.createElement('span');
                icon.className = 'material-icons';
                icon.textContent = t.icon;
                const lbl = document.createElement('span');
                lbl.textContent = t.label;
                btn.append(icon, lbl);
                tabBar.appendChild(btn);
            });

            const panelsWrap = document.createElement('div');
            panelsWrap.className = 't2-img-editor-panels';

            // ── 필터 패널 ─────────────────────────────────────────────────
            const filterPanel = document.createElement('div');
            filterPanel.className = 't2-img-ed-panel t2-img-ed-filter-panel active';
            const filterStrip = document.createElement('div');
            filterStrip.className = 't2-img-ed-filter-strip';
            filterPanel.appendChild(filterStrip);

            // ── 조정 패널 ─────────────────────────────────────────────────
            const adjustPanel = document.createElement('div');
            adjustPanel.className = 't2-img-ed-panel t2-img-ed-adjust-panel';
            const ADJUST_ITEMS = [
                { id: 'brightness', label: '밝기',   icon: 'wb_sunny',    min: 50,  max: 150, def: 100 },
                { id: 'contrast',   label: '대비',   icon: 'contrast',    min: 50,  max: 150, def: 100 },
                { id: 'saturation', label: '채도',   icon: 'palette',     min: 0,   max: 200, def: 100 },
                { id: 'warmth',     label: '온도',   icon: 'thermostat',  min: -50, max: 50,  def: 0   },
                { id: 'fade',       label: '페이드', icon: 'gradient',    min: 0,   max: 100, def: 0   },
                { id: 'vignette',   label: '비네트', icon: 'vignette',    min: 0,   max: 100, def: 0   },
            ];
            ADJUST_ITEMS.forEach(item => {
                const row = document.createElement('div');
                row.className = 't2-img-ed-adjust-row';

                const adjIcon = document.createElement('span');
                adjIcon.className = 'material-icons t2-img-ed-adj-icon';
                adjIcon.textContent = item.icon;

                const adjLabel = document.createElement('span');
                adjLabel.className = 't2-img-ed-adj-label';
                adjLabel.textContent = item.label;

                const sliderWrap = document.createElement('div');
                sliderWrap.className = 't2-img-ed-adj-slider-wrap';
                const slider = document.createElement('input');
                slider.type = 'range';
                slider.className = 't2-img-ed-adj-slider';
                slider.min = item.min;
                slider.max = item.max;
                slider.value = item.def;
                slider.dataset.adj = item.id;
                sliderWrap.appendChild(slider);

                const valDisplay = document.createElement('span');
                valDisplay.className = 't2-img-ed-adj-value';
                valDisplay.id = `t2-adj-val-${item.id}`;
                valDisplay.textContent = '0';

                row.append(adjIcon, adjLabel, sliderWrap, valDisplay);
                adjustPanel.appendChild(row);

                // 더블클릭으로 초기화
                slider.addEventListener('dblclick', () => {
                    slider.value = item.def;
                    slider.dispatchEvent(new Event('input'));
                });
            });

            // ── 자르기 패널 ───────────────────────────────────────────────
            const cropPanel = document.createElement('div');
            cropPanel.className = 't2-img-ed-panel t2-img-ed-crop-panel';

            const cropToolRow = document.createElement('div');
            cropToolRow.className = 't2-img-ed-crop-row';

            const rotateBtn = document.createElement('button');
            rotateBtn.type = 'button';
            rotateBtn.className = 't2-img-ed-crop-tool-btn';
            rotateBtn.dataset.action = 'rotate-left';
            const rotIcon = document.createElement('span');
            rotIcon.className = 'material-icons';
            rotIcon.textContent = 'rotate_left';
            const rotLbl = document.createElement('span');
            rotLbl.textContent = '회전';
            rotateBtn.append(rotIcon, rotLbl);

            const flipBtn = document.createElement('button');
            flipBtn.type = 'button';
            flipBtn.className = 't2-img-ed-crop-tool-btn';
            flipBtn.dataset.action = 'flip-h';
            const flipIcon = document.createElement('span');
            flipIcon.className = 'material-icons';
            flipIcon.textContent = 'flip';
            const flipLbl = document.createElement('span');
            flipLbl.textContent = '좌우반전';
            flipBtn.append(flipIcon, flipLbl);

            cropToolRow.append(rotateBtn, flipBtn);

            const aspectRow = document.createElement('div');
            aspectRow.className = 't2-img-ed-aspect-row';
            [
                { ratio: 'free', label: '자유' },
                { ratio: '1:1',  label: '1:1' },
                { ratio: '4:3',  label: '4:3' },
                { ratio: '3:4',  label: '3:4' },
                { ratio: '16:9', label: '16:9' },
            ].forEach(({ ratio, label }) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 't2-img-ed-aspect-btn' + (ratio === 'free' ? ' active' : '');
                btn.dataset.ratio = ratio;
                btn.textContent = label;
                aspectRow.appendChild(btn);
            });

            cropPanel.append(cropToolRow, aspectRow);
            panelsWrap.append(filterPanel, adjustPanel, cropPanel);
            overlay.append(header, canvasWrap, tabBar, panelsWrap);
            document.body.appendChild(overlay);

            // ── 렌더링 함수 ───────────────────────────────────────────────
            //
            // [REFACTOR] CSS filter 를 캔버스 엘리먼트에 직접 적용해 실시간
            // 미리보기 제공. ctx.filter 는 iOS Safari·구형 모바일 브라우저에서
            // 일관성이 떨어져 슬라이더 변화가 시각적으로 반영되지 않는 문제가
            // 있었다. 내보내기 시에는 별도의 픽셀 합성으로 동일 효과를 베이크한다.
            const getFilterString = () => {
                const parts = [];
                if (brightness !== 100) parts.push(`brightness(${(brightness / 100).toFixed(3)})`);
                if (contrast   !== 100) parts.push(`contrast(${(contrast / 100).toFixed(3)})`);
                if (saturation !== 100) parts.push(`saturate(${(saturation / 100).toFixed(3)})`);
                if (warmth > 0)  parts.push(`sepia(${(warmth / 50 * 0.28).toFixed(3)})`);
                if (warmth < 0) {
                    parts.push(`hue-rotate(${(warmth * 0.5).toFixed(1)}deg)`);
                    parts.push(`saturate(${Math.max(0, (1 + warmth / 150)).toFixed(3)})`);
                }
                if (fade > 0) {
                    const f = fade / 100;
                    parts.push(`brightness(${(1 + f * 0.14).toFixed(3)})`);
                    parts.push(`contrast(${(1 - f * 0.2).toFixed(3)})`);
                    parts.push(`saturate(${(1 - f * 0.16).toFixed(3)})`);
                }
                const preset = FILTERS.find(f => f.id === currentFilter);
                if (preset && preset.css) parts.push(preset.css);
                return parts.join(' ') || 'none';
            };

            // ── ctx.filter 지원 여부 1회 감지 ────────────────────────────────
            // 단순히 프로퍼티가 존재하는지(읽기/쓰기 가능)만 확인하면 false-positive 발생.
            // 일부 브라우저(Safari 18 초기, 구형 Android WebView 등)에서 ctx.filter
            // 프로퍼티는 존재하지만 drawImage 픽셀에 실제로 반영되지 않는 경우가 있다.
            // → 1×1 canvas에 흰 픽셀을 그리고 brightness(0) 필터를 적용해
            //   결과 픽셀이 실제로 검정으로 바뀌는지 픽셀 단위로 검증한다.
            const _ctxFilterSupported = (() => {
                try {
                    // 소스 캔버스: 흰색 픽셀
                    const src = document.createElement('canvas');
                    src.width = 1; src.height = 1;
                    const sCtx = src.getContext('2d');
                    if (!sCtx) return false;
                    sCtx.fillStyle = '#ffffff';
                    sCtx.fillRect(0, 0, 1, 1);

                    // 대상 캔버스: brightness(0) 필터 후 drawImage → 검정이 돼야 함
                    const dst = document.createElement('canvas');
                    dst.width = 1; dst.height = 1;
                    const dCtx = dst.getContext('2d');
                    if (!dCtx) return false;
                    dCtx.filter = 'brightness(0)';
                    dCtx.drawImage(src, 0, 0);

                    // 실제로 픽셀이 어두워졌는지 확인 (R 채널이 거의 0이면 필터가 동작한 것)
                    const px = dCtx.getImageData(0, 0, 1, 1).data;
                    return px[0] < 10;
                } catch (_) { return false; }
            })();

            // ── CSS filter 문자열 → 픽셀 조작 폴백 ────────────────────────────
            // ctx.filter 미지원/픽셀 미반영 환경에서 exportResult() 가 호출하는 함수.
            // getImageData/putImageData 로 직접 픽셀에 CSS filter 함수 효과를 베이크.
            // 지원 함수: brightness, contrast, saturate, grayscale, sepia, hue-rotate
            const _bakeCssFiltersToPixels = (ctx, w, h, filterStr) => {
                if (!filterStr || filterStr === 'none') return;
                let imageData;
                try { imageData = ctx.getImageData(0, 0, w, h); } catch (e) {
                    console.warn('[T2Image] 필터 픽셀 적용 실패 — canvas getImageData 접근 불가:', e && e.message);
                    return;
                }
                const d   = imageData.data;
                const len = d.length;
                const Wr = 0.2126, Wg = 0.7152, Wb = 0.0722; // BT.709 luminance

                // HSL 헬퍼 (hue-rotate 에서 사용)
                const hue2rgb = (p, q, t) => {
                    if (t < 0) t += 1;
                    if (t > 1) t -= 1;
                    if (t < 1/6) return p + (q - p) * 6 * t;
                    if (t < 1/2) return q;
                    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                    return p;
                };

                const filterRe = /([\w-]+)\(\s*([^)]+?)\s*\)/g;
                let m;
                while ((m = filterRe.exec(filterStr)) !== null) {
                    const fn  = m[1];
                    const raw = m[2];

                    if (fn === 'brightness') {
                        const v = parseFloat(raw);
                        if (!isFinite(v) || v === 1) continue;
                        for (let i = 0; i < len; i += 4) {
                            d[i]   = Math.min(255, Math.max(0, d[i]   * v + 0.5)) | 0;
                            d[i+1] = Math.min(255, Math.max(0, d[i+1] * v + 0.5)) | 0;
                            d[i+2] = Math.min(255, Math.max(0, d[i+2] * v + 0.5)) | 0;
                        }

                    } else if (fn === 'contrast') {
                        const v = parseFloat(raw);
                        if (!isFinite(v) || v === 1) continue;
                        const t = 128 * (1 - v);
                        for (let i = 0; i < len; i += 4) {
                            d[i]   = Math.min(255, Math.max(0, d[i]   * v + t + 0.5)) | 0;
                            d[i+1] = Math.min(255, Math.max(0, d[i+1] * v + t + 0.5)) | 0;
                            d[i+2] = Math.min(255, Math.max(0, d[i+2] * v + t + 0.5)) | 0;
                        }

                    } else if (fn === 'saturate') {
                        const v = parseFloat(raw);
                        if (!isFinite(v) || v === 1) continue;
                        for (let i = 0; i < len; i += 4) {
                            const r = d[i], g = d[i+1], b = d[i+2];
                            const lum = Wr * r + Wg * g + Wb * b;
                            d[i]   = Math.min(255, Math.max(0, lum + (r - lum) * v + 0.5)) | 0;
                            d[i+1] = Math.min(255, Math.max(0, lum + (g - lum) * v + 0.5)) | 0;
                            d[i+2] = Math.min(255, Math.max(0, lum + (b - lum) * v + 0.5)) | 0;
                        }

                    } else if (fn === 'grayscale') {
                        const v = Math.min(1, Math.max(0, parseFloat(raw)));
                        if (!isFinite(v) || v === 0) continue;
                        for (let i = 0; i < len; i += 4) {
                            const gray = Wr * d[i] + Wg * d[i+1] + Wb * d[i+2];
                            d[i]   = (d[i]   + (gray - d[i])   * v + 0.5) | 0;
                            d[i+1] = (d[i+1] + (gray - d[i+1]) * v + 0.5) | 0;
                            d[i+2] = (d[i+2] + (gray - d[i+2]) * v + 0.5) | 0;
                        }

                    } else if (fn === 'sepia') {
                        const v = Math.min(1, Math.max(0, parseFloat(raw)));
                        if (!isFinite(v) || v === 0) continue;
                        for (let i = 0; i < len; i += 4) {
                            const r = d[i], g = d[i+1], b = d[i+2];
                            const sr = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
                            const sg = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
                            const sb = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
                            d[i]   = (r + (sr - r) * v + 0.5) | 0;
                            d[i+1] = (g + (sg - g) * v + 0.5) | 0;
                            d[i+2] = (b + (sb - b) * v + 0.5) | 0;
                        }

                    } else if (fn === 'hue-rotate') {
                        let deg = parseFloat(raw);
                        if (!isFinite(deg) || deg === 0) continue;
                        deg = ((deg % 360) + 360) % 360;
                        const deltaNorm = deg / 360;
                        for (let i = 0; i < len; i += 4) {
                            const r = d[i] / 255, g = d[i+1] / 255, b = d[i+2] / 255;
                            const max = Math.max(r, g, b), min = Math.min(r, g, b);
                            const diff = max - min;
                            const l = (max + min) / 2;
                            let h, s;
                            if (diff === 0) { h = 0; s = 0; }
                            else {
                                s = l > 0.5 ? diff / (2 - max - min) : diff / (max + min);
                                if      (max === r) h = ((g - b) / diff + (g < b ? 6 : 0)) / 6;
                                else if (max === g) h = ((b - r) / diff + 2) / 6;
                                else                h = ((r - g) / diff + 4) / 6;
                            }
                            h = (h + deltaNorm) % 1;
                            let nr, ng, nb;
                            if (s === 0) { nr = ng = nb = l; }
                            else {
                                const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                                const p = 2 * l - q;
                                nr = hue2rgb(p, q, h + 1/3);
                                ng = hue2rgb(p, q, h);
                                nb = hue2rgb(p, q, h - 1/3);
                            }
                            d[i]   = Math.min(255, Math.max(0, nr * 255 + 0.5)) | 0;
                            d[i+1] = Math.min(255, Math.max(0, ng * 255 + 0.5)) | 0;
                            d[i+2] = Math.min(255, Math.max(0, nb * 255 + 0.5)) | 0;
                        }
                    }
                    // url(), drop-shadow, invert, opacity 등 미구현 함수는 무시
                }
                ctx.putImageData(imageData, 0, 0);
            };

            // 회전·플립 → CSS transform, 필터/조정 → CSS filter
            // 캔버스에는 원본만 그려놓고 시각적 효과는 모두 CSS 로 처리한다.
            // → 미리보기가 항상 정확하고 즉시 반응한다.
            const renderCanvas = () => {
                if (!origW || !origH) return;
                const ctx = mainCanvas.getContext('2d');
                mainCanvas.width  = origW;
                mainCanvas.height = origH;
                ctx.clearRect(0, 0, origW, origH);
                ctx.drawImage(origImg, 0, 0, origW, origH);

                // CSS: 필터·회전·플립 모두 캔버스 엘리먼트에 직접 적용
                const filterStr = getFilterString();
                mainCanvas.style.filter = filterStr;
                mainCanvas.style.webkitFilter = filterStr;

                const transforms = [];
                if (rotation) transforms.push(`rotate(${rotation}deg)`);
                if (flipH)    transforms.push('scaleX(-1)');
                mainCanvas.style.transform = transforms.length ? transforms.join(' ') : '';

                // 비네트 (CSS 기반)
                vignetteEl.style.opacity = vignette > 0 ? String(vignette / 100) : '0';

                // 크롭 오버레이
                updateCropOverlay();
            };

            // ── 크롭 좌표 변환 헬퍼 ─────────────────────────────────────────
            //
            // 캔버스는 원본 이미지를 그대로 그리고 CSS transform 으로 회전/플립을
            // 적용한다. 따라서 화면에 표시되는 이미지의 "가시 영역" 픽셀은
            // 회전 후의 좌표계(rotW × rotH) 다. 크롭 박스도 이 좌표계 기준이다.
            const getRotatedDims = () => {
                const isRot90 = (rotation === 90 || rotation === 270);
                return {
                    rotW: isRot90 ? origH : origW,
                    rotH: isRot90 ? origW : origH
                };
            };

            // 현재 캔버스가 화면에 실제로 표시되는 박스(회전 적용 후) 를 구한다.
            // canvas 엘리먼트의 getBoundingClientRect 는 transform 회전 시
            // 회전된 외접 사각형을 반환하므로 그대로 사용 가능하다.
            const getDisplayedRect = () => {
                const r = mainCanvas.getBoundingClientRect();
                const wrapRect = canvasWrap.getBoundingClientRect();
                return {
                    left: r.left - wrapRect.left,
                    top:  r.top  - wrapRect.top,
                    width:  r.width,
                    height: r.height
                };
            };

            // 비율 자르기 박스를 "이미지 회전 후 좌표계" 픽셀 단위로 계산.
            // 항상 이미지의 실제 가로/세로에 정확히 fit 한다.
            const computeFittedCropBox = (aspect) => {
                const { rotW, rotH } = getRotatedDims();
                if (aspect === 'free') {
                    return { x: 0, y: 0, w: rotW, h: rotH };
                }
                const [rw, rh] = aspect.split(':').map(Number);
                if (!rw || !rh) return { x: 0, y: 0, w: rotW, h: rotH };
                const targetAspect = rw / rh;
                const imgAspect = rotW / rotH;
                let w, h;
                if (targetAspect > imgAspect) {
                    // 박스가 이미지보다 가로로 더 넓다 → 이미지 가로 = 박스 가로
                    w = rotW;
                    h = Math.round(rotW / targetAspect);
                } else {
                    // 박스가 이미지보다 세로로 더 길다 → 이미지 세로 = 박스 세로
                    h = rotH;
                    w = Math.round(rotH * targetAspect);
                }
                return {
                    x: Math.round((rotW - w) / 2),
                    y: Math.round((rotH - h) / 2),
                    w, h
                };
            };

            // 크롭 박스(원본 픽셀) → 화면 표시 좌표 변환
            const cropBoxToScreen = () => {
                if (!cropBox) return null;
                const { rotW, rotH } = getRotatedDims();
                const disp = getDisplayedRect();
                const sx = disp.width  / rotW;
                const sy = disp.height / rotH;
                return {
                    left:   disp.left + cropBox.x * sx,
                    top:    disp.top  + cropBox.y * sy,
                    width:  cropBox.w * sx,
                    height: cropBox.h * sy,
                    sx, sy,
                    dispLeft: disp.left, dispTop: disp.top,
                    dispW: disp.width, dispH: disp.height
                };
            };

            const updateCropOverlay = () => {
                // 자르기 탭이 아닐 때는 숨김
                if (activeTab !== 'crop') {
                    cropOverlay.style.display = 'none';
                    return;
                }
                // 크롭 박스가 없으면 비율에 맞춰 생성
                if (!cropBox) {
                    cropBox = computeFittedCropBox(cropAspect);
                }
                const s = cropBoxToScreen();
                if (!s) { cropOverlay.style.display = 'none'; return; }
                cropOverlay.style.display = 'block';
                cropOverlay.style.left    = `${s.left}px`;
                cropOverlay.style.top     = `${s.top}px`;
                cropOverlay.style.width   = `${s.width}px`;
                cropOverlay.style.height  = `${s.height}px`;
                // 자유 모드일 때만 모서리 핸들 표시
                cropOverlay.querySelectorAll('.t2-img-ed-crop-handle').forEach(h => {
                    h.style.display = (cropAspect === 'free') ? 'block' : 'none';
                });
            };

            // ── 크롭 박스 클램프(이미지 영역 안으로 제한) ─────────────────
            const clampCropBox = () => {
                if (!cropBox) return;
                const { rotW, rotH } = getRotatedDims();
                const minSize = 24;
                cropBox.w = Math.max(minSize, Math.min(rotW, Math.round(cropBox.w)));
                cropBox.h = Math.max(minSize, Math.min(rotH, Math.round(cropBox.h)));
                cropBox.x = Math.max(0, Math.min(rotW - cropBox.w, Math.round(cropBox.x)));
                cropBox.y = Math.max(0, Math.min(rotH - cropBox.h, Math.round(cropBox.y)));
            };

            // ── 크롭 인터랙션: 드래그(이동) + 휠/핀치(줌) + 모서리 리사이즈 ─
            //   모바일: 1손가락 = 이동, 2손가락 = 줌
            //   데스크톱: 드래그 = 이동, 휠 = 줌, 자유 모드면 모서리 드래그 = 리사이즈
            (() => {
                let mode = null;          // 'move' | 'resize' | 'pinch' | null
                let resizeHandle = null;  // 'tl' | 'tr' | 'bl' | 'br'
                let startPointer = null;  // { x, y } in screen px
                let startBox = null;      // 시작 시 cropBox snapshot
                let pinchStart = null;    // { dist, centerBoxX, centerBoxY }

                const getScale = () => {
                    const { rotW, rotH } = getRotatedDims();
                    const disp = getDisplayedRect();
                    return {
                        sx: disp.width  / rotW,
                        sy: disp.height / rotH
                    };
                };

                // 비율 유지하며 박스를 새로운 크기로 조정 (중심 유지)
                const resizeKeepingAspect = (newW) => {
                    if (!cropBox) return;
                    const { rotW, rotH } = getRotatedDims();
                    let aspectRatio;
                    if (cropAspect === 'free') {
                        aspectRatio = cropBox.w / cropBox.h;
                    } else {
                        const [rw, rh] = cropAspect.split(':').map(Number);
                        aspectRatio = rw / rh;
                    }
                    const cx = cropBox.x + cropBox.w / 2;
                    const cy = cropBox.y + cropBox.h / 2;
                    let w = Math.max(24, Math.min(rotW, newW));
                    let h = w / aspectRatio;
                    if (h > rotH) {
                        h = rotH;
                        w = h * aspectRatio;
                    }
                    cropBox.w = Math.round(w);
                    cropBox.h = Math.round(h);
                    cropBox.x = Math.round(cx - cropBox.w / 2);
                    cropBox.y = Math.round(cy - cropBox.h / 2);
                    clampCropBox();
                };

                // 포인터 시작
                const onPointerDown = (e) => {
                    if (activeTab !== 'crop' || !cropBox) return;
                    // 핸들 클릭이면 resize, 아니면 move
                    const handleEl = e.target.closest('.t2-img-ed-crop-handle');
                    if (handleEl && cropAspect === 'free') {
                        mode = 'resize';
                        resizeHandle = handleEl.dataset.handle;
                    } else {
                        mode = 'move';
                    }
                    startPointer = { x: e.clientX, y: e.clientY };
                    startBox = { ...cropBox };
                    e.preventDefault();
                    cropOverlay.setPointerCapture && cropOverlay.setPointerCapture(e.pointerId);
                };

                const onPointerMove = (e) => {
                    if (!mode || !startPointer || !startBox) return;
                    const { sx, sy } = getScale();
                    const dx = (e.clientX - startPointer.x) / sx;
                    const dy = (e.clientY - startPointer.y) / sy;
                    const { rotW, rotH } = getRotatedDims();

                    if (mode === 'move') {
                        cropBox.x = startBox.x + dx;
                        cropBox.y = startBox.y + dy;
                        clampCropBox();
                    } else if (mode === 'resize') {
                        // 4개 핸들 별로 리사이즈 (자유 모드)
                        let nx = startBox.x, ny = startBox.y, nw = startBox.w, nh = startBox.h;
                        if (resizeHandle === 'tl') {
                            nx = startBox.x + dx; ny = startBox.y + dy;
                            nw = startBox.w - dx; nh = startBox.h - dy;
                        } else if (resizeHandle === 'tr') {
                            ny = startBox.y + dy;
                            nw = startBox.w + dx; nh = startBox.h - dy;
                        } else if (resizeHandle === 'bl') {
                            nx = startBox.x + dx;
                            nw = startBox.w - dx; nh = startBox.h + dy;
                        } else if (resizeHandle === 'br') {
                            nw = startBox.w + dx; nh = startBox.h + dy;
                        }
                        // 최소 크기 강제 + 이미지 경계 안으로
                        const minSize = 24;
                        if (nw < minSize) { nw = minSize; nx = Math.min(nx, startBox.x + startBox.w - minSize); }
                        if (nh < minSize) { nh = minSize; ny = Math.min(ny, startBox.y + startBox.h - minSize); }
                        if (nx < 0) { nw += nx; nx = 0; }
                        if (ny < 0) { nh += ny; ny = 0; }
                        if (nx + nw > rotW) nw = rotW - nx;
                        if (ny + nh > rotH) nh = rotH - ny;
                        cropBox.x = Math.round(nx);
                        cropBox.y = Math.round(ny);
                        cropBox.w = Math.round(nw);
                        cropBox.h = Math.round(nh);
                    }
                    updateCropOverlay();
                };

                const onPointerUp = (e) => {
                    mode = null; resizeHandle = null; startPointer = null; startBox = null;
                    try { cropOverlay.releasePointerCapture && cropOverlay.releasePointerCapture(e.pointerId); } catch (_) {}
                };

                cropOverlay.addEventListener('pointerdown', onPointerDown);
                cropOverlay.addEventListener('pointermove', onPointerMove);
                cropOverlay.addEventListener('pointerup',   onPointerUp);
                cropOverlay.addEventListener('pointercancel', onPointerUp);

                // ── 휠 줌 (데스크톱) ──────────────────────────────────────
                cropOverlay.addEventListener('wheel', (e) => {
                    if (activeTab !== 'crop' || !cropBox) return;
                    e.preventDefault();
                    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
                    resizeKeepingAspect(cropBox.w * factor);
                    updateCropOverlay();
                }, { passive: false });

                // ── 핀치 줌 (모바일 / 터치) ──────────────────────────────
                // pointer event 2개 추적
                const activePointers = new Map();
                const getPinchDist = () => {
                    const pts = Array.from(activePointers.values());
                    if (pts.length < 2) return 0;
                    const dx = pts[0].x - pts[1].x;
                    const dy = pts[0].y - pts[1].y;
                    return Math.sqrt(dx*dx + dy*dy);
                };
                canvasWrap.addEventListener('pointerdown', (e) => {
                    if (activeTab !== 'crop') return;
                    if (e.pointerType !== 'touch') return;
                    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
                    if (activePointers.size === 2 && cropBox) {
                        mode = 'pinch';
                        pinchStart = { dist: getPinchDist(), w: cropBox.w };
                    }
                });
                canvasWrap.addEventListener('pointermove', (e) => {
                    if (!activePointers.has(e.pointerId)) return;
                    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
                    if (mode === 'pinch' && pinchStart && activePointers.size === 2 && cropBox) {
                        const curDist = getPinchDist();
                        if (pinchStart.dist > 0) {
                            const ratio = curDist / pinchStart.dist;
                            resizeKeepingAspect(pinchStart.w * ratio);
                            updateCropOverlay();
                        }
                        e.preventDefault();
                    }
                }, { passive: false });
                const endPinch = (e) => {
                    activePointers.delete(e.pointerId);
                    if (activePointers.size < 2 && mode === 'pinch') {
                        mode = null; pinchStart = null;
                    }
                };
                canvasWrap.addEventListener('pointerup', endPinch);
                canvasWrap.addEventListener('pointercancel', endPinch);
            })();

            // ── 썸네일 생성 ───────────────────────────────────────────────
            const generateThumbnails = () => {
                const thumbW = 80, thumbH = 80;
                FILTERS.forEach(filter => {
                    const item = document.createElement('div');
                    item.className = 't2-img-ed-filter-item' + (filter.id === currentFilter ? ' active' : '');
                    item.dataset.filter = filter.id;

                    const tc = document.createElement('canvas');
                    tc.width = thumbW; tc.height = thumbH;
                    const tctx = tc.getContext('2d');
                    const scale = Math.min(thumbW / origW, thumbH / origH);
                    const tw = origW * scale, th = origH * scale;
                    tctx.filter = filter.css || 'none';
                    tctx.drawImage(origImg, (thumbW - tw) / 2, (thumbH - th) / 2, tw, th);

                    const lbl = document.createElement('span');
                    lbl.className = 't2-img-ed-filter-label';
                    lbl.textContent = filter.label;

                    item.append(tc, lbl);
                    item.addEventListener('click', () => {
                        currentFilter = filter.id;
                        filterStrip.querySelectorAll('.t2-img-ed-filter-item').forEach(el => el.classList.remove('active'));
                        item.classList.add('active');
                        renderCanvas();
                    });
                    filterStrip.appendChild(item);
                });
            };

            // ── 이미지 로드 ───────────────────────────────────────────────
            const onImageReady = () => {
                origW = origImg.naturalWidth;
                origH = origImg.naturalHeight;
                renderCanvas();
                generateThumbnails();
            };
            if (origImg.complete && origImg.naturalWidth) {
                onImageReady();
            } else {
                origImg.onload = onImageReady;
            }

            // ── 탭 전환 ───────────────────────────────────────────────────
            tabBar.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-tab]');
                if (!btn) return;
                activeTab = btn.dataset.tab;
                tabBar.querySelectorAll('.t2-img-ed-tab').forEach(t => t.classList.remove('active'));
                btn.classList.add('active');
                filterPanel.classList.remove('active');
                adjustPanel.classList.remove('active');
                cropPanel.classList.remove('active');
                if (activeTab === 'filter') filterPanel.classList.add('active');
                if (activeTab === 'adjust') adjustPanel.classList.add('active');
                if (activeTab === 'crop')   cropPanel.classList.add('active');
                updateCropOverlay();
            });

            // ── 조정 슬라이더 ─────────────────────────────────────────────
            adjustPanel.addEventListener('input', (e) => {
                const slider = e.target.closest('[data-adj]');
                if (!slider) return;
                const val = parseInt(slider.value, 10);
                const id  = slider.dataset.adj;
                const meta = ADJUST_ITEMS.find(a => a.id === id);
                if (id === 'brightness') brightness = val;
                else if (id === 'contrast')   contrast   = val;
                else if (id === 'saturation') saturation = val;
                else if (id === 'warmth')     warmth     = val;
                else if (id === 'fade')       fade       = val;
                else if (id === 'vignette')   vignette   = val;
                const valEl = adjustPanel.querySelector(`#t2-adj-val-${id}`);
                if (valEl && meta) {
                    const diff = val - meta.def;
                    valEl.textContent = (diff >= 0 ? '+' : '') + diff;
                    valEl.classList.toggle('changed', diff !== 0);
                }
                renderCanvas();
            });

            // ── 자르기 패널 이벤트 ────────────────────────────────────────
            cropPanel.addEventListener('click', (e) => {
                const toolBtn = e.target.closest('[data-action]');
                if (toolBtn) {
                    const action = toolBtn.dataset.action;
                    if (action === 'rotate-left') {
                        rotation = (rotation + 270) % 360;
                        mainCanvas.style.transition = 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)';
                        // 회전 후 회전된 좌표계가 바뀌므로 크롭 박스를 비율 기준으로 재맞춤
                        cropBox = computeFittedCropBox(cropAspect);
                        renderCanvas();
                    } else if (action === 'flip-h') {
                        flipH = !flipH;
                        flipBtn.classList.toggle('active', flipH);
                        // 플립 시 크롭 박스는 좌우 반전
                        if (cropBox) {
                            const { rotW } = getRotatedDims();
                            cropBox.x = rotW - cropBox.x - cropBox.w;
                            clampCropBox();
                        }
                        renderCanvas();
                    }
                }
                const aspectBtn = e.target.closest('[data-ratio]');
                if (aspectBtn) {
                    cropAspect = aspectBtn.dataset.ratio;
                    cropPanel.querySelectorAll('[data-ratio]').forEach(b => b.classList.remove('active'));
                    aspectBtn.classList.add('active');
                    // 비율 변경 시 항상 이미지 가로/세로에 fit 되도록 박스를 재계산
                    cropBox = computeFittedCropBox(cropAspect);
                    updateCropOverlay();
                }
            });

            // 리사이즈 시 크롭 오버레이 재계산
            const resizeObserver = new ResizeObserver(() => {
                requestAnimationFrame(updateCropOverlay);
            });
            resizeObserver.observe(canvasWrap);

            // ── 내보내기 함수 ─────────────────────────────────────────────
            //
            // [REFACTOR] 픽셀에 회전·플립·필터·크롭·비네트를 모두 베이크.
            // 미리보기는 CSS 로 했지만 저장 시점에는 진짜 픽셀에 적용해야 한다.
            //
            // [보안 정합성]
            //   원본 파일의 확장자/MIME 을 보존해서 서버 매직바이트 검사를 통과한다.
            //   원본이 PNG 면 PNG 로, JPEG 면 JPEG 로, WEBP 면 WEBP 로 출력.
            //   알 수 없는 형식은 JPEG 으로 폴백.
            const exportResult = () => {
                if (!origW || !origH) return { dataUrl: imageData.url, w: origW, h: origH, mime: null };

                const isRot90 = (rotation === 90 || rotation === 270);
                const rotW = isRot90 ? origH : origW;
                const rotH = isRot90 ? origW : origH;

                // 1) 회전·플립 적용 캔버스(원본 회전 후 좌표계)
                const rotCanvas = document.createElement('canvas');
                rotCanvas.width  = rotW;
                rotCanvas.height = rotH;
                const rctx = rotCanvas.getContext('2d');
                rctx.save();
                rctx.translate(rotW / 2, rotH / 2);
                rctx.rotate((rotation * Math.PI) / 180);
                if (flipH) rctx.scale(-1, 1);
                rctx.drawImage(origImg, -origW / 2, -origH / 2, origW, origH);
                rctx.restore();

                // 2) 크롭 박스 결정 (사용자가 드래그/줌으로 조절한 박스 우선)
                let cropX, cropY, cropW, cropH;
                if (cropBox && cropBox.w > 0 && cropBox.h > 0) {
                    cropX = Math.max(0, Math.min(rotW, Math.round(cropBox.x)));
                    cropY = Math.max(0, Math.min(rotH, Math.round(cropBox.y)));
                    cropW = Math.max(1, Math.min(rotW - cropX, Math.round(cropBox.w)));
                    cropH = Math.max(1, Math.min(rotH - cropY, Math.round(cropBox.h)));
                } else {
                    cropX = 0; cropY = 0; cropW = rotW; cropH = rotH;
                }

                // 3) 크롭 + 필터(픽셀에 베이크)
                const exportCanvas = document.createElement('canvas');
                exportCanvas.width  = cropW;
                exportCanvas.height = cropH;
                const ctx = exportCanvas.getContext('2d');
                const filterStr = getFilterString();

                if (_ctxFilterSupported && filterStr !== 'none') {
                    // ctx.filter 지원 + 실제 픽셀 반영 확인된 환경:
                    // 필터를 설정한 뒤 drawImage 로 픽셀에 베이크
                    ctx.filter = filterStr;
                    ctx.drawImage(rotCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
                    ctx.filter = 'none';
                } else {
                    // ctx.filter 미지원/픽셀 미반영 환경(Safari 18 미만, 구형 Android WebView 등):
                    // 먼저 원본 픽셀을 그린 뒤 getImageData/putImageData 로 필터 베이크
                    ctx.drawImage(rotCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
                    _bakeCssFiltersToPixels(ctx, cropW, cropH, filterStr);
                }

                // 4) 비네트 (그라데이션을 따로 그림)
                if (vignette > 0) {
                    const grd = ctx.createRadialGradient(
                        cropW / 2, cropH / 2, Math.min(cropW, cropH) * 0.2,
                        cropW / 2, cropH / 2, Math.max(cropW, cropH) * 0.78
                    );
                    grd.addColorStop(0, 'rgba(0,0,0,0)');
                    grd.addColorStop(1, `rgba(0,0,0,${(vignette / 100 * 0.72).toFixed(3)})`);
                    ctx.fillStyle = grd;
                    ctx.fillRect(0, 0, cropW, cropH);
                }

                // 5) 원본 파일 확장자 기반으로 출력 MIME 결정
                //    → 서버 매직바이트 검사를 통과하도록 매칭한다.
                const origName = (imageData.file && imageData.file.name) || 'image.jpg';
                const origExt  = origName.toLowerCase().split('.').pop();
                let outMime, outExt;
                if (origExt === 'png') {
                    outMime = 'image/png'; outExt = 'png';
                } else if (origExt === 'webp' && exportCanvas.toDataURL('image/webp').indexOf('data:image/webp') === 0) {
                    outMime = 'image/webp'; outExt = 'webp';
                } else {
                    // jpg, jpeg, gif, bmp 등 → JPEG 으로 통일 (가장 호환성·압축 효율 좋음)
                    // GIF/BMP 는 canvas.toDataURL 이 지원하지 않으므로 JPEG 가 안전.
                    outMime = 'image/jpeg'; outExt = (origExt === 'jpeg') ? 'jpeg' : 'jpg';
                }
                const quality = (outMime === 'image/jpeg' || outMime === 'image/webp') ? 0.92 : undefined;
                const dataUrl = (quality !== undefined)
                    ? exportCanvas.toDataURL(outMime, quality)
                    : exportCanvas.toDataURL(outMime);

                return { dataUrl, w: cropW, h: cropH, mime: outMime, ext: outExt };
            };

            // ── 닫기 ──────────────────────────────────────────────────────
            let resolved = false;
            const close = (save) => {
                if (resolved) return;
                resolved = true;
                resizeObserver.disconnect();

                if (save) {
                    // 저장 중 피드백
                    const savingEl = document.createElement('div');
                    savingEl.className = 't2-img-ed-saving';
                    const savIcon = document.createElement('span');
                    savIcon.className = 'material-icons';
                    savIcon.textContent = 'check_circle';
                    const savTxt = document.createElement('span');
                    savTxt.textContent = '편집 완료';
                    savingEl.append(savIcon, savTxt);
                    canvasWrap.appendChild(savingEl);

                    const { dataUrl, w, h, mime, ext } = exportResult();
                    const safeUrl = this._sanitizeImageSrc(dataUrl);
                    if (safeUrl) {
                        imageData.url    = safeUrl;
                        imageData.width  = w;
                        imageData.height = h;
                        if (previewImg) previewImg.src = safeUrl;

                        // ── 편집된 File 객체 생성 ──────────────────────────────
                        // [FIX] atob() → Uint8Array 변환 방식은 대용량 이미지에서
                        // 메모리 부족으로 try-catch 가 조용히 실패할 수 있다.
                        // fetch(dataUrl) 방식으로 브라우저 내부 디코더를 활용해 안정적으로 Blob 생성.
                        // fetch가 없는 환경(매우 드물지만)은 기존 atob 방식으로 폴백.
                        const origName = (imageData.file && imageData.file.name) || 'image.jpg';
                        const dot      = origName.lastIndexOf('.');
                        const baseName = (dot > 0 ? origName.slice(0, dot) : origName)
                            .replace(/[\\/:*?"<>|]+/g, '_');
                        const finalExt  = ext || 'jpg';
                        const newName   = `${baseName}_edited.${finalExt}`;
                        const finalMime = mime || 'image/jpeg';

                        const applyEditedFile = (blob) => {
                            if (blob && blob.size > 0) {
                                imageData.file = new File([blob], newName, { type: finalMime });
                            } else {
                                console.warn('[T2Image] 편집 파일 Blob 생성 실패 — 원본 파일 유지');
                            }
                        };

                        if (typeof fetch === 'function') {
                            // fetch(dataUrl): 브라우저가 직접 디코딩 → 메모리 효율적
                            fetch(safeUrl)
                                .then(r => r.blob())
                                .then(blob => applyEditedFile(new Blob([blob], { type: finalMime })))
                                .catch(e => {
                                    console.warn('[T2Image] fetch 방식 Blob 생성 실패, atob 폴백:', e && e.message);
                                    // atob 폴백
                                    try {
                                        const arr  = safeUrl.split(',');
                                        const bstr = atob(arr[1]);
                                        const u8   = new Uint8Array(bstr.length);
                                        for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
                                        applyEditedFile(new Blob([u8], { type: finalMime }));
                                    } catch (e2) {
                                        console.warn('[T2Image] atob 폴백도 실패:', e2 && e2.message);
                                    }
                                });
                        } else {
                            // fetch 없는 환경: 기존 atob 방식
                            try {
                                const arr  = safeUrl.split(',');
                                const bstr = atob(arr[1]);
                                const u8   = new Uint8Array(bstr.length);
                                for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
                                applyEditedFile(new Blob([u8], { type: finalMime }));
                            } catch (e) {
                                console.warn('[T2Image] 편집 파일 변환 실패:', e && e.message);
                            }
                        }
                    }

                    setTimeout(() => {
                        overlay.remove();
                        resolve();
                    }, 420);
                } else {
                    overlay.remove();
                    resolve();
                }
            };

            cancelBtn.addEventListener('click',  () => close(false));
            confirmBtn.addEventListener('click', () => close(true));
            document.addEventListener('keydown', function escHandler(e) {
                if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', escHandler); }
            });
        });
    }

    /**
     * 현재 에디터 내 커서(Selection/Range)를 _savedEditorRange에 저장한다.
     * 모달 열기 직전에 호출하여 포커스를 잃어도 삽입 위치를 기억한다.
     */
    _saveEditorRange() {
        try {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                // 에디터 내부의 range만 저장 (모달 등 외부 range는 무시)
                if (this.editor.editor.contains(range.startContainer)) {
                    this._savedEditorRange = range.cloneRange();
                    return;
                }
            }
        } catch (_) { /* 무시 */ }
        // selection이 없어도 core.js의 savedSelection을 참조할 수 있으니 null 유지
    }

    /**
     * 이미지 삽입에 사용할 유효한 Range를 4단계로 결정한다.
     *
     * 1순위: 현재 selection이 에디터 내부를 가리키는 경우
     * 2순위: 모달 열기 직전에 저장한 _savedEditorRange
     * 3순위: core.js 의 editor.savedSelection
     * 4순위: 에디터의 마지막 블록 끝 (최종 fallback)
     *
     * @returns {Range|null}
     */
    _resolveEditorRange() {
        const editorEl = this.editor.editor;

        // ── 1순위: 현재 selection ─────────────────────────────────────
        try {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                if (editorEl.contains(range.startContainer)) {
                    return range;
                }
            }
        } catch (_) { /* 무시 */ }

        // ── 2순위: 모달 열기 직전에 저장한 range ─────────────────────
        if (this._savedEditorRange) {
            try {
                // 저장된 range의 startContainer가 아직 에디터에 연결돼 있는지 확인
                if (editorEl.contains(this._savedEditorRange.startContainer)) {
                    return this._savedEditorRange;
                }
            } catch (_) { /* range가 detach됐을 수 있음 */ }
        }

        // ── 3순위: core.js editor.savedSelection ─────────────────────
        if (this.editor.savedSelection) {
            try {
                if (editorEl.contains(this.editor.savedSelection.startContainer)) {
                    return this.editor.savedSelection;
                }
            } catch (_) { /* 무시 */ }
        }

        // ── 4순위: 에디터 마지막 블록 끝 (최종 fallback) ─────────────
        try {
            const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE'];
            // 마지막 자식 블록 요소를 역방향으로 탐색
            const children = Array.from(editorEl.childNodes);
            let targetBlock = null;
            for (let i = children.length - 1; i >= 0; i--) {
                const node = children[i];
                if (node.nodeType === Node.ELEMENT_NODE && blockTags.includes(node.nodeName)) {
                    targetBlock = node;
                    break;
                }
            }
            if (!targetBlock) {
                // 블록이 전혀 없으면 에디터에 빈 p를 생성
                targetBlock = document.createElement('p');
                targetBlock.innerHTML = '<br>';
                editorEl.appendChild(targetBlock);
            }
            const fallbackRange = document.createRange();
            fallbackRange.selectNodeContents(targetBlock);
            fallbackRange.collapse(false); // 끝으로 이동
            return fallbackRange;
        } catch (_) { /* 무시 */ }

        return null;
    }

    generateBlockId() {
        return `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

window.T2ImagePlugin = T2ImagePlugin;
// T2Editor/plugin/video/video.js

class T2VideoPlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['insertYouTube'];

        // ── [UPLOAD-CONFIG] 허용 확장자·MIME·accept 문자열 ───────────────────
        // 설정 로드는 두 단계로 동작한다.
        //
        // 1단계 (동기): editor_lib.php 가 주입한 window.T2EDITOR_UPLOAD_CONFIG 를 읽는다.
        //   주입 성공 → 즉시 사용, API 호출 없음.
        //   주입 실패 → fallback 으로 초기화 후 _loadConfig() 로 비동기 보완.
        //
        // 2단계 (비동기): window 변수가 없으면 get_upload_config.php 를 호출한다.
        //   video.js · file.js 공용 엔드포인트이므로 플러그인별 *_config.php 불필요.
        //   API 성공 → 설정 교체 (이후 열리는 모달부터 반영).
        //   API 실패 → fallback 유지, console.error 출력.
        // ─────────────────────────────────────────────────────────────────────
        this._configReady = false;   // _loadConfig() 완료 여부
        this._configPromise = null;  // 진행 중인 로드 Promise (중복 호출 방지)

        this._applyWindowConfig();   // 1단계: window 변수 동기 적용
        this._loadConfig();          // 2단계: 필요 시 비동기 보완 (fire-and-forget)
    }

    // ── [SEC-PLUGIN-BOUNDARY] core.js / utils.js 공통 보안 경계 래퍼 ────────
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

    _sanitizeURL(url, context = 'href') {
        if (typeof T2Utils !== 'undefined' && T2Utils.sanitizeURL) {
            return T2Utils.sanitizeURL(String(url || ''), context);
        }

        const value = String(url || '');
        const normalized = value.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^(javascript|vbscript):/.test(normalized)) return '';
        if (context === 'href' && /^data:/.test(normalized)) return '';
        return value;
    }

    _sanitizeYouTubeId(id) {
        const value = String(id || '').trim();
        return /^[a-zA-Z0-9_-]{11}$/.test(value) ? value : '';
    }

    _sanitizeVideoURL(url) {
        const safe = this._sanitizeURL(url, 'href');
        if (!safe) return '';

        const value = String(safe).trim();
        const normalized = value.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^data:/.test(normalized)) return '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(normalized) && !/^https?:/i.test(normalized) && !/^blob:/i.test(normalized)) {
            return '';
        }

        return value;
    }

    _sanitizeVideoInfo(videoInfo) {
        if (!videoInfo || typeof videoInfo !== 'object') return null;

        if (videoInfo.type === 'youtube') {
            const safeId = this._sanitizeYouTubeId(videoInfo.id);
            return safeId ? { type: 'youtube', id: safeId } : null;
        }

        if (videoInfo.type === 'video') {
            const safeUrl = this._sanitizeVideoURL(videoInfo.url);
            return safeUrl ? { type: 'video', url: safeUrl } : null;
        }

        return null;
    }

    _toBoundedInt(value, fallback, min = 1, max = 10000) {
        const num = Number.parseInt(value, 10);
        if (!Number.isFinite(num)) return fallback;
        return Math.min(max, Math.max(min, num));
    }

    _sanitizePluginHTML(html) {
        return (this.editor && typeof this.editor.sanitizePluginHTML === 'function')
            ? this.editor.sanitizePluginHTML(html, 'video')
            : html;
    }

    _setPluginHTML(target, html, debugLabel = 'video') {
        if (this.editor && typeof this.editor.setPluginHTML === 'function') {
            this.editor.setPluginHTML(target, html, { plugin: 'video', debugLabel });
        } else {
            target.innerHTML = this._sanitizePluginHTML(html);
        }
    }

    _setTrustedStaticHTML(target, html) {
        target.innerHTML = this._sanitizePluginHTML(html);
    }

    _normalizeConfig(data = {}) {
        data = data && typeof data === 'object' ? data : {};
        const fallbackExts = ['mp4', 'webm', 'ogg'];
        const exts = data.extensions || {};
        const accept = data.accept || {};

        const allowedVideoTypes = Array.from(new Set(
            (Array.isArray(exts.video) && exts.video.length ? exts.video : fallbackExts)
                .map(ext => String(ext).toLowerCase().replace(/^\./, '').trim())
                .filter(ext => /^[a-z0-9]{1,10}$/.test(ext))
        ));
        const safeVideoExts = allowedVideoTypes.length ? allowedVideoTypes : fallbackExts;

        const videoAccept = String(accept.video || safeVideoExts.map(ext => `.${ext}`).join(','))
            .split(',')
            .map(v => v.trim())
            .filter(v => /^\.[a-z0-9]{1,10}$/i.test(v) || /^video\/[a-z0-9.+-]+$/i.test(v))
            .join(',') || safeVideoExts.map(ext => `.${ext}`).join(',');

        const safeMimeMap = {};
        const rawMimeMap = data.mimeMap && typeof data.mimeMap === 'object' ? data.mimeMap : {};
        safeVideoExts.forEach(ext => {
            const mapped = String(rawMimeMap[ext] || '').toLowerCase();
            safeMimeMap[ext] = /^video\/[a-z0-9.+-]+$/i.test(mapped) ? mapped : (
                ext === 'webm' ? 'video/webm' :
                ext === 'ogg' || ext === 'ogv' ? 'video/ogg' :
                'video/mp4'
            );
        });

        return {
            allowedVideoTypes: safeVideoExts,
            videoAccept,
            videoMimeMap: safeMimeMap,
            maxUploadSizeMB: this._toBoundedInt(data.maxSizeMB, 50, 1, 1024)
        };
    }

    _insertBlockAtSavedRange(savedRange, videoBlock) {
        if (!videoBlock) return false;

        const selection = window.getSelection();
        if (selection && savedRange) {
            try {
                selection.removeAllRanges();
                selection.addRange(savedRange);
            } catch (_) { /* selection 복구 실패 시 fallback 삽입 */ }
        }

        const currentBlock = savedRange ? this.editor.getClosestBlock(savedRange.startContainer) : null;

        if (currentBlock && currentBlock !== this.editor.editor && currentBlock.parentNode) {
            const topBreak = document.createElement('p');
            if (this.editor.isIOS || this.editor.isSafari) {
                topBreak.appendChild(document.createElement('br'));
            } else {
                topBreak.appendChild(document.createTextNode('\u200B'));
                topBreak.appendChild(document.createElement('br'));
            }

            currentBlock.parentNode.insertBefore(topBreak, currentBlock.nextSibling);
            topBreak.parentNode.insertBefore(videoBlock, topBreak.nextSibling);

            const bottomBreak = document.createElement('p');
            bottomBreak.textContent = '\u200B';
            videoBlock.parentNode.insertBefore(bottomBreak, videoBlock.nextSibling);

            this.cleanupEmptyLines(videoBlock);

            if (selection) {
                const newRange = document.createRange();
                newRange.setStartAfter(bottomBreak);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
            }

            return true;
        }

        // 빈 에디터 또는 selection 이 에디터 루트인 경우에도 반드시 삽입한다.
        const bottomBreak = document.createElement('p');
        bottomBreak.textContent = '\u200B';

        this.editor.editor.appendChild(videoBlock);
        this.editor.editor.appendChild(bottomBreak);

        if (selection) {
            const newRange = document.createRange();
            newRange.setStart(bottomBreak, 0);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
        }

        return true;
    }

    /**
     * window.T2EDITOR_UPLOAD_CONFIG 에서 설정을 읽어 this 에 적용한다.
     * 객체가 없거나 필수 키가 빠진 경우 fallback 값을 설정하고 false 를 반환한다.
     * @returns {boolean} true = 정상 주입됨
     */
    _applyWindowConfig() {
        const cfg = window.T2EDITOR_UPLOAD_CONFIG;
        if (!cfg) {
            const normalized = this._normalizeConfig(null);
            this.allowedVideoTypes = normalized.allowedVideoTypes;
            this.videoAccept = normalized.videoAccept;
            this.videoMimeMap = normalized.videoMimeMap;
            this.maxUploadSizeMB = normalized.maxUploadSizeMB;
            return false;
        }

        const normalized = this._normalizeConfig(cfg);
        this.allowedVideoTypes = normalized.allowedVideoTypes;
        this.videoAccept = normalized.videoAccept;
        this.videoMimeMap = normalized.videoMimeMap;
        this.maxUploadSizeMB = normalized.maxUploadSizeMB;

        this._configReady = true;
        return true;
    }

    /**
     * window 변수가 없을 때 get_upload_config.php 에서 설정을 가져온다.
     * video_config.php · file_config.php 같은 플러그인별 엔드포인트 없이
     * 보안 검증(check_request_origin)이 이미 적용된 공통 엔드포인트를 재사용한다.
     * @returns {Promise<void>}
     */
    _loadConfig() {
        if (this._configReady) return Promise.resolve();
        if (this._configPromise) return this._configPromise;

        this._configPromise = (async () => {
            try {
                console.warn('[T2Video] window.T2EDITOR_UPLOAD_CONFIG 미주입. ' +
                    'editor_lib.php 의 upload_config.php 로드 여부를 확인하세요. ' +
                    'get_upload_config.php 에서 설정을 가져옵니다.');

                const res = await fetch(
                    `${t2editor_url}/config/get_upload_config.php`,
                    { method: 'GET', credentials: 'same-origin' }
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                this._applyServerConfig(await res.json());
                this._configReady = true;
                console.info('[T2Video] get_upload_config.php 에서 설정 로드 완료.');

            } catch (err) {
                console.error('[T2Video] config 로드 실패. fallback 값을 유지합니다.', err);
            }
        })();

        return this._configPromise;
    }

    /**
     * get_upload_config.php 응답(= get_js_config() 구조)을 this 에 적용한다.
     * _applyWindowConfig 와 동일한 키를 사용해 일관성을 보장한다.
     */
    _applyServerConfig(data) {
        const normalized = this._normalizeConfig(data);
        this.allowedVideoTypes = normalized.allowedVideoTypes;
        this.videoAccept = normalized.videoAccept;
        this.videoMimeMap = normalized.videoMimeMap;
        this.maxUploadSizeMB = normalized.maxUploadSizeMB;
    }

    handleCommand(command, button) {
        switch(command) {
            case 'insertYouTube':
                this.insertVideo();
                break;
        }
    }

    onContentSet(html) {
        console.log('Video plugin: onContentSet called');
        setTimeout(() => {
            this.initializeVideoBlocks();
        }, 50);
    }

    insertVideo() {
        const selection = window.getSelection();
        let savedRange = null;

        if (selection && selection.rangeCount > 0) {
            savedRange = selection.getRangeAt(0).cloneRange();
        } else if (this.editor && this.editor.editor) {
            savedRange = document.createRange();
            savedRange.selectNodeContents(this.editor.editor);
            savedRange.collapse(false);
        }

        // [UPLOAD-CONFIG] 설정이 아직 로드 중(window 변수 미주입 → API 호출 진행 중)이면
        // 완료를 기다렸다가 모달을 연다. 이미 완료된 경우 즉시 실행.
        this._loadConfig().then(() => this._openInsertVideoModal(savedRange));
    }

    _openInsertVideoModal(savedRange) {
        // this.allowedVideoTypes : upload_config.php 에서 주입된 확장자 배열
        // this.videoAccept       : <input accept> 속성값
        // 표시용 대문자 목록 (예: "MP4, WebM, Ogg, MOV, ...")
        const extDisplayList = this.allowedVideoTypes.map(e => e.toUpperCase()).join(', ');
        // URL 안내 문자열용 소문자 점 포함 목록 (예: ".mp4, .webm, .ogg, ...")
        const extDotList = this.allowedVideoTypes.map(e => '.' + e).join(', ');
        // [SEC-XSS] 위 두 값은 allowedVideoTypes(서버 주입 영숫자)에서만 생성되므로
        // HTML 삽입 시 별도 이스케이프 불필요. 단, escapeHtml 통과로 방어적 처리.
        const safeExtDisplay = this._escapeHtml(extDisplayList);
        const safeExtDotList = this._escapeHtml(extDotList);
        // accept 속성값: setAttribute 로 설정하므로 template literal 에서 제외
        const safeAccept = this._escapeAttr(this.videoAccept);
        // 최대 크기 — 정수이므로 별도 이스케이프 불필요 (Number() 로 타입 보장)
        const maxSizeMB = Number(this.maxUploadSizeMB) || 50;

        const modalContent = `
            <div class="t2-video-editor-modal">
                <h3>비디오 삽입</h3>
                <div class="t2-video-tabs">
                    <button class="t2-tab active" data-tab="url">동영상 URL</button>
                    <button class="t2-tab" data-tab="upload">파일 업로드</button>
                </div>
                <div class="t2-tab-content">
                    <div class="t2-tab-pane active" data-pane="url">
                        <input type="text" placeholder="동영상 링크 삽입" class="t2-youtube-url">
                        <div class="t2-video-type-info">
                            지원 동영상 유형: 유튜브, 비디오 파일(${safeExtDotList}) 링크
                        </div>
                    </div>
                    <div class="t2-tab-pane" data-pane="upload">
                        <div class="t2-video-upload-area">
                            <span class="material-icons">cloud_upload</span>
                            <div class="t2-video-upload-text">클릭하여 동영상 선택</div>
                            <div class="t2-video-upload-hint">지원 형식: ${safeExtDisplay} (최대 ${maxSizeMB}MB)</div>
                            <input type="file" accept="${safeAccept}" />
                        </div>
                        <div class="t2-video-preview-container"></div>
                        <div class="t2-upload-progress" style="display: none;">
                            <div class="t2-progress-bar">
                                <div class="t2-progress-fill"></div>
                            </div>
                            <div class="t2-progress-text">동영상 업로드 중...</div>
                        </div>
                    </div>
                </div>
                <div class="t2-btn-group">
                    <button class="t2-btn" data-action="cancel">취소</button>
                    <button class="t2-btn" data-action="insert">삽입</button>
                </div>
            </div>
        `;

        const modal = T2Utils.createModal(modalContent);
        this.setupVideoModalEvents(modal, savedRange);
    }

    setupVideoModalEvents(modal, savedRange) {
        const urlInput = modal.querySelector('.t2-youtube-url');
        const fileInput = modal.querySelector('input[type="file"]');
        const uploadArea = modal.querySelector('.t2-video-upload-area');
        const previewContainer = modal.querySelector('.t2-video-preview-container');
        const progressContainer = modal.querySelector('.t2-upload-progress');
        const progressBar = modal.querySelector('.t2-progress-fill');
        const progressText = modal.querySelector('.t2-progress-text');
        const insertBtn = modal.querySelector('[data-action="insert"]');
        if (insertBtn) insertBtn.disabled = true;

        // [FIX-ASPECT-RATIO] uploadedVideoUrl → uploadedVideoData: { url, width, height }
        // handleVideoFileUpload() 가 객체를 반환하므로 치수를 함께 보관한다.
        let uploadedVideoData = null;
        let activeTab = 'url';

        modal.querySelectorAll('.t2-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                modal.querySelectorAll('.t2-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                const targetPane = tab.dataset.tab;
                activeTab = targetPane;
                
                modal.querySelectorAll('.t2-tab-pane').forEach(pane => {
                    pane.classList.remove('active');
                    if (pane.dataset.pane === targetPane) {
                        pane.classList.add('active');
                    }
                });

                if (activeTab === 'url') {
                    insertBtn.disabled = !urlInput.value.trim();
                } else {
                    insertBtn.disabled = !uploadedVideoData;
                }
            });
        });

        urlInput.addEventListener('input', () => {
            insertBtn.disabled = !urlInput.value.trim();
        });

        fileInput.addEventListener('change', async (e) => {
            if (e.target.files.length > 0) {
                const result = await this.handleVideoFileUpload(
                    e.target.files[0], 
                    previewContainer, 
                    progressContainer, 
                    progressBar, 
                    progressText, 
                    insertBtn
                );
                if (result) {
                    uploadedVideoData = result; // { url, width, height }
                }
            }
        });

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-over');
        });

        uploadArea.addEventListener('drop', async (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            
            if (e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                if (this.validateVideoFile(file)) {
                    fileInput.files = e.dataTransfer.files;
                    const result = await this.handleVideoFileUpload(
                        file, 
                        previewContainer, 
                        progressContainer, 
                        progressBar, 
                        progressText, 
                        insertBtn
                    );
                    if (result) {
                        uploadedVideoData = result; // { url, width, height }
                    }
                }
            }
        });

        // [FIX-ASPECT-RATIO] insertVideo → async 함수로 변경.
        // · URL 탭: 직접 비디오 URL(mp4 등)은 _detectVideoDimensions() 로 해상도 감지 후 삽입.
        //           YouTube 는 항상 16:9 이므로 감지 불필요.
        // · 업로드 탭: handleVideoFileUpload() 가 이미 감지한 치수를 uploadedVideoData 에서 꺼냄.
        // 삽입 버튼 비활성화로 중복 클릭 방지.
        const insertVideo = async () => {
            let videoInfo  = null;
            let vidWidth   = null;
            let vidHeight  = null;

            if (activeTab === 'url') {
                const url = urlInput.value.trim();
                videoInfo = T2Utils.getVideoType(url);
                
                if (!videoInfo) {
                    T2Utils.showNotification('올바른 비디오 URL을 입력해주세요.', 'error');
                    return;
                }

                // [FIX-ASPECT-RATIO] 직접 비디오 URL이면 해상도 감지 시도
                if (videoInfo.type === 'video') {
                    insertBtn.disabled = true;
                    insertBtn.textContent = '분석 중…';
                    try {
                        const dims = await this._detectVideoDimensions(videoInfo.url);
                        if (dims) {
                            vidWidth  = dims.width;
                            vidHeight = dims.height;
                        }
                    } catch (_) { /* 감지 실패 → 기본 비율 */ }
                    finally {
                        insertBtn.disabled = false;
                        insertBtn.textContent = '삽입';
                    }
                }
                // YouTube: 항상 16:9 기본값 (vidWidth/vidHeight = null → _normalizeDimensions 기본값)

            } else if (activeTab === 'upload' && uploadedVideoData) {
                videoInfo = { type: 'video', url: uploadedVideoData.url };
                vidWidth  = uploadedVideoData.width;
                vidHeight = uploadedVideoData.height;
            } else {
                T2Utils.showNotification('동영상을 선택해주세요.', 'error');
                return;
            }

            videoInfo = this._sanitizeVideoInfo(videoInfo);
            if (!videoInfo) {
                T2Utils.showNotification('보안 정책상 허용되지 않는 비디오 URL입니다.', 'error');
                return;
            }

            const videoBlock = this.createVideoBlock(videoInfo, vidWidth, vidHeight);
            if (!this._insertBlockAtSavedRange(savedRange, videoBlock)) {
                T2Utils.showNotification('비디오 블록을 삽입하지 못했습니다.', 'error');
                return;
            }

            this.editor.normalizeContent();
            this.editor.createUndoPoint();
            this.editor.autoSave();
            modal.remove();
        };

        modal.querySelector('[data-action="cancel"]').onclick = () => modal.remove();
        modal.querySelector('[data-action="insert"]').onclick = () => insertVideo();
        
        urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                insertVideo();
            }
        });

        urlInput.focus();
    }

    validateVideoFile(file) {
        if (!file || typeof file.name !== 'string') {
            T2Utils.showNotification('올바르지 않은 파일입니다.', 'error');
            return false;
        }

        const fileExt = file.name.toLowerCase().split('.').pop();
        const allowed = Array.isArray(this.allowedVideoTypes) ? this.allowedVideoTypes : [];

        if (!allowed.includes(fileExt)) {
            const extList = allowed.map(e => e.toUpperCase()).join(', ');
            T2Utils.showNotification(`지원되지 않는 동영상 형식입니다. ${extList} 파일만 업로드 가능합니다.`, 'error');
            return false;
        }

        // 확장자와 브라우저 MIME이 명백히 충돌하면 클라이언트에서 선제 차단한다.
        // 일부 OS/브라우저는 file.type 이 비어 있을 수 있으므로 빈 값은 서버 검증에 위임한다.
        const fileType = String(file.type || '').toLowerCase();
        const expectedMime = this.videoMimeMap && this.videoMimeMap[fileExt];
        if (fileType && expectedMime && fileType !== expectedMime && !(fileExt === 'mp4' && fileType === 'video/x-m4v')) {
            T2Utils.showNotification('파일 확장자와 MIME 타입이 일치하지 않습니다.', 'error');
            return false;
        }

        if (file.size > this.maxUploadSizeMB * 1024 * 1024) {
            T2Utils.showNotification(`파일 크기가 너무 큽니다. 최대 ${this.maxUploadSizeMB}MB까지 업로드 가능합니다.`, 'error');
            return false;
        }

        return true;
    }

    async handleVideoFileUpload(file, previewContainer, progressContainer, progressBar, progressText, insertBtn) {
        if (!this.validateVideoFile(file)) {
            return null;
        }

        insertBtn.disabled = true;
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.textContent = '동영상 업로드 중...';

        // [FIX-ASPECT-RATIO] 업로드 전에 로컬 File 객체에서 해상도를 감지한다.
        // blob URL 은 same-origin 이므로 CORS 제약 없이 항상 loadedmetadata 가 발생한다.
        // 업로드 완료를 기다리지 않고 병렬 실행해 UX 지연 최소화.
        let detectedWidth  = null;
        let detectedHeight = null;
        const blobUrl = URL.createObjectURL(file);
        try {
            const dims = await this._detectVideoDimensions(blobUrl);
            if (dims) {
                detectedWidth  = dims.width;
                detectedHeight = dims.height;
                console.info(`[T2Video] 해상도 감지 성공: ${detectedWidth}×${detectedHeight}`);
            }
        } catch (_) { /* 감지 실패 → 기본 비율 사용 */ }
        finally { URL.revokeObjectURL(blobUrl); }

        try {
            const formData = new FormData();
            formData.append('bf_file', file);
            // [FIX] generateUid()는 UUID·hex 등 다양한 형식을 반환할 수 있다.
            // file_upload.php의 uid 검증을 안정적으로 통과하도록 Date.now()를 사용한다.
            // image.js uploadToServer()와 동일한 방식.
            formData.append('uid', String(Date.now()));

            const response = await fetch(`${t2editor_url}/plugin/file/file_upload.php`, {
                method: 'POST',
                body: formData
            });

            // [FIX] response.json() → text().trim().JSON.parse() 로 변경.
            // PHP 워닝·BOM 등 JSON 앞 여분 출력이 있어도 파싱에 성공한다.
            const text = await response.text();
            let data;
            try { data = JSON.parse(text.trim()); }
            catch(e) { throw new Error('서버 응답을 처리할 수 없습니다.'); }
            
            if (data.success) {
                const uploadedUrl = this._sanitizeVideoURL(data && data.file && data.file.url);
                if (!uploadedUrl) {
                    throw new Error('업로드 응답 URL이 보안 정책을 통과하지 못했습니다.');
                }

                progressBar.style.width = '100%';
                progressText.textContent = '업로드 완료';
                const safeUrl  = this._escapeAttr(uploadedUrl);
                const safeName = this._escapeAttr(file.name);
                // [UPLOAD-CONFIG] 미리보기 <source type>: videoMimeMap 에서 대표 MIME 조회.
                // 맵에 없는 확장자는 'video/mp4' 로 폴백 (브라우저가 재판정함).
                const rawExt   = file.name.split('.').pop().toLowerCase();
                const mimeType = (this.videoMimeMap && this.videoMimeMap[rawExt])
                    ? this.videoMimeMap[rawExt]
                    : 'video/mp4';
                const safeMime = this._escapeAttr(mimeType);
                // [SEC-PLUGIN-API] previewContainer.innerHTML 을 core.js 보안 경계(sanitizePluginHTML)로 라우팅.
                // safeUrl/safeName/safeMime 은 이미 escapeHtml 처리됐으나,
                // video 프로필 기반 2차 검증(src 위험 프로토콜 차단, on* 핸들러 제거)을 추가 적용한다.
                const previewHtml = `
                    <div class="t2-video-preview">
                        <video controls style="width: 100%; max-height: 200px;">
                            <source src="${safeUrl}" type="${safeMime}">
                        </video>
                        <div class="t2-video-info">
                            <span class="t2-video-file-name" title="${safeName}">${safeName}</span>
                            <span class="t2-video-file-size">${T2Utils.formatFileSize(file.size)}</span>
                        </div>
                    </div>
                `;
                this._setPluginHTML(previewContainer, previewHtml, 'video:preview');
                
                insertBtn.disabled = false;
                
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                }, 1000);
                
                T2Utils.showNotification('동영상이 성공적으로 업로드되었습니다.', 'success');

                // [FIX-ASPECT-RATIO] url 단독 반환 → { url, width, height } 객체 반환.
                // setupVideoModalEvents 의 insertVideo 핸들러가 치수를 createVideoBlock 에 전달.
                return { url: uploadedUrl, width: detectedWidth, height: detectedHeight };
            } else {
                throw new Error(data.message || '업로드 실패');
            }
        } catch (error) {
            console.error('동영상 업로드 오류:', error);
            T2Utils.showNotification('동영상 업로드 중 오류가 발생했습니다.', 'error');
            insertBtn.disabled = false;
            progressContainer.style.display = 'none';
            return null;
        }
    }

    // ── [플러그인 간 연동 API] ───────────────────────────────────────────────
    // 파일 플러그인 등 외부에서 단일 비디오 파일을 업로드할 때 사용하는 공개 API.
    // UI(모달·프로그레스바) 없이 업로드 → 비디오 블록 DOM 요소를 반환한다.
    // 호출자(파일 플러그인)가 이미 validateFile()을 통과시켰으므로
    // 클라이언트 재검증은 생략하고 서버 validate_upload_file()에 위임한다.
    //
    // 반환값: createVideoBlock()이 생성한 HTMLElement (t2-video-block)
    // 예외:   업로드 실패 시 Error를 throw (호출자가 catch해 사용자에게 알림)
    async uploadVideoFile(file) {
        // [FIX-ASPECT-RATIO] 업로드 전 로컬 File 객체에서 해상도 병렬 감지
        let detectedWidth  = null;
        let detectedHeight = null;
        const blobUrl = URL.createObjectURL(file);
        try {
            const dims = await this._detectVideoDimensions(blobUrl);
            if (dims) {
                detectedWidth  = dims.width;
                detectedHeight = dims.height;
            }
        } catch (_) { /* 감지 실패 → 기본 비율 */ }
        finally { URL.revokeObjectURL(blobUrl); }

        const formData = new FormData();
        formData.append('bf_file', file);
        // image.js uploadToServer()와 동일하게 Date.now()를 사용.
        // generateUid()가 생성하는 UUID/hex 문자열은 file_upload.php의
        // uid 검증 패턴을 통과하지 못하는 경우가 있다.
        formData.append('uid', String(Date.now()));

        const response = await fetch(`${t2editor_url}/plugin/file/file_upload.php`, {
            method: 'POST',
            body: formData
        });

        // PHP 워닝·BOM 대응: text() → trim() → JSON.parse()
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text.trim());
        } catch (e) {
            console.error('[T2Video] 업로드 응답 파싱 실패. 서버 원문:', text.substring(0, 500));
            throw new Error('서버 응답을 처리할 수 없습니다. 콘솔을 확인해주세요.');
        }

        if (!data.success) {
            throw new Error(data.message || '비디오 업로드 실패');
        }

        const uploadedUrl = this._sanitizeVideoURL(data && data.file && data.file.url);
        if (!uploadedUrl) {
            throw new Error('업로드 응답 URL이 보안 정책을 통과하지 못했습니다.');
        }

        // 업로드 성공 → 비디오 블록 DOM 요소 생성 후 반환.
        // 삽입 위치 결정은 호출자(파일 플러그인)가 담당한다.
        return this.createVideoBlock(
            { type: 'video', url: uploadedUrl },
            detectedWidth,
            detectedHeight
        );
    }

    // ── 비디오 실제 해상도 감지 ──────────────────────────────────────────────
    //
    // <video> 엘리먼트의 loadedmetadata 이벤트로 videoWidth / videoHeight 를 읽는다.
    // · File 객체에서 직접 호출 시 → URL.createObjectURL() 로 생성한 임시 URL 전달
    //   (서버 업로드 전에 로컬에서 해상도 감지 → CORS 문제 없음)
    // · 서버 URL 에서 호출 시 → CORS 허용 여부에 따라 실패 가능 → null 반환
    //
    // 타임아웃 8초: 응답 없는 원격 URL 무한 대기 방지
    // 성공: { width, height } 반환 / 실패: null 반환 (createVideoBlock 이 fallback 처리)
    //
    // @param {string} url  video src 로 쓸 URL (blob: 또는 http(s):// 모두 가능)
    // @returns {Promise<{width:number,height:number}|null>}
    _detectVideoDimensions(url) {
        const safeUrl = this._sanitizeVideoURL(url);
        if (!safeUrl) return Promise.resolve(null);

        return new Promise((resolve) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted   = true;
            // DOM에 붙이지 않아도 loadedmetadata 는 발생하지만,
            // 일부 브라우저(Safari)에서 hidden 상태 로딩이 불안정한 경우 대비
            video.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
            document.body.appendChild(video);

            let settled = false;

            const resolve_ = (val) => {
                if (settled) return;
                settled = true;
                // blob URL 메모리 해제는 호출자가 담당 (revokeObjectURL)
                video.src = '';
                video.load();
                video.remove();
                resolve(val);
            };

            const timer = setTimeout(() => {
                console.warn('[T2Video] 해상도 감지 타임아웃:', safeUrl);
                resolve_(null);
            }, 8000);

            video.addEventListener('loadedmetadata', () => {
                clearTimeout(timer);
                const w = video.videoWidth;
                const h = video.videoHeight;
                resolve_((w > 0 && h > 0) ? { width: w, height: h } : null);
            }, { once: true });

            video.addEventListener('error', () => {
                clearTimeout(timer);
                console.warn('[T2Video] 해상도 감지 실패 (에러):', safeUrl);
                resolve_(null);
            }, { once: true });

            video.src = safeUrl;
            video.load();
        });
    }

    // ── 비디오 블록 치수 정규화 ─────────────────────────────────────────────
    //
    // 실제 해상도(rawWidth × rawHeight) 를 에디터 가용 너비에 맞게 스케일 다운하고,
    // 최소 높이(80px) 를 보장한다.
    //
    // · rawWidth / rawHeight 가 유효하지 않으면 기본 16:9(560×315) 반환
    // · editorWidth 기준 초과 시 비율 유지하며 축소
    // · 이미 에디터보다 작으면 원본 크기 그대로 사용
    //
    // @param {number|null} rawWidth   실제 비디오 가로 픽셀
    // @param {number|null} rawHeight  실제 비디오 세로 픽셀
    // @returns {{ width:number, height:number }}
    _normalizeDimensions(rawWidth, rawHeight) {
        const DEFAULT_W = 560;
        const DEFAULT_H = 315;
        const MIN_H     = 80;

        if (!rawWidth || !rawHeight || rawWidth <= 0 || rawHeight <= 0) {
            return { width: DEFAULT_W, height: DEFAULT_H };
        }

        const editorW = this.editor?.editor?.clientWidth || DEFAULT_W;
        // 에디터 너비를 초과하면 축소, 그 이하면 원본 크기 사용
        const finalW  = Math.min(rawWidth, editorW);
        const ratio   = rawHeight / rawWidth;
        const finalH  = Math.max(Math.round(finalW * ratio), MIN_H);

        return { width: Math.round(finalW), height: finalH };
    }

    getVideoIframeUrl(videoInfo) {
        if (videoInfo.type === 'youtube') {
            // [SEC-XSS] YouTube video ID 검증: 영숫자·하이픈·언더스코어만 허용.
            // T2Utils.getVideoType() 이 추출한 ID 라도 추가 검증하여
            // URL 인젝션(예: "ID/../../../evil") 을 차단한다.
            const rawId = String(videoInfo.id || '');
            const safeId = this._sanitizeYouTubeId(rawId);
            if (!safeId) {
                console.warn('[T2Video] 유효하지 않은 YouTube video ID:', rawId);
                return '';
            }
            return `https://www.youtube.com/embed/${safeId}`;
        } else {
            const videoPath = this._sanitizeVideoURL(videoInfo.url);
            return videoPath ? `${t2editor_url}/plugin/video/video_view.php?video=${encodeURIComponent(videoPath)}` : '';
        }
    }

    // @param {object}      videoInfo        { type, id|url }
    // @param {number|null} [detectedWidth]  실제 비디오 가로 (없으면 기본값)
    // @param {number|null} [detectedHeight] 실제 비디오 세로 (없으면 기본값)
    createVideoBlock(videoInfo, detectedWidth = null, detectedHeight = null) {
        videoInfo = this._sanitizeVideoInfo(videoInfo);
        if (!videoInfo) {
            console.warn('[T2Video][SEC] 비디오 URL이 보안 경계를 통과하지 못해 블록 생성을 건너뜁니다.');
            return null;
        }

        // [FIX-ASPECT-RATIO] 실제 해상도가 전달된 경우 에디터 너비 기준으로 정규화.
        // 전달되지 않으면 16:9 기본값(560×315) 사용.
        const { width: defaultWidth, height: defaultHeight } =
            this._normalizeDimensions(detectedWidth, detectedHeight);

        const wrapper = document.createElement('div');
        wrapper.className = 't2-media-block t2-video-block';
        wrapper.contentEditable = false;
        wrapper.style.position = 'relative';
        
        const blockId = this.generateBlockId();
        wrapper.setAttribute('data-block-id', blockId);

        // [FIX-PERSIST] wrapper에 비디오 메타데이터를 중복 기록한다.
        // CMS(Gnuboard5 등) 새니타이저가 iframe/data-* 를 제거해도
        // wrapper 의 data 속성은 div 이므로 살아남아 복구 기준이 된다.
        wrapper.setAttribute('data-t2-block', 'video');
        wrapper.setAttribute('data-video-type', videoInfo.type);
        if (videoInfo.type === 'youtube') {
            wrapper.setAttribute('data-video-id', videoInfo.id || '');
        } else {
            wrapper.setAttribute('data-video-url', videoInfo.url || '');
        }
        
        const videoContainer = document.createElement('div');
        videoContainer.style.width = defaultWidth + 'px';
        videoContainer.style.height = defaultHeight + 'px';
        videoContainer.style.maxWidth = '100%';
        videoContainer.style.margin = '0 auto';
        videoContainer.dataset.width = defaultWidth;
        videoContainer.dataset.height = defaultHeight;
        videoContainer.dataset.originalWidth = defaultWidth;
        videoContainer.dataset.originalHeight = defaultHeight;

        // [FIX-PERSIST] container에도 동일 데이터 기록 (iframe 부모 div 로서 CMS 생존율 높음)
        videoContainer.setAttribute('data-t2-block', 'video');
        videoContainer.setAttribute('data-video-type', videoInfo.type);
        if (videoInfo.type === 'youtube') {
            videoContainer.setAttribute('data-video-id', videoInfo.id || '');
        } else {
            videoContainer.setAttribute('data-video-url', videoInfo.url || '');
        }
        
        const videoElement = document.createElement('iframe');
        const iframeUrl = this.getVideoIframeUrl(videoInfo);
        if (!iframeUrl) return null;
        videoElement.src = iframeUrl;
        videoElement.frameBorder = "0";
        videoElement.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        videoElement.allowFullscreen = true;
        videoElement.style.width = '100%';
        videoElement.style.height = '100%';
        videoElement.style.borderRadius = '15px';
        videoElement.style.border = 'none';

        // [FIX-G5-IFRAME] 직접 업로드 비디오(video_view.php)는 9.1.1과 동일하게
        // sandbox 없이 저장/노출한다. 일부 CMS 필터가 same-origin iframe + sandbox 조합을
        // 비허용 iframe으로 처리해 게시글 보기에서 iframe을 제거하는 케이스를 방지한다.
        // YouTube 등 외부 iframe은 기존 보안 경계를 유지한다.
        if (videoInfo.type === 'youtube') {
            T2Editor._applyIframeSandbox(videoElement, videoElement.getAttribute('src') || videoElement.src);
        } else {
            videoElement.removeAttribute('sandbox');
        }
        
        videoElement.dataset.videoType = videoInfo.type;
        
        if (videoInfo.type === 'youtube') {
            videoElement.dataset.videoId = videoInfo.id;
        } else {
            videoElement.dataset.videoUrl = videoInfo.url;
        }
        
        videoContainer.appendChild(videoElement);

        // [FIX-PERSIST] fallback anchor: 화면에는 숨기되 저장 HTML에 남긴다.
        // CMS가 iframe·data-* 를 모두 제거해도 이 앵커의 href 에서 원본 URL을 복구할 수 있다.
        // · display:none 은 일부 CMS 새니타이저가 함께 제거하므로 사용하지 않는다.
        //   대신 width/height:0 + overflow:hidden + aria-hidden 조합으로 시각적 숨김 처리.
        // · href 값: YouTube = watch URL, video = 원본 파일 URL (절대·상대 모두 가능)
        const fallbackAnchor = document.createElement('a');
        fallbackAnchor.className = 't2-video-source';
        let fallbackHref = '';
        if (videoInfo.type === 'youtube') {
            const safeId = String(videoInfo.id || '').replace(/[^a-zA-Z0-9\-_]/g, '');
            fallbackHref = safeId ? `https://www.youtube.com/watch?v=${safeId}` : '';
        } else {
            fallbackHref = videoInfo.url || '';
        }
        // [SEC-URL] 직접 비디오 URL 은 사용자 입력에서 유래할 수 있으므로
        // href 컨텍스트(javascript:, vbscript:, data: 모두 차단)로 sanitizeURL 검증.
        fallbackAnchor.href = this._sanitizeURL(fallbackHref, 'href') || '';
        fallbackAnchor.setAttribute('aria-hidden', 'true');
        fallbackAnchor.setAttribute('tabindex', '-1');
        fallbackAnchor.style.cssText =
            'position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;';
        videoContainer.appendChild(fallbackAnchor);

        wrapper.appendChild(videoContainer);

        const controls = this.createVideoControls(videoContainer, videoElement, videoInfo, defaultWidth, defaultHeight, blockId);
        wrapper.appendChild(controls);

        const moveControls = this.createMoveControls();
        wrapper.appendChild(moveControls);

        return wrapper;
    }

    createVideoControls(container, videoElement, videoInfo, defaultWidth, defaultHeight, blockId) {
        const controls = document.createElement('div');
        controls.className = 't2-media-controls';
        controls.contentEditable = false;

        defaultWidth = this._toBoundedInt(defaultWidth, 560, 1, 10000);
        defaultHeight = this._toBoundedInt(defaultHeight, 315, 1, 10000);

        const editorWidth = this._toBoundedInt(this.editor.editor.clientWidth, defaultWidth, 1, 10000);
        const maxWidthPercentage = Math.max(30, Math.min(100, Math.floor((editorWidth / defaultWidth) * 100)));
        const isYoutube = videoInfo.type === 'youtube';

        const createIconButton = (className, iconName, hidden = false) => {
            const btn = document.createElement('button');
            btn.className = `t2-btn ${className}`;
            btn.type = 'button';
            if (hidden) btn.style.display = 'none';

            const icon = document.createElement('span');
            icon.className = 'material-icons';
            icon.textContent = iconName;
            btn.appendChild(icon);

            return btn;
        };

        const deleteBtn = createIconButton('delete-btn', 'delete');
        const editBtn = createIconButton(isYoutube ? 'edit-url-btn-youtube' : 'edit-url-btn', 'edit');

        const rangeInput = document.createElement('input');
        rangeInput.type = 'range';
        rangeInput.min = '30';
        rangeInput.max = String(maxWidthPercentage);
        rangeInput.value = String(Math.min(100, maxWidthPercentage));
        rangeInput.className = 'size-slider';
        rangeInput.style.width = '100px';

        controls.append(deleteBtn, editBtn, rangeInput);

        deleteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const mediaBlock = controls.closest('.t2-media-block');
            if (mediaBlock) {
                mediaBlock.remove();
                this.editor.createUndoPoint();
                this.editor.autoSave();
            }
        });

        let isSliding = false;
        let slideTimer = null;

        rangeInput.addEventListener('mousedown', () => { isSliding = true; });
        rangeInput.addEventListener('mouseup',   () => { isSliding = false; });
        rangeInput.addEventListener('touchstart',() => { isSliding = true; }, { passive: true });
        rangeInput.addEventListener('touchend',  () => { isSliding = false; });

        const resizeObserver = new ResizeObserver(() => {
            const newEditorWidth = this._toBoundedInt(this.editor.editor.clientWidth, defaultWidth, 1, 10000);
            const newMaxPercentage = Math.max(30, Math.min(100, Math.floor((newEditorWidth / defaultWidth) * 100)));
            rangeInput.max = String(newMaxPercentage);

            if (parseInt(rangeInput.value, 10) > newMaxPercentage) {
                rangeInput.value = String(newMaxPercentage);
                const newWidth = Math.round((defaultWidth * newMaxPercentage) / 100);
                const newHeight = Math.round((defaultHeight * newMaxPercentage) / 100);

                container.style.width = `${newWidth}px`;
                container.style.height = `${newHeight}px`;
                container.dataset.sliderPercentage = String(newMaxPercentage);
            }
        });

        resizeObserver.observe(this.editor.editor);

        rangeInput.addEventListener('input', (e) => {
            const percentage = this._toBoundedInt(e.target.value, 100, 30, maxWidthPercentage);
            const newWidth = Math.round((defaultWidth * percentage) / 100);
            const newHeight = Math.round((defaultHeight * percentage) / 100);

            container.style.width = `${newWidth}px`;
            container.style.height = `${newHeight}px`;
            container.dataset.sliderPercentage = String(percentage);

            this.editor.createUndoPoint();

            if (isSliding) {
                if (slideTimer) clearTimeout(slideTimer);
                slideTimer = setTimeout(() => {
                    if (this.editor.getPlugin('collab')) {
                        this.editor.getPlugin('collab')._debounceUpdate();
                    }
                }, 300);
            }
        });

        const updateSliderFromDOM = () => {
            const currentPercentage = container.dataset.sliderPercentage;
            if (currentPercentage && parseInt(rangeInput.value, 10) !== parseInt(currentPercentage, 10)) {
                rangeInput.value = currentPercentage;
            }
        };

        const sliderSyncTimer = setInterval(updateSliderFromDOM, 100);
        controls.addEventListener('DOMNodeRemoved', () => clearInterval(sliderSyncTimer), { once: true });

        editBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showVideoUrlEditModal(container, videoElement, videoInfo, blockId);
        });

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

    showVideoUrlEditModal(container, videoElement, currentVideoInfo, blockId) {
        let currentUrl = '';
        if (currentVideoInfo.type === 'youtube') {
            currentUrl = `https://youtube.com/watch?v=${currentVideoInfo.id}`;
        } else {
            currentUrl = currentVideoInfo.url;
        }
        
        // [SEC-XSS] currentUrl을 value 속성 삽입 전 이스케이프
        const safeCurrentUrl = this._escapeAttr(currentUrl);
        // [UPLOAD-CONFIG] 안내 문자열 동적 생성 (insertVideo 모달과 동일 방식)
        const safeExtDotList = this._escapeHtml(this.allowedVideoTypes.map(e => '.' + e).join(', '));
        const modalContent = `
            <div class="t2-video-editor-modal">
                <h3>비디오 URL 수정</h3>
                <input type="text" placeholder="동영상 링크 삽입" class="t2-youtube-url" value="${safeCurrentUrl}">
                <div class="t2-video-type-info">
                    지원 동영상 유형: 유튜브, 비디오 파일(${safeExtDotList}) 링크
                </div>
                <div class="t2-btn-group">
                    <button class="t2-btn" data-action="cancel">취소</button>
                    <button class="t2-btn" data-action="insert">수정</button>
                </div>
            </div>
        `;

        const modal = T2Utils.createModal(modalContent);
        
        const updateVideo = () => {
            const url = modal.querySelector('.t2-youtube-url').value;
            const parsedInfo = T2Utils.getVideoType(url);
            const videoInfo = this._sanitizeVideoInfo(parsedInfo);

            if (!videoInfo) {
                T2Utils.showNotification('올바른 비디오 URL을 입력해주세요.', 'error');
                return;
            }

            const nextSrc = this.getVideoIframeUrl(videoInfo);
            if (!nextSrc) {
                T2Utils.showNotification('보안 정책상 허용되지 않는 비디오 URL입니다.', 'error');
                return;
            }

            const currentWidth = this._toBoundedInt(container.style.width, 560, 1, 10000);
            const currentHeight = this._toBoundedInt(container.style.height, 315, 1, 10000);
            const currentSliderPercentage = container.dataset.sliderPercentage;

            videoElement.src = nextSrc;

            videoElement.dataset.videoType = videoInfo.type;
            const block = container.closest('.t2-video-block') || container.closest('.t2-media-block');
            [block, container].filter(Boolean).forEach(el => {
                el.setAttribute('data-t2-block', 'video');
                el.setAttribute('data-video-type', videoInfo.type);
            });

            if (videoInfo.type === 'youtube') {
                videoElement.dataset.videoId = videoInfo.id;
                delete videoElement.dataset.videoUrl;
                [block, container].filter(Boolean).forEach(el => {
                    el.setAttribute('data-video-id', videoInfo.id);
                    el.removeAttribute('data-video-url');
                });
            } else {
                videoElement.dataset.videoUrl = videoInfo.url;
                delete videoElement.dataset.videoId;
                [block, container].filter(Boolean).forEach(el => {
                    el.setAttribute('data-video-url', videoInfo.url);
                    el.removeAttribute('data-video-id');
                });
            }

            let anchor = container.querySelector('.t2-video-source');
            if (!anchor) {
                anchor = document.createElement('a');
                anchor.className = 't2-video-source';
                anchor.setAttribute('aria-hidden', 'true');
                anchor.setAttribute('tabindex', '-1');
                anchor.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;';
                container.appendChild(anchor);
            }
            anchor.href = videoInfo.type === 'youtube'
                ? `https://www.youtube.com/watch?v=${videoInfo.id}`
                : this._sanitizeURL(videoInfo.url, 'href');

            // [FIX-G5-IFRAME] 직접 업로드 비디오 iframe은 sandbox 없이 유지한다.
            // YouTube 등 외부 iframe만 sandbox를 재적용한다.
            videoElement.removeAttribute('sandbox');
            if (videoInfo.type === 'youtube') {
                T2Editor._applyIframeSandbox(videoElement, videoElement.getAttribute('src') || '');
            }

            container.style.width = currentWidth + 'px';
            container.style.height = currentHeight + 'px';
            if (currentSliderPercentage) {
                container.dataset.sliderPercentage = currentSliderPercentage;
            }

            modal.remove();
            this.editor.createUndoPoint();
            this.editor.autoSave();

            if (this.editor.getPlugin('collab')) {
                this.editor.getPlugin('collab')._debounceUpdate();
            }
        };

        modal.querySelector('[data-action="cancel"]').onclick = () => modal.remove();
        modal.querySelector('[data-action="insert"]').onclick = updateVideo;
        
        modal.querySelector('.t2-youtube-url').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                updateVideo();
            }
        });

        modal.querySelector('.t2-youtube-url').focus();
    }

    cleanupEmptyLines(videoBlock) {
        let prev = videoBlock.previousElementSibling;
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
        
        let next = videoBlock.nextElementSibling;
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

    // ✅ 초기화 메서드 개선
    initializeVideoBlocks() {
        console.log('Initializing video blocks...');
        
        // 1단계: 단독 iframe/video 태그 처리
        this.editor.editor.querySelectorAll('iframe:not(.t2-media-block iframe)').forEach(frame => {
            let videoInfo = null;

            // [FIX] IDL .src(절대 URL)과 content attribute(원본 상대 URL) 모두 시도
            const resolvedSrc = frame.src || '';
            const rawSrc      = frame.getAttribute('src') || '';

            if (resolvedSrc.includes('youtube.com/embed/') || rawSrc.includes('youtube.com/embed/')) {
                const videoId =
                    resolvedSrc.match(/embed\/([^?]+)/)?.[1] ||
                    rawSrc.match(/embed\/([^?]+)/)?.[1];
                if (videoId) {
                    videoInfo = { type: 'youtube', id: videoId };
                }
            }
            else if (resolvedSrc.includes('video_view.php') || rawSrc.includes('video_view.php')) {
                // [FIX] [?&]video= 로 첫 파라미터·중간 파라미터 모두 매칭
                const matchResolved = resolvedSrc.match(/[?&]video=([^&]+)/);
                const matchRaw      = rawSrc.match(/[?&]video=([^&]+)/);
                const encoded = (matchResolved || matchRaw)?.[1] || '';
                if (encoded) {
                    try {
                        const url = decodeURIComponent(encoded);
                        videoInfo = { type: 'video', url };
                    } catch (e) {
                        videoInfo = { type: 'video', url: encoded };
                    }
                }
            }
            
            if (videoInfo) {
                const wrapper = this.createVideoBlock(videoInfo);
                if (wrapper) {
                    frame.parentNode.replaceChild(wrapper, frame);
                    this.cleanupEmptyLines(wrapper);
                } else {
                    frame.remove();
                }
            } else {
                // [SEC-IFRAME-ALLOWLIST] 인식되지 않는 iframe:
                // 허용 도메인이면 sandbox 만 적용, 비허용이면 제거.
                const src = frame.getAttribute('src') || '';
                if (!T2Editor._isAllowedIframeSrc(src)) {
                    console.warn('[T2Video] 비허용 iframe 제거:', src);
                    frame.remove();
                } else if ((/video_view\.php/i).test(src)) {
                    // [FIX-G5-IFRAME] T2 직접 업로드 비디오 iframe은 9.1.1 호환 저장 구조 유지.
                    frame.removeAttribute('sandbox');
                } else if (!frame.hasAttribute('sandbox')) {
                    T2Editor._applyIframeSandbox(frame, src);
                }
            }
        });

        this.editor.editor.querySelectorAll('video:not(.t2-media-block video)').forEach(video => {
            const videoInfo = this._sanitizeVideoInfo({ type: 'video', url: video.getAttribute('src') || video.src });
            const wrapper = this.createVideoBlock(videoInfo);
            if (wrapper) {
                video.parentNode.replaceChild(wrapper, video);
                this.cleanupEmptyLines(wrapper);
            } else {
                video.remove();
            }
        });

        // 2단계: 기존 미디어 블록 재초기화
        this.editor.editor.querySelectorAll('.t2-media-block').forEach(block => {
            const container = block.querySelector('div:first-child');
            const mediaElement = container?.querySelector('iframe, video');
            
            // ── [FIX-PERSIST] URL 복구 우선순위 헬퍼 ─────────────────────────
            // 우선순위: iframe.dataset → wrapper/container data-* → iframe src 파싱
            //           → .t2-video-source[href]
            // 이 순서로 신뢰도가 높은 소스를 먼저 사용한다.
            const _resolveVideoInfo = (currentIframe) => {
                // ── 우선순위 1: iframe.dataset (가장 신뢰) ──────────────────
                if (currentIframe) {
                    const rawSrc      = currentIframe.getAttribute('src') || '';
                    const resolvedSrc = currentIframe.src || '';

                    const isYoutube =
                        currentIframe.dataset.videoType === 'youtube' ||
                        resolvedSrc.includes('youtube.com') ||
                        rawSrc.includes('youtube.com');

                    if (isYoutube) {
                        const videoId =
                            currentIframe.dataset.videoId ||
                            resolvedSrc.match(/embed\/([^?]+)/)?.[1] ||
                            rawSrc.match(/embed\/([^?]+)/)?.[1];
                        if (videoId) {
                            if (!currentIframe.dataset.videoType) currentIframe.dataset.videoType = 'youtube';
                            if (!currentIframe.dataset.videoId)   currentIframe.dataset.videoId   = videoId;
                            return { type: 'youtube', id: videoId };
                        }
                    }

                    // 직접 비디오: data-video-url 또는 src 파싱
                    let videoUrl = currentIframe.dataset.videoUrl || '';
                    if (!videoUrl) {
                        const matchResolved = resolvedSrc.match(/[?&]video=([^&]+)/);
                        const matchRaw      = rawSrc.match(/[?&]video=([^&]+)/);
                        const encoded = (matchResolved || matchRaw)?.[1] || '';
                        if (encoded) {
                            try { videoUrl = decodeURIComponent(encoded); }
                            catch(e) { videoUrl = encoded; }
                        }
                    }
                    if (videoUrl) {
                        if (!currentIframe.dataset.videoType) currentIframe.dataset.videoType = 'video';
                        if (!currentIframe.dataset.videoUrl)  currentIframe.dataset.videoUrl  = videoUrl;
                        return { type: 'video', url: videoUrl };
                    }
                }

                // ── 우선순위 2: wrapper/container data-* ─────────────────────
                for (const el of [block, container].filter(Boolean)) {
                    const vType = el.getAttribute('data-video-type') || el.dataset.videoType;
                    if (vType === 'youtube') {
                        const id = el.getAttribute('data-video-id') || el.dataset.videoId;
                        if (id) return { type: 'youtube', id };
                    } else if (vType === 'video') {
                        const vUrl = el.getAttribute('data-video-url') || el.dataset.videoUrl;
                        if (vUrl) return { type: 'video', url: vUrl };
                    }
                }

                // ── 우선순위 3: .t2-video-source[href] fallback anchor ────────
                const anchor = container?.querySelector('.t2-video-source[href]') ||
                               block.querySelector('.t2-video-source[href]');
                if (anchor) {
                    const href = anchor.getAttribute('href') || '';
                    if (href) {
                        const info = T2Utils.getVideoType(href);
                        if (info) return info;
                    }
                }

                return null;
            };

            // ── iframe이 없는 경우: fallback URL로 iframe 재생성 ───────────────
            if (!mediaElement && container) {
                const videoInfo = _resolveVideoInfo(null);
                if (videoInfo) {
                    console.log('[T2Video] iframe 없음 — fallback으로 재생성:', videoInfo);
                    const newWrapper = this.createVideoBlock(videoInfo);
                    if (newWrapper) {
                        block.parentNode.replaceChild(newWrapper, block);
                        this.cleanupEmptyLines(newWrapper);
                    }
                    return; // forEach 다음 항목으로
                }
                // URL도 없으면 빈 뼈대 방치 방지
                return;
            }

            if (!mediaElement) return;
            
            // video 태그를 iframe으로 변환
            if (mediaElement.tagName === 'VIDEO') {
                const videoInfo = this._sanitizeVideoInfo({ type: 'video', url: mediaElement.getAttribute('src') || mediaElement.src });
                if (!videoInfo) {
                    mediaElement.remove();
                    return;
                }
                const newIframe = document.createElement('iframe');
                const nextSrc = this.getVideoIframeUrl(videoInfo);
                if (!nextSrc) {
                    mediaElement.remove();
                    return;
                }
                newIframe.src = nextSrc;
                newIframe.frameBorder = "0";
                newIframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
                newIframe.allowFullscreen = true;
                newIframe.style.width = '100%';
                newIframe.style.height = '100%';
                newIframe.style.borderRadius = '15px';
                newIframe.style.border = 'none';
                newIframe.dataset.videoType = 'video';
                newIframe.dataset.videoUrl = videoInfo.url;

                // [FIX-G5-IFRAME] video_view.php iframe은 sandbox 없이 유지한다.
                newIframe.removeAttribute('sandbox');
                
                mediaElement.parentNode.replaceChild(newIframe, mediaElement);
            }
            
            // [FIX-G5-IFRAME] 이미 iframe 인 경우에도 직접 업로드 비디오 iframe은 sandbox를 제거한다.
            if (mediaElement.tagName === 'IFRAME') {
                const existingSrc = mediaElement.getAttribute('src') || '';
                if ((/video_view\.php/i).test(existingSrc)) {
                    mediaElement.removeAttribute('sandbox');
                } else if (!mediaElement.hasAttribute('sandbox')) {
                    T2Editor._applyIframeSandbox(mediaElement, existingSrc);
                }
            }
            
            // 블록 설정
            block.contentEditable = false;
            block.style.position = 'relative';
            if (!block.classList.contains('t2-video-block')) {
                block.classList.add('t2-video-block');
            }
            
            // blockId 확인
            if (!block.getAttribute('data-block-id')) {
                block.setAttribute('data-block-id', this.generateBlockId());
            }
            
            // 컨테이너 보정
            if (!container.style.maxWidth) {
                container.style.maxWidth = '100%';
            }
            if (!container.style.margin) {
                container.style.margin = '0 auto';
            }
            
            if (!container.dataset.originalWidth) {
                container.dataset.originalWidth = container.dataset.width || 560;
            }
            if (!container.dataset.originalHeight) {
                container.dataset.originalHeight = container.dataset.height || 315;
            }
            
            // P 태그 안에 있으면 꺼내기
            if (block.parentNode.nodeName === 'P') {
                const p = block.parentNode;
                p.parentNode.insertBefore(block, p);
                p.remove();
            }
            
            // ✅ 컨트롤 재생성
            const existingControls = block.querySelector('.t2-media-controls');
            if (existingControls) {
                existingControls.remove();
            }
            
            const currentIframe = container.querySelector('iframe');
            const videoInfo = this._sanitizeVideoInfo(_resolveVideoInfo(currentIframe));

            if (videoInfo) {
                // [FIX-PERSIST] 복구된 URL을 wrapper/container/fallback에 재기록
                // — 다음 저장 후 수정 시 소실 방지
                block.setAttribute('data-t2-block', 'video');
                block.setAttribute('data-video-type', videoInfo.type);
                container.setAttribute('data-t2-block', 'video');
                container.setAttribute('data-video-type', videoInfo.type);

                if (videoInfo.type === 'youtube') {
                    block.setAttribute('data-video-id', videoInfo.id || '');
                    container.setAttribute('data-video-id', videoInfo.id || '');
                    block.removeAttribute('data-video-url');
                    container.removeAttribute('data-video-url');
                } else {
                    block.setAttribute('data-video-url', videoInfo.url || '');
                    container.setAttribute('data-video-url', videoInfo.url || '');
                    block.removeAttribute('data-video-id');
                    container.removeAttribute('data-video-id');
                }

                // fallback anchor 갱신 (없으면 재생성)
                let anchor = container.querySelector('.t2-video-source');
                if (!anchor) {
                    anchor = document.createElement('a');
                    anchor.className = 't2-video-source';
                    anchor.setAttribute('aria-hidden', 'true');
                    anchor.setAttribute('tabindex', '-1');
                    anchor.style.cssText =
                        'position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;';
                    container.appendChild(anchor);
                }
                if (videoInfo.type === 'youtube') {
                    const safeId = String(videoInfo.id || '').replace(/[^a-zA-Z0-9\-_]/g, '');
                    anchor.href = safeId ? `https://www.youtube.com/watch?v=${safeId}` : '';
                } else {
                    // [SEC-URL] 복구된 직접 비디오 URL 은 저장 HTML에서 유래할 수 있으므로
                    // href 컨텍스트(javascript:, vbscript:, data: 차단)로 sanitizeURL 검증.
                    anchor.href = this._sanitizeURL(videoInfo.url || '', 'href');
                }

                // iframe이 없었다면 여기서 재생성했을 것이므로 currentIframe 재취득
                const activeIframe = container.querySelector('iframe') || currentIframe;

                const width  = parseInt(container.dataset.originalWidth)  || parseInt(container.dataset.width)  || 560;
                const height = parseInt(container.dataset.originalHeight) || parseInt(container.dataset.height) || 315;
                
                const controls = this.createVideoControls(
                    container,
                    activeIframe,
                    videoInfo,
                    width,
                    height,
                    block.getAttribute('data-block-id')
                );
                block.appendChild(controls);
            } else {
                // URL 복구 불가 — 컨트롤 없이 placeholder 상태 유지
                console.warn('[T2Video] URL 복구 실패, placeholder 상태:', block);
            }
            
            // ✅ 이동 버튼 재생성
            const existingMoveControls = block.querySelector('.t2-move-controls');
            if (existingMoveControls) {
                existingMoveControls.remove();
            }
            const moveControls = this.createMoveControls();
            block.appendChild(moveControls);
            
            this.cleanupEmptyLines(block);
        });
        
        console.log('Video blocks initialization complete');
    }

    // ── [SEC-XSS] HTML 특수문자 이스케이프 ───────────────────────────────────
    // file.name / data.file.url 등을 innerHTML에 삽입하기 전 반드시 통과시킨다.
    escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    }

    generateBlockId() {
        return `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

window.T2VideoPlugin = T2VideoPlugin;
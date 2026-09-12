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

    /**
     * window.T2EDITOR_UPLOAD_CONFIG 에서 설정을 읽어 this 에 적용한다.
     * 객체가 없거나 필수 키가 빠진 경우 fallback 값을 설정하고 false 를 반환한다.
     * @returns {boolean} true = 정상 주입됨
     */
    _applyWindowConfig() {
        const cfg = window.T2EDITOR_UPLOAD_CONFIG;
        if (!cfg) return false;

        const exts   = cfg.extensions || {};
        const accept = cfg.accept     || {};

        this.allowedVideoTypes = Array.isArray(exts.video) && exts.video.length
            ? exts.video.slice()
            : ['mp4', 'webm', 'ogg'];

        this.videoAccept = typeof accept.video === 'string' && accept.video
            ? accept.video
            : '.mp4,.webm,.ogg,video/mp4,video/webm,video/ogg';

        this.videoMimeMap = cfg.mimeMap && typeof cfg.mimeMap === 'object'
            ? cfg.mimeMap
            : { mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg' };

        this.maxUploadSizeMB = typeof cfg.maxSizeMB === 'number' && cfg.maxSizeMB > 0
            ? cfg.maxSizeMB
            : 50;

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
        const exts   = data.extensions || {};
        const accept = data.accept     || {};

        if (Array.isArray(exts.video)    && exts.video.length)    this.allowedVideoTypes = exts.video;
        if (typeof accept.video === 'string' && accept.video)      this.videoAccept       = accept.video;
        if (data.mimeMap && typeof data.mimeMap === 'object')      this.videoMimeMap      = data.mimeMap;
        if (typeof data.maxSizeMB === 'number' && data.maxSizeMB > 0) this.maxUploadSizeMB = data.maxSizeMB;
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
        const range = selection.getRangeAt(0);
        const savedRange = range.cloneRange();

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
        const safeExtDisplay = this.escapeHtml(extDisplayList);
        const safeExtDotList = this.escapeHtml(extDotList);
        // accept 속성값: setAttribute 로 설정하므로 template literal 에서 제외
        const safeAccept = this.escapeHtml(this.videoAccept);
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
        
        let uploadedVideoUrl = null;
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
                    insertBtn.disabled = !uploadedVideoUrl;
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
                    uploadedVideoUrl = result;
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
                        uploadedVideoUrl = result;
                    }
                }
            }
        });

        const insertVideo = () => {
            let videoInfo = null;
            
            if (activeTab === 'url') {
                const url = urlInput.value.trim();
                videoInfo = T2Utils.getVideoType(url);
                
                if (!videoInfo) {
                    T2Utils.showNotification('올바른 비디오 URL을 입력해주세요.', 'error');
                    return;
                }
            } else if (activeTab === 'upload' && uploadedVideoUrl) {
                videoInfo = { type: 'video', url: uploadedVideoUrl };
            } else {
                T2Utils.showNotification('동영상을 선택해주세요.', 'error');
                return;
            }

            const videoBlock = this.createVideoBlock(videoInfo);
            
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(savedRange);
            
            const currentBlock = this.editor.getClosestBlock(savedRange.startContainer);
            if (currentBlock && currentBlock !== this.editor.editor) {
                const topBreak = document.createElement('p');
                if (this.editor.isIOS || this.editor.isSafari) {
                    topBreak.innerHTML = '<br>';
                } else {
                    topBreak.innerHTML = '\u200B<br>';
                }
                currentBlock.parentNode.insertBefore(topBreak, currentBlock.nextSibling);
                
                topBreak.parentNode.insertBefore(videoBlock, topBreak.nextSibling);
                
                const bottomBreak = document.createElement('p');
                bottomBreak.textContent = '\u200B';
                videoBlock.parentNode.insertBefore(bottomBreak, videoBlock.nextSibling);
                
                this.cleanupEmptyLines(videoBlock);
                
                const newRange = document.createRange();
                newRange.setStartAfter(bottomBreak);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
            }

            this.editor.normalizeContent();
            this.editor.createUndoPoint();
            this.editor.autoSave();
            modal.remove();
        };

        modal.querySelector('[data-action="cancel"]').onclick = () => modal.remove();
        modal.querySelector('[data-action="insert"]').onclick = insertVideo;
        
        urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                insertVideo();
            }
        });

        urlInput.focus();
    }

    validateVideoFile(file) {
        const fileExt = file.name.toLowerCase().split('.').pop();
        
        if (!this.allowedVideoTypes.includes(fileExt)) {
            // [UPLOAD-CONFIG] 허용 확장자 목록을 동적으로 조합해 에러 메시지에 표시
            const extList = this.allowedVideoTypes.map(e => e.toUpperCase()).join(', ');
            T2Utils.showNotification(`지원되지 않는 동영상 형식입니다. ${extList} 파일만 업로드 가능합니다.`, 'error');
            return false;
        }
        
        // [UPLOAD-CONFIG] 최대 크기를 this.maxUploadSizeMB (upload_config.php 기반) 로 판단
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
                progressBar.style.width = '100%';
                progressText.textContent = '업로드 완료';
                const safeUrl  = this.escapeHtml(data.file.url);
                const safeName = this.escapeHtml(file.name);
                // [UPLOAD-CONFIG] 미리보기 <source type>: videoMimeMap 에서 대표 MIME 조회.
                // 맵에 없는 확장자는 'video/mp4' 로 폴백 (브라우저가 재판정함).
                const rawExt   = file.name.split('.').pop().toLowerCase();
                const mimeType = (this.videoMimeMap && this.videoMimeMap[rawExt])
                    ? this.videoMimeMap[rawExt]
                    : 'video/mp4';
                const safeMime = this.escapeHtml(mimeType);
                previewContainer.innerHTML = `
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
                
                insertBtn.disabled = false;
                
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                }, 1000);
                
                T2Utils.showNotification('동영상이 성공적으로 업로드되었습니다.', 'success');
                
                return data.file.url;
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

        // 업로드 성공 → 비디오 블록 DOM 요소 생성 후 반환.
        // 삽입 위치 결정은 호출자(파일 플러그인)가 담당한다.
        return this.createVideoBlock({ type: 'video', url: data.file.url });
    }

    getVideoIframeUrl(videoInfo) {
        if (videoInfo.type === 'youtube') {
            // [SEC-XSS] YouTube video ID 검증: 영숫자·하이픈·언더스코어만 허용.
            // T2Utils.getVideoType() 이 추출한 ID 라도 추가 검증하여
            // URL 인젝션(예: "ID/../../../evil") 을 차단한다.
            const rawId = String(videoInfo.id || '');
            const safeId = rawId.replace(/[^a-zA-Z0-9\-_]/g, '');
            if (!safeId) {
                console.warn('[T2Video] 유효하지 않은 YouTube video ID:', rawId);
                return '';
            }
            return `https://www.youtube.com/embed/${safeId}`;
        } else {
            const videoPath = videoInfo.url;
            return `${t2editor_url}/plugin/video/video_view.php?video=${encodeURIComponent(videoPath)}`;
        }
    }

    createVideoBlock(videoInfo) {
        const defaultWidth = 560;
        const defaultHeight = 315;

        const wrapper = document.createElement('div');
        wrapper.className = 't2-media-block t2-video-block';
        wrapper.contentEditable = false;
        wrapper.style.position = 'relative';
        
        const blockId = this.generateBlockId();
        wrapper.setAttribute('data-block-id', blockId);
        
        const videoContainer = document.createElement('div');
        videoContainer.style.width = defaultWidth + 'px';
        videoContainer.style.height = defaultHeight + 'px';
        videoContainer.style.maxWidth = '100%';
        videoContainer.style.margin = '0 auto';
        videoContainer.dataset.width = defaultWidth;
        videoContainer.dataset.height = defaultHeight;
        videoContainer.dataset.originalWidth = defaultWidth;
        videoContainer.dataset.originalHeight = defaultHeight;
        
        const videoElement = document.createElement('iframe');
        videoElement.src = this.getVideoIframeUrl(videoInfo);
        videoElement.frameBorder = "0";
        videoElement.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        videoElement.allowFullscreen = true;
        videoElement.style.width = '100%';
        videoElement.style.height = '100%';
        videoElement.style.borderRadius = '15px';
        videoElement.style.border = 'none';

        // [SEC-SANDBOX] iframe sandbox 적용.
        // _applyIframeSandbox() 는 same-origin(video_view.php) 과
        // cross-origin(YouTube 등) 을 자동 구분하여 적절한 토큰을 부여한다.
        T2Editor._applyIframeSandbox(videoElement, videoElement.getAttribute('src') || videoElement.src);
        
        videoElement.dataset.videoType = videoInfo.type;
        
        if (videoInfo.type === 'youtube') {
            videoElement.dataset.videoId = videoInfo.id;
        } else {
            videoElement.dataset.videoUrl = videoInfo.url;
        }
        
        videoContainer.appendChild(videoElement);
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

        const editorWidth = this.editor.editor.clientWidth;
        const maxWidthPercentage = Math.min(100, Math.floor((editorWidth / defaultWidth) * 100));

        const isYoutube = videoInfo.type === 'youtube';

        controls.innerHTML = `
            <button class="t2-btn delete-btn">
                <span class="material-icons">delete</span>
            </button>
            ${!isYoutube ? '<button class="t2-btn edit-url-btn"><span class="material-icons">edit</span></button>' : ''}
            <button class="t2-btn edit-url-btn-youtube" style="${!isYoutube ? 'display:none;' : ''}">
                <span class="material-icons">edit</span>
            </button>
            <input type="range" min="30" max="${maxWidthPercentage}" value="100" class="size-slider" style="width: 100px;">
        `;

        // 삭제 버튼
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
                }
            });
        }

        // 크기 슬라이더
        const rangeInput = controls.querySelector('.size-slider');
        if (rangeInput) {
            let isSliding = false;
            let slideTimer = null;

            rangeInput.addEventListener('mousedown', () => { isSliding = true; });
            rangeInput.addEventListener('mouseup',   () => { isSliding = false; });
            rangeInput.addEventListener('touchstart',() => { isSliding = true; }, { passive: true });
            rangeInput.addEventListener('touchend',  () => { isSliding = false; });

            const resizeObserver = new ResizeObserver(() => {
                const newEditorWidth = this.editor.editor.clientWidth;
                const newMaxPercentage = Math.min(100, Math.floor((newEditorWidth / defaultWidth) * 100));
                rangeInput.max = newMaxPercentage;
                
                if (parseInt(rangeInput.value) > newMaxPercentage) {
                    rangeInput.value = newMaxPercentage;
                    const newWidth = Math.round((defaultWidth * newMaxPercentage) / 100);
                    const newHeight = Math.round((defaultHeight * newMaxPercentage) / 100);
                    
                    container.style.width = `${newWidth}px`;
                    container.style.height = `${newHeight}px`;
                    container.dataset.sliderPercentage = newMaxPercentage;
                }
            });
            
            resizeObserver.observe(this.editor.editor);

            rangeInput.addEventListener('input', (e) => {
                const percentage = parseInt(e.target.value);
                const newWidth = Math.round((defaultWidth * percentage) / 100);
                const newHeight = Math.round((defaultHeight * percentage) / 100);
                
                container.style.width = `${newWidth}px`;
                container.style.height = `${newHeight}px`;
                container.dataset.sliderPercentage = percentage;
                
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
                if (currentPercentage && parseInt(rangeInput.value) !== parseInt(currentPercentage)) {
                    rangeInput.value = currentPercentage;
                }
            };

            setInterval(updateSliderFromDOM, 100);
        }

        const editUrlBtn = controls.querySelector('.edit-url-btn');
        if (editUrlBtn) {
            editUrlBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showVideoUrlEditModal(container, videoElement, videoInfo, blockId);
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
        const safeCurrentUrl = this.escapeHtml(currentUrl);
        // [UPLOAD-CONFIG] 안내 문자열 동적 생성 (insertVideo 모달과 동일 방식)
        const safeExtDotList = this.escapeHtml(this.allowedVideoTypes.map(e => '.' + e).join(', '));
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
            const videoInfo = T2Utils.getVideoType(url);
            
            if (!videoInfo) {
                T2Utils.showNotification('올바른 비디오 URL을 입력해주세요.', 'error');
                return;
            }

            const currentWidth = parseInt(container.style.width);
            const currentHeight = parseInt(container.style.height);
            const currentSliderPercentage = container.dataset.sliderPercentage;

            videoElement.src = this.getVideoIframeUrl(videoInfo);
            
            videoElement.dataset.videoType = videoInfo.type;
            if (videoInfo.type === 'youtube') {
                videoElement.dataset.videoId = videoInfo.id;
                delete videoElement.dataset.videoUrl;
            } else {
                videoElement.dataset.videoUrl = videoInfo.url;
                delete videoElement.dataset.videoId;
            }

            // [SEC-SANDBOX] URL 변경 후 sandbox 재적용 (변경된 출처 기준으로 재판단)
            videoElement.removeAttribute('sandbox');
            T2Editor._applyIframeSandbox(videoElement, videoElement.getAttribute('src') || '');

            container.style.width = currentWidth + 'px';
            container.style.height = currentHeight + 'px';
            container.dataset.sliderPercentage = currentSliderPercentage;

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
                frame.parentNode.replaceChild(wrapper, frame);
                this.cleanupEmptyLines(wrapper);
            } else {
                // [SEC-IFRAME-ALLOWLIST] 인식되지 않는 iframe:
                // 허용 도메인이면 sandbox 만 적용, 비허용이면 제거.
                const src = frame.getAttribute('src') || '';
                if (!T2Editor._isAllowedIframeSrc(src)) {
                    console.warn('[T2Video] 비허용 iframe 제거:', src);
                    frame.remove();
                } else if (!frame.hasAttribute('sandbox')) {
                    T2Editor._applyIframeSandbox(frame, src);
                }
            }
        });

        this.editor.editor.querySelectorAll('video:not(.t2-media-block video)').forEach(video => {
            const videoInfo = { type: 'video', url: video.src };
            const wrapper = this.createVideoBlock(videoInfo);
            video.parentNode.replaceChild(wrapper, video);
            this.cleanupEmptyLines(wrapper);
        });

        // 2단계: 기존 미디어 블록 재초기화
        this.editor.editor.querySelectorAll('.t2-media-block').forEach(block => {
            const container = block.querySelector('div:first-child');
            const mediaElement = container?.querySelector('iframe, video');
            
            if (!mediaElement) return;
            
            // video 태그를 iframe으로 변환
            if (mediaElement.tagName === 'VIDEO') {
                const videoInfo = { type: 'video', url: mediaElement.src };
                const newIframe = document.createElement('iframe');
                newIframe.src = this.getVideoIframeUrl(videoInfo);
                newIframe.frameBorder = "0";
                newIframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
                newIframe.allowFullscreen = true;
                newIframe.style.width = '100%';
                newIframe.style.height = '100%';
                newIframe.style.borderRadius = '15px';
                newIframe.style.border = 'none';
                newIframe.dataset.videoType = 'video';
                newIframe.dataset.videoUrl = videoInfo.url;

                // [SEC-SANDBOX] video_view.php 는 same-origin
                T2Editor._applyIframeSandbox(newIframe, newIframe.getAttribute('src') || '');
                
                mediaElement.parentNode.replaceChild(newIframe, mediaElement);
            }
            
            // [SEC-SANDBOX] 이미 iframe 인 경우에도 sandbox 미설정이면 적용
            if (mediaElement.tagName === 'IFRAME' && !mediaElement.hasAttribute('sandbox')) {
                T2Editor._applyIframeSandbox(mediaElement, mediaElement.getAttribute('src') || '');
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
            if (currentIframe) {
                let videoInfo;

                // [FIX] data-video-type 판별: IDL .src(절대 URL)와 content attribute(원본)
                // 둘 다 확인하여 CMS 새니타이저가 data-* 속성을 제거해도 src로 복원 가능하게 함
                const rawSrc = currentIframe.getAttribute('src') || '';
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
                    videoInfo = { type: 'youtube', id: videoId };

                    // [FIX] 복구된 data 속성 재기록 — 다음 저장 후 수정 시 소실 방지
                    if (!currentIframe.dataset.videoType) currentIframe.dataset.videoType = 'youtube';
                    if (videoId && !currentIframe.dataset.videoId) currentIframe.dataset.videoId = videoId;

                } else {
                    // [FIX] URL 복원 우선순위:
                    //   1) data-video-url (가장 신뢰)
                    //   2) IDL .src (live DOM에서 절대 URL) 파싱
                    //   3) content attribute rawSrc (저장된 원본 상대 URL) 파싱
                    //   → decodeURIComponent 실패 시 빈 문자열 대신 원본 src 유지
                    let videoUrl = currentIframe.dataset.videoUrl || '';

                    if (!videoUrl) {
                        const matchResolved = resolvedSrc.match(/[?&]video=([^&]+)/);
                        const matchRaw      = rawSrc.match(/[?&]video=([^&]+)/);
                        const encoded = (matchResolved || matchRaw)?.[1] || '';
                        if (encoded) {
                            try {
                                videoUrl = decodeURIComponent(encoded);
                            } catch (e) {
                                videoUrl = encoded; // 이중 인코딩 등 예외 시 인코딩된 값 그대로 사용
                            }
                        }
                    }

                    videoInfo = { type: 'video', url: videoUrl };

                    // [FIX] 복구된 data 속성 재기록 — CMS가 data-* 를 제거한 후
                    // 재저장해도 다음 수정 시 src 파싱으로 재복원 가능하도록 보장
                    if (!currentIframe.dataset.videoType) currentIframe.dataset.videoType = 'video';
                    if (videoUrl && !currentIframe.dataset.videoUrl) currentIframe.dataset.videoUrl = videoUrl;
                }
                
                const width = parseInt(container.dataset.originalWidth) || parseInt(container.dataset.width) || 560;
                const height = parseInt(container.dataset.originalHeight) || parseInt(container.dataset.height) || 315;
                
                const controls = this.createVideoControls(
                    container, 
                    currentIframe, 
                    videoInfo, 
                    width, 
                    height, 
                    block.getAttribute('data-block-id')
                );
                block.appendChild(controls);
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
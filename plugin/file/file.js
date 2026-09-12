//Path: T2Editor/plugin/file/file.js

class T2FilePlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['attachFile'];

        // ── [UPLOAD-CONFIG] 허용 확장자·MIME·accept 문자열 ───────────────────
        // 설정 로드는 두 단계로 동작한다.
        //
        // 1단계 (동기): editor_lib.php 가 주입한 window 전역 변수를 읽는다.
        //   주입 성공 → 즉시 사용, API 호출 없음.
        //   주입 실패 → 최소 fallback 으로 초기화 후 _loadConfig() 로 비동기 보완.
        //
        // 2단계 (비동기): window 변수가 없으면 file_config.php 엔드포인트를 호출한다.
        //   API 성공 → 설정 교체 (이후 열리는 모달부터 반영).
        //   API 실패 → fallback 유지, console.error 출력.
        //
        // 이 구조로 editor_lib.php 주입 실패 시에도 올바른 설정이 보장된다.
        // ─────────────────────────────────────────────────────────────────────
        this._configReady = false;  // _loadConfig() 완료 여부
        this._configPromise = null; // 진행 중인 로드 Promise (중복 호출 방지)

        this._applyWindowConfig();  // 1단계: window 변수 동기 적용
        this._loadConfig();         // 2단계: 필요 시 비동기 보완 (fire-and-forget)

        // ── 지연 자기 초기화 ─────────────────────────────────────────────────
        // 이미지 플러그인(priority 0)이 먼저 로드될 때 core.js의 processContentSet이
        // contentSetQueue를 소비해버린다. 파일 플러그인(priority 4)이 로드될 시점엔
        // contentSetQueue가 이미 null이므로 onContentSet이 호출되지 않는다.
        // 따라서 생성자에서 에디터에 콘텐츠가 이미 존재하는지 확인하고,
        // 있으면 직접 initializeFileBlocks()를 실행한다.
        setTimeout(() => {
            if (this.editor.editor && this.editor.editor.innerHTML.trim()) {
                this.initializeFileBlocks();
            }
        }, 50);
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

        this.docExtensions   = Array.isArray(exts.document) && exts.document.length ? exts.document.slice() : ['pdf','txt','doc','docx','xls','xlsx','ppt','pptx','hwp','odt','ods','odp','rtf'];
        this.videoExtensions = Array.isArray(exts.video)    && exts.video.length    ? exts.video.slice()    : ['mp4','webm','ogg','mov','avi','mkv','wmv','flv','m4v'];
        this.audioExtensions = Array.isArray(exts.audio)    && exts.audio.length    ? exts.audio.slice()    : ['mp3','m4a','wav','flac','aac','wma'];
        this.imageExtensions = Array.isArray(exts.image)    && exts.image.length    ? exts.image.slice()    : ['jpg','jpeg','png','gif','webp','bmp'];
        this.otherExtensions = Array.isArray(exts.other)    && exts.other.length    ? exts.other.slice()    : ['zip','rar','7z','tar','gz','bz2','mp3','m4a','wav','flac','aac','wma','json','xml','csv'];
        this.fileAccept      = typeof accept.file === 'string' && accept.file       ? accept.file           : '.pdf,.txt,.doc,.docx,.mp4,.webm,.ogg,.mov,.avi,.mkv,.zip,.rar,.7z,.mp3,.m4a,.wav,.flac,.json,.xml,.csv';
        this.maxUploadSizeMB = typeof cfg.maxSizeMB === 'number' && cfg.maxSizeMB > 0 ? cfg.maxSizeMB      : 50;

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
                console.warn('[T2File] window.T2EDITOR_UPLOAD_CONFIG 미주입. ' +
                    'editor_lib.php 의 upload_config.php 로드 여부를 확인하세요. ' +
                    'get_upload_config.php 에서 설정을 가져옵니다.');

                const res = await fetch(
                    `${t2editor_url}/config/get_upload_config.php`,
                    { method: 'GET', credentials: 'same-origin' }
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                this._applyServerConfig(await res.json());
                this._configReady = true;
                console.info('[T2File] get_upload_config.php 에서 설정 로드 완료.');

            } catch (err) {
                console.error('[T2File] config 로드 실패. fallback 값을 유지합니다.', err);
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

        if (Array.isArray(exts.document) && exts.document.length) this.docExtensions   = exts.document;
        if (Array.isArray(exts.video)    && exts.video.length)    this.videoExtensions  = exts.video;
        if (Array.isArray(exts.audio)    && exts.audio.length)    this.audioExtensions  = exts.audio;
        if (Array.isArray(exts.image)    && exts.image.length)    this.imageExtensions  = exts.image;
        if (Array.isArray(exts.other)    && exts.other.length)    this.otherExtensions  = exts.other;
        if (typeof accept.file === 'string' && accept.file)       this.fileAccept       = accept.file;
        if (typeof data.maxSizeMB === 'number' && data.maxSizeMB > 0) this.maxUploadSizeMB = data.maxSizeMB;
    }

    // ── [FIX] collab.recordChange 안전 호출 헬퍼 ─────────────────────────────
    // this.editor.collab 객체가 존재하더라도 recordChange 가 함수가 아닌 경우
    // "is not a function" TypeError 가 발생한다 (collab 플러그인 로딩 타이밍,
    // 버전 불일치 등). typeof 로 먼저 확인하고, 없으면 createUndoPoint() 로 폴백.
    _recordChange() {
        if (this.editor.collab && typeof this.editor.collab.recordChange === 'function') {
            this.editor.collab.recordChange();
        } else {
            this.editor.createUndoPoint();
        }
    }

    handleCommand(command, button) {
        switch(command) {
            case 'attachFile':
                this.showFileUploadModal();
                break;
        }
    }

    onContentSet(html) {
        setTimeout(() => {
            this.initializeFileBlocks();
        }, 100);
    }

    showFileUploadModal() {
        // [UPLOAD-CONFIG] 설정이 아직 로드 중(window 변수 미주입 → API 호출 진행 중)이면
        // 완료를 기다렸다가 모달을 연다. 이미 완료된 경우 즉시 실행.
        this._loadConfig().then(() => this._openFileUploadModal());
    }

    _openFileUploadModal() {
        const modalContent = `
            <div class="t2-file-editor-modal">
                <h3>파일 첨부</h3>
                <div class="t2-file-upload-area">
                    <span class="material-icons">attach_file</span>
                    <div class="t2-file-upload-text">클릭하여 파일 선택</div>
                    <div class="t2-file-upload-hint">지원 형식: 문서, 비디오, 오디오, 압축 파일<br>최대 ${this.maxUploadSizeMB}MB</div>
                    <input type="file" accept="${this.escapeHtml(this.fileAccept)}" />
                </div>
                <div class="t2-file-preview-grid"></div>
                <div class="t2-upload-progress" style="display: none;">
                    <div class="t2-progress-bar">
                        <div class="t2-progress-fill"></div>
                    </div>
                    <div class="t2-progress-text">파일 업로드 중...</div>
                </div>
                <div class="t2-btn-group">
                    <button class="t2-btn" data-action="cancel">취소</button>
                    <button class="t2-btn" data-action="upload" disabled>첨부</button>
                </div>
            </div>
        `;

        const modal = T2Utils.createModal(modalContent);
        this.setupFileModalEvents(modal);
    }

    getAcceptString() {
        // fileAccept 는 editor_lib.php 주입(window.T2EDITOR_UPLOAD_CONFIG) 또는
        // get_upload_config.php fallback 으로 항상 초기화되어 있으므로 별도 null 체크 불필요.
        return this.fileAccept;
    }

    validateFile(file) {
        const fileExt = file.name.toLowerCase().split('.').pop();

        if (this.imageExtensions.includes(fileExt)) {
            T2Utils.showNotification('이미지 파일은 이미지 버튼을 사용해주세요.', 'warning');
            return false;
        }

        const allAllowedExtensions = [
            ...this.docExtensions,
            ...this.videoExtensions,
            ...this.otherExtensions
        ];

        if (!allAllowedExtensions.includes(fileExt)) {
            T2Utils.showNotification('지원하지 않는 파일 형식입니다.', 'error');
            return false;
        }

        const maxSize = this.maxUploadSizeMB * 1024 * 1024;
        if (file.size > maxSize) {
            T2Utils.showNotification(`파일 크기가 너무 큽니다. (최대 ${this.maxUploadSizeMB}MB)`, 'error');
            return false;
        }

        return true;
    }

    // ── [SEC-XSS] HTML 특수문자 이스케이프 ────────────────────────────────
    // file.name / original_name 을 innerHTML에 삽입하기 전 반드시 통과시킨다.
    escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    }

    detectFileType(filename) {
        const fileExt = filename.toLowerCase().split('.').pop();

        if (this.docExtensions.includes(fileExt))   return 'document';
        if (this.videoExtensions.includes(fileExt)) return 'video';
        if (this.imageExtensions.includes(fileExt)) return 'image';
        if (this.otherExtensions.includes(fileExt)) return 'other';

        return 'unknown';
    }

    setupFileModalEvents(modal) {
        const previewGrid = modal.querySelector('.t2-file-preview-grid');
        const fileInput = modal.querySelector('input[type="file"]');
        const uploadBtn = modal.querySelector('[data-action="upload"]');
        const uploadArea = modal.querySelector('.t2-file-upload-area');
        const progressBar = modal.querySelector('.t2-progress-fill');
        const progressContainer = modal.querySelector('.t2-upload-progress');
        const progressText = modal.querySelector('.t2-progress-text');
        
        let selectedFile = null;

        const handleFile = (file) => {
            if (!this.validateFile(file)) {
                return;
            }

            const fileExt = file.name.toLowerCase().split('.').pop();
            const fileType = this.detectFileType(file.name);
            
            previewGrid.innerHTML = '';
            
            const previewItem = document.createElement('div');
            previewItem.className = 't2-file-preview-item';
            
            if (fileType === 'image') {
                const reader = new FileReader();
                reader.onload = (e) => {
                    previewItem.innerHTML = `
                        <div class="t2-file-preview-image" style="position: relative; width: 100%; height: 100%; overflow: hidden;">
                            <img src="${e.target.result}" style="width: 100%; height: 100%; object-fit: cover;">
                            <div class="t2-file-preview-image-label" style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.7); color: white; padding: 4px 8px; font-size: 12px;">
                                <span class="material-icons" style="font-size: 14px; vertical-align: middle;">image</span>
                                이미지 파일
                            </div>
                        </div>
                        <div class="t2-file-preview-name">${this.escapeHtml(file.name)}</div>
                        <button type="button" class="t2-file-preview-remove">
                            <span class="material-icons">close</span>
                        </button>
                    `;
                    
                    const removeBtn = previewItem.querySelector('.t2-file-preview-remove');
                    removeBtn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        selectedFile = null;
                        previewItem.remove();
                        uploadBtn.disabled = true;
                        fileInput.value = '';
                    };
                };
                reader.readAsDataURL(file);
            } else if (fileType === 'video') {
                previewItem.innerHTML = `
                    <div class="t2-file-preview-icon" style="background-color: #8B5CF6; position: relative;">
                        <span class="material-icons" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 20px;">play_circle</span>
                    </div>
                    <div class="t2-file-preview-name">${this.escapeHtml(file.name)}</div>
                    <button type="button" class="t2-file-preview-remove">
                        <span class="material-icons">close</span>
                    </button>
                `;
            } else {
                const iconColor = this.getFileIconColor(fileExt);
                previewItem.innerHTML = `
                    <div class="t2-file-preview-icon" style="background-color: ${iconColor}"></div>
                    <div class="t2-file-preview-name">${this.escapeHtml(file.name)}</div>
                    <button type="button" class="t2-file-preview-remove">
                        <span class="material-icons">close</span>
                    </button>
                `;
            }

            if (fileType !== 'image') {
                const removeBtn = previewItem.querySelector('.t2-file-preview-remove');
                removeBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectedFile = null;
                    previewItem.remove();
                    uploadBtn.disabled = true;
                    fileInput.value = '';
                };
            }

            selectedFile = file;
            previewGrid.appendChild(previewItem);
            uploadBtn.disabled = false;
        };

        fileInput.onchange = (e) => {
            if (e.target.files.length > 0) {
                handleFile(e.target.files[0]);
            }
        };

        T2Utils.setupDragAndDrop(uploadArea, (files) => {
            if (files.length > 0) {
                handleFile(files[0]);
            }
        });

        modal.querySelector('[data-action="cancel"]').onclick = () => modal.remove();
        
        modal.querySelector('[data-action="upload"]').onclick = async () => {
            if (!selectedFile) return;
            
            const fileType = this.detectFileType(selectedFile.name);
            
            uploadBtn.disabled = true;
            progressContainer.style.display = 'block';
            progressBar.style.width = '0%';
            progressText.textContent = this.getUploadProgressText(fileType);

            // 업로드 실패 시 UI 복원 헬퍼
            const onUploadError = (msg) => {
                T2Utils.showNotification(msg || '파일 업로드 중 오류가 발생했습니다.', 'error');
                uploadBtn.disabled = false;
                progressContainer.style.display = 'none';
            };

            if (fileType === 'image') {
                try {
                    await this.handleImageUpload(selectedFile);
                    progressBar.style.width = '100%';
                    progressText.textContent = '업로드 완료';
                    modal.remove();
                } catch (error) {
                    console.error('Image upload error:', error);
                    onUploadError(error.message);
                }
                return;
            }

            if (fileType === 'video') {
                try {
                    await this.handleVideoUpload(selectedFile);
                    progressBar.style.width = '100%';
                    progressText.textContent = '업로드 완료';
                    modal.remove();
                } catch (error) {
                    console.error('Video upload error:', error);
                    onUploadError(error.message);
                }
                return;
            }

            // ── 문서/기타 파일 업로드 ──────────────────────────────────────

            // [STEP 1] 네트워크 요청 및 JSON 파싱
            // response.json() 대신 text() → trim() → JSON.parse() 를 사용해
            // PHP 워닝·BOM 등 JSON 앞 불필요한 출력으로 인한 파싱 실패를 방지한다.
            let data;
            try {
                const formData = new FormData();
                formData.append('bf_file', selectedFile);
                // [FIX] generateUid() 대신 Date.now() 사용.
                // generateUid()가 반환하는 UUID/hex 형식이 file_upload.php uid 검증을
                // 통과하지 못하는 경우가 있다. image.js uploadToServer()와 동일한 방식.
                formData.append('uid', String(Date.now()));

                const response = await fetch(`${t2editor_url}/plugin/file/file_upload.php`, {
                    method: 'POST',
                    body: formData
                });

                const text = await response.text();
                data = JSON.parse(text.trim());
            } catch (networkOrParseError) {
                console.error('File upload network/parse error:', networkOrParseError);
                onUploadError('서버 응답을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.');
                return;
            }

            // [STEP 2] 서버 응답 확인 — 실패 시 서버 메시지를 그대로 사용자에게 표시
            if (!data.success) {
                console.error('File upload rejected by server:', data.message);
                onUploadError(data.message || '파일 업로드에 실패했습니다.');
                return;
            }

            // [STEP 3] 업로드 성공 — 모달을 먼저 닫고 파일 블록 삽입
            // insertFileBlock(→ insertElementAtCursor)의 selection 오류가
            // 업로드 성공 알림을 막지 않도록 블록 삽입은 별도 try-catch로 보호한다.
            progressBar.style.width = '100%';
            progressText.textContent = '업로드 완료';
            modal.remove();

            try {
                this.insertFileBlock(data.file);
            } catch (insertError) {
                console.error('File block insertion error (non-critical):', insertError);
            }

            this._recordChange();
        };
    }

    getFileIconColor(fileExt) {
        const colors = {
            'zip': '#E8B56F', 'rar': '#E8B56F', '7z': '#E8B56F', 'tar': '#E8B56F', 'gz': '#E8B56F', 'bz2': '#E8B56F',
            'pdf': '#F44336',
            'txt': '#585858', 'rtf': '#585858',
            'doc': '#2196F3', 'docx': '#2196F3',
            'xls': '#4CAF50', 'xlsx': '#4CAF50', 'ods': '#4CAF50',
            'ppt': '#FF9800', 'pptx': '#FF9800', 'odp': '#FF9800',
            'hwp': '#1976D2', 'odt': '#1976D2',
            'mp3': '#9C27B0', 'm4a': '#9C27B0', 'wav': '#9C27B0', 'flac': '#9C27B0', 'aac': '#9C27B0', 'wma': '#9C27B0',
            'mp4': '#8B5CF6', 'webm': '#8B5CF6', 'ogg': '#8B5CF6', 'mov': '#8B5CF6', 'avi': '#8B5CF6', 'mkv': '#8B5CF6', 'wmv': '#8B5CF6', 'flv': '#8B5CF6', 'm4v': '#8B5CF6',
            'json': '#FFC107', 'xml': '#FFC107', 'csv': '#4CAF50'
        };
        return colors[fileExt.toLowerCase()] || '#E8B56F';
    }

    getUploadProgressText(fileType) {
        switch(fileType) {
            case 'image': return '이미지 업로드 중...';
            case 'video': return '비디오 업로드 중...';
            case 'document': return '문서 업로드 중...';
            case 'other': return '파일 업로드 중...';
            default: return '파일 업로드 중...';
        }
    }

    async handleImageUpload(file) {
        const imagePlugin = this.editor.getPlugin('image');
        
        if (imagePlugin) {
            // ── 이미지 플러그인에 완전 위임 ───────────────────────────────────
            // uploadImageFile()은 image.js의 handleMultipleImageInsert()를 래핑한다.
            // NSFW 검사·인라인 미리보기·큐 업로드 등 이미지 플러그인 전체 흐름 적용.
            // 이전에는 존재하지 않는 imagePlugin.uploadImageFile()을 호출해
            // "is not a function" TypeError가 발생했다.
            await imagePlugin.uploadImageFile(file);
        } else {
            // ── 이미지 플러그인 미로드 시 직접 업로드 폴백 ───────────────────
            const formData = new FormData();
            formData.append('bf_file[]', file);
            // [FIX] generateUid() 대신 Date.now() 사용.
            // image.js uploadToServer()와 동일 — UUID 형식이 PHP 검증을 통과 못하는 문제 방지.
            formData.append('uid', String(Date.now()));

            const response = await fetch(`${t2editor_url}/plugin/image/image_upload.php`, {
                method: 'POST',
                body: formData
            });

            const data = JSON.parse((await response.text()).trim());

            if (data.success && data.files && data.files.length > 0) {
                this.insertImageBlock(data.files[0]);
                T2Utils.showNotification('이미지가 성공적으로 업로드되었습니다.', 'success');
            } else {
                throw new Error(data.message || '이미지 업로드 실패');
            }
        }
    }

    // 공통 fetch 헬퍼: text() → trim() → JSON.parse()
    // response.json()은 PHP 워닝·BOM 등 JSON 앞 여분의 출력에 취약하다.
    async _fetchJSON(url, formData) {
        const response = await fetch(url, { method: 'POST', body: formData });
        return JSON.parse((await response.text()).trim());
    }

    async handleVideoUpload(file) {
        const videoPlugin = this.editor.getPlugin('video');

        if (videoPlugin && typeof videoPlugin.uploadVideoFile === 'function') {
            // ── 비디오 플러그인에 완전 위임 ───────────────────────────────────
            // uploadVideoFile()이 서버 업로드 → createVideoBlock()까지 담당.
            // 반환된 HTMLElement를 파일 플러그인의 커서 삽입 로직으로 에디터에 배치한다.
            // 이렇게 하면 비디오 블록 생성 방식이 비디오 플러그인 모달과 100% 동일하다.
            const videoBlock = await videoPlugin.uploadVideoFile(file);
            this.insertElementAtCursor(videoBlock);
            T2Utils.showNotification('비디오가 성공적으로 업로드되었습니다.', 'success');
            this._recordChange();
            return;
        }

        // ── 비디오 플러그인 미로드 시 직접 업로드 폴백 ───────────────────────
        // [FIX] generateUid() 대신 Date.now() 사용 — uid 검증 오류 방지.
        // file_upload.php의 uid 검증이 image_upload.php와 동일하게 수정되었더라도
        // Date.now()가 가장 안전한 방어적 선택이다.
        const formData = new FormData();
        formData.append('bf_file', file);
        formData.append('uid', String(Date.now()));

        const data = await this._fetchJSON(
            `${t2editor_url}/plugin/file/file_upload.php`,
            formData
        );

        if (!data.success) {
            throw new Error(data.message || '비디오 업로드 실패');
        }

        // 비디오 플러그인 없음 → 일반 파일 블록으로 에디터에 삽입
        this.insertFileBlock(data.file);
        T2Utils.showNotification('파일이 성공적으로 업로드되었습니다.', 'success');
        this._recordChange();
    }

    insertElementAtCursor(element) {
        const selection = window.getSelection();
        let currentBlock = null;
        
        // [FIX] selection이 에디터 내부에 있을 때만 사용
        // 모달에 포커스가 있을 때 selection.rangeCount > 0 이어도
        // startContainer가 에디터 밖을 가리킬 수 있으므로 반드시 containment 확인 필요
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (this.editor.editor.contains(range.startContainer)) {
                currentBlock = this.editor.getClosestBlock(range.startContainer);
            }
        }
        
        if (!currentBlock || currentBlock === this.editor.editor) {
            currentBlock = this.editor.editor.lastElementChild;
            if (!currentBlock || currentBlock.tagName !== 'P') {
                currentBlock = document.createElement('p');
                currentBlock.innerHTML = '<br>';
                this.editor.editor.appendChild(currentBlock);
            }
        }

        const topBreak = document.createElement('p');
        topBreak.innerHTML = '<br>';
        currentBlock.parentNode.insertBefore(topBreak, currentBlock.nextSibling);
        
        topBreak.parentNode.insertBefore(element, topBreak.nextSibling);
        
        const bottomBreak = document.createElement('p');
        bottomBreak.innerHTML = '<br>';
        element.parentNode.insertBefore(bottomBreak, element.nextSibling);
        
        this.cleanupEmptyLines(element);

        // [FIX] iOS/Safari: addRange() 호출 전 에디터에 포커스를 명시적으로 부여해야 한다.
        // 모달이나 외부 요소에 포커스가 있을 때 selection.addRange()를 호출하면
        // iOS Safari가 InvalidStateError를 throw하므로 focus() 후 try-catch로 보호한다.
        this.editor.editor.focus();
        try {
            const newRange = document.createRange();
            newRange.setStartAfter(bottomBreak);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
        } catch (selectionError) {
            // 커서 위치 복원 실패는 non-critical — 블록 삽입 자체는 이미 완료됐다
            console.warn('Cursor placement failed (non-critical):', selectionError);
        }

        this.editor.normalizeContent();
        
        this._recordChange();
    }

    cleanupEmptyLines(fileBlock) {
        let prev = fileBlock.previousElementSibling;
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
        
        let next = fileBlock.nextElementSibling;
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

    insertImageBlock(imageInfo) {
        const mediaBlock = document.createElement('div');
        mediaBlock.className = 't2-media-block';
        
        const container = document.createElement('div');
        container.style.width = imageInfo.width + 'px';
        container.style.maxWidth = '100%';
        container.style.margin = '0 auto';
        
        const img = document.createElement('img');
        // [SEC-XSS] core.js / utils.js 보안 경계 준수:
        // img.src 에 직접 할당하기 전 T2Utils.sanitizeURL(url, 'src') 로 검증.
        // 서버 응답 URL 이라도 javascript:, vbscript: 프로토콜을 차단한다.
        // (data: URI 는 'src' 컨텍스트에서 정상 사용 케이스이므로 허용)
        img.src = T2Utils.sanitizeURL(imageInfo.url, 'src') || '';
        img.style.width = '100%';
        img.dataset.width = imageInfo.width;
        img.dataset.height = imageInfo.height;
        
        container.appendChild(img);
        mediaBlock.appendChild(container);
        
        const controls = this.createImageControls(container, img);
        mediaBlock.appendChild(controls);
        
        this.insertElementAtCursor(mediaBlock);
    }

    createImageControls(container, img) {
        const controls = document.createElement('div');
        controls.className = 't2-media-controls';
        controls.contentEditable = false;

        const width = parseInt(img.dataset.width) || parseInt(container.style.width) || 320;
        const height = parseInt(img.dataset.height) || parseInt(container.style.height) || 180;
        
        const editorWidth = this.editor.editor.clientWidth;
        const maxWidthPercentage = Math.min(100, Math.floor((editorWidth / width) * 100));
        const currentWidth = parseInt(container.style.width);
        const percentage = Math.round((currentWidth / width) * 100);

        controls.innerHTML = `
            <button class="t2-btn delete-btn">
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
                    img.style.width = '100%';
                }
            });
            
            resizeObserver.observe(this.editor.editor);

            sizeSlider.addEventListener('input', (e) => {
                const percentage = parseInt(e.target.value);
                const newWidth = Math.round((width * percentage) / 100);
                
                container.style.width = `${newWidth}px`;
                container.style.maxWidth = '100%';
                img.style.width = '100%';
                
                img.dataset.currentWidth = newWidth;
            });
        }

        const deleteBtn = controls.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const mediaBlock = controls.closest('.t2-media-block');
                if (mediaBlock) {
                    mediaBlock.remove();
                    
                    this._recordChange();
                }
            });
        }

        return controls;
    }

    insertFileBlock(fileInfo) {
        const fileBlock = document.createElement('div');
        fileBlock.className = 't2-media-block t2-file-block';
        fileBlock.contentEditable = false;
        fileBlock.style.position = 'relative';
        // CMS 새니타이저가 class 속성을 제거하더라도 data 속성으로 복구 가능하도록 마킹
        fileBlock.dataset.t2Block = 'file';
        
        const date = new Date().toISOString().split('T')[0].replace(/-/g, '.');
        const fileSize = T2Utils.formatFileSize(fileInfo.size);
        const fileExt = fileInfo.original_name.toLowerCase().split('.').pop();
        const isAudioFile = this.audioExtensions.includes(fileExt);
        const isPdfFile = fileExt === 'pdf';
        
        let fileUrl = fileInfo.url;
        if (isPdfFile) {
            const matches = fileUrl.match(/data\/editor\/t2editor_(\d+)\/(.+\.pdf)$/i);
            if (matches) {
                const [, date, filename] = matches;
                fileUrl = t2editor_url + `/plugin/file/pdf_view.php?pdf=${date}/${filename}`;
            }
        }
        
        // [SEC-PLUGIN-DOM] core.js 보안 경계 준수:
        // fileBlock.innerHTML = html 직접 할당 대신 setPluginHTML() 경유.
        // 'file' 프로필 자동 적용:
        //   · on* 이벤트 핸들러 무조건 제거
        //   · href → T2Utils.sanitizeURL(url, 'href')  (javascript:/vbscript:/data: 차단)
        //   · src  → T2Utils.sanitizeURL(url, 'src')   (javascript:/vbscript: 차단)
        //   · audio 허용 (profile.allowAudio = true)
        //   · 다운로드 링크 허용 (profile.allowDownloadLink = true)
        //   · data-* 화이트리스트 적용 (data-file-type, data-file-name 등)
        //
        // escapeHtml()은 텍스트 콘텐츠(파일명, 날짜, 크기)에만 사용하고,
        // href/src 의 위험 프로토콜 검증은 setPluginHTML → sanitizePluginHTML 에 위임한다.
        let fileBlockHTML;
        if (isAudioFile) {
            const safeAudioUrl = this.escapeHtml(fileInfo.url);
            fileBlockHTML = `
                <div class="audio-player">
                    <audio src="${safeAudioUrl}" preload="metadata"></audio>
                </div>
                <a href="${safeAudioUrl}" download style="text-decoration: none; color: inherit;">
                    <div class="audio-file-container">
                        <div class="audio-file-icon"></div>
                        <div class="audio-file-info">
                            <div class="audio-file-name">${this.escapeHtml(fileInfo.original_name)}</div>
                            <div class="audio-file-details">
                                <span>DATE: ${date}</span>
                                <span>Size: ${fileSize}</span>
                                <span class="audio-duration">--:--</span>
                            </div>
                        </div>
                    </div>
                </a>
            `;
        } else {
            fileBlockHTML = `
                <a href="${this.escapeHtml(fileUrl)}" ${!isPdfFile ? 'download' : ''} style="text-decoration: none; color: inherit;">
                    <div class="file-container">
                        <div class="file-icon" style="background-color: ${this.getFileIconColor(fileExt)};"></div>
                        <div class="file-info">
                            <div class="file-name">${this.escapeHtml(fileInfo.original_name)}</div>
                            <div class="file-details">
                                <span>DATE: ${date}&nbsp;</span>
                                <span>Size: ${fileSize}</span>
                            </div>
                        </div>
                    </div>
                </a>
            `;
        }

        this.editor.setPluginHTML(fileBlock, fileBlockHTML, { plugin: 'file' });

        if (isAudioFile) {
            // [NOTE] audio 이벤트 리스너는 setPluginHTML() 이후에 재연결한다.
            // sanitizePluginHTML은 on* HTML 속성만 제거하므로
            // addEventListener 방식의 JS 이벤트 바인딩은 영향 없음.
            const audio = fileBlock.querySelector('audio');
            const durationSpan = fileBlock.querySelector('.audio-duration');

            if (audio && durationSpan) {
                audio.addEventListener('loadedmetadata', () => {
                    const minutes = Math.floor(audio.duration / 60);
                    const seconds = Math.floor(audio.duration % 60);
                    durationSpan.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                });
                audio.addEventListener('error', () => {
                    durationSpan.textContent = '--:--';
                });
            }
        }

        const controls = document.createElement('div');
        controls.className = 't2-media-controls';
        controls.contentEditable = false;
        controls.innerHTML = `
            <button class="t2-btn delete-btn">
                <span class="material-icons">delete</span>
            </button>
        `;

        const deleteBtn = controls.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            fileBlock.remove();
            
            this._recordChange();
        });

        fileBlock.appendChild(controls);

        // 이미지 블록과 동일하게 하단 알약형 이동 바 추가
        const moveControls = this.createMoveControls();
        fileBlock.appendChild(moveControls);

        this.insertElementAtCursor(fileBlock);
    }

    initializeFileBlocks() {
        // ── 파일 블록 탐색 전략 (다중) ─────────────────────────────────────────
        // 이미지 블록이 <img> 태그 자체로 복구되는 것처럼,
        // 파일 블록도 클래스 외 내부 구조(data 속성, 내부 요소)로 식별한다.
        //
        // 탐색 우선순위:
        //   1. .t2-file-block   — 정상 저장된 콘텐츠
        //   2. [data-t2-block="file"] — 신규 저장 방식 (data 속성 마킹)
        //   3. .file-container  — class는 살아있으나 outer div class 손실
        //   4. .audio-file-container / .audio-player — 오디오 파일 블록
        //   5. <a download> 포함 블록 — class 전체 손실 시 구조로 판별
        //   6. <a href*="pdf_view.php"> — PDF 블록 구조 판별
        //
        // 각 탐색에서 '에디터의 직계 자식(또는 조상을 통해 직계 자식이 되는 요소)'을
        // 수집한 후 Set으로 중복을 제거한다.

        const editorEl = this.editor.editor;
        const foundBlocks = new Set();

        const addEditorDirectChild = (el) => {
            if (!el || el === editorEl) return;
            let node = el;
            while (node.parentElement && node.parentElement !== editorEl) {
                node = node.parentElement;
            }
            if (node.parentElement === editorEl) foundBlocks.add(node);
        };

        // 전략 1·2: class / data 속성
        editorEl.querySelectorAll('.t2-file-block, [data-t2-block="file"]')
            .forEach(addEditorDirectChild);

        // 전략 3: 내부 .file-container 클래스
        editorEl.querySelectorAll('.file-container')
            .forEach(el => addEditorDirectChild(el.closest('div') || el));

        // 전략 4: 오디오 블록 내부 클래스
        editorEl.querySelectorAll('.audio-file-container, .audio-player')
            .forEach(el => addEditorDirectChild(el.closest('div') || el));

        // 전략 5: <a download> 를 포함한 블록 (class 전체 손실 시)
        editorEl.querySelectorAll('a[download]').forEach(a => {
            // <p> 또는 <a> 자체가 직계일 수 있으므로 closest block-level ancestor 탐색
            const ancestor = a.closest('div, article, section') || a.parentElement;
            addEditorDirectChild(ancestor);
        });

        // 전략 6: PDF 뷰어 링크 포함 블록
        editorEl.querySelectorAll('a[href*="pdf_view.php"]').forEach(a => {
            const ancestor = a.closest('div, article, section') || a.parentElement;
            addEditorDirectChild(ancestor);
        });

        // 이미 다른 플러그인 블록으로 처리된 요소 제외
        const validBlocks = Array.from(foundBlocks).filter(block => {
            // 이미지·비디오 전용 media-block이 file 내용을 담을 수는 없음
            if (block.classList.contains('t2-video-block')) return false;
            if (block.classList.contains('t2-code-block')) return false;
            if (block.classList.contains('t2-table-wrapper')) return false;
            // <img> 또는 <iframe>만 있고 file-container 없으면 이미지/비디오 블록
            const hasFileContent = block.querySelector(
                '.file-container, .audio-player, .audio-file-container, a[download], a[href*="pdf_view.php"], audio'
            );
            return !!hasFileContent;
        });

        validBlocks.forEach(block => {
            // ── 1. 필수 속성·클래스 복원 ────────────────────────────────────
            block.classList.add('t2-media-block', 't2-file-block');
            block.dataset.t2Block = 'file';
            block.contentEditable = false;
            if (!block.style.position) block.style.position = 'relative';

            // ── 2. <p> 래핑 탈출 ────────────────────────────────────────────
            if (block.parentNode && block.parentNode.nodeName === 'P') {
                const p = block.parentNode;
                p.parentNode.insertBefore(block, p);
                if (!p.textContent.trim() && !p.querySelector('img, iframe, video')) {
                    p.remove();
                }
            }

            // ── 3. 기존 컨트롤 제거 후 재생성 ───────────────────────────────
            // HTML 구조는 남아있지만 JS 이벤트 리스너가 없는 '죽은' 버튼 방지
            const existingControls = block.querySelector('.t2-media-controls');
            if (existingControls) existingControls.remove();

            // ── 4. 오디오 이벤트 리스너 재연결 ──────────────────────────────
            const audio = block.querySelector('audio');
            const durationSpan = block.querySelector('.audio-duration');
            if (audio && durationSpan) {
                const updateDuration = () => {
                    if (audio.duration && isFinite(audio.duration)) {
                        const m = Math.floor(audio.duration / 60);
                        const s = Math.floor(audio.duration % 60);
                        durationSpan.textContent = `${m}:${s.toString().padStart(2, '0')}`;
                    }
                };
                audio.addEventListener('loadedmetadata', updateDuration);
                audio.addEventListener('error', () => { durationSpan.textContent = '--:--'; });
                if (audio.readyState >= 1) updateDuration();
            }

            // ── 5. 새 컨트롤 생성 ────────────────────────────────────────────
            const controls = document.createElement('div');
            controls.className = 't2-media-controls';
            controls.contentEditable = false;
            controls.innerHTML = `
                <button class="t2-btn delete-btn">
                    <span class="material-icons">delete</span>
                </button>
            `;
            controls.querySelector('.delete-btn').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                block.remove();
                this._recordChange();
            });

            block.appendChild(controls);

            // 이미지 블록과 동일하게 하단 알약형 이동 바 복원
            const existingMoveControls = block.querySelector('.t2-move-controls');
            if (existingMoveControls) existingMoveControls.remove();
            const moveControls = this.createMoveControls();
            block.appendChild(moveControls);

            this.cleanupEmptyLines(block);
        });
    }
}

window.T2FilePlugin = T2FilePlugin;
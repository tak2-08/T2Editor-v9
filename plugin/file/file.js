//Path: T2Editor/plugin/file/file.js

class T2FilePlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['attachFile'];
        this.config = null;
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
                    document: ['pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
                    video: ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'],
                    other: ['zip', 'rar', '7z', 'tar', 'gz', 'mp3', 'm4a', 'wav', 'flac']
                },
                acceptStrings: {
                    all: '.pdf,.txt,.doc,.docx,.mp4,.webm,.mp3,.zip'
                }
            };
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
        if (!this.config) {
            T2Utils.showNotification('설정을 불러오는 중입니다. 잠시 후 다시 시도해주세요.', 'warning');
            return;
        }

        const modalContent = `
            <div class="t2-file-editor-modal">
                <h3>파일 첨부</h3>
                <div class="t2-file-upload-area">
                    <span class="material-icons">attach_file</span>
                    <div class="t2-file-upload-text">클릭하여 파일 선택</div>
                    <div class="t2-file-upload-hint">지원 형식: 문서, 비디오, 오디오, 압축 파일<br>최대 ${this.config.maxUploadSize}MB</div>
                    <input type="file" accept="${this.getAcceptString()}" />
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
        if (!this.config) return '';
        
        const allExtensions = [
            ...this.config.allowedExtensions.document,
            ...this.config.allowedExtensions.video,
            ...this.config.allowedExtensions.other
        ];
        
        return allExtensions.map(ext => '.' + ext).join(',');
    }

    validateFile(file) {
        if (!this.config) {
            T2Utils.showNotification('설정을 불러오는 중입니다.', 'warning');
            return false;
        }

        const fileExt = file.name.toLowerCase().split('.').pop();
        
        if (this.config.allowedExtensions.image && this.config.allowedExtensions.image.includes(fileExt)) {
            T2Utils.showNotification('이미지 파일은 이미지 버튼을 사용해주세요.', 'warning');
            return false;
        }
        
        const allAllowedExtensions = [
            ...this.config.allowedExtensions.document,
            ...this.config.allowedExtensions.video,
            ...this.config.allowedExtensions.other
        ];
        
        if (!allAllowedExtensions.includes(fileExt)) {
            T2Utils.showNotification('지원하지 않는 파일 형식입니다.', 'error');
            return false;
        }
        
        const maxSize = this.config.maxUploadSize * 1024 * 1024;
        if (file.size > maxSize) {
            T2Utils.showNotification(`파일 크기가 너무 큽니다. (최대 ${this.config.maxUploadSize}MB)`, 'error');
            return false;
        }
        
        return true;
    }

    detectFileType(filename) {
        const fileExt = filename.toLowerCase().split('.').pop();
        
        if (this.config.allowedExtensions.document.includes(fileExt)) {
            return 'document';
        } else if (this.config.allowedExtensions.video.includes(fileExt)) {
            return 'video';
        } else if (this.config.allowedExtensions.image && this.config.allowedExtensions.image.includes(fileExt)) {
            return 'image';
        } else if (this.config.allowedExtensions.other.includes(fileExt)) {
            return 'other';
        }
        
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
                        <div class="t2-file-preview-name">${file.name}</div>
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
                    <div class="t2-file-preview-name">${file.name}</div>
                    <button type="button" class="t2-file-preview-remove">
                        <span class="material-icons">close</span>
                    </button>
                `;
            } else {
                const iconColor = this.getFileIconColor(fileExt);
                previewItem.innerHTML = `
                    <div class="t2-file-preview-icon" style="background-color: ${iconColor}"></div>
                    <div class="t2-file-preview-name">${file.name}</div>
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

            try {
                if (fileType === 'image') {
                    await this.handleImageUpload(selectedFile);
                    progressBar.style.width = '100%';
                    progressText.textContent = '업로드 완료';
                    modal.remove();
                } else if (fileType === 'video') {
                    await this.handleVideoUpload(selectedFile);
                    progressBar.style.width = '100%';
                    progressText.textContent = '업로드 완료';
                    modal.remove();
                } else {
                    const formData = new FormData();
                    formData.append('bf_file', selectedFile);
                    formData.append('uid', this.editor.generateUid());

                    const response = await fetch(`${t2editor_url}/plugin/file/file_upload.php`, {
                        method: 'POST',
                        body: formData
                    });

                    const data = await response.json();
                    
                    if (data.success) {
                        progressBar.style.width = '100%';
                        progressText.textContent = '업로드 완료';
                        this.insertFileBlock(data.file);
                        modal.remove();
                        
                        if (this.editor.collab) {
                            this.editor.collab.recordChange();
                        } else {
                            this.editor.createUndoPoint();
                        }
                    } else {
                        throw new Error(data.message || '업로드 실패');
                    }
                }
            } catch (error) {
                console.error('File upload error:', error);
                T2Utils.showNotification('파일 업로드 중 오류가 발생했습니다.', 'error');
                uploadBtn.disabled = false;
                progressContainer.style.display = 'none';
            }
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
            await imagePlugin.uploadImageFile(file);
        } else {
            const formData = new FormData();
            formData.append('bf_file[]', file);
            formData.append('uid', this.editor.generateUid());

            const response = await fetch(`${t2editor_url}/plugin/image/image_upload.php`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (data.success && data.files && data.files.length > 0) {
                this.insertImageBlock(data.files[0]);
                T2Utils.showNotification('이미지가 성공적으로 업로드되었습니다.', 'success');
            } else {
                throw new Error(data.message || '이미지 업로드 실패');
            }
        }
    }

    async handleVideoUpload(file) {
        const videoPlugin = this.editor.getPlugin('video');
        
        if (videoPlugin) {
            const formData = new FormData();
            formData.append('bf_file', file);
            formData.append('uid', this.editor.generateUid());

            const response = await fetch(`${t2editor_url}/plugin/file/file_upload.php`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (data.success) {
                const videoBlock = videoPlugin.createVideoBlock({ 
                    type: 'video', 
                    url: data.file.url 
                });
                
                this.insertElementAtCursor(videoBlock);
                
                T2Utils.showNotification('비디오가 성공적으로 업로드되었습니다.', 'success');
                
                if (this.editor.collab) {
                    this.editor.collab.recordChange();
                } else {
                    this.editor.createUndoPoint();
                }
            } else {
                throw new Error(data.message || '비디오 업로드 실패');
            }
        } else {
            const formData = new FormData();
            formData.append('bf_file', file);
            formData.append('uid', this.editor.generateUid());

            const response = await fetch(`${t2editor_url}/plugin/file/file_upload.php`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (data.success) {
                this.insertFileBlock(data.file);
                T2Utils.showNotification('파일이 성공적으로 업로드되었습니다.', 'success');
                
                if (this.editor.collab) {
                    this.editor.collab.recordChange();
                } else {
                    this.editor.createUndoPoint();
                }
            } else {
                throw new Error(data.message || '파일 업로드 실패');
            }
        }
    }

    insertElementAtCursor(element) {
        const selection = window.getSelection();
        let currentBlock = null;
        
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            currentBlock = this.editor.getClosestBlock(range.startContainer);
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
        
        const newRange = document.createRange();
        newRange.setStartAfter(bottomBreak);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);

        this.editor.normalizeContent();
        
        if (this.editor.collab) {
            this.editor.collab.recordChange();
        } else {
            this.editor.createUndoPoint();
        }
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
        img.src = imageInfo.url;
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
                    
                    if (this.editor.collab) {
                        this.editor.collab.recordChange();
                    } else {
                        this.editor.createUndoPoint();
                    }
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
        
        const date = new Date().toISOString().split('T')[0].replace(/-/g, '.');
        const fileSize = T2Utils.formatFileSize(fileInfo.size);
        const fileExt = fileInfo.original_name.toLowerCase().split('.').pop();
        const isAudioFile = ['mp3', 'm4a', 'wav', 'flac', 'aac', 'wma'].includes(fileExt);
        const isPdfFile = fileExt === 'pdf';
        
        let fileUrl = fileInfo.url;
        if (isPdfFile) {
            const matches = fileUrl.match(/data\/editor\/t2editor_(\d+)\/(.+\.pdf)$/i);
            if (matches) {
                const [, date, filename] = matches;
                fileUrl = t2editor_url + `/plugin/file/pdf_view.php?pdf=${date}/${filename}`;
            }
        }
        
        if (isAudioFile) {
            fileBlock.innerHTML = `
                <div class="audio-player">
                    <audio src="${fileInfo.url}" preload="metadata"></audio>
                </div>
                <a href="${fileInfo.url}" download style="text-decoration: none; color: inherit;">
                    <div class="audio-file-container">
                        <div class="audio-file-icon"></div>
                        <div class="audio-file-info">
                            <div class="audio-file-name">${fileInfo.original_name}</div>
                            <div class="audio-file-details">
                                <span>DATE: ${date}</span>
                                <span>Size: ${fileSize}</span>
                                <span class="audio-duration">--:--</span>
                            </div>
                        </div>
                    </div>
                </a>
            `;

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
        } else {
            fileBlock.innerHTML = `
                <a href="${fileUrl}" ${!isPdfFile ? 'download' : ''} style="text-decoration: none; color: inherit;">
                    <div class="file-container">
                        <div class="file-icon" style="background-color: ${this.getFileIconColor(fileExt)};"></div>
                        <div class="file-info">
                            <div class="file-name">${fileInfo.original_name}</div>
                            <div class="file-details">
                                <span>DATE: ${date}&nbsp;</span>
                                <span>Size: ${fileSize}</span>
                            </div>
                        </div>
                    </div>
                </a>
            `;
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
            
            if (this.editor.collab) {
                this.editor.collab.recordChange();
            } else {
                this.editor.createUndoPoint();
            }
        });

        fileBlock.appendChild(controls);
        this.insertElementAtCursor(fileBlock);
    }

    initializeFileBlocks() {
        const fileBlocks = this.editor.editor.querySelectorAll('.t2-file-block');
        
        fileBlocks.forEach(block => {
            if (block.querySelector('.t2-media-controls')) {
                return;
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
                block.remove();
                
                if (this.editor.collab) {
                    this.editor.collab.recordChange();
                } else {
                    this.editor.createUndoPoint();
                }
            });

            block.appendChild(controls);
        });
    }
}

window.T2FilePlugin = T2FilePlugin;
// T2Editor/plugin/clipurl/clipurl.js

class T2ClipurlPlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['createClipUrl'];
        this.apiKey = 'T2ClipUrl2025';
        this.apiEndpoint = 'https://dsclub.kr/api/link/';
        this.lastCursorPosition = null;
        this.currentButton = null;
        this.loadStyles();
    }

    loadStyles() {
        if (document.querySelector('style[data-t2-clipurl-styles]')) return;

        const style = document.createElement('style');
        style.setAttribute('data-t2-clipurl-styles', 'true');
        style.textContent = ``;
        document.head.appendChild(style);
    }

    handleCommand(command, button) {
        if (command === 'createClipUrl') {
            this.saveCursorPosition();
            this.currentButton = button;
            this.showUrlInputDropdown(button);
        }
    }

    saveCursorPosition() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            this.lastCursorPosition = selection.getRangeAt(0).cloneRange();
        }
    }

    showUrlInputDropdown(button) {
        const content = document.createElement('div');
        content.className = 't2-clipurl-dropdown';
        content.innerHTML = `
            <h3>
                <span class="material-icons">link</span>
                T2ClipURL
            </h3>
            <div class="t2-clipurl-input-section">
                <input type="url" 
                       class="t2-clipurl-input" 
                       placeholder="URL을 입력하세요 (예: https://example.com)"
                       autocomplete="off">
            </div>
            <div class="t2-clipurl-buttons">
                <button type="button" class="t2-clipurl-btn" data-action="short">
                    <span class="material-icons" style="font-size: 18px;">short_text</span>
                    단축링크
                </button>
                <button type="button" class="t2-clipurl-btn" data-action="qr">
                    <span class="material-icons" style="font-size: 18px;">qr_code</span>
                    QR코드
                </button>
            </div>
        `;

        this.showDropdown(content, button);

        const input = content.querySelector('.t2-clipurl-input');
        const shortBtn = content.querySelector('[data-action="short"]');
        const qrBtn = content.querySelector('[data-action="qr"]');

        setTimeout(() => input.focus(), 100);

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                shortBtn.click();
            }
        });

        shortBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const url = input.value.trim();
            if (!this.validateUrl(url)) {
                T2Utils.showNotification('올바른 URL을 입력해주세요.', 'error');
                return false;
            }
            shortBtn.disabled = true;
            qrBtn.disabled = true;
            try {
                const data = await this.callAPI(url, 'link');
                content.remove();
                this.showShortLinkResult(url, data, button);
            } catch (error) {
                T2Utils.showNotification('단축링크 생성에 실패했습니다.', 'error');
                shortBtn.disabled = false;
                qrBtn.disabled = false;
            }
            return false;
        };

        qrBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const url = input.value.trim();
            if (!this.validateUrl(url)) {
                T2Utils.showNotification('올바른 URL을 입력해주세요.', 'error');
                return false;
            }
            shortBtn.disabled = true;
            qrBtn.disabled = true;
            try {
                const data = await this.callAPI(url, 'qr');
                content.remove();
                this.showQRCodeResult(url, data, button);
            } catch (error) {
                T2Utils.showNotification('QR코드 생성에 실패했습니다.', 'error');
                shortBtn.disabled = false;
                qrBtn.disabled = false;
            }
            return false;
        };
    }

    showShortLinkResult(originalUrl, data, button) {
        const content = document.createElement('div');
        content.className = 't2-clipurl-dropdown';
        content.innerHTML = `
            <h3>
                <span class="material-icons">link</span>
                T2ClipURL
            </h3>
            <div class="t2-clipurl-result-section">
                <div class="t2-clipurl-label">
                    <span class="material-icons" style="font-size: 16px;">link</span>
                    단축 URL
                </div>
                <div class="t2-clipurl-output-box">${data.short_url}</div>
                <a class="t2-clipurl-edit-link" data-action="edit">
                    <span class="material-icons" style="font-size: 16px;">edit</span>
                    링크 재작성
                </a>
            </div>
            <div class="t2-clipurl-buttons">
                <button type="button" class="t2-clipurl-btn" data-action="regenerate">
                    <span class="material-icons" style="font-size: 18px;">refresh</span>
                    재생성
                </button>
                <button type="button" class="t2-clipurl-btn" data-action="copy">
                    <span class="material-icons" style="font-size: 18px;">content_copy</span>
                    복사
                </button>
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-primary" data-action="insert">
                    <span class="material-icons" style="font-size: 18px;">add</span>
                    추가
                </button>
            </div>
        `;

        this.showDropdown(content, button);

        content.querySelector('[data-action="edit"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            content.remove();
            this.showUrlInputDropdown(button);
            return false;
        };

        content.querySelector('[data-action="regenerate"]').onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const bothData = await this.callAPI(originalUrl, 'both');
                content.remove();
                this.showBothResult(originalUrl, bothData, button);
            } catch (error) {
                T2Utils.showNotification('재생성에 실패했습니다.', 'error');
            }
            return false;
        };

        content.querySelector('[data-action="copy"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            navigator.clipboard.writeText(data.short_url).then(() => {
                T2Utils.showNotification('복사되었습니다.', 'success');
            });
            return false;
        };

        content.querySelector('[data-action="insert"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.insertLink(data.short_url);
            content.remove();
            T2Utils.showNotification('추가되었습니다.', 'success');
            return false;
        };
    }

    showQRCodeResult(originalUrl, data, button) {
        const content = document.createElement('div');
        content.className = 't2-clipurl-dropdown';
        content.innerHTML = `
            <h3>
                <span class="material-icons">link</span>
                T2ClipURL
            </h3>
            <div class="t2-clipurl-result-section">
                <div class="t2-clipurl-label">
                    <span class="material-icons" style="font-size: 16px;">qr_code</span>
                    QR 코드
                </div>
                <img src="${data.qr_code_url}" alt="QR Code" class="t2-clipurl-qr-image" crossorigin="anonymous">
                <a class="t2-clipurl-edit-link" data-action="edit">
                    <span class="material-icons" style="font-size: 16px;">edit</span>
                    링크 재작성
                </a>
            </div>
            <div class="t2-clipurl-buttons">
                <button type="button" class="t2-clipurl-btn" data-action="regenerate">
                    <span class="material-icons" style="font-size: 18px;">refresh</span>
                    재생성
                </button>
                <button type="button" class="t2-clipurl-btn" data-action="download">
                    <span class="material-icons" style="font-size: 18px;">download</span>
                    다운로드
                </button>
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-primary" data-action="insert">
                    <span class="material-icons" style="font-size: 18px;">add</span>
                    추가
                </button>
            </div>
        `;

        this.showDropdown(content, button);

        content.querySelector('[data-action="edit"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            content.remove();
            this.showUrlInputDropdown(button);
            return false;
        };

        content.querySelector('[data-action="regenerate"]').onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const bothData = await this.callAPI(originalUrl, 'both');
                content.remove();
                this.showBothResult(originalUrl, bothData, button);
            } catch (error) {
                T2Utils.showNotification('재생성에 실패했습니다.', 'error');
            }
            return false;
        };

        content.querySelector('[data-action="download"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.downloadQRCode(data.qr_code_url, 'qrcode.png');
            return false;
        };

        content.querySelector('[data-action="insert"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.insertQRImage(data.qr_code_url);
            content.remove();
            T2Utils.showNotification('추가되었습니다.', 'success');
            return false;
        };
    }

    showBothResult(originalUrl, data, button) {
        const content = document.createElement('div');
        content.className = 't2-clipurl-dropdown';
        content.innerHTML = `
            <h3>
                <span class="material-icons">link</span>
                T2ClipURL
            </h3>
            <div class="t2-clipurl-result-section">
                <div class="t2-clipurl-both-layout">
                    <div class="t2-clipurl-qr-col">
                        <div class="t2-clipurl-label">
                            <span class="material-icons" style="font-size: 16px;">qr_code</span>
                            QR 코드
                        </div>
                        <img src="${data.qr_code_url}" alt="QR Code" class="t2-clipurl-qr-image" crossorigin="anonymous">
                        <button type="button" class="t2-clipurl-btn" data-action="download" style="margin-top: 10px; width: 100%;">
                            <span class="material-icons" style="font-size: 18px;">download</span>
                            다운로드
                        </button>
                    </div>
                    <div class="t2-clipurl-link-col">
                        <div>
                            <div class="t2-clipurl-label">
                                <span class="material-icons" style="font-size: 16px;">link</span>
                                단축 URL
                            </div>
                            <div class="t2-clipurl-output-box">${data.short_url}</div>
                        </div>
                        <button type="button" class="t2-clipurl-btn" data-action="copy">
                            <span class="material-icons" style="font-size: 18px;">content_copy</span>
                            복사
                        </button>
                    </div>
                </div>
                <a class="t2-clipurl-edit-link" data-action="edit" style="margin-top: 14px; display: inline-block;">
                    <span class="material-icons" style="font-size: 16px;">edit</span>
                    링크 재작성
                </a>
            </div>
            <div class="t2-clipurl-buttons">
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-primary" data-action="insert-qr">
                    <span class="material-icons" style="font-size: 18px;">add</span>
                    QR 추가
                </button>
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-primary" data-action="insert-link">
                    <span class="material-icons" style="font-size: 18px;">add</span>
                    링크 추가
                </button>
            </div>
        `;

        this.showDropdown(content, button);

        content.querySelector('[data-action="edit"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            content.remove();
            this.showUrlInputDropdown(button);
            return false;
        };

        content.querySelector('[data-action="download"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.downloadQRCode(data.qr_code_url, 'qrcode.png');
            return false;
        };

        content.querySelector('[data-action="copy"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            navigator.clipboard.writeText(data.short_url).then(() => {
                T2Utils.showNotification('복사되었습니다.', 'success');
            });
            return false;
        };

        content.querySelector('[data-action="insert-qr"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.insertQRImage(data.qr_code_url);
            content.remove();
            T2Utils.showNotification('QR코드가 추가되었습니다.', 'success');
            return false;
        };

        content.querySelector('[data-action="insert-link"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.insertLink(data.short_url);
            content.remove();
            T2Utils.showNotification('단축 URL이 추가되었습니다.', 'success');
            return false;
        };
    }

    showDropdown(element, button) {
        const existingDropdown = this.editor.toolbar.querySelector('.t2-clipurl-dropdown');
        if (existingDropdown) existingDropdown.remove();

        const buttonRect = button.getBoundingClientRect();
        const toolbarRect = this.editor.toolbar.getBoundingClientRect();
        const editorRect = this.editor.editor.getBoundingClientRect();
        
        const dropdownContainer = document.createElement('div');
        dropdownContainer.style.cssText = `
            position: absolute;
            top: ${buttonRect.bottom - toolbarRect.top + 5}px;
            left: ${buttonRect.left - toolbarRect.left}px;
            z-index: 10000;
        `;
        
        dropdownContainer.appendChild(element);
        this.editor.toolbar.appendChild(dropdownContainer);
        
        setTimeout(() => {
            const dropdownRect = element.getBoundingClientRect();
            const editorWidth = editorRect.width;
            const maxWidth = Math.min(500, editorWidth - 40);
            
            element.style.maxWidth = maxWidth + 'px';
            element.style.width = maxWidth + 'px';
            
            const updatedRect = element.getBoundingClientRect();
            
            let leftPos = buttonRect.left - toolbarRect.left;
            
            if (updatedRect.right > editorRect.right) {
                leftPos = editorRect.right - toolbarRect.left - updatedRect.width - 10;
            }
            
            if (leftPos < 10) {
                leftPos = 10;
            }
            
            dropdownContainer.style.left = leftPos + 'px';
        }, 0);
        
        const closeHandler = (e) => {
            if (!element.contains(e.target) && !button.contains(e.target)) {
                dropdownContainer.remove();
                document.removeEventListener('mousedown', closeHandler);
            }
        };
        
        setTimeout(() => document.addEventListener('mousedown', closeHandler), 100);
    }

    validateUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    async callAPI(url, type) {
        const formData = new FormData();
        formData.append('api_key', this.apiKey);
        formData.append('url', url);
        formData.append('type', type);

        const response = await fetch(this.apiEndpoint, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'API 요청 실패');

        return data;
    }

    downloadQRCode(url, filename) {
        fetch(url)
            .then(response => response.blob())
            .then(blob => {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
                T2Utils.showNotification('다운로드되었습니다.', 'success');
            })
            .catch(() => T2Utils.showNotification('다운로드에 실패했습니다.', 'error'));
    }

    insertLink(url) {
        let targetBlock = null;

        if (this.lastCursorPosition) {
            try {
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(this.lastCursorPosition);
                targetBlock = this.editor.getClosestBlock(this.lastCursorPosition.startContainer);
            } catch (e) {}
        }

        if (!targetBlock || targetBlock === this.editor.editor) {
            const blocks = this.editor.editor.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6');
            targetBlock = blocks[blocks.length - 1];
            
            if (!targetBlock) {
                targetBlock = document.createElement('p');
                this.editor.editor.appendChild(targetBlock);
            }
        }

        const link = document.createElement('a');
        link.href = url;
        link.textContent = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        if (targetBlock.textContent.trim() === '' || targetBlock.innerHTML === '<br>') {
            targetBlock.innerHTML = '';
            targetBlock.appendChild(link);
        } else {
            targetBlock.appendChild(document.createTextNode(' '));
            targetBlock.appendChild(link);
        }

        const range = document.createRange();
        const selection = window.getSelection();
        range.setStartAfter(link);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);

        this.editor.normalizeContent();
        this.editor.createUndoPoint();
        this.editor.autoSave();
    }

    insertQRImage(qrUrl) {
        const imagePlugin = this.editor.getPlugin('image');
        if (!imagePlugin) {
            T2Utils.showNotification('이미지 플러그인을 찾을 수 없습니다.', 'error');
            return;
        }

        let targetBlock = null;

        if (this.lastCursorPosition) {
            try {
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(this.lastCursorPosition);
                targetBlock = this.editor.getClosestBlock(this.lastCursorPosition.startContainer);
            } catch (e) {}
        }

        if (!targetBlock || targetBlock === this.editor.editor) {
            const blocks = this.editor.editor.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6');
            targetBlock = blocks[blocks.length - 1];
            
            if (!targetBlock) {
                targetBlock = document.createElement('p');
                targetBlock.innerHTML = '<br>';
                this.editor.editor.appendChild(targetBlock);
            }
        }

        const imageData = {
            url: qrUrl,
            width: 300,
            height: 300,
            blockId: imagePlugin.generateBlockId(),
            isUploading: false
        };

        const mediaBlock = imagePlugin.createImageBlock(imageData);
        const topBreak = document.createElement('p');
        topBreak.innerHTML = this.editor.isIOS || this.editor.isSafari ? '<br>' : '\u200B<br>';
        
        targetBlock.parentNode.insertBefore(topBreak, targetBlock.nextSibling);
        topBreak.parentNode.insertBefore(mediaBlock, topBreak.nextSibling);
        
        const bottomBreak = document.createElement('p');
        bottomBreak.textContent = '\u200B';
        mediaBlock.parentNode.insertBefore(bottomBreak, mediaBlock.nextSibling);

        imagePlugin.cleanupEmptyLines(mediaBlock);

        const range = document.createRange();
        const selection = window.getSelection();
        range.setStartAfter(bottomBreak);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);

        this.editor.normalizeContent();
        this.editor.createUndoPoint();
        this.editor.autoSave();
    }
}

window.T2ClipurlPlugin = T2ClipurlPlugin;
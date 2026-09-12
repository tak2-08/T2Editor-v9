// Path: T2Editor/plugin/collab/collab.js
(function(){
'use strict';

function isoNow(){ return (new Date()).toISOString(); }

// [PATCH-JS-1] CSS 선택자 인젝션 방지: blockId/tableId 형식 검증
function isValidDomId(id) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) return false;
    return /^[a-zA-Z0-9_-]+$/.test(id);
}

// [PATCH-JS-2] 서버에서 받은 콘텐츠 기본 검증
const MAX_CONTENT_LENGTH = 1 * 1024 * 1024; // 1MB
function isValidContent(content) {
    return typeof content === 'string' && content.length <= MAX_CONTENT_LENGTH;
}
function generateUUIDv4(){
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const buf = new Uint8Array(16);
        crypto.getRandomValues(buf);
        buf[6] = (buf[6] & 0x0f) | 0x40;
        buf[8] = (buf[8] & 0x3f) | 0x80;
        const toHex = (n)=> (n+0x100).toString(16).substr(1);
        return Array.from(buf).map(toHex).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.+)$/, '$1-$2-$3-$4-$5');
    } else {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
            const r = Math.random()*16|0, v = c==='x'? r : (r&0x3|0x8);
            return v.toString(16);
        });
    }
}

const memoryStorage = {
    data: {},
    getItem(key) { return this.data[key] || null; },
    setItem(key, value) { this.data[key] = value; },
    removeItem(key) { delete this.data[key]; },
    key(index) { const keys = Object.keys(this.data); return keys[index] || null; },
    get length() { return Object.keys(this.data).length; }
};

function getClientId(){
    let id = memoryStorage.getItem('t2_collab_client_id');
    if (!id) { 
        id = generateUUIDv4(); 
        memoryStorage.setItem('t2_collab_client_id', id); 
    }
    return id;
}

function normalizeHTML(html) {
    if (!html) return '';
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    tempDiv.querySelectorAll('p, div').forEach(el => {
        if (!el.innerHTML.trim() || el.innerHTML === '<br>') {
            el.innerHTML = '<br>';
        }
    });
    let cleanedHTML = tempDiv.innerHTML.replace(/(<br\s*\/?>\s*){2,}/gi, '<br>');
    return cleanedHTML;
}

function extractDOMState(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    const domState = {
        mediaBlocks: {},
        codeBlocks: {},
        tables: {}
    };
    
    tempDiv.querySelectorAll('.t2-media-block').forEach(block => {
        const blockId = block.getAttribute('data-block-id');
        // [PATCH-JS-3] 유효하지 않은 blockId는 처리 제외 (CSS 선택자 인젝션 방지)
        if (!blockId || !isValidDomId(blockId)) return;
        
        const container = block.querySelector('div:first-child');
        const mediaElement = container?.querySelector('img, iframe, video');
        
        if (container && mediaElement) {
            const computedStyle = window.getComputedStyle(container);
            const actualWidth = container.style.width || computedStyle.width;
            const actualHeight = container.style.height || computedStyle.height;
            
            const originalWidth = parseInt(mediaElement.dataset.width) || parseInt(container.dataset.originalWidth) || 320;
            const originalHeight = parseInt(mediaElement.dataset.height) || parseInt(container.dataset.originalHeight) || 180;
            
            domState.mediaBlocks[blockId] = {
                containerStyle: {
                    width: actualWidth,
                    height: actualHeight,
                    maxWidth: container.style.maxWidth || computedStyle.maxWidth,
                    margin: container.style.margin || computedStyle.margin
                },
                mediaStyle: {
                    width: mediaElement.style.width || window.getComputedStyle(mediaElement).width,
                    height: mediaElement.style.height || window.getComputedStyle(mediaElement).height
                },
                originalSize: {
                    width: originalWidth,
                    height: originalHeight
                },
                sliderPercentage: Math.round((parseInt(actualWidth) / originalWidth) * 100) || 100
            };
        }
    });
    
    tempDiv.querySelectorAll('.t2-code-block').forEach(block => {
        const codeElement = block.querySelector('code');
        if (codeElement) {
            const blockId = block.getAttribute('data-block-id');
            // [PATCH-JS-4] 유효하지 않은 blockId는 처리 제외
            if (blockId && isValidDomId(blockId)) {
                domState.codeBlocks[blockId] = {
                    content: codeElement.textContent,
                    isPlaceholder: codeElement.classList.contains('code-placeholder')
                };
            }
        }
    });
    
    tempDiv.querySelectorAll('.t2-table-wrapper').forEach(wrapper => {
        const table = wrapper.querySelector('table');
        if (table) {
            const tableId = table.getAttribute('data-table-id');
            // [PATCH-JS-5] 유효하지 않은 tableId는 처리 제외
            if (tableId && isValidDomId(tableId)) {
                domState.tables[tableId] = {
                    isLarge: table.classList.contains('t2-table-large'),
                    hasScroll: !!wrapper.querySelector('.t2-table-scroll-wrapper')
                };
            }
        }
    });
    
    return domState;
}

function applyDOMState(html, domState) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    Object.keys(domState.mediaBlocks || {}).forEach(blockId => {
        // [PATCH-JS-6] blockId CSS 선택자 인젝션 방지
        if (!isValidDomId(blockId)) return;
        const block = tempDiv.querySelector(`[data-block-id="${blockId}"]`);
        if (!block) return;
        
        const container = block.querySelector('div:first-child');
        const mediaElement = container?.querySelector('img, iframe, video');
        const state = domState.mediaBlocks[blockId];
        
        if (container && mediaElement && state) {
            if (state.containerStyle) {
                container.style.width = state.containerStyle.width;
                container.style.height = state.containerStyle.height;
                container.style.maxWidth = state.containerStyle.maxWidth;
                container.style.margin = state.containerStyle.margin;
            }
            
            if (state.mediaStyle) {
                mediaElement.style.width = state.mediaStyle.width;
                mediaElement.style.height = state.mediaStyle.height;
            }
            
            if (state.originalSize) {
                mediaElement.dataset.width = state.originalSize.width;
                mediaElement.dataset.height = state.originalSize.height;
                container.dataset.originalWidth = state.originalSize.width;
                container.dataset.originalHeight = state.originalSize.height;
            }
            
            if (state.sliderPercentage) {
                container.dataset.sliderPercentage = state.sliderPercentage;
            }
        }
    });
    
    Object.keys(domState.codeBlocks || {}).forEach(blockId => {
        // [PATCH-JS-7] blockId CSS 선택자 인젝션 방지
        if (!isValidDomId(blockId)) return;
        const block = tempDiv.querySelector(`[data-block-id="${blockId}"]`);
        if (!block) return;
        
        const codeElement = block.querySelector('code');
        const state = domState.codeBlocks[blockId];
        
        if (codeElement && state) {
            if (!state.isPlaceholder) {
                codeElement.textContent = state.content;
                codeElement.classList.remove('code-placeholder');
            } else {
                codeElement.textContent = '코드를 입력하세요';
                codeElement.classList.add('code-placeholder');
            }
        }
    });
    
    Object.keys(domState.tables || {}).forEach(tableId => {
        // [PATCH-JS-8] tableId CSS 선택자 인젝션 방지
        if (!isValidDomId(tableId)) return;
        const table = tempDiv.querySelector(`[data-table-id="${tableId}"]`);
        if (!table) return;
        
        const wrapper = table.closest('.t2-table-wrapper');
        const state = domState.tables[tableId];
        
        if (wrapper && state) {
            if (state.isLarge) {
                table.classList.add('t2-table-large');
                if (state.hasScroll && !wrapper.querySelector('.t2-table-scroll-wrapper')) {
                    const scrollWrapper = document.createElement('div');
                    scrollWrapper.className = 't2-table-scroll-wrapper';
                    wrapper.insertBefore(scrollWrapper, table);
                    scrollWrapper.appendChild(table);
                }
            } else {
                table.classList.remove('t2-table-large');
                const scrollWrapper = wrapper.querySelector('.t2-table-scroll-wrapper');
                if (scrollWrapper) {
                    scrollWrapper.parentNode.insertBefore(table, scrollWrapper);
                    scrollWrapper.remove();
                }
            }
        }
    });
    
    return tempDiv.innerHTML;
}

function hasRealChange(prevHTML, currHTML, prevDOMState, currDOMState) {
    const prevNorm = normalizeHTML(prevHTML || '');
    const currNorm = normalizeHTML(currHTML || '');
    const prevDOMStr = JSON.stringify(prevDOMState || {});
    const currDOMStr = JSON.stringify(currDOMState || {});
    return prevNorm !== currNorm || prevDOMStr !== currDOMStr;
}

async function postAction(t2url, action, body, retries = 3) {
    const url = t2url + '/plugin/collab/collab_number.php';
    
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify(Object.assign({}, body, { action }))
            });
            
            if (!resp.ok) {
                if (attempt < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
                    continue;
                }
                throw new Error('HTTP ' + resp.status);
            }
            
            return await resp.json();
        } catch(e) {
            console.error(`postAction error (attempt ${attempt + 1}/${retries}):`, e);
            if (attempt < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
            } else {
                return null;
            }
        }
    }
    
    return null;
}

function sendHostDeleteBeacon(t2url, code, host_token) {
    try {
        if (!code || !host_token) {
            console.error('[Collab] Missing params for delete beacon');
            return false;
        }

        const url = t2url + '/plugin/collab/collab_number_delete.php';
        const payload = JSON.stringify({
            code: code,
            host_token: host_token,
            timestamp: Date.now()
        });

        // [PATCH-JS-20] 방 코드·토큰 등 민감 정보를 콘솔에 노출하지 않음
        if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            const ok = navigator.sendBeacon(url, blob);
            if (ok) return true;
        }

        if (typeof fetch === 'function') {
            fetch(url, {
                method: 'POST',
                body: payload,
                headers: {'Content-Type': 'application/json'},
                keepalive: true,
                mode: 'no-cors'
            }).catch(e => console.error('[Collab] Fetch keepalive error:', e));
            return true;
        }

        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(payload);
            return true;
        } catch(e) {
            console.error('Sync XHR error:', e);
            return false;
        }
    } catch(e) {
        console.error('sendHostDeleteBeacon error:', e);
        return false;
    }
}

class T2CollabPlugin {
    constructor(editor) {
        this.editor = editor;
        this.container = editor.container || document;
        this.toolbarBtn = this.container.querySelector('[data-command="collab"]');
        this.client_id = getClientId();
        this.collabCode = null;
        this.nickname = null;
        this.hostToken = null;
        this.isHost = false;
        this.t2url = (typeof t2editor_url !== 'undefined') ? t2editor_url : '';
        // [PATCH-JS-10] t2url이 http(s)://로 시작하지 않으면 same-origin 상대경로로 강제
        if (this.t2url && !/^https?:\/\//i.test(this.t2url) && !this.t2url.startsWith('/')) {
            console.warn('[Collab] t2editor_url 형식이 올바르지 않아 초기화합니다.');
            this.t2url = '';
        }
        
        this.pollInterval = 3000;
        this.debounceMs = 1500;
        
        this._pollTimer = null;
        this._debounceTimer = null;
        
        this.localBaseContent = '';
        this.localBaseDOMState = {};
        this.localCurrentContent = '';
        this.localCurrentDOMState = {};
        this.knownServerVersion = 0;
        
        this.isLocallyEditing = false;
        this.lastLocalEditTime = 0;
        this.localEditProtectionMs = 3000;
        
        this.pendingServerUpdates = [];
        
        this._mutationObserver = null;
        this._inputHandler = null;
        this._unloadHandler = null;
        this._isUpdating = false;
        this._isSyncing = false;
        
        this._updateQueue = [];
        this._isProcessingQueue = false;
        
        this.commands = ['collab'];
        
        console.log('[Collab] Plugin initialized with improved sync');
        this.init();
    }

    init() {
        if (!this.toolbarBtn) {
            console.error('[Collab] Button not found');
            return;
        }
        
        const state = this._loadRoomState();
        if (state && state.code) {
            this.collabCode = state.code;
            this.nickname = state.nickname || '';
            this.hostToken = state.hostToken || null;
            this.isHost = !!state.isHost;
            setTimeout(()=>this._initialSync(), 50);
            if (this.isHost) this._installHostUnloadHandler();
        }
    }

    async handleCommand(command, button) {
        if (command === 'collab') {
            const verification = await this._verifyCollabEnvironment();
            if (!verification.success) {
                this._showVerificationError(verification);
                return;
            }
            this.openModal();
        }
    }

    async _verifyCollabEnvironment() {
        try {
            const url = this.t2url + '/plugin/collab/collab_verification.php?verify=1';
            const response = await fetch(url);
            const result = await response.json();
            return result;
        } catch (error) {
            console.error('[Collab] Environment verification failed:', error);
            return {
                success: false,
                error: '검증 요청 실패: ' + error.message,
                steps: ['⚠ 검증 요청 실패']
            };
        }
    }

    _showVerificationError(verification) {
        let errorMessage = '⚠ 협업 기능을 사용할 수 없는 환경입니다.\n\n';
        if (verification.error) {
            errorMessage += verification.error;
        } else {
            errorMessage += '알 수 없는 오류가 발생했습니다.';
        }
        alert(errorMessage);
        console.error('[Collab] Environment verification failed:', verification);
    }

    _roomKey(code){ return `t2_collab_room_${code}`; }
    
    _saveRoomState(){ 
        if (!this.collabCode) return; 
        try { 
            memoryStorage.setItem(this._roomKey(this.collabCode), JSON.stringify({
                code:this.collabCode,
                nickname:this.nickname,
                hostToken:this.hostToken,
                isHost:this.isHost
            })); 
        } catch(e){
            console.error('[Collab] Save room state error:', e);
        } 
    }
    
    _loadRoomState(){ 
        try { 
            for (let i=0; i < memoryStorage.length; i++){ 
                const k = memoryStorage.key(i); 
                if (!k) continue; 
                if (k.startsWith('t2_collab_room_')) { 
                    const v = memoryStorage.getItem(k); 
                    if (!v) continue; 
                    try { return JSON.parse(v); } catch(e){} 
                } 
            } 
        } catch(e){} 
        return null; 
    }
    
    _clearRoomState(){ 
        if (!this.collabCode) return; 
        try { 
            memoryStorage.removeItem(this._roomKey(this.collabCode)); 
        } catch(e){} 
    }

    // [PATCH-JS-A] _initialSync: get 요청에 host_token도 포함
    //   서버의 get 액션이 인가 검사를 수행하므로,
    //   호스트인 경우 host_token을, 일반 사용자는 client_id를 전송한다.
    async _initialSync() {
        if (!this.collabCode) return;
        console.log('[Collab] Initial sync for room:', this.collabCode);
        
        const resp = await postAction(this.t2url, 'get', { 
            code: this.collabCode,
            client_id: this.client_id,
            ...(this.hostToken ? { host_token: this.hostToken } : {})
        });
        
        if (resp && resp.success && resp.data) {
            const d = resp.data;
            const content = d.content || '';
            const domState = d.domState || {};
            const version = d.version || 0;
            
            this.knownServerVersion = version;
            this.localBaseContent = content;
            this.localBaseDOMState = domState;
            this.localCurrentContent = content;
            this.localCurrentDOMState = domState;
            
            this._setEditorContent(content, domState);
            this.startPolling();
            
            console.log('[Collab] Initial sync complete, version:', version);
        }
    }

    async createRoom(){
        const resp = await postAction(this.t2url, 'create', {});
        if (resp && resp.success) {
            this.collabCode = resp.code;
            this.hostToken = resp.host_token || null;
            this.isHost = true;
            this._saveRoomState();
            this._installHostUnloadHandler();
            console.log('[Collab] Room created successfully');
            return true;
        }
        return false;
    }
    
    async checkRoomExists(code){
        const resp = await postAction(this.t2url, 'exists', { code });
        return resp && resp.success;
    }
    
    // [PATCH-JS-B] joinRoom: 호스트인 경우 host_token을 서버에 전달
    //   기존 방식은 host_token 없이 join → 서버가 "첫 번째 도착자"를 방장으로 지정.
    //   수정 후: 호스트는 create에서 받은 host_token을 join 시 제출해야 방장 권한 획득.
    //   → 코드를 알게 된 공격자가 먼저 join해도 host_token 없이는 방장이 될 수 없음.
    async joinRoom(code, nickname){
        const body = {
            code,
            client_id: this.client_id,
            nickname
        };

        // 이미 host_token을 보유 중이면(방장이 자신의 방에 재접속하는 경우) 함께 전송
        if (this.hostToken) {
            body.host_token = this.hostToken;
        }

        const resp = await postAction(this.t2url, 'join', body);
        if (resp && resp.success) {
            this.collabCode = code;
            this.nickname = nickname;
            this.hostToken = resp.is_host ? resp.host_token : null;
            this.isHost = !!resp.is_host;
            this._saveRoomState();
            if (this.isHost) this._installHostUnloadHandler();
            console.log('[Collab] Joined room, isHost:', this.isHost);
            return resp.data;
        }
        return null;
    }
    
    async leaveRoom(){
        if (!this.collabCode) return true;
        console.log('[Collab] Leaving room');
        
        const resp = await postAction(this.t2url, 'leave', {
            code: this.collabCode,
            client_id: this.client_id
        });
        
        if (resp && resp.success) {
            this._stopPolling();
            this._uninstallHostUnloadHandler();
            this._clearRoomState();
            this._resetState();
            return true;
        }
        return false;
    }
    
    async stopRoom(){
        if (!this.isHost || !this.hostToken) return false;
        console.log('[Collab] Stopping room');
        
        const resp = await postAction(this.t2url, 'stop', {
            code: this.collabCode,
            host_token: this.hostToken
        });
        
        if (resp && resp.success) {
            this._stopPolling();
            this._uninstallHostUnloadHandler();
            this._clearRoomState();
            this._resetState();
            return true;
        }
        return false;
    }
    
    async kickUser(target_client_id){
        if (!this.isHost) return false;
        const resp = await postAction(this.t2url, 'kick', {
            code: this.collabCode,
            client_id: this.client_id,
            target_client_id,
            host_token: this.hostToken
        });
        return resp && resp.success;
    }
    
    _resetState() {
        this.collabCode = null;
        this.nickname = null;
        this.hostToken = null;
        this.isHost = false;
        this.localBaseContent = '';
        this.localBaseDOMState = {};
        this.localCurrentContent = '';
        this.localCurrentDOMState = {};
        this.knownServerVersion = 0;
        this.isLocallyEditing = false;
        this.lastLocalEditTime = 0;
        this.pendingServerUpdates = [];
        this._updateQueue = [];
    }
    
    _installHostUnloadHandler(){
        if (this._unloadHandler) return;
        
        this._unloadHandler = (event) => {
            if (event.type === 'beforeunload') {
                event.preventDefault();
                event.returnValue = '';
            }
            
            if (this.isHost && this.collabCode && this.hostToken) {
                console.log('[Collab] Host leaving - sending delete request');
                sendHostDeleteBeacon(this.t2url, this.collabCode, this.hostToken);
            }
        };
        
        window.addEventListener('beforeunload', this._unloadHandler);
        window.addEventListener('pagehide', this._unloadHandler);
        window.addEventListener('unload', this._unloadHandler);
    }
    
    _uninstallHostUnloadHandler(){
        if (this._unloadHandler) {
            window.removeEventListener('beforeunload', this._unloadHandler);
            window.removeEventListener('pagehide', this._unloadHandler);
            window.removeEventListener('unload', this._unloadHandler);
            this._unloadHandler = null;
        }
    }
    
    startPolling(){
        this._stopPolling();
        this._setupContentObserver();
        this._pollTimer = setInterval(() => this._pollServer(), this.pollInterval);
        console.log('[Collab] Polling started');
    }
    
    _stopPolling(){
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        this._removeContentObserver();
        console.log('[Collab] Polling stopped');
    }
    
    _setupContentObserver(){
        if (this._mutationObserver || this._inputHandler) return;
        
        this._inputHandler = () => {
            this.isLocallyEditing = true;
            this.lastLocalEditTime = Date.now();
            this._debounceUpdate();
        };
        this.editor.editor.addEventListener('input', this._inputHandler);
        
        this._mutationObserver = new MutationObserver((mutations) => {
            const hasStyleChanges = mutations.some(mutation => 
                mutation.type === 'attributes' && mutation.attributeName === 'style'
            );
            if (hasStyleChanges) {
                this.isLocallyEditing = true;
                this.lastLocalEditTime = Date.now();
                this._debounceUpdate();
            }
        });
        
        this._mutationObserver.observe(this.editor.editor, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['style']
        });
    }
    
    _removeContentObserver(){
        if (this._inputHandler) {
            this.editor.editor.removeEventListener('input', this._inputHandler);
            this._inputHandler = null;
        }
        if (this._mutationObserver) {
            this._mutationObserver.disconnect();
            this._mutationObserver = null;
        }
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
    }
    
    _debounceUpdate(){
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(() => {
            this._handleLocalChange();
            this._debounceTimer = null;
        }, this.debounceMs);
    }
    
    _handleLocalChange(){
        if (this._isUpdating || this._isSyncing) {
            console.log('[Collab] Skipping local change - update/sync in progress');
            return;
        }

        const currentContent = this.editor.editor.innerHTML;

        // [PATCH-JS-11] 콘텐츠 크기 제한 (1MB 초과 시 전송 차단)
        if (!isValidContent(currentContent)) {
            console.warn('[Collab] Content too large or invalid, not sending');
            return;
        }

        const currentDOMState = extractDOMState(currentContent);
        
        if (!hasRealChange(this.localBaseContent, currentContent, this.localBaseDOMState, currentDOMState)) {
            console.log('[Collab] No real change detected');
            return;
        }
        
        this.localCurrentContent = currentContent;
        this.localCurrentDOMState = currentDOMState;
        
        const operation = {
            type: 'full',
            content: currentContent,
            domState: currentDOMState,
            timestamp: isoNow(),
            client_id: this.client_id
        };
        
        this._updateQueue.push(operation);
        this._processUpdateQueue();
        
        console.log('[Collab] Local change queued');
    }
    
    async _processUpdateQueue(){
        if (this._isProcessingQueue || this._updateQueue.length === 0) return;
        
        this._isProcessingQueue = true;
        
        while (this._updateQueue.length > 0) {
            const operation = this._updateQueue[0];
            
            const success = await this._sendUpdate(operation);
            
            if (success) {
                this._updateQueue.shift();
                
                this.localBaseContent = operation.content;
                this.localBaseDOMState = operation.domState;
                
                console.log('[Collab] Update sent successfully');
            } else {
                console.warn('[Collab] Update failed, will retry');
                await new Promise(resolve => setTimeout(resolve, 1000));
                break;
            }
        }
        
        this._isProcessingQueue = false;
        
        if (this._updateQueue.length === 0) {
            this.isLocallyEditing = false;
        }
    }
    
    async _sendUpdate(operation){
        if (!operation || this._isUpdating) return false;
        
        this._isUpdating = true;
        try {
            const resp = await postAction(this.t2url, 'update', {
                code: this.collabCode,
                client_id: this.client_id,
                version: this.knownServerVersion,
                operation: operation,
                host_token: this.hostToken
            });
            
            if (resp && resp.success) {
                this.knownServerVersion = resp.new_version || this.knownServerVersion + 1;
                console.log('[Collab] Update accepted, new version:', this.knownServerVersion);
                return true;
            } else if (resp && resp.conflict) {
                console.warn('[Collab] Conflict detected, merging...');
                await this._handleConflict(
                    resp.current_content, 
                    resp.current_dom_state || {}, 
                    resp.current_version
                );
                return false;
            } else {
                console.error('[Collab] Update failed', resp);
                return false;
            }
        } catch(e) {
            console.error('[Collab] Send update error:', e);
            return false;
        } finally {
            this._isUpdating = false;
        }
    }
    
    async _handleConflict(serverContent, serverDOMState, serverVersion){
        console.log('[Collab] Handling conflict - server version:', serverVersion, 'local version:', this.knownServerVersion);
        
        const localChanged = hasRealChange(
            this.localBaseContent, 
            this.localCurrentContent,
            this.localBaseDOMState,
            this.localCurrentDOMState
        );
        
        const serverChanged = hasRealChange(
            this.localBaseContent,
            serverContent,
            this.localBaseDOMState,
            serverDOMState
        );
        
        if (!localChanged && serverChanged) {
            console.log('[Collab] No local changes, accepting server update');
            this._applyServerUpdate(serverContent, serverDOMState, serverVersion);
        } else if (localChanged && !serverChanged) {
            console.log('[Collab] Only local changes, re-sending');
            this.knownServerVersion = serverVersion;
        } else {
            console.log('[Collab] Both changed, accepting server (LWW)');
            this._applyServerUpdate(serverContent, serverDOMState, serverVersion);
            
            this._updateQueue = [];
            this.isLocallyEditing = false;
        }
    }
    
    _applyServerUpdate(content, domState, version) {
        this.localBaseContent = content;
        this.localBaseDOMState = domState;
        this.localCurrentContent = content;
        this.localCurrentDOMState = domState;
        this.knownServerVersion = version;
        
        this._setEditorContent(content, domState);
    }
    
    // [PATCH-JS-C] _pollServer: host_token도 포함하여 get 인가 통과
    async _pollServer(){
        if (this._isUpdating || this._isSyncing) return;
        
        const timeSinceLastEdit = Date.now() - this.lastLocalEditTime;
        if (this.isLocallyEditing && timeSinceLastEdit < this.localEditProtectionMs) {
            console.log('[Collab] Skipping poll - local editing protected');
            return;
        }
        
        this._isSyncing = true;
        try {
            const resp = await postAction(this.t2url, 'get', {
                code: this.collabCode,
                client_id: this.client_id,
                since_version: this.knownServerVersion,
                ...(this.hostToken ? { host_token: this.hostToken } : {})
            });
            
            if (resp && resp.success && resp.data) {
                const d = resp.data;
                
                if (d.version > this.knownServerVersion) {
                    console.log('[Collab] Server has newer version:', d.version, 'local:', this.knownServerVersion);
                    
                    const newContent = d.content || '';
                    const newDOMState = d.domState || {};

                    // [PATCH-JS-12] 서버에서 받은 콘텐츠 크기/형식 검증
                    if (!isValidContent(newContent)) {
                        console.warn('[Collab] Server content invalid or too large, skipping');
                        return;
                    }
                    
                    if (this.isLocallyEditing) {
                        console.log('[Collab] Local editing - buffering server update');
                        this.pendingServerUpdates.push({
                            content: newContent,
                            domState: newDOMState,
                            version: d.version
                        });
                    } else {
                        if (hasRealChange(this.localBaseContent, newContent, this.localBaseDOMState, newDOMState)) {
                            console.log('[Collab] Applying server update');
                            this._applyServerUpdate(newContent, newDOMState, d.version);
                        } else {
                            this.knownServerVersion = d.version;
                        }
                    }
                }
            }
        } catch(e) {
            console.error('[Collab] Poll error:', e);
        } finally {
            this._isSyncing = false;
            
            if (!this.isLocallyEditing && this.pendingServerUpdates.length > 0) {
                const latest = this.pendingServerUpdates[this.pendingServerUpdates.length - 1];
                this.pendingServerUpdates = [];
                
                console.log('[Collab] Applying buffered server update');
                this._applyServerUpdate(latest.content, latest.domState, latest.version);
            }
        }
    }
    
    _setEditorContent(html, domState = {}){
        const processedHTML = applyDOMState(html, domState);
        this.editor.setContent(processedHTML);
        
        setTimeout(() => {
            for (let [name, plugin] of this.editor.plugins) {
                if (plugin.onContentSet) {
                    plugin.onContentSet(processedHTML);
                }
            }
            this._updateSlidersFromDOMState(domState);
        }, 100);
    }
    
    _updateSlidersFromDOMState(domState) {
        Object.keys(domState.mediaBlocks || {}).forEach(blockId => {
            // [PATCH-JS-9] blockId CSS 선택자 인젝션 방지
            if (!isValidDomId(blockId)) return;
            const block = this.editor.editor.querySelector(`[data-block-id="${blockId}"]`);
            if (!block) return;
            
            const controls = block.querySelector('.t2-media-controls');
            const slider = controls?.querySelector('input[type="range"]');
            const state = domState.mediaBlocks[blockId];
            
            if (slider && state && state.sliderPercentage) {
                slider.value = state.sliderPercentage;
            }
        });
    }
    
    _getEditorContent(){
        return this.editor.editor.innerHTML;
    }
    
    openModal(){
        const overlay = document.createElement('div');
        overlay.className = 't2-modal-overlay';
        overlay.innerHTML = `
            <div class="t2-modal-box t2-collab-modal">
                <div class="t2-collab-header">
                    <h3>협업 편집</h3>
                    <button class="t2-collab-close-btn material-icons">close</button>
                </div>
                <div class="t2-tab-container">
                    <div class="t2-tabs">
                        <button class="t2-tab active" data-tab="create">방 만들기</button>
                        <button class="t2-tab" data-tab="join">참여하기</button>
                    </div>
                    <div class="t2-tab-content">
                        <div class="t2-tab-pane active" data-pane="create">
                            <div class="t2-collab-create-section">
                                <p>새 협업 방을 생성합니다.</p>
                                <button class="t2-collab-create-btn">방 생성</button>
                            </div>
                            <div class="t2-collab-host-nick-section" style="display:none;">
                                <p>닉네임을 입력하세요:</p>
                                <input type="text" class="t2-collab-host-nick" placeholder="닉네임 (선택사항)">
                                <button class="t2-collab-start-btn" disabled>시작</button>
                            </div>
                        </div>
                        <div class="t2-tab-pane" data-pane="join">
                            <p>참여할 방 코드를 입력하세요:</p>
                            <input type="text" class="t2-collab-join-code" placeholder="방 코드">
                            <p>닉네임을 입력하세요:</p>
                            <input type="text" class="t2-collab-join-nick" placeholder="닉네임 (선택사항)">
                            <button class="t2-collab-join-btn" disabled>참여</button>
                        </div>
                    </div>
                    <div class="t2-collab-info-section" style="display:none;">
                        <p>방 코드: <strong class="t2-collab-disp-code"></strong>
                            <button class="t2-collab-copy-btn">복사</button>
                        </p>
                        <p>닉네임: <strong class="t2-collab-disp-nick"></strong></p>
                        <ul class="t2-collab-users-list"></ul>
                        <button class="t2-collab-stop-btn" style="display:none;">협업 중지</button>
                        <button class="t2-collab-leave-btn">나가기</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const box          = overlay.querySelector('.t2-modal-box');
        const tabs         = overlay.querySelectorAll('.t2-tab');
        const panes        = overlay.querySelectorAll('.t2-tab-pane');
        const createBtn    = overlay.querySelector('.t2-collab-create-btn');
        const hostNickSection = overlay.querySelector('.t2-collab-host-nick-section');
        const hostNickInput= overlay.querySelector('.t2-collab-host-nick');
        const startBtn     = overlay.querySelector('.t2-collab-start-btn');
        const joinCodeInput= overlay.querySelector('.t2-collab-join-code');
        const joinNickInput= overlay.querySelector('.t2-collab-join-nick');
        const joinBtn      = overlay.querySelector('.t2-collab-join-btn');
        const infoSection  = overlay.querySelector('.t2-collab-info-section');
        const dispCode     = overlay.querySelector('.t2-collab-disp-code');
        const dispNick     = overlay.querySelector('.t2-collab-disp-nick');
        const copyBtn      = overlay.querySelector('.t2-collab-copy-btn');
        const usersList    = overlay.querySelector('.t2-collab-users-list');
        const stopBtn      = overlay.querySelector('.t2-collab-stop-btn');
        const leaveBtn     = overlay.querySelector('.t2-collab-leave-btn');
        const closeBtn     = overlay.querySelector('.t2-collab-close-btn');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const targetPane = tab.dataset.tab;
                panes.forEach(pane => {
                    pane.classList.remove('active');
                    if (pane.dataset.pane === targetPane) {
                        pane.classList.add('active');
                    }
                });
            });
        });

        createBtn.addEventListener('click', async () => {
            const ok = await this.createRoom();
            if (ok) {
                box.querySelector('.t2-collab-create-section').style.display = 'none';
                hostNickSection.style.display = 'block';
                hostNickInput.focus();
            } else {
                alert('방 생성 실패');
            }
        });

        hostNickInput.addEventListener('input', (e) => {
            startBtn.disabled = (e.target.value.trim().length === 0);
        });

        startBtn.addEventListener('click', async () => {
            // [PATCH-JS-13] 닉네임 길이 50자 제한
            const nick = (hostNickInput.value.trim() || '익명').substring(0, 50);
            const data = await this.joinRoom(this.collabCode, nick);
            if (data) {
                box.querySelector('.t2-tab-content').style.display = 'none';
                infoSection.style.display = 'block';
                dispCode.textContent = this.collabCode;
                dispNick.textContent = this.nickname;
                if (this.isHost) stopBtn.style.display = 'inline-block';
                this.startPolling();
                this._updateUsersList(usersList);
            } else {
                alert('협업 시작 실패');
            }
        });

        const checkJoinInputs = () => {
            const code = joinCodeInput.value.trim();
            const nick = joinNickInput.value.trim();
            joinBtn.disabled = !(code.length > 3 && nick.length > 0);
        };
        joinCodeInput.addEventListener('input', checkJoinInputs);
        joinNickInput.addEventListener('input', checkJoinInputs);

        joinBtn.addEventListener('click', async () => {
            const code = joinCodeInput.value.trim();
            // [PATCH-JS-14] 닉네임 50자 제한
            const nick = (joinNickInput.value.trim() || '익명').substring(0, 50);
            if (!code) {
                alert('방 코드를 입력하세요');
                return;
            }
            const exists = await this.checkRoomExists(code);
            if (!exists) {
                alert('해당 방이 없습니다');
                return;
            }
            const data = await this.joinRoom(code, nick);
            if (data) {
                box.querySelector('.t2-tab-content').style.display = 'none';
                infoSection.style.display = 'block';
                dispCode.textContent = this.collabCode;
                dispNick.textContent = this.nickname;
                this.startPolling();
                this._updateUsersList(usersList);
            } else {
                alert('참여 실패');
            }
        });

        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(this.collabCode).then(() => {
                alert('코드가 복사되었습니다.');
            }).catch(() => {
                const textArea = document.createElement('textarea');
                textArea.value = this.collabCode;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                alert('코드가 복사되었습니다.');
            });
        });

        usersList.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-clientid]');
            if (!btn) return;
            const target_client_id = btn.getAttribute('data-clientid');
            if (!this.isHost) {
                alert('방장만 강퇴할 수 있습니다');
                return;
            }
            const ok = await this.kickUser(target_client_id);
            if (ok) {
                this._updateUsersList(usersList);
            } else {
                alert('강퇴 실패');
            }
        });

        stopBtn.addEventListener('click', async () => {
            if (!this.isHost) return;
            const ok = await this.stopRoom();
            if (ok) {
                overlay.remove();
                alert('협업 중지 및 방 삭제 완료');
            } else {
                alert('협업 중지 실패');
            }
        });

        leaveBtn.addEventListener('click', async () => {
            await this.leaveRoom();
            overlay.remove();
        });

        closeBtn.addEventListener('click', () => {
            overlay.remove();
        });

        if (this.collabCode && this.nickname) {
            box.querySelector('.t2-tab-content').style.display = 'none';
            infoSection.style.display = 'block';
            dispCode.textContent = this.collabCode;
            dispNick.textContent = this.nickname;
            if (this.isHost) stopBtn.style.display = 'inline-block';
            this._updateUsersList(usersList);
        }
    }

    // [PATCH-JS-D] _updateUsersList: client_id와 host_token(방장인 경우)을 포함하여 get 인가 통과
    async _updateUsersList(container) {
        const resp = await postAction(this.t2url, 'get', {
            code: this.collabCode,
            client_id: this.client_id,
            ...(this.hostToken ? { host_token: this.hostToken } : {})
        });
        if (resp && resp.success && resp.data) {
            this._renderUsers(container, resp.data.users || []);
        }
    }

    _renderUsers(container, users) {
        container.innerHTML = '';
        
        let hostUser = null;
        users.forEach(u => {
            if (u.isHost) {
                hostUser = u;
            }
        });
        
        (users || []).forEach(u => {
            const li = document.createElement('li');
            const left = document.createElement('div');
            left.className = 't2-collab-user-name';
            left.textContent = u.nickname || '(익명)';

            if (u.client_id === this.client_id) {
                const badge = document.createElement('span');
                badge.className = 't2-collab-badge-me';
                badge.textContent = '나';
                left.appendChild(badge);
            }

            if (u.isHost && u.client_id === hostUser?.client_id) {
                const hostBadge = document.createElement('span');
                hostBadge.className = 't2-collab-badge-host';
                hostBadge.textContent = '방장';
                left.appendChild(hostBadge);
            }

            li.appendChild(left);

            if (this.isHost && !u.isHost && u.client_id !== this.client_id) {
                const kickBtn = document.createElement('button');
                kickBtn.className = 't2-collab-kick-btn';
                kickBtn.textContent = '강퇴';
                kickBtn.setAttribute('data-clientid', u.client_id);
                li.appendChild(kickBtn);
            }

            container.appendChild(li);
        });
    }
}

window.T2CollabPlugin = T2CollabPlugin;

document.addEventListener('DOMContentLoaded', function() {
    const containers = document.querySelectorAll('.t2-editor-container');
    containers.forEach(container => {
        const editorId = container.id.replace('_container', '');
        const editorInstance = window[editorId + '_editor'];
        
        if (editorInstance && !editorInstance.getPlugin('collab')) {
            console.log('[Collab] Registering plugin for editor:', editorId);
            const collabPlugin = new T2CollabPlugin(editorInstance);
            editorInstance.registerPlugin('collab', collabPlugin);
        }
    });
});

})();
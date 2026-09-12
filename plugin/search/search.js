// Path: T2Editor/plugin/search/search.js

class T2SearchPlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['search'];
        this.API_URL = 'https://dsclub.kr/api/search/index.php';
        this.CACHE_URL = 'https://dsclub.kr/api/search/cache.php';
        this.API_KEY = 'dsclubSEARCH2025';
        
        this.searchBar = null;
        this.resultsContainer = null;
        this.infoBar = null;
        this.isLoading = false;
        this.currentTags = [];
        this.currentOffset = 0;
        this.totalResults = 0;
        this.hasMore = false;
        this.LIMIT = 15;
        this.MAX_RESULTS = 100;
        
        this.t2SearchEnabled = this.loadT2SearchSetting();
        this.editorHighlights = [];
        this.currentHighlightIndex = -1;
        this.currentQuery = '';
        
        this.db = null;
        this.initIndexedDB();
    }

    async initIndexedDB() {
        try {
            this.db = await new Promise((resolve, reject) => {
                const request = indexedDB.open('T2SearchCache', 2);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (db.objectStoreNames.contains('searches')) {
                        db.deleteObjectStore('searches');
                    }
                    const store = db.createObjectStore('searches', { keyPath: 'key' });
                    store.createIndex('hits', 'hits', { unique: false });
                    store.createIndex('expires', 'expires', { unique: false });
                    store.createIndex('created', 'created', { unique: false });
                };
            });
            this.cleanExpiredCache();
        } catch (e) {}
    }

    async cleanExpiredCache() {
        if (!this.db) return;
        try {
            const tx = this.db.transaction(['searches'], 'readwrite');
            const store = tx.objectStore('searches');
            const index = store.index('expires');
            const now = Date.now();
            const request = index.openCursor();
            
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    if (cursor.value.expires < now) {
                        cursor.delete();
                    }
                    cursor.continue();
                }
            };
            await new Promise(resolve => tx.oncomplete = resolve);
        } catch (e) {}
    }

    getCacheKey(tags, limit, offset) {
        const sortedTags = [...tags].sort().join(',');
        return `${sortedTags}|${limit}|${offset}`;
    }

    async getLocalCache(key) {
        if (!this.db) return null;
        try {
            const tx = this.db.transaction(['searches'], 'readonly');
            const store = tx.objectStore('searches');
            const request = store.get(key);
            
            const data = await new Promise((resolve) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
            });
            
            if (!data) return null;
            if (data.expires < Date.now()) {
                this.deleteLocalCache(key);
                return null;
            }
            
            this.updateCacheHits(key, data);
            return data.data;
        } catch (e) {
            return null;
        }
    }

    async setLocalCache(key, data, ttl = 3600000) {
        if (!this.db || !data || !data.results || !Array.isArray(data.results) || data.results.length === 0) {
            return;
        }
        
        try {
            const tx = this.db.transaction(['searches'], 'readwrite');
            const store = tx.objectStore('searches');
            
            const existing = await new Promise((resolve) => {
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            });
            
            const cacheEntry = {
                key,
                data,
                hits: existing ? existing.hits + 1 : 1,
                created: existing ? existing.created : Date.now(),
                expires: Date.now() + ttl
            };
            
            if (cacheEntry.hits > 5) {
                cacheEntry.expires = Date.now() + (ttl * 2);
            }
            
            store.put(cacheEntry);
            await new Promise(resolve => tx.oncomplete = resolve);
            
            this.limitLocalCacheSize();
        } catch (e) {}
    }

    async deleteLocalCache(key) {
        if (!this.db) return;
        try {
            const tx = this.db.transaction(['searches'], 'readwrite');
            const store = tx.objectStore('searches');
            store.delete(key);
        } catch (e) {}
    }

    async updateCacheHits(key, data) {
        if (!this.db) return;
        try {
            const tx = this.db.transaction(['searches'], 'readwrite');
            const store = tx.objectStore('searches');
            data.hits++;
            store.put(data);
        } catch (e) {}
    }

    async limitLocalCacheSize() {
        if (!this.db) return;
        try {
            const tx = this.db.transaction(['searches'], 'readwrite');
            const store = tx.objectStore('searches');
            const countRequest = store.count();
            
            countRequest.onsuccess = () => {
                const count = countRequest.result;
                if (count > 100) {
                    const index = store.index('hits');
                    const request = index.openCursor();
                    let deleted = 0;
                    const toDelete = count - 100;
                    
                    request.onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor && deleted < toDelete) {
                            cursor.delete();
                            deleted++;
                            cursor.continue();
                        }
                    };
                }
            };
        } catch (e) {}
    }

    async getSharedCache(tags, limit, offset) {
        try {
            const params = new URLSearchParams({
                tags: tags.join(','),
                limit: limit.toString(),
                offset: offset.toString()
            });
            
            const response = await fetch(`${this.CACHE_URL}?${params}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!response.ok) return null;
            
            const result = await response.json();
            
            if (!result.success || !result.data || !result.data.results) {
                return null;
            }
            
            return result.data;
        } catch (e) {
            return null;
        }
    }

    async uploadToSharedCache(tags, limit, offset, results, total) {
        if (!results || !Array.isArray(results) || results.length === 0) {
            return;
        }
        
        try {
            await fetch(this.CACHE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tags: tags.join(','),
                    limit,
                    offset,
                    results,
                    total
                })
            });
        } catch (e) {}
    }

    async performSearch(query, isNewSearch = true) {
        if (this.isLoading) return;

        let tags = this.currentTags;
        if (isNewSearch && query) {
            tags = query.split(/[,，\s]+/).map(t => t.trim()).filter(t => t.length > 0);
            if (tags.length === 0) {
                this.showMessage('검색어를 입력해주세요.', 'empty', 'search');
                return;
            }
            this.currentTags = tags;
            this.currentQuery = query;
            
            const editorResults = this.searchEditorContent(query);
            this.renderEditorResults(editorResults);
        }

        if (!this.t2SearchEnabled) {
            return;
        }

        if (tags.length === 0) return;

        this.isLoading = true;
        const searchBtn = this.searchBar.querySelector('.t2-search-btn');
        searchBtn.disabled = true;

        if (isNewSearch) {
            const loading = document.createElement('div');
            loading.className = 't2-search-loading';
            loading.innerHTML = `<span class="material-icons">autorenew</span><div style="margin-top:8px">T2Search로 검색 중...</div>`;
            this.resultsContainer.appendChild(loading);
        } else {
            const loadingMore = document.createElement('div');
            loadingMore.className = 't2-search-load-more';
            loadingMore.innerHTML = '<span class="material-icons" style="font-size:16px;animation:t2-spin 1s linear infinite">autorenew</span>';
            this.resultsContainer.appendChild(loadingMore);
        }

        try {
            const cacheKey = this.getCacheKey(tags, this.LIMIT, this.currentOffset);
            let data = null;
            
            data = await this.getLocalCache(cacheKey);
            
            if (!data) {
                data = await this.getSharedCache(tags, this.LIMIT, this.currentOffset);
                if (data) {
                    await this.setLocalCache(cacheKey, data);
                }
            }
            
            if (!data) {
                const response = await fetch(this.API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': this.API_KEY,
                        'X-T2Editor': 'true' 
                    },
                    body: JSON.stringify({
                        tags,
                        limit: this.LIMIT,
                        offset: this.currentOffset
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const apiResult = await response.json();
                
                if (!apiResult.success) {
                    throw new Error(apiResult.error || '검색 실패');
                }
                
                if (!apiResult.results || !Array.isArray(apiResult.results)) {
                    throw new Error('잘못된 검색 결과 형식');
                }
                
                data = {
                    results: apiResult.results,
                    total: apiResult.total || 0
                };
                
                if (data.results.length > 0) {
                    await this.setLocalCache(cacheKey, data);
                    await this.uploadToSharedCache(tags, this.LIMIT, this.currentOffset, data.results, data.total);
                }
            }

            const loadingEl = this.resultsContainer.querySelector('.t2-search-load-more, .t2-search-loading');
            if (loadingEl) loadingEl.remove();

            if (isNewSearch) {
                this.totalResults = data.total;
                
                if (data.results.length === 0) {
                    this.showMessage('검색 결과가 없습니다.', 'empty', 'block');
                    return;
                }
                
                this.renderApiHeader();
            }

            if (data.results.length > 0) {
                this.appendResults(data.results);
            }
            
            this.currentOffset += data.results.length;
            this.hasMore = this.currentOffset < Math.min(this.totalResults, this.MAX_RESULTS) && 
                          data.results.length === this.LIMIT;
            
            this.updateHeader();

        } catch (error) {
            console.error('Search error:', error);
            
            const loadingEl = this.resultsContainer.querySelector('.t2-search-load-more, .t2-search-loading');
            if (loadingEl) loadingEl.remove();
            
            if (isNewSearch) {
                let errorMessage = 'T2Search가 바빠요, 나중에 다시 시도해주세요';
                let errorIcon = 'block';
                
                if (error.message.includes('Failed to fetch') || error.message.includes('network')) {
                    errorMessage = '네트워크 연결을 확인해주세요';
                    errorIcon = 'wifi_off';
                } else if (error.message.includes('timeout')) {
                    errorMessage = '요청 시간이 초과되었습니다. 다시 시도해주세요';
                    errorIcon = 'timer_off';
                } else if (error.message.includes('HTTP') || error.message.includes('검색 실패')) {
                    errorMessage = 'T2Search 서비스가 많이 바빠요. 잠시 후 다시 시도해주세요';
                    errorIcon = 'error';
                }
                
                this.showMessage(errorMessage, 'api-busy', errorIcon);
            }
        } finally {
            this.isLoading = false;
            searchBtn.disabled = false;
        }
    }

    loadT2SearchSetting() {
        let value = localStorage.getItem('t2-search-enabled');
        if (value === null) value = this.getCookie('t2-search-enabled');
        return value !== 'false';
    }

    saveT2SearchSetting(enabled) {
        localStorage.setItem('t2-search-enabled', enabled);
        this.setCookie('t2-search-enabled', enabled, 365);
    }

    setCookie(name, value, days) {
        const expires = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
    }

    getCookie(name) {
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? match[2] : null;
    }

    handleCommand(command, button) {
        if (command === 'search') this.toggleSearchBar();
    }

    toggleSearchBar() {
        this.searchBar ? this.closeSearchBar() : this.createSearchBar();
    }

    createSearchBar() {
        const toolbar = this.editor.toolbar;
        
        this.searchBar = document.createElement('div');
        this.searchBar.className = 't2-search-bar';
        this.searchBar.innerHTML = `
            <div class="t2-search-input-wrapper">
                <span class="material-icons t2-search-icon">search</span>
                <input type="text" class="t2-search-input" placeholder="검색어 입력 (쉼표 또는 공백으로 구분)">
                <button class="t2-search-btn" type="button">검색</button>
            </div>
            <div class="t2-search-results"></div>
        `;

        this.infoBar = document.createElement('div');
        this.infoBar.className = 't2-search-info-bar';
        this.infoBar.innerHTML = `
            <div class="t2-editor-search-toggle">
                <label class="t2-search-switch">
                    <input type="checkbox" ${this.t2SearchEnabled ? 'checked' : ''}>
                    <span class="t2-search-slider"></span>
                </label>
                <span class="t2-editor-search-label">T2Search 검색</span>
            </div>
            <a href="https://dsclub.kr/service/${this.t2SearchEnabled ? 'search' : 'editor'}" target="_blank" rel="noopener noreferrer" class="t2-search-powered">
                powered by <span><b>${this.t2SearchEnabled ? 'T2Search' : 'T2Editor'}</b></span>
            </a>
        `;

        this.closeBtn = document.createElement('button');
        this.closeBtn.className = 't2-search-close';
        this.closeBtn.type = 'button';
        this.closeBtn.innerHTML = '<span class="material-icons">close</span>';

        toolbar.insertAdjacentElement('afterend', this.searchBar);
        this.searchBar.insertAdjacentElement('afterend', this.infoBar);
        this.infoBar.insertAdjacentElement('afterend', this.closeBtn);

        this.resultsContainer = this.searchBar.querySelector('.t2-search-results');
        const input = this.searchBar.querySelector('.t2-search-input');
        const searchBtn = this.searchBar.querySelector('.t2-search-btn');
        const t2SearchToggle = this.infoBar.querySelector('.t2-editor-search-toggle input');

        t2SearchToggle.addEventListener('change', (e) => {
            this.t2SearchEnabled = e.target.checked;
            this.saveT2SearchSetting(this.t2SearchEnabled);
            
            const poweredBy = this.infoBar.querySelector('.t2-search-powered');
            poweredBy.href = `https://dsclub.kr/service/${this.t2SearchEnabled ? 'search' : 'editor'}`;
            poweredBy.innerHTML = `powered by <span><b>${this.t2SearchEnabled ? 'T2Search' : 'T2Editor'}</b></span>`;
            
            if (input.value.trim()) this.resetAndSearch(input.value);
        });

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.resetAndSearch(input.value);
            }
        });

        input.addEventListener('input', (e) => {
            if (this.searchDebounce) clearTimeout(this.searchDebounce);
            this.searchDebounce = setTimeout(() => {
                if (e.target.value.trim()) {
                    this.currentQuery = e.target.value.trim();
                    this.searchEditorContent(this.currentQuery);
                } else {
                    this.clearHighlights();
                }
            }, 300);
        });

        searchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.resetAndSearch(input.value);
        });

        this.closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.closeSearchBar();
        });

        this.resultsContainer.addEventListener('scroll', () => this.handleScroll());

        setTimeout(() => document.addEventListener('click', this.handleOutsideClick), 100);
        setTimeout(() => input.focus(), 100);
    }

    handleOutsideClick = (e) => {
        if (this.searchBar && !this.searchBar.contains(e.target)) {
            if (this.infoBar && this.infoBar.contains(e.target)) return;
            const searchButton = this.editor.toolbar.querySelector('[data-command="search"]');
            if (searchButton && searchButton.contains(e.target)) return;
            this.closeSearchBar();
        }
    }

    handleScroll() {
        if (this.isLoading || !this.hasMore || !this.t2SearchEnabled) return;
        const { scrollTop, scrollHeight, clientHeight } = this.resultsContainer;
        if (scrollTop + clientHeight >= scrollHeight - 50) this.loadMore();
    }

    async loadMore() {
        if (this.currentOffset >= this.MAX_RESULTS) {
            this.hasMore = false;
            return;
        }
        await this.performSearch(null, false);
    }

    resetAndSearch(query) {
        this.currentOffset = 0;
        this.totalResults = 0;
        this.hasMore = false;
        this.resultsContainer.innerHTML = '';
        this.clearHighlights();
        
        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            this.showMessage('검색어를 입력해주세요.', 'empty', 'search');
            return;
        }

        this.currentQuery = trimmedQuery;
        this.searchEditorContent(trimmedQuery);
        this.performSearch(query, true);
    }

    searchEditorContent(query) {
        this.clearHighlights();
        const editorEl = this.editor.editor;
        const text = editorEl.innerText || editorEl.textContent;
        const lines = text.split('\n');
        const results = [];
        const searchTerms = query.toLowerCase().split(/[,，\s]+/).filter(t => t.length > 0);

        lines.forEach((line, lineIndex) => {
            const lineLower = line.toLowerCase();
            searchTerms.forEach(term => {
                let pos = 0;
                while ((pos = lineLower.indexOf(term, pos)) !== -1) {
                    const start = Math.max(0, pos - 20);
                    const end = Math.min(line.length, pos + term.length + 20);
                    let snippet = line.substring(start, end);
                    if (start > 0) snippet = '...' + snippet;
                    if (end < line.length) snippet = snippet + '...';
                    results.push({
                        lineNumber: lineIndex + 1,
                        position: pos,
                        term: term,
                        snippet: snippet,
                        fullLine: line,
                        matchStart: pos,
                        matchEnd: pos + term.length
                    });
                    pos += term.length;
                }
            });
        });

        this.applyHighlights(searchTerms);
        return results;
    }

    applyHighlights(searchTerms) {
        const editorEl = this.editor.editor;
        this.editorHighlights = [];
        const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.trim()) textNodes.push(node);
        }

        textNodes.forEach(textNode => {
            const text = textNode.textContent;
            const textLower = text.toLowerCase();
            const matches = [];

            searchTerms.forEach(term => {
                let pos = 0;
                while ((pos = textLower.indexOf(term, pos)) !== -1) {
                    matches.push({ start: pos, end: pos + term.length, term });
                    pos += term.length;
                }
            });

            if (matches.length === 0) return;
            matches.sort((a, b) => a.start - b.start);
            const mergedMatches = [];
            matches.forEach(m => {
                const last = mergedMatches[mergedMatches.length - 1];
                if (last && m.start <= last.end) {
                    last.end = Math.max(last.end, m.end);
                } else {
                    mergedMatches.push({ ...m });
                }
            });

            const parent = textNode.parentNode;
            if (!parent || parent.classList?.contains('t2-search-highlight')) return;

            for (let i = mergedMatches.length - 1; i >= 0; i--) {
                const match = mergedMatches[i];
                const range = document.createRange();
                try {
                    range.setStart(textNode, match.start);
                    range.setEnd(textNode, match.end);
                    const highlight = document.createElement('span');
                    highlight.className = 't2-search-highlight';
                    highlight.dataset.highlightIndex = this.editorHighlights.length;
                    range.surroundContents(highlight);
                    this.editorHighlights.push(highlight);
                } catch (e) {}
            }
        });
    }

    clearHighlights() {
        this.editorHighlights.forEach(el => {
            if (el && el.parentNode) {
                const parent = el.parentNode;
                while (el.firstChild) parent.insertBefore(el.firstChild, el);
                parent.removeChild(el);
            }
        });
        this.editorHighlights = [];
        this.currentHighlightIndex = -1;
        this.editor.editor.normalize();
    }

renderEditorResults(results) {
    if (results.length === 0) return;
    
    const section = document.createElement('div');
    section.className = 't2-search-editor-section';
    
    const title = document.createElement('div');
    title.className = 't2-search-section-title';
    title.innerHTML = `<span class="material-icons">edit_note</span> 에디터 내 검색 결과 (${results.length}개)`;
    section.appendChild(title);

    results.forEach((result, index) => {
        const item = document.createElement('div');
        item.className = 't2-search-editor-item';
        item.dataset.resultIndex = index;
        const location = document.createElement('div');
        location.className = 't2-search-editor-location';
        location.textContent = `${result.lineNumber}번째 줄, ${result.position + 1}번째 문자`;
        const textEl = document.createElement('div');
        textEl.className = 't2-search-editor-text';
        const escapedSnippet = this.escapeHtml(result.snippet);
        const escapedTerm = this.escapeHtml(result.term);
        const regex = new RegExp(`(${this.escapeRegExp(escapedTerm)})`, 'gi');
        textEl.innerHTML = escapedSnippet.replace(regex, '<mark>$1</mark>');
        item.appendChild(location);
        item.appendChild(textEl);
        item.addEventListener('click', () => this.scrollToHighlight(index, results));
        section.appendChild(item);
    });

    const replaceContainer = document.createElement('div');
    replaceContainer.className = 't2-search-replace-container';
    replaceContainer.style.cssText = `
        padding: 8px 12px;
        border-top: 1px solid var(--t2-border, #e5e7eb);
        margin-top: 6px;
    `;
    
    const replaceWrapper = document.createElement('div');
    replaceWrapper.style.cssText = 'display: flex; gap: 6px; align-items: center;';
    
    const replaceInput = document.createElement('input');
    replaceInput.type = 'text';
    replaceInput.placeholder = `"${this.currentQuery}" → 바꿀 텍스트`;
    replaceInput.className = 't2-search-replace-input';
    replaceInput.style.cssText = `
        flex: 1;
        padding: 7px 10px;
        border: 1px solid var(--t2-border, #e5e7eb);
        border-radius: 4px;
        font-size: 12px;
        background: transparent;
        color: var(--t2-text, #374151);
        outline: none;
        transition: border-color 0.15s;
    `;
    
    replaceInput.addEventListener('focus', () => {
        replaceInput.style.borderColor = '#9ca3af';
    });
    
    replaceInput.addEventListener('blur', () => {
        replaceInput.style.borderColor = 'var(--t2-border, #e5e7eb)';
    });
    
    const highlightCount = this.editorHighlights.length;
    
    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 't2-search-replace-btn';
    replaceBtn.innerHTML = `<span class="material-icons" style="font-size: 16px;">sync_alt</span>`;
    replaceBtn.title = `${highlightCount}개 바꾸기`;
    replaceBtn.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 7px;
        background: transparent;
        color: #6b7280;
        border: 1px solid var(--t2-border, #e5e7eb);
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s;
        min-width: 32px;
    `;
    
    replaceBtn.addEventListener('mouseenter', () => {
        replaceBtn.style.background = '#f3f4f6';
        replaceBtn.style.color = '#374151';
    });
    
    replaceBtn.addEventListener('mouseleave', () => {
        replaceBtn.style.background = 'transparent';
        replaceBtn.style.color = '#6b7280';
    });
    
    const performReplace = () => {
        const replaceText = replaceInput.value;
        if (replaceText === undefined) {
            replaceInput.focus();
            return;
        }
        
        const replacedCount = this.replaceAllHighlights(replaceText);
        
        if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
            if (replacedCount > 0) {
                T2Utils.showNotification(`${replacedCount}개 항목이 "${replaceText}"로 변경되었습니다`, 'success');
            } else {
                T2Utils.showNotification('변경할 항목이 없습니다', 'info');
            }
        }
    };
    
    replaceBtn.addEventListener('click', performReplace);
    
    replaceInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            performReplace();
        }
    });
    
    replaceWrapper.appendChild(replaceInput);
    replaceWrapper.appendChild(replaceBtn);
    replaceContainer.appendChild(replaceWrapper);
    
    section.appendChild(replaceContainer);

    if (this.resultsContainer.firstChild) {
        this.resultsContainer.insertBefore(section, this.resultsContainer.firstChild);
    } else {
        this.resultsContainer.appendChild(section);
    }
}

    replaceAllHighlights(replaceText) {
        const editorEl = this.editor.editor;
        
        const validHighlights = this.editorHighlights.filter(h => 
            h && h.parentNode && document.body.contains(h)
        );
        
        const totalCount = validHighlights.length;
        
        if (totalCount === 0) {
            return 0;
        }
        
        let replacedCount = 0;
        
        for (let i = validHighlights.length - 1; i >= 0; i--) {
            const highlight = validHighlights[i];
            try {
                if (highlight && highlight.parentNode && document.body.contains(highlight)) {
                    const textNode = document.createTextNode(replaceText);
                    highlight.parentNode.replaceChild(textNode, highlight);
                    replacedCount++;
                }
            } catch (e) {
                console.warn('Replace failed for highlight:', e);
            }
        }
        
        this.editorHighlights = [];
        this.currentHighlightIndex = -1;
        
        editorEl.normalize();
        
        this.editor.normalizeContent();
        this.editor.createUndoPoint();
        this.editor.autoSave();
        
        if (this.currentQuery) {
            const results = this.searchEditorContent(this.currentQuery);
            
            const existingSection = this.resultsContainer.querySelector('.t2-search-editor-section');
            if (existingSection) {
                existingSection.remove();
            }
            
            if (results.length > 0) {
                this.renderEditorResults(results);
            } else {
                const noResults = document.createElement('div');
                noResults.style.cssText = `
                    padding: 20px;
                    text-align: center;
                    color: var(--t2-text-secondary, #6b7280);
                    font-size: 13px;
                `;
                noResults.innerHTML = `
                    <span class="material-icons" style="font-size: 32px; margin-bottom: 8px; opacity: 0.5;">check_circle</span>
                    <div>모든 항목이 변경되었습니다</div>
                `;
                this.resultsContainer.insertBefore(noResults, this.resultsContainer.firstChild);
            }
        }
        
        return replacedCount;
    }

    scrollToHighlight(index, results) {
        this.searchBar.querySelectorAll('.t2-search-editor-item.active').forEach(el => el.classList.remove('active'));
        this.editorHighlights.forEach(el => el.classList.remove('t2-search-highlight-active'));
        const item = this.searchBar.querySelector(`[data-result-index="${index}"]`);
        if (item) item.classList.add('active');
        if (this.editorHighlights[index]) {
            const highlight = this.editorHighlights[index];
            highlight.classList.add('t2-search-highlight-active');
            highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
            this.currentHighlightIndex = index;
        }
    }

    renderApiHeader() {
        const existingHeader = this.resultsContainer.querySelector('.t2-search-api-header');
        if (existingHeader) return;
        
        const header = document.createElement('div');
        header.className = 't2-search-section-title t2-search-api-header';
        header.innerHTML = `<span class="material-icons" style="color:#4E80ED">public</span> T2Search 검색 결과`;
        header.style.marginTop = '8px';
        this.resultsContainer.appendChild(header);
    }

    renderHeader() {
        const header = document.createElement('div');
        header.className = 't2-search-header';
        header.style.cssText = 'font-size:12px;color:#888;margin-bottom:8px;padding:0 4px;';
        this.resultsContainer.appendChild(header);
        this.updateHeader();
    }

    updateHeader() {
        const header = this.resultsContainer.querySelector('.t2-search-header');
        if (header) {
            const maxShow = Math.min(this.totalResults, this.MAX_RESULTS);
            header.textContent = `총 ${this.totalResults}개 중 ${this.currentOffset}개 표시${this.totalResults > this.MAX_RESULTS ? ' (최대 100개)' : ''}`;
        }
    }

    appendResults(results) {
        results.forEach(item => {
            const div = document.createElement('div');
            div.className = 't2-search-result-item';
            
            const title = this.escapeHtml(item.title || '제목 없음');
            const snippet = this.escapeHtml(item.snippet || '');
            const url = this.escapeHtml(item.url || '');
            const score = item.score ? item.score.toFixed(1) : '0';
            
            div.innerHTML = `
                <div class="t2-search-result-title">${title}</div>
                <div class="t2-search-result-snippet">${snippet}</div>
                <div class="t2-search-result-meta">
                    <span class="t2-search-result-url">${this.truncateUrl(url, 50)}</span>
                    <span class="t2-search-result-score">점수 ${score}</span>
                </div>
            `;
            
            div.addEventListener('click', () => this.insertResult(item));
            this.resultsContainer.appendChild(div);
        });
    }

    insertResult(item) {
        const title = item.title || '제목 없음';
        const snippet = item.snippet || '내용 없음';
        const url = item.url || '';

        const titleP = document.createElement('p');
        const boldTitle = document.createElement('b');
        boldTitle.textContent = title;
        titleP.appendChild(boldTitle);

        const codeBlock = document.createElement('div');
        codeBlock.className = 't2-media-block t2-code-block';
        codeBlock.contentEditable = 'false';
        
        const pre = document.createElement('pre');
        pre.style.cssText = 'margin:0;padding:16px;background:#f5f5f5;border-radius:8px;overflow-x:auto;';
        
        const code = document.createElement('code');
        code.textContent = snippet;
        code.contentEditable = 'true';
        code.style.cssText = 'outline:none;display:block;white-space:pre-wrap;word-wrap:break-word;font-family:monospace;font-size:13px;line-height:1.5;';
        
        pre.appendChild(code);
        codeBlock.appendChild(pre);

        const linkP = document.createElement('p');
        linkP.textContent = '- ';
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = url;
        link.style.cssText = 'color:#4A90E2;text-decoration:underline;';
        linkP.appendChild(link);

        const spacer = document.createElement('p');
        spacer.innerHTML = '<br>';

        const editorEl = this.editor.editor;
        
        let lastElement = editorEl.lastElementChild;
        if (!lastElement) {
            lastElement = document.createElement('p');
            lastElement.innerHTML = '<br>';
            editorEl.appendChild(lastElement);
        }

        editorEl.appendChild(titleP);
        editorEl.appendChild(codeBlock);
        editorEl.appendChild(linkP);
        editorEl.appendChild(spacer);

        const codePlugin = this.editor.getPlugin('code');
        if (codePlugin && code) {
            codePlugin.setupCodeEvents(code);
        }

        const linkPlugin = this.editor.getPlugin('link');
        if (linkPlugin && link) {
            linkPlugin.setupLinkEvents(link);
        }

        this.editor.normalizeContent();
        this.editor.createUndoPoint();
        this.editor.autoSave();
        
        const range = document.createRange();
        const selection = window.getSelection();
        range.setStart(spacer, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        
        this.editor.editor.focus();
        spacer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        this.closeSearchBar();

        if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
            T2Utils.showNotification('검색 결과가 삽입되었습니다.', 'success');
        }
    }

    showMessage(message, type = 'empty', icon = null) {
        const className = type === 'error' || type === 'api-busy' ? 't2-search-error' : 't2-search-empty';
        
        if (!icon) {
            icon = (type === 'error' || type === 'api-busy') ? 'block' : 'search_off';
        }
        
        const msgEl = document.createElement('div');
        msgEl.className = className;
        msgEl.innerHTML = `
            <span class="material-icons" style="font-size:32px;margin-bottom:8px;opacity:0.5">${icon}</span>
            <div>${message}</div>
        `;
        this.resultsContainer.appendChild(msgEl);
    }

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    truncateUrl(url, maxLength) {
        if (!url) return '';
        if (url.length <= maxLength) return url;
        return url.substring(0, maxLength - 3) + '...';
    }

    closeSearchBar() {
        document.removeEventListener('click', this.handleOutsideClick);
        this.clearHighlights();
        if (this.searchBar) {
            this.searchBar.remove();
            this.searchBar = null;
            this.resultsContainer = null;
        }
        if (this.infoBar) {
            this.infoBar.remove();
            this.infoBar = null;
        }
        if (this.closeBtn) {
            this.closeBtn.remove();
            this.closeBtn = null;
        }
        this.currentTags = [];
        this.currentOffset = 0;
        this.totalResults = 0;
        this.hasMore = false;
        this.currentQuery = '';
        if (this.searchDebounce) clearTimeout(this.searchDebounce);
    }
}

window.T2SearchPlugin = T2SearchPlugin;
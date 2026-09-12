// T2Editor/plugin/meme/meme.js

class T2MemePlugin extends T2ImagePlugin {
    constructor(editor) {
        super(editor);
        this.commands = ['insertMeme'];
        this.memeApiUrl = 'https://dsclub.kr/api/meme/index.php';
        this._ms = {          // meme state
            page: 1,
            limit: 24,
            loading: false,
            hasMore: true,
            query: '',
            modal: null,
            timer: null,
            scrollObserver: null,
            lazyObserver: null,
        };
        this._savedRange = null; // 선택 영역(커서 위치) 저장을 위한 변수 추가
    }

    // T2ImagePlugin.handleCommand 완전 오버라이드
    handleCommand(command) {
        if (command === 'insertMeme') {
            this._saveSelection(); // 모달이 포커스를 빼앗기 전 현재 커서 위치 저장
            this._openModal();
            return true; // 기본 동작 방지
        }
    }

    // ─── Selection 관리 ───────────────────────────────────────────────────────

    _saveSelection() {
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            // 에디터 내부의 선택 영역인지 확인
            if (this.editor.editor.contains(range.startContainer)) {
                this._savedRange = range.cloneRange();
                return;
            }
        }
        this._savedRange = null;
    }

    _restoreSelection() {
        this.editor.editor.focus();
        const sel = window.getSelection();
        
        if (this._savedRange) {
            sel.removeAllRanges();
            sel.addRange(this._savedRange);
        } else {
            // 저장된 영역이 없거나 에디터가 비어있을 경우 안전하게 맨 끝에 블록 생성 후 포커스
            let targetNode = this.editor.editor.lastElementChild;
            if (!targetNode || targetNode.tagName !== 'P') {
                const p = document.createElement('p');
                p.innerHTML = '<br>';
                this.editor.editor.appendChild(p);
                targetNode = p;
            }
            const range = document.createRange();
            range.selectNodeContents(targetNode);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }

    // ─── Modal ────────────────────────────────────────────────────────────────

    _openModal() {
        const s = this._ms;
        Object.assign(s, { page: 1, hasMore: true, query: '', loading: false });
        this._destroyObservers();

        // DOM 객체 대신 HTML 문자열로 생성합니다.
        const modalHtml = `
            <div class="t2-meme-modal">
                <div class="t2-meme-header">
                    <div class="t2-meme-title-wrap">
                        <span class="t2-meme-title">
                            <span class="material-icons">sentiment_very_satisfied</span>T2Meme
                        </span>
                        <p class="t2-meme-desc">검색을 통해 다양한 밈 이미지를 찾아 에디터에 삽입해보세요</p>
                        <a href="https://dsclub.kr/service/meme" target="_blank" rel="noopener noreferrer" class="t2-meme-powered">
                            <span class="material-icons">info</span>
                            <span>powered by <b>T2Meme</b></span>
                        </a>
                    </div>
                    <div class="t2-meme-search-wrap">
                        <span class="material-icons t2-meme-search-icon">search</span>
                        <input type="text" class="t2-meme-search" placeholder="태그 또는 키워드 검색..." autocomplete="off" spellcheck="false">
                    </div>
                </div>
                <div class="t2-meme-body">
                    <div class="t2-meme-grid"></div>
                    <div class="t2-meme-loader">
                        <span class="material-icons t2-meme-spin">sync</span>
                    </div>
                    <div class="t2-meme-empty">
                        <span class="material-icons">search_off</span>
                        <p>검색 결과가 없습니다</p>
                    </div>
                    <div class="t2-meme-sentinel"></div>
                </div>
                <div class="t2-meme-footer">
                    <a href="https://dsclub.kr/service/meme/" target="_blank" rel="noopener" class="t2-meme-reg-btn">
                        <span class="material-icons">add_photo_alternate</span>
                        <span>짤 등록</span>
                    </a>
                    <button type="button" class="t2-meme-close-btn">닫기</button>
                </div>
            </div>
        `;

        // T2Utils.createModal에 문자열을 전달
        const modal = T2Utils.createModal(modalHtml);
        s.modal = modal;

        const search   = modal.querySelector('.t2-meme-search');
        const grid     = modal.querySelector('.t2-meme-grid');
        const loader   = modal.querySelector('.t2-meme-loader');
        const emptyEl  = modal.querySelector('.t2-meme-empty');
        const sentinel = modal.querySelector('.t2-meme-sentinel');

        loader.style.display  = 'none';
        emptyEl.style.display = 'none';

        // 닫기
        modal.querySelector('.t2-meme-close-btn').onclick = () => this._closeModal();

        // 검색 (X 버튼 제거됨 - 자동으로만 지워짐)
        search.addEventListener('input', e => {
            clearTimeout(s.timer);
            const v = e.target.value.trim();
            s.timer = setTimeout(() => {
                s.query = v;
                s.page  = 1;
                s.hasMore = true;
                grid.innerHTML = '';
                emptyEl.style.display = 'none';
                this._fetch(grid, loader, emptyEl);
            }, 380);
        });

        // 무한 스크롤 sentinel
        s.scrollObserver = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && !s.loading && s.hasMore) {
                this._fetch(grid, loader, emptyEl);
            }
        }, { threshold: 0 });
        s.scrollObserver.observe(sentinel);

        // 공유 lazy observer (단일 인스턴스로 메모리 절약)
        s.lazyObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                        s.lazyObserver.unobserve(img);
                    }
                }
            });
        }, { rootMargin: '300px 0px' });

        this._fetch(grid, loader, emptyEl);
        setTimeout(() => search.focus(), 100);
    }

    _closeModal() {
        this._destroyObservers();
        const s = this._ms;
        if (s.modal) { s.modal.remove(); s.modal = null; }
    }

    _destroyObservers() {
        const s = this._ms;
        if (s.scrollObserver) { s.scrollObserver.disconnect(); s.scrollObserver = null; }
        if (s.lazyObserver)   { s.lazyObserver.disconnect();  s.lazyObserver = null; }
    }

    // ─── API fetch ────────────────────────────────────────────────────────────

    async _fetch(grid, loader, emptyEl) {
        const s = this._ms;
        if (s.loading || !s.hasMore) return;
        s.loading = true;
        loader.style.display = 'flex';

        try {
            const qs = new URLSearchParams({
                q:     s.query,
                page:  s.page,
                limit: s.limit
            });
            const res = await fetch(`${this.memeApiUrl}?${qs}`, {
                headers: { Accept: 'application/json' }
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);

            const json = await res.json();
            if (!json.success) throw new Error(json.message || 'API 오류');

            const items = json.data || [];

            if (items.length === 0 && s.page === 1) {
                emptyEl.style.display = 'flex';
            } else {
                emptyEl.style.display = 'none';
                const frag = document.createDocumentFragment();
                items.forEach(m => frag.appendChild(this._createTile(m)));
                grid.appendChild(frag);
                s.page++;
                s.hasMore = items.length >= s.limit;
            }
        } catch (err) {
            console.error('[T2MemePlugin] fetch error:', err);
            if (s.page === 1) emptyEl.style.display = 'flex';
        } finally {
            s.loading = false;
            loader.style.display = 'none';
        }
    }

    // ─── Tile ─────────────────────────────────────────────────────────────────

    _createTile(meme) {
        const s = this._ms;
        const tile = document.createElement('div');
        tile.className = 't2-meme-tile';
        tile.setAttribute('role', 'button');
        tile.setAttribute('tabindex', '0');
        tile.title = Array.isArray(meme.tags) ? meme.tags.map(t => '#' + t).join(' ') : '';

        // 이미지 (lazy)
        const imgWrap = document.createElement('div');
        imgWrap.className = 't2-meme-img-wrap';

        const img = document.createElement('img');
        img.dataset.src = meme.url;
        // 1×1 투명 SVG placeholder (네트워크 요청 없음)
        img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/%3E";
        img.alt  = tile.title;
        img.decoding = 'async';
        img.addEventListener('error', () => { img.closest('.t2-meme-tile')?.classList.add('t2-meme-tile-err'); });
        if (s.lazyObserver) s.lazyObserver.observe(img);

        imgWrap.appendChild(img);

        // 메타 정보 (태그 출력 제거됨)
        const meta = document.createElement('div');
        meta.className = 't2-meme-meta';

        meta.innerHTML = `
            ${meme.poster ? `<div class="t2-meme-poster">${this._esc(meme.poster)}</div>` : ''}
        `;

        tile.appendChild(imgWrap);
        tile.appendChild(meta);

        // 클릭 / 키보드
        const insert = () => this._insertBlock(meme.url);
        tile.addEventListener('click', (e) => {
            e.preventDefault();
            insert();
        });
        tile.addEventListener('keydown', e => { 
            if (e.key === 'Enter' || e.key === ' ') { 
                e.preventDefault(); 
                insert(); 
            } 
        });

        return tile;
    }

    _esc(str) {
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ─── Insert (부모 클래스 메서드 재사용) ───────────────────────────────────

    _insertBlock(url) {
        this._closeModal();
        this._restoreSelection(); // 잃어버린 에디터 포커스 및 커서 위치 복원

        const blockId = this.generateBlockId();

        // 기본 치수로 즉시 삽입 (블록이 에디터에 들어가야 사용자가 확인 가능)
        const imageDataArray = [{
            url,
            width: 640,
            height: 480,
            blockId,
            isUploading: false,
        }];

        // 실제 치수 비동기 보정
        const tempImg = new Image();
        tempImg.crossOrigin = 'anonymous';
        tempImg.onload = () => {
            const w = tempImg.naturalWidth  || 640;
            const h = tempImg.naturalHeight || 480;
            const block = this.editor.editor.querySelector(`[data-block-id="${blockId}"]`);
            if (!block) return;
            const container = block.querySelector('div:first-child');
            if (container) {
                container.dataset.originalWidth  = w;
                container.dataset.originalHeight = h;
                const maxW = this.editor.editor.clientWidth || w;
                container.style.width = Math.min(w, maxW) + 'px';
            }
            const imgEl = block.querySelector('img');
            if (imgEl) { imgEl.dataset.width = w; imgEl.dataset.height = h; }
        };
        tempImg.src = url;

        // T2ImagePlugin.insertImageBlocks 상속 호출
        this.insertImageBlocks(imageDataArray);
    }
}

window.T2MemePlugin = T2MemePlugin;
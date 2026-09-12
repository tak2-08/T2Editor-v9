// T2Editor/plugin/code/code.js

class T2CodePlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['insertCodeBlock'];

        // ── 지연 자기 초기화 ─────────────────────────────────────────────────
        // [FIX-타이밍 문제 3]
        // file 플러그인(priority 4, 50ms fallback)과 동일 우선순위로 로드되지만,
        // core.js processContentSet 이 priority 1(video) 로드 직후 contentSetQueue를
        // 소비해버려 code 플러그인은 onContentSet을 받지 못하는 레이스 컨디션이 존재.
        // file.js와 동일한 패턴으로, 생성자에서 에디터에 이미 콘텐츠가 있으면
        // 직접 initializeCodeBlocks()를 실행한다.
        setTimeout(() => {
            if (this.editor.editor && this.editor.editor.innerHTML.trim()) {
                this.initializeCodeBlocks();
            }
        }, 100); // file(50ms)보다 늦게 실행 — file 블록 처리 완료 후 동작
    }

    handleCommand(command, button) {
        switch (command) {
            case 'insertCodeBlock':
                this.insertCodeBlock();
                break;
        }
    }

    onContentSet(html) {
        console.log('Code plugin: onContentSet called');
        setTimeout(() => {
            this.initializeCodeBlocks();
        }, 50);
    }

    insertCodeBlock() {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const currentBlock = this.editor.getClosestBlock(range.startContainer);

        const codeBlock = this.createCodeBlock();

        if (currentBlock && currentBlock !== this.editor.editor) {
            const topBreak = document.createElement('p');
            topBreak.textContent = '\u200B';
            currentBlock.parentNode.insertBefore(topBreak, currentBlock.nextSibling);

            topBreak.parentNode.insertBefore(codeBlock, topBreak.nextSibling);

            const bottomBreak = document.createElement('p');
            bottomBreak.textContent = '\u200B';
            codeBlock.parentNode.insertBefore(bottomBreak, codeBlock.nextSibling);

            const codeElement = codeBlock.querySelector('code');
            if (codeElement) {
                setTimeout(() => {
                    codeElement.focus();
                    if (codeElement.classList.contains('code-placeholder')) {
                        codeElement.textContent = '';
                        codeElement.classList.remove('code-placeholder');
                    }
                    const newRange = document.createRange();
                    newRange.setStart(codeElement, 0);
                    newRange.collapse(true);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(newRange);
                }, 50);
            }

            this.cleanupEmptyLines(codeBlock);
            this.editor.createUndoPoint();
            this.editor.autoSave();
        }
    }

    createCodeBlock() {
        const mediaBlock = document.createElement('div');
        mediaBlock.className = 't2-media-block t2-code-block';
        mediaBlock.contentEditable = false;
        mediaBlock.style.position = 'relative';

        const blockId = this.generateBlockId();
        mediaBlock.setAttribute('data-block-id', blockId);

        const container = document.createElement('div');
        container.style.width = '100%';
        container.style.margin = '0 auto';

        const pre = document.createElement('pre');
        pre.contentEditable = false;
        // [FIX-레이아웃] 긴 코드로 인한 에디터 영역/textarea 강제 확장 방지
        pre.style.overflowX = 'auto';
        pre.style.maxWidth = '100%';

        const codeElement = document.createElement('code');
        codeElement.textContent = '코드를 입력하세요';
        codeElement.classList.add('code-placeholder');
        codeElement.setAttribute('contenteditable', 'true');

        this.setupCodeEvents(codeElement);

        pre.appendChild(codeElement);
        container.appendChild(pre);
        mediaBlock.appendChild(container);

        const controls = this.createCodeControls();
        mediaBlock.appendChild(controls);

        const moveControls = this.createMoveControls();
        mediaBlock.appendChild(moveControls);

        return mediaBlock;
    }

    createCodeControls() {
        const controls = document.createElement('div');
        controls.className = 't2-media-controls';
        controls.contentEditable = false;

        controls.innerHTML = `
            <button class="t2-btn delete-btn" type="button">
                <span class="material-icons">delete</span>
            </button>
        `;

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

        return controls;
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

        const sibling = direction === 'up'
            ? mediaBlock.previousElementSibling
            : mediaBlock.nextElementSibling;
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

    setupCodeEvents(codeElement) {
        codeElement.addEventListener('click', function (e) {
            e.stopPropagation();
            if (this.classList.contains('code-placeholder')) {
                this.textContent = '';
                this.classList.remove('code-placeholder');
                const range = document.createRange();
                const sel = window.getSelection();
                range.setStart(this, 0);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        });

        codeElement.addEventListener('focus', function (e) {
            e.stopPropagation();
            if (this.classList.contains('code-placeholder')) {
                this.textContent = '';
                this.classList.remove('code-placeholder');
            }
        });

        codeElement.addEventListener('blur', function () {
            if (this.textContent.trim() === '') {
                this.textContent = '코드를 입력하세요';
                this.classList.add('code-placeholder');
            }
        });

        codeElement.addEventListener('paste', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (codeElement.classList.contains('code-placeholder')) {
                codeElement.textContent = '';
                codeElement.classList.remove('code-placeholder');
            }

            const text = (e.clipboardData || window.clipboardData).getData('text/plain');
            const selection = window.getSelection();
            if (!selection.rangeCount) return;

            const range = selection.getRangeAt(0);
            range.deleteContents();

            const lines = text.split(/\r?\n/);
            const fragment = document.createDocumentFragment();
            lines.forEach((line, index) => {
                if (line) fragment.appendChild(document.createTextNode(line));
                if (index < lines.length - 1) {
                    fragment.appendChild(document.createTextNode('\n'));
                }
            });

            range.insertNode(fragment);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);

            this.editor.createUndoPoint();
            this.editor.autoSave();
        });

        // ── [FIX-iOS Safari 엔터 두 번 버그] ────────────────────────────────────
        //
        // 원인: iOS Safari는 contenteditable 안에 텍스트가 있을 때
        //   ① autocorrect가 현재 단어를 "composing" 상태로 유지함
        //   ② 첫 번째 Enter → autocorrect 커밋(단어 확정)에 소비됨 → 줄바꿈 없음
        //   ③ 두 번째 Enter → 비로소 줄바꿈
        //   또한 iOS는 keydown의 preventDefault()를 무시하고 <div>/<br>를 삽입함.
        //
        // 해결책:
        //   1) autocorrect/spellcheck 비활성화 → Enter가 composing 커밋에 소비되지 않음
        //   2) beforeinput(insertLineBreak/insertParagraph)을 주 트리거로 사용
        //      → iOS Safari는 beforeinput의 preventDefault()를 반드시 존중함
        //   3) getTargetRanges()로 iOS에서 신뢰할 수 있는 range 확보
        //   4) execCommand('insertText')로 삽입 → iOS의 composition 상태와 충돌 없음
        //   5) keydown은 데스크톱 / isComposing=false 환경의 보조 트리거로 유지
        // ─────────────────────────────────────────────────────────────────────

        // iOS Safari autocorrect/자동수정 비활성화
        // (텍스트 있을 때 Enter가 단어 커밋에 소비되는 근본 원인 차단)
        codeElement.setAttribute('autocorrect', 'off');
        codeElement.setAttribute('autocapitalize', 'none');
        codeElement.setAttribute('spellcheck', 'false');
        codeElement.setAttribute('data-gramm', 'false'); // Grammarly 충돌 방지

        // 공통 줄바꿈 삽입 헬퍼
        // rangeOverride: beforeinput의 getTargetRanges()에서 가져온 range (없으면 null)
        const _insertNewline = (rangeOverride) => {
            if (codeElement.classList.contains('code-placeholder')) {
                codeElement.textContent = '';
                codeElement.classList.remove('code-placeholder');
            }

            const selection = window.getSelection();
            if (!selection) return;

            let range = rangeOverride;
            if (!range) {
                if (!selection.rangeCount) return;
                range = selection.getRangeAt(0);
            }

            // 커서 앞 텍스트를 텍스트 노드 트리 순회로 정확히 계산 (들여쓰기용)
            // 기존 range.startOffset은 자식 노드 인덱스로 문자 오프셋과 달라 버그 있었음
            let charOffset = 0;
            const calcOffset = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    if (node === range.startContainer) {
                        charOffset += range.startOffset;
                        return true;
                    }
                    charOffset += node.textContent.length;
                    return false;
                }
                for (const child of node.childNodes) {
                    if (calcOffset(child)) return true;
                }
                return false;
            };
            calcOffset(codeElement);

            const textBeforeCursor = codeElement.textContent.substring(0, charOffset);
            const lastLine = textBeforeCursor.split('\n').pop();
            const leadingSpaces = lastLine.match(/^(\s*)/)[1];

            // selection을 range에 맞춰 동기화 후 execCommand로 삽입.
            // iOS Safari에서 range.insertNode()보다 execCommand('insertText')가
            // composition 상태·undo 히스토리를 올바르게 처리함.
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('insertText', false, '\n' + leadingSpaces);
        };

        // 중복 삽입 방지 플래그
        // (keydown이 먼저 처리한 경우 beforeinput에서 _insertNewline 스킵)
        let _enterHandledByKeydown = false;

        // beforeinput: iOS Safari 주(主) 트리거
        // iOS는 keydown의 preventDefault를 무시하지만 beforeinput은 반드시 존중함
        codeElement.addEventListener('beforeinput', (e) => {
            if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
            e.preventDefault();
            e.stopPropagation();
            if (_enterHandledByKeydown) return;

            // getTargetRanges(): iOS Safari에서 window.getSelection()보다
            // 신뢰할 수 있는 range를 제공하는 InputEvent 전용 API
            let range = null;
            if (typeof e.getTargetRanges === 'function') {
                const targets = e.getTargetRanges();
                if (targets.length > 0) {
                    const sr = targets[0];
                    range = document.createRange();
                    range.setStart(sr.startContainer, sr.startOffset);
                    range.setEnd(sr.endContainer, sr.endOffset);
                }
            }
            _insertNewline(range);
        });

        // keydown: 데스크톱 및 isComposing=false 모바일 환경의 보조 트리거
        codeElement.addEventListener('keydown', (e) => {
            e.stopPropagation();

            if (e.key === 'Tab') {
                e.preventDefault();
                document.execCommand('insertText', false, '    ');
            } else if (e.key === 'Enter') {
                // isComposing=true: CJK IME 조합 중 → beforeinput에 위임
                if (e.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                _enterHandledByKeydown = true;
                _insertNewline(null);
                // beforeinput이 이어서 발생해도 중복 삽입 방지
                setTimeout(() => { _enterHandledByKeydown = false; }, 0);
            }
        });

        codeElement.addEventListener('input', (e) => {
            e.stopPropagation();
            this.editor.createUndoPoint();
            this.editor.autoSave();

            if (this.editor.getPlugin('collab')) {
                this.editor.getPlugin('collab')._debounceUpdate();
            }
        });

        codeElement.addEventListener('mouseup', (e) => { e.stopPropagation(); });
        codeElement.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    }

    generateBlockId() {
        return `code_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    cleanupEmptyLines(codeBlock) {
        let prev = codeBlock.previousElementSibling;
        let emptyCount = 0;
        const toRemove = [];

        while (prev && prev.tagName === 'P' &&
               !prev.textContent.trim() &&
               (prev.innerHTML === '<br>' || prev.querySelector('br'))) {
            emptyCount++;
            if (emptyCount > 1) toRemove.push(prev);
            prev = prev.previousElementSibling;
        }

        let next = codeBlock.nextElementSibling;
        emptyCount = 0;

        while (next && next.tagName === 'P' &&
               !next.textContent.trim() &&
               (next.innerHTML === '<br>' || next.querySelector('br'))) {
            emptyCount++;
            if (emptyCount > 1) toRemove.push(next);
            next = next.nextElementSibling;
        }

        toRemove.forEach(el => el.remove());
    }

    // =====================================================================
    // initializeCodeBlocks — 전면 재작성
    // =====================================================================
    // [FIX-미탐지  문제1] class·data-block-id 소실 시 <pre><code> 구조로 보조 탐지
    // [FIX-미복구  문제2] html_entity_decode + innerHTML 파싱으로 깨진 <pre><code>
    //                     구조를 pre.textContent 수집으로 복구
    //                     data-events-setup 이 DB에 잔류해 이벤트 재연결이 차단되던
    //                     문제 해결 (cloneNode()로 리스너를 완전 초기화)
    // [FIX-타이밍  문제3] 생성자 setTimeout 100ms fallback (위 constructor 참고)
    // [FIX-XSS       ] code 요소 내 잔류 HTML 마크업을 textContent로 sanitize
    // [FIX-레이아웃  ] <pre>에 overflow-x:auto / max-width:100% 적용
    //                   → textarea 강제 확장 방지
    // =====================================================================
    initializeCodeBlocks() {
        console.log('Initializing code blocks...');
        const editorEl = this.editor.editor;

        // ── 에디터 직계 자식 탐색 헬퍼 ──────────────────────────────────────
        const getEditorDirectChild = (el) => {
            if (!el || el === editorEl) return null;
            let node = el;
            while (node.parentElement && node.parentElement !== editorEl) {
                node = node.parentElement;
            }
            return node.parentElement === editorEl ? node : null;
        };

        // ── Pass 1: 구형 블록 변환 (.t2-code-block without .t2-media-block) ──
        // querySelectorAll 결과를 배열로 고정 후 DOM 변경
        Array.from(
            editorEl.querySelectorAll('.t2-code-block:not(.t2-media-block)')
        ).forEach(oldBlock => {
            const codeElement = oldBlock.querySelector('code');
            if (!codeElement) return;

            const mediaBlock = document.createElement('div');
            mediaBlock.className = 't2-media-block t2-code-block';
            mediaBlock.contentEditable = false;
            mediaBlock.style.position = 'relative';
            mediaBlock.setAttribute('data-block-id', this.generateBlockId());

            const container = document.createElement('div');
            container.style.width = '100%';
            container.style.margin = '0 auto';

            const pre = (codeElement.closest('pre') || codeElement.parentElement).cloneNode(true);
            pre.contentEditable = false;
            pre.style.overflowX = 'auto';
            pre.style.maxWidth = '100%';
            container.appendChild(pre);
            mediaBlock.appendChild(container);

            if (oldBlock.parentNode && oldBlock.parentNode.nodeName === 'P') {
                const p = oldBlock.parentNode;
                p.parentNode.insertBefore(mediaBlock, p);
                p.remove();
            } else if (oldBlock.parentNode) {
                oldBlock.parentNode.replaceChild(mediaBlock, oldBlock);
            }

            this.cleanupEmptyLines(mediaBlock);
        });

        // ── Pass 2: 전체 블록 수집 (다중 탐지 전략) ──────────────────────────
        //
        // 탐지 우선순위:
        //   1. .t2-media-block.t2-code-block   — 정상 저장된 콘텐츠
        //   2. [data-block-id^="code_"]         — class 손실, data 속성 생존
        //   3. <pre><code> 구조                 — class·data 전부 손실 (최후 수단)
        //
        const allBlocks = new Set();

        // 전략 1: class 기반
        editorEl.querySelectorAll('.t2-media-block.t2-code-block').forEach(el => {
            const root = getEditorDirectChild(el);
            if (root) allBlocks.add(root);
        });

        // 전략 2: data-block-id 기반 (class 손실 케이스)
        editorEl.querySelectorAll('[data-block-id^="code_"]:not(.t2-code-block)').forEach(el => {
            const root = getEditorDirectChild(el);
            if (root) allBlocks.add(root);
        });

        // 전략 3: <pre><code> 구조 탐지
        // — class·data-block-id 가 모두 소실된 경우의 최후 수단.
        // — 파일/이미지/비디오 콘텐츠가 없는 div 안의 pre>code 구조만 대상.
        editorEl.querySelectorAll('pre > code').forEach(codeEl => {
            const root = getEditorDirectChild(codeEl);
            if (!root) return;
            // 다른 플러그인 블록 제외
            if (root.classList.contains('t2-video-block') ||
                root.classList.contains('t2-file-block') ||
                root.classList.contains('t2-table-wrapper') ||
                root.classList.contains('t2-drawing-block')) return;
            // 파일·이미지 콘텐츠가 없는 경우만 코드 블록으로 처리
            if (!root.querySelector('img, iframe, video, audio, .file-container, a[download]')) {
                allBlocks.add(root);
            }
        });

        // ── Pass 3: 수집된 블록 재초기화 ────────────────────────────────────
        allBlocks.forEach(block => {

            // ── 필수 클래스·속성 복원 ──────────────────────────────────────
            block.classList.add('t2-media-block', 't2-code-block');
            block.contentEditable = false;
            block.style.position = 'relative';
            if (!block.getAttribute('data-block-id')) {
                block.setAttribute('data-block-id', this.generateBlockId());
            }

            // ── <p> 래핑 탈출 ─────────────────────────────────────────────
            if (block.parentNode && block.parentNode.nodeName === 'P') {
                const p = block.parentNode;
                p.parentNode.insertBefore(block, p);
                const pText = p.textContent.replace(/\u200B/g, '').trim();
                if (!pText && !p.querySelector('img, iframe, video')) {
                    p.remove();
                }
            }

            // ── <pre> 구조 확인 및 복원 ───────────────────────────────────
            let pre = block.querySelector('pre');
            if (!pre) {
                // <pre>가 없으면 컨테이너를 찾아 구조 재생성
                const container = block.querySelector(':scope > div') || block;
                pre = document.createElement('pre');
                pre.contentEditable = false;
                const orphanCode = container.querySelector('code');
                if (orphanCode) {
                    // <code>가 있으면 <pre> 안으로 이동
                    pre.appendChild(orphanCode);
                } else {
                    // 텍스트만 있으면 <code>로 감싸기
                    const code = document.createElement('code');
                    code.textContent = container.textContent.trim();
                    pre.appendChild(code);
                    container.textContent = '';
                }
                container.appendChild(pre);
            }

            // [FIX-레이아웃] overflow 처리 — <pre>의 긴 코드가
            // 에디터 영역과 textarea를 강제로 확장하는 문제 방지
            pre.contentEditable = false;
            pre.style.overflowX = 'auto';
            pre.style.maxWidth = '100%';

            // ── <code> 요소 복원 및 파손 구조 재구성 ─────────────────────────
            let codeElement = pre.querySelector('code');

            if (!codeElement) {
                // <code>가 없으면 <pre>의 텍스트를 <code>로 감싸기
                const text = pre.textContent;
                pre.innerHTML = '';
                codeElement = document.createElement('code');
                codeElement.textContent = text;
                pre.appendChild(codeElement);
            } else {
                // ── [FIX-미복구] 파손 구조 복구 ────────────────────────────
                // html_entity_decode() + innerHTML 파싱으로 코드 내용 중
                // </code>, </pre> 등이 실제 닫는 태그로 해석되어 <code> 안의
                // 내용이 잘리고, 나머지가 <pre> 내 텍스트 노드로 남는 경우:
                // → <pre>.textContent 로 전체 텍스트를 수집해 <code>에 재설정.
                const preText = pre.textContent;
                if (pre.childNodes.length > 1 || codeElement.textContent !== preText) {
                    codeElement.textContent = preText;
                    // <code> 이외의 형제 노드(잘린 텍스트 등) 제거
                    Array.from(pre.childNodes).forEach(child => {
                        if (child !== codeElement) pre.removeChild(child);
                    });
                }

                // ── [FIX-XSS] 코드 요소 내 잔류 HTML 마크업 sanitize ─────────
                // innerHTML에 실제 HTML 태그가 잔류하는 경우 textContent로 치환.
                // & 를 먼저 처리해야 이중 인코딩 오류가 없음.
                const safeText = codeElement.textContent;
                const expectedHtml = safeText
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
                if (codeElement.innerHTML !== expectedHtml) {
                    codeElement.textContent = safeText;
                }
            }

            codeElement.setAttribute('contenteditable', 'true');

            // ── [FIX-이벤트 재연결] ─────────────────────────────────────────
            // ① data-events-setup 이 DB에 저장되어 있으면 이벤트 재연결이 차단.
            //    (기존 문제의 근본 원인)
            // ② cloneNode()로 기존 리스너를 완전히 초기화한 후 setupCodeEvents 호출.
            //    initializeCodeBlocks()가 여러 번 호출되어도 중복 리스너 없음.
            const freshCode = codeElement.cloneNode(true);
            freshCode.removeAttribute('data-events-setup');
            codeElement.parentElement.replaceChild(freshCode, codeElement);
            codeElement = freshCode;

            this.setupCodeEvents(codeElement);
            codeElement.dataset.eventsSetup = 'true';

            // ── 컨트롤 제거 후 재생성 (이벤트 없는 죽은 버튼 방지) ────────────
            const existingControls = block.querySelector('.t2-media-controls');
            if (existingControls) existingControls.remove();
            block.appendChild(this.createCodeControls());

            const existingMoveControls = block.querySelector('.t2-move-controls');
            if (existingMoveControls) existingMoveControls.remove();
            block.appendChild(this.createMoveControls());

            this.cleanupEmptyLines(block);
        });

        console.log('Code blocks initialization complete');
    }
}

window.T2CodePlugin = T2CodePlugin;
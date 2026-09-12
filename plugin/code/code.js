// T2Editor/plugin/code/code.js

class T2CodePlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['insertCodeBlock'];
    }

    handleCommand(command, button) {
        switch(command) {
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
        
        const codeElement = document.createElement('code');
        codeElement.textContent = '코드를 입력하세요';
        codeElement.classList.add('code-placeholder');
        codeElement.setAttribute('contenteditable', 'true');
        
        this.setupCodeEvents(codeElement, blockId);
        
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

    setupCodeEvents(codeElement) {
        codeElement.addEventListener('click', function(e) {
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

        codeElement.addEventListener('focus', function(e) {
            e.stopPropagation();
            if (this.classList.contains('code-placeholder')) {
                this.textContent = '';
                this.classList.remove('code-placeholder');
            }
        });

        codeElement.addEventListener('blur', function() {
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
                if (line) {
                    fragment.appendChild(document.createTextNode(line));
                }
                
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

        codeElement.addEventListener('keydown', (e) => {
            e.stopPropagation();
            
            if (e.key === 'Tab') {
                e.preventDefault();
                document.execCommand('insertText', false, '    ');
            } else if (e.key === 'Enter') {
                e.preventDefault();
                
                const selection = window.getSelection();
                const range = selection.getRangeAt(0);
                
                const newline = document.createTextNode('\n');
                range.deleteContents();
                range.insertNode(newline);
                
                range.setStartAfter(newline);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                
                const textBeforeCursor = codeElement.textContent.substring(0, range.startOffset - 1);
                const lastLine = textBeforeCursor.split('\n').pop();
                const leadingSpaces = lastLine.match(/^(\s*)/)[1];
                if (leadingSpaces) {
                    document.execCommand('insertText', false, leadingSpaces);
                }
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
        
        codeElement.addEventListener('mouseup', (e) => {
            e.stopPropagation();
        });
        
        codeElement.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
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
            if (emptyCount > 1) {
                toRemove.push(prev);
            }
            prev = prev.previousElementSibling;
        }
        
        let next = codeBlock.nextElementSibling;
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
    initializeCodeBlocks() {
        console.log('Initializing code blocks...');
        
        // 1단계: 구형 코드블록 변환
        this.editor.editor.querySelectorAll('.t2-code-block:not(.t2-media-block)').forEach(oldBlock => {
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
            
            const pre = codeElement.parentElement.cloneNode(true);
            pre.contentEditable = false;
            container.appendChild(pre);
            mediaBlock.appendChild(container);
            
            const controls = this.createCodeControls();
            mediaBlock.appendChild(controls);
            
            const moveControls = this.createMoveControls();
            mediaBlock.appendChild(moveControls);
            
            if (oldBlock.parentNode.nodeName === 'P') {
                const p = oldBlock.parentNode;
                p.parentNode.insertBefore(mediaBlock, p);
                p.remove();
            } else {
                oldBlock.parentNode.replaceChild(mediaBlock, oldBlock);
            }
            
            const newCodeElement = mediaBlock.querySelector('code');
            if (newCodeElement) {
                newCodeElement.setAttribute('contenteditable', 'true');
                // 인라인 스타일 제거됨
                
                if (!newCodeElement.dataset.eventsSetup) {
                    this.setupCodeEvents(newCodeElement);
                    newCodeElement.dataset.eventsSetup = 'true';
                }
            }
            
            this.cleanupEmptyLines(mediaBlock);
        });

        // 2단계: 기존 미디어 블록 재초기화
        this.editor.editor.querySelectorAll('.t2-media-block.t2-code-block').forEach(block => {
            block.contentEditable = false;
            block.style.position = 'relative';
            
            // blockId 확인
            if (!block.getAttribute('data-block-id')) {
                block.setAttribute('data-block-id', this.generateBlockId());
            }
            
            const pre = block.querySelector('pre');
            if (pre) {
                pre.contentEditable = false;
            }
            
            const codeElement = block.querySelector('code');
            if (codeElement) {
                codeElement.setAttribute('contenteditable', 'true');
                // 인라인 스타일 제거됨
                
                if (!codeElement.dataset.eventsSetup) {
                    this.setupCodeEvents(codeElement);
                    codeElement.dataset.eventsSetup = 'true';
                }
            }
            
            // ✅ 컨트롤 재생성
            const existingControls = block.querySelector('.t2-media-controls');
            if (existingControls) {
                existingControls.remove();
            }
            const controls = this.createCodeControls();
            block.appendChild(controls);
            
            // ✅ 이동 버튼 재생성
            const existingMoveControls = block.querySelector('.t2-move-controls');
            if (existingMoveControls) {
                existingMoveControls.remove();
            }
            const moveControls = this.createMoveControls();
            block.appendChild(moveControls);
            
            // P 태그 안에 있으면 꺼내기
            if (block.parentNode.nodeName === 'P') {
                const p = block.parentNode;
                p.parentNode.insertBefore(block, p);
                p.remove();
            }
            
            this.cleanupEmptyLines(block);
        });
        
        console.log('Code blocks initialization complete');
    }
}

window.T2CodePlugin = T2CodePlugin;
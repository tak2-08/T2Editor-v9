//Path: T2Editor/js/core.js

class T2Editor {
    constructor(container) {
        this.container = container;
        this.editor = container.querySelector('.t2-editor');
        this.toolbar = container.querySelector('.t2-toolbar');
        this.plugins = new Map();
        this.pluginLoadStatus = new Map();
        this.pluginLoadPromises = new Map();
        this.contentSetQueue = null;
        
        this.config = {
            autoSave: true,
            plugins: window.T2EDITOR_PLUGINS || []
        };
        
        // 마이그레이션 모드: 'auto' | 'prompt' | false
        this.migrationMode = (window.T2EDITOR_MIGRATION_MODE !== undefined)
            ? window.T2EDITOR_MIGRATION_MODE
            : 'prompt';
        
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        this.isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        
        this.alignmentState = 'left';
        this.bulletState = { active: false, type: null, count: 1 };
        this.undoStack = [];
        this.redoStack = [];
        this.lastCheckpoint = null;
        this.savedSelection = null;
        
        this.undoBtn = container.querySelector('[data-command="undo"]');
        this.redoBtn = container.querySelector('[data-command="redo"]');
        this.charCount = container.querySelector('.t2-char-count span');
        
        this.autoSaveEnabled = localStorage.getItem('t2editor-autosave-enabled') !== 'false';
        this.collab = null;
        
        this.init();
    }

    init() {
        this.setupEditor();
        this.setupEventListeners();
        this.setupAutoSaveToggle();
        this.setupBeforeUnload();
        
        if (this.autoSaveEnabled) {
            this.loadAutoSave();
        }
        
        this.updateUndoRedoButtons();
        this.updateCharCount();
        this.loadPluginsWithPriority();
    }

    setupEditor() {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        this.editor.appendChild(p);
        
        this.editor.style.whiteSpace = 'pre-wrap';
        this.editor.style.wordBreak = 'break-word';
    }

    setupEventListeners() {
        this.toolbar.addEventListener('click', (e) => {
            const button = e.target.closest('.t2-btn');
            if (!button) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            const command = button.dataset.command;
            this.handleCommand(command, button);
        });

        document.addEventListener('selectionchange', () => {
            if (document.activeElement === this.editor || this.editor.contains(document.activeElement)) {
                this.updateFormatButtons();
            }
        });

        if (this.isIOS || this.isSafari) {
            this.editor.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace') {
                    this.handleBackspace(e);
                }
            });
        } else {
            this.editor.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handleEnterKey();
                } else if (e.key === 'Backspace') {
                    this.handleBackspace(e);
                }
            });
        }

        this.editor.addEventListener('input', (e) => {
            this.handleInput(e);
        });

        this.editor.addEventListener('paste', async (e) => {
            await this.handlePaste(e);
        });

        this.editor.addEventListener('DOMNodeInserted', (e) => {
            this.handleNodeInserted(e);
        });
    }

    updateFormatButtons() {
        const formatCommands = ['bold', 'italic', 'underline', 'strikeThrough'];
        
        formatCommands.forEach(command => {
            const button = this.toolbar.querySelector(`[data-command="${command}"]`);
            if (!button) return;
            
            try {
                const isActive = document.queryCommandState(command);
                if (isActive) {
                    button.classList.add('active');
                } else {
                    button.classList.remove('active');
                }
            } catch (e) {
                // queryCommandState 실패 시 무시
            }
        });
    }

    async handleCommand(command, button) {
        const pluginName = button.dataset.plugin;
        
        if (pluginName && !this.plugins.has(pluginName)) {
            this.showButtonLoading(button);
            await this.loadPluginImmediately(pluginName);
            this.hideButtonLoading(button);
        }
        
        for (let [name, plugin] of this.plugins) {
            if (plugin.commands && plugin.commands.includes(command)) {
                console.log(`Command '${command}' handled by plugin '${name}'`);
                plugin.handleCommand(command, button);
                this.createUndoPoint();
                return;
            }
        }

        switch(command) {
            case 'undo':
                this.undo();
                break;
            case 'redo':
                this.redo();
                break;
            case 'fontSize':
                this.showFontSizeList(button);
                break;
            case 'justifyContent':
                this.toggleAlignment(button);
                break;
            case 'foreColor':
            case 'backColor':
                this.saveSelection();
                this.showColorPalette(command, button);
                break;
            case 'bold':
            case 'italic':
            case 'underline':
            case 'strikeThrough':
                this.execCommand(command);
                this.editor.focus();
                setTimeout(() => this.updateFormatButtons(), 0);
                break;
            default:
                console.warn(`Unknown command: ${command}`);
                break;
        }
        
        this.createUndoPoint();
    }

    async loadPluginImmediately(pluginName) {
        if (this.pluginLoadPromises.has(pluginName)) {
            return this.pluginLoadPromises.get(pluginName);
        }
        
        if (this.pluginLoadStatus.get(pluginName) === 'loaded') {
            return Promise.resolve();
        }
        
        console.log(`Loading plugin '${pluginName}' immediately due to user interaction`);
        
        const loadPromise = this.loadPlugin(pluginName);
        this.pluginLoadPromises.set(pluginName, loadPromise);
        
        try {
            await loadPromise;
        } finally {
            this.pluginLoadPromises.delete(pluginName);
        }
    }

    async loadPluginsWithPriority() {
        const priorities = window.T2EDITOR_PLUGIN_PRIORITY || {};
        
        const priorityGroups = new Map();
        const unassignedPlugins = [];
        
        this.config.plugins.forEach(pluginName => {
            const priority = priorities[pluginName];
            
            if (priority === undefined || priority === null) {
                unassignedPlugins.push(pluginName);
            } else {
                if (!priorityGroups.has(priority)) {
                    priorityGroups.set(priority, []);
                }
                priorityGroups.get(priority).push(pluginName);
            }
        });
        
        const sortedPriorities = Array.from(priorityGroups.keys()).sort((a, b) => a - b);
        
        if (unassignedPlugins.length > 0) {
            const maxPriority = sortedPriorities.length > 0 ? 
                Math.max(...sortedPriorities) + 1 : 1;
            sortedPriorities.push(maxPriority);
            priorityGroups.set(maxPriority, unassignedPlugins);
        }
        
        for (const priority of sortedPriorities) {
            const plugins = priorityGroups.get(priority);
            
            const pluginsWithSize = await Promise.all(
                plugins.map(async (name) => {
                    const size = await this.getPluginFileSize(name);
                    return { name, size };
                })
            );
            
            pluginsWithSize.sort((a, b) => a.size - b.size);
            priorityGroups.set(priority, pluginsWithSize.map(p => p.name));
        }
        
        const buttons = this.toolbar.querySelectorAll('.t2-btn[data-plugin]');
        buttons.forEach(button => {
            const pluginName = button.dataset.plugin;
            if (this.config.plugins.includes(pluginName)) {
                this.showButtonLoading(button);
            }
        });
        
        if (sortedPriorities.includes(0)) {
            const immediatePlugins = priorityGroups.get(0);
            console.log(`Loading priority 0 plugins immediately:`, immediatePlugins);
            
            await Promise.all(
                immediatePlugins.map(async (pluginName) => {
                    await this.loadPlugin(pluginName);
                    const button = this.toolbar.querySelector(`[data-plugin="${pluginName}"]`);
                    if (button) {
                        this.hideButtonLoading(button);
                    }
                })
            );
        }
        
        const delayedPriorities = sortedPriorities.filter(p => p > 0);
        
        for (let i = 0; i < delayedPriorities.length; i++) {
            const priority = delayedPriorities[i];
            const plugins = priorityGroups.get(priority);
            
            const groupDelay = i * 50;
            
            setTimeout(async () => {
                console.log(`Loading priority ${priority} plugins:`, plugins);
                
                await Promise.all(
                    plugins.map(async (pluginName) => {
                        await this.loadPlugin(pluginName);
                        const button = this.toolbar.querySelector(`[data-plugin="${pluginName}"]`);
                        if (button) {
                            this.hideButtonLoading(button);
                        }
                    })
                );
                
                if (this.contentSetQueue) {
                    console.log('Processing queued content after plugin load');
                    this.processContentSet(this.contentSetQueue);
                    this.contentSetQueue = null;
                }
            }, groupDelay);
        }
    }

    async getPluginFileSize(pluginName) {
        try {
            const url = `${window.T2EDITOR_URL}/plugin/${pluginName}/${pluginName}.js`;
            
            const response = await fetch(url, { method: 'HEAD' });
            const contentLength = response.headers.get('content-length');
            
            if (contentLength) {
                return parseInt(contentLength, 10);
            }
            
            const fullResponse = await fetch(url);
            const blob = await fullResponse.blob();
            return blob.size;
        } catch (error) {
            console.warn(`Failed to get size for plugin ${pluginName}:`, error);
            return 50000;
        }
    }

    async loadPlugin(name) {
        if (this.pluginLoadStatus.get(name) === 'loaded') {
            return Promise.resolve();
        }
        
        this.pluginLoadStatus.set(name, 'loading');
        
        return new Promise((resolve, reject) => {
            try {
                const script = document.createElement('script');
                script.src = `${window.T2EDITOR_URL}/plugin/${name}/${name}.js`;
                
                script.onload = () => {
                    const className = `T2${name.charAt(0).toUpperCase() + name.slice(1)}Plugin`;
                    if (window[className]) {
                        const PluginClass = window[className];
                        const plugin = new PluginClass(this);
                        this.plugins.set(name, plugin);
                        this.pluginLoadStatus.set(name, 'loaded');
                        console.log(`✓ Plugin ${name} loaded successfully`);
                        
                        if (name === 'collab') {
                            this.collab = plugin;
                        }
                        
                        resolve();
                    } else {
                        console.error(`Plugin class ${className} not found`);
                        this.pluginLoadStatus.set(name, 'failed');
                        reject(new Error(`Plugin class not found: ${className}`));
                    }
                };
                
                script.onerror = (e) => {
                    console.error(`✗ Failed to load plugin ${name}:`, e);
                    this.pluginLoadStatus.set(name, 'failed');
                    reject(e);
                };
                
                document.head.appendChild(script);
            } catch (error) {
                console.error(`Failed to load plugin ${name}:`, error);
                this.pluginLoadStatus.set(name, 'failed');
                reject(error);
            }
        });
    }

    handleInput(e) {
        this.autoSave();
        this.handleBulletPoints();
        
        if (this.isIOS || this.isSafari) {
            requestAnimationFrame(() => {
                this.normalizeContent();
            });
        } else {
            this.normalizeContent();
        }
        
        this.createUndoPoint();
        this.updateCharCount();
    }

    handleEnterKey() {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        
        let currentBlock = this.getClosestBlock(range.startContainer);
        
        if (!currentBlock || currentBlock === this.editor) {
            currentBlock = document.createElement('p');
            currentBlock.innerHTML = '<br>';
            this.editor.appendChild(currentBlock);
            this.setCaretToStart(currentBlock);
            return;
        }
        
        const newBlock = document.createElement('p');
        
        if (range.collapsed) {
            const beforeRange = document.createRange();
            beforeRange.selectNodeContents(currentBlock);
            beforeRange.setEnd(range.startContainer, range.startOffset);
            const afterRange = document.createRange();
            afterRange.selectNodeContents(currentBlock);
            afterRange.setStart(range.startContainer, range.startOffset);
            
            const beforeContent = beforeRange.cloneContents();
            const afterContent = afterRange.cloneContents();
            
            if (beforeContent.textContent.trim()) {
                currentBlock.innerHTML = '';
                currentBlock.appendChild(beforeContent);
            } else {
                currentBlock.innerHTML = '<br>';
            }
            
            if (afterContent.textContent.trim()) {
                newBlock.appendChild(afterContent);
            } else {
                newBlock.innerHTML = '<br>';
            }
        } else {
            newBlock.innerHTML = '<br>';
        }
        
        currentBlock.parentNode.insertBefore(newBlock, currentBlock.nextSibling);
        this.setCaretToStart(newBlock);
        
        this.normalizeContent();
        this.createUndoPoint();
        this.autoSave();
    }

    handleBackspace(e) {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        
        if (this.editor.childNodes.length <= 1) {
            const onlyBlock = this.editor.firstElementChild;
            if (!onlyBlock || onlyBlock.textContent.trim() === '') {
                e.preventDefault();
                if (!onlyBlock || onlyBlock.tagName !== 'P') {
                    this.resetEditor();
                }
                return;
            }
        }
        
        if (range.collapsed && this.isAtBlockStart(range)) {
            e.preventDefault();
            
            const currentBlock = this.getClosestBlock(range.startContainer);
            if (!currentBlock || currentBlock === this.editor) return;
            
            const previousBlock = currentBlock.previousElementSibling;
            if (!previousBlock) return;
            
            this.mergeBlocks(previousBlock, currentBlock);
            this.createUndoPoint();
        }
        
        setTimeout(() => this.normalizeContent(), 0);
    }

    async handlePaste(e) {
        for (let [name, plugin] of this.plugins) {
            if (plugin.handlePaste) {
                const handled = await plugin.handlePaste(e);
                if (handled) {
                    return;
                }
            }
        }

        e.preventDefault();
        
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        
        const range = selection.getRangeAt(0);
        
        const clipboardData = e.clipboardData || window.clipboardData;
        const pastedData = clipboardData ? 
            (clipboardData.getData('text/html') || clipboardData.getData('text/plain')) : 
            null;

        const insertContent = (content) => {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            
            const hasHTML = tempDiv.children.length > 0 || /<[^>]+>/.test(content);
            
            if (!range.collapsed) {
                range.deleteContents();
            }
            
            let currentBlock = this.getClosestBlock(range.startContainer);
            
            if (!currentBlock || currentBlock === this.editor) {
                currentBlock = document.createElement('p');
                currentBlock.innerHTML = '<br>';
                this.editor.appendChild(currentBlock);
            }
            
            const cursorOffset = range.startOffset;
            const originalText = currentBlock.textContent;
            const beforeText = originalText.substring(0, cursorOffset);
            const afterText = originalText.substring(cursorOffset);
            
            if (hasHTML) {
                const sanitizedHTML = this.sanitizeHTML(content);
                currentBlock.innerHTML = beforeText + sanitizedHTML + afterText;
                const newOffset = beforeText.length + tempDiv.textContent.length;
                this.setCaretPosition(currentBlock, newOffset);
            } else {
                const plainText = tempDiv.textContent || tempDiv.innerText || '';
                const newContent = beforeText + plainText + afterText;
                currentBlock.textContent = newContent;
                const newOffset = beforeText.length + plainText.length;
                this.setCaretPosition(currentBlock, newOffset);
            }
            
            this.normalizeContent();
            this.createUndoPoint();
            this.autoSave();
            this.updateCharCount();
            this.editor.focus();
        };

        if (pastedData) {
            insertContent(pastedData);
        } else {
            try {
                document.execCommand('insertText', false, '');
                setTimeout(() => {
                    this.normalizeContent();
                    this.createUndoPoint();
                    this.autoSave();
                }, 10);
            } catch (err) {
                console.warn('Paste failed:', err);
                alert('붙여넣기에 실패했습니다. Ctrl+V를 다시 시도해주세요.');
            }
        }
    }

    handleNodeInserted(e) {
        if (e.target.nodeType === Node.TEXT_NODE && e.target.parentNode === this.editor) {
            const p = document.createElement('p');
            e.target.parentNode.insertBefore(p, e.target);
            p.appendChild(e.target);
            this.normalizeContent();
        }
    }

    getClosestBlock(node) {
        const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE'];
        while (node && node !== this.editor) {
            if (blockTags.includes(node.nodeName)) {
                return node;
            }
            node = node.parentNode;
        }
        return null;
    }

    isBlockElement(element) {
        const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE'];
        return blockTags.includes(element.tagName);
    }

    isAtBlockStart(range) {
        const block = this.getClosestBlock(range.startContainer);
        if (!block) return false;
        
        const blockRange = document.createRange();
        blockRange.selectNodeContents(block);
        blockRange.collapse(true);
        
        return range.compareBoundaryPoints(Range.START_TO_START, blockRange) === 0;
    }

    setCaretToStart(element) {
        const range = document.createRange();
        const selection = window.getSelection();
        
        let target = element.firstChild;
        while (target && target.nodeType === Node.ELEMENT_NODE && target.tagName !== 'BR') {
            target = target.firstChild;
        }
        
        if (!target) {
            range.setStart(element, 0);
        } else if (target.nodeType === Node.TEXT_NODE) {
            range.setStart(target, 0);
        } else {
            range.setStartBefore(target);
        }
        
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    setCaretPosition(element, offset) {
        const range = document.createRange();
        const selection = window.getSelection();
        
        function findTextNode(node, offset) {
            let currentOffset = 0;
            
            const walk = document.createTreeWalker(
                node,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            let textNode;
            while (textNode = walk.nextNode()) {
                const length = textNode.textContent.length;
                if (currentOffset + length >= offset) {
                    return {
                        node: textNode,
                        offset: offset - currentOffset
                    };
                }
                currentOffset += length;
            }
            
            return {
                node: walk.previousNode() || element,
                offset: walk.previousNode() ? walk.previousNode().textContent.length : 0
            };
        }
        
        const target = findTextNode(element, offset);
        
        try {
            range.setStart(target.node, Math.min(target.offset, target.node.length || 0));
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            element.focus();
        } catch (e) {
            console.warn('Caret positioning failed:', e);
            range.setStart(element, 0);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    mergeBlocks(target, source) {
        const caretPosition = target.textContent.length;
        
        if (target.innerHTML === '<br>') {
            target.innerHTML = '';
        }
        if (source.innerHTML === '<br>') {
            source.innerHTML = '';
        }
        
        while (source.firstChild) {
            target.appendChild(source.firstChild);
        }
        source.remove();
        
        this.setCaretPosition(target, caretPosition);
        this.normalizeContent();
    }

    normalizeContent() {
        const blocks = Array.from(this.editor.childNodes);
        let lastMediaBlock = null;

        blocks.forEach((node, index) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const p = document.createElement('p');
                node.parentNode.insertBefore(p, node);
                p.appendChild(node);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const isMediaBlock = node.classList?.contains('t2-media-block') ||
                                   node.classList?.contains('t2-code-block') ||
                                   node.classList?.contains('t2-file-block');

                if (isMediaBlock) {
                    node.contentEditable = false;
                    
                    let prevSibling = node.previousElementSibling;
                    let emptyCount = 0;
                    
                    while (prevSibling && prevSibling.tagName === 'P' && 
                           !prevSibling.textContent.trim() && 
                           (prevSibling.innerHTML === '<br>' || prevSibling.querySelector('br'))) {
                        emptyCount++;
                        const toRemove = prevSibling;
                        prevSibling = prevSibling.previousElementSibling;
                        
                        if (emptyCount > 1) {
                            toRemove.remove();
                        }
                    }
                    
                    let nextSibling = node.nextElementSibling;
                    emptyCount = 0;
                    
                    while (nextSibling && nextSibling.tagName === 'P' && 
                           !nextSibling.textContent.trim() && 
                           (nextSibling.innerHTML === '<br>' || nextSibling.querySelector('br'))) {
                        emptyCount++;
                        const toRemove = nextSibling;
                        nextSibling = nextSibling.nextElementSibling;
                        
                        if (emptyCount > 1) {
                            toRemove.remove();
                        }
                    }
                    
                    lastMediaBlock = node;
                } else {
                    if (!node.textContent.trim() && !node.querySelector('br, img, iframe, video')) {
                        if (this.isIOS || this.isSafari) {
                            node.innerHTML = '<br>';
                        } else {
                            node.innerHTML = '\u200B<br>';
                        }
                    }
                }
            }
        });

        if (!this.editor.firstChild) {
            const p = document.createElement('p');
            if (this.isIOS || this.isSafari) {
                p.innerHTML = '<br>';
            } else {
                p.innerHTML = '\u200B<br>';
            }
            this.editor.appendChild(p);
        }
    }

    cleanupPastedHTML(element) {
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_ELEMENT,
            null,
            false
        );
        
        const nodesToRemove = [];
        let node;
        
        while (node = walker.nextNode()) {
            node.removeAttribute('style');
            node.removeAttribute('class');
            
            if (['STYLE', 'SCRIPT', 'META'].includes(node.tagName)) {
                nodesToRemove.push(node);
            }
            
            if (this.isBlockElement(node) && !node.textContent.trim()) {
                node.innerHTML = '<br>';
            }
        }
        
        nodesToRemove.forEach(node => node.parentNode.removeChild(node));
    }

    resetEditor() {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        this.editor.innerHTML = '';
        this.editor.appendChild(p);
        this.setCaretToStart(p);
    }

    createUndoPoint() {
        const currentContent = this.editor.innerHTML;
        if (currentContent === this.lastCheckpoint) return;
        
        this.undoStack.push(this.lastCheckpoint);
        this.lastCheckpoint = currentContent;
        this.redoStack = [];
        
        if (this.undoStack.length > 100) {
            this.undoStack.shift();
        }
        
        this.updateUndoRedoButtons();
    }

    undo() {
        if (this.undoStack.length === 0) return;
        
        const currentContent = this.editor.innerHTML;
        this.redoStack.push(currentContent);
        
        const previousContent = this.undoStack.pop();
        this.lastCheckpoint = previousContent;
        this.editor.innerHTML = previousContent;
        
        this.updateUndoRedoButtons();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        
        const currentContent = this.editor.innerHTML;
        this.undoStack.push(currentContent);
        
        const nextContent = this.redoStack.pop();
        this.lastCheckpoint = nextContent;
        this.editor.innerHTML = nextContent;
        
        this.updateUndoRedoButtons();
    }

    updateUndoRedoButtons() {
        this.undoBtn.disabled = this.undoStack.length === 0;
        this.redoBtn.disabled = this.redoStack.length === 0;
    }

    execCommand(command, value = null) {
        document.execCommand('styleWithCSS', false, true);
        
        switch(command) {
            case 'fontSize':
                const selection = window.getSelection();
                const range = selection.getRangeAt(0);
                
                const span = document.createElement('span');
                span.style.fontSize = value + 'px';
                
                const existingSpan = range.commonAncestorContainer.parentElement;
                if (existingSpan && existingSpan.style.fontSize) {
                    existingSpan.style.fontSize = value + 'px';
                } else {
                    range.surroundContents(span);
                }
                break;
            default:
                document.execCommand(command, false, value);
        }
        
        this.normalizeContent();
    }

    saveSelection() {
        if (window.getSelection) {
            this.savedSelection = window.getSelection().getRangeAt(0).cloneRange();
        }
    }

    restoreSelection() {
        if (this.savedSelection) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(this.savedSelection);
        }
    }

    setupAutoSaveToggle() {
        const statusBar = this.container.querySelector('.t2-editor-status');
        const autoSaveToggle = document.createElement('div');
        autoSaveToggle.className = 't2-autosave-toggle';

        const toggleId = `t2-autosave-${this.generateUid()}`;

        autoSaveToggle.innerHTML = `
            <label class="t2-switch" for="${toggleId}">
                <input type="checkbox" id="${toggleId}" ${this.autoSaveEnabled ? 'checked' : ''}>
                <span class="t2-slider"></span>
            </label>
            <label for="${toggleId}" class="t2-autosave-text">자동 저장</label>
        `;

        const toggleCheckbox = autoSaveToggle.querySelector('input[type="checkbox"]');
        
        toggleCheckbox.addEventListener('change', (e) => {
            this.autoSaveEnabled = e.target.checked;
            localStorage.setItem('t2editor-autosave-enabled', this.autoSaveEnabled);

            if (!this.autoSaveEnabled) {
                this.clearAutoSave();
            } else {
                this.autoSave();
            }
        });

        const logo = statusBar.querySelector('.t2-logo').parentElement;
        logo.parentNode.insertBefore(autoSaveToggle, logo.nextSibling);
    }

    autoSave() {
        if (this.collab && this.collab.isActive) {
            return;
        }

        if (!this.autoSaveEnabled) return;

        const content = this.editor.innerHTML;
        const normalizedContent = content.replace(/<p>\s*<\/p>/g, '<p><br></p>');
        
        try {
            localStorage.setItem('t2editor-autosave', normalizedContent);
            console.log('AutoSave: Content saved to localStorage');
        } catch (e) {
            console.error('AutoSave failed:', e);
            if (e.name === 'QuotaExceededError') {
                console.warn('LocalStorage quota exceeded. AutoSave disabled.');
                this.autoSaveEnabled = false;
                localStorage.setItem('t2editor-autosave-enabled', 'false');
            }
        }
    }

    loadAutoSave() {
        if (this.collab && this.collab.isActive) {
            return;
        }

        if (!this.autoSaveEnabled) return;

        try {
            const saved = localStorage.getItem('t2editor-autosave');
            if (saved && saved.trim() !== '') {
                const currentContent = this.editor.innerHTML;
                const isEmpty = !currentContent || 
                               currentContent === '<p><br></p>' || 
                               currentContent === '<p>\u200B<br></p>' ||
                               currentContent.trim() === '';
                
                if (isEmpty) {
                    this.editor.innerHTML = saved;
                    this.normalizeContent();
                    console.log('AutoSave: Content restored from localStorage');
                }
            }
        } catch (e) {
            console.error('LoadAutoSave failed:', e);
        }
    }

    clearAutoSave() {
        try {
            localStorage.removeItem('t2editor-autosave');
            console.log('AutoSave: Cleared localStorage');
        } catch (e) {
            console.error('ClearAutoSave failed:', e);
        }
    }

    setupBeforeUnload() {
        window.addEventListener('beforeunload', (e) => {
            if (!(this.collab && this.collab.isActive) && this.autoSaveEnabled) {
                const content = this.editor.innerHTML;
                const normalizedContent = content.replace(/<p>\s*<\/p>/g, '<p><br></p>');
                try {
                    localStorage.setItem('t2editor-autosave', normalizedContent);
                } catch (err) {
                    console.error('BeforeUnload save failed:', err);
                }
            }
        });
        
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && this.autoSaveEnabled) {
                if (!(this.collab && this.collab.isActive)) {
                    this.autoSave();
                }
            }
        });
    }

    updateCharCount() {
        let text = this.editor.textContent;
        text = text.replace(/\s+/g, '');
        this.charCount.textContent = text.length;
    }

    showFontSizeList(button) {
        const sizes = ['11', '13', '15', '16', '19', '24', '30', '34', '38'];
        const list = document.createElement('div');
        list.className = 't2-font-size-list';
        list.style.cssText = `
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 5px 0;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            min-width: 120px;
        `;
        
        const currentFontSize = this.getCurrentFontSize();
        
        sizes.forEach(size => {
            const option = document.createElement('div');
            option.className = 't2-font-size-option';
            
            const isCurrentSize = parseInt(size) === currentFontSize;
            
            const optionContent = document.createElement('div');
            optionContent.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                width: 100%;
            `;
            
            const sizeText = document.createElement('span');
            sizeText.textContent = `${size}px`;
            optionContent.appendChild(sizeText);
            
            if (isCurrentSize) {
                const checkmark = document.createElement('span');
                checkmark.className = 'material-icons';
                checkmark.textContent = 'check';
                checkmark.style.fontSize = '16px';
                checkmark.style.color = '#1a73e8';
                optionContent.appendChild(checkmark);
            }
            
            option.appendChild(optionContent);
            
            option.style.cssText = `
                padding: 5px 15px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.1s ease;
                ${isCurrentSize ? 'background-color: #e8f0fe; font-weight: 500;' : ''}
            `;
            
            option.addEventListener('mouseenter', () => {
                option.style.backgroundColor = isCurrentSize ? '#d2e3fc' : '#f5f5f5';
            });
            
            option.addEventListener('mouseleave', () => {
                option.style.backgroundColor = isCurrentSize ? '#e8f0fe' : 'transparent';
            });
            
            option.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.execCommand('fontSize', size);
                list.parentElement.remove();
                this.createUndoPoint();
            });
            
            list.appendChild(option);
        });
        
        this.showDropdown(list, button);
    }

    getCurrentFontSize() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;
        
        const range = selection.getRangeAt(0);
        let node = range.commonAncestorContainer;
        
        if (node.nodeType === Node.TEXT_NODE) {
            node = node.parentNode;
        }
        
        while (node && node !== this.editor) {
            const fontSize = window.getComputedStyle(node).fontSize;
            if (fontSize && fontSize !== 'inherit') {
                return parseInt(fontSize);
            }
            node = node.parentNode;
        }
        
        return parseInt(window.getComputedStyle(this.editor).fontSize);
    }

    showColorPalette(command, button) {
        const self = this;

        const buttonRect = button.getBoundingClientRect();
        const toolbarRect = this.toolbar.getBoundingClientRect();
        const viewportWidth = window.innerWidth;

        const pickerHeight = 325;
        const pickerWidth = pickerHeight * 0.65;

        const pickerContainer = document.createElement('div');
        pickerContainer.className = 't2-color-picker-container';

        let left = buttonRect.left - toolbarRect.left;

        if (buttonRect.left + pickerWidth > viewportWidth - 10) {
            left = viewportWidth - toolbarRect.left - pickerWidth - 10;
        }

        if (left < 0) {
            left = 0;
        }

        pickerContainer.style.cssText = `
            position: absolute;
            background: white;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            padding: 12px;
            width: ${pickerWidth}px;
            height: ${pickerHeight}px;
            left: ${left}px;
            top: ${buttonRect.bottom - toolbarRect.top + 8}px;
            z-index: 10000;
            overflow: hidden;
            border: 1px solid #ddd;
        `;

        let currentHue = 0;
        let currentSaturation = 100;
        let currentLightness = 50;

        const updateColor = () => {
            const hex = hslToHex(currentHue, currentSaturation, currentLightness);
            colorPreview.style.backgroundColor = hex;
            colorInput.value = hex;
            updateSaturationSlider();
            updateLightnessSlider();
        };

        const hueSlider = document.createElement('div');
        hueSlider.style.cssText = `
            display: flex;
            gap: 4px;
            margin-bottom: 8px;
            overflow-x: auto;
            padding-bottom: 2px;
        `;
        const hueColors = [
            { hue: 0, color: '#ef4444' }, { hue: 30, color: '#f97316' },
            { hue: 60, color: '#eab308' }, { hue: 120, color: '#22c55e' },
            { hue: 200, color: '#3b82f6' }, { hue: 270, color: '#a855f7' },
            { hue: 330, color: '#ec4899' }, { hue: 240, color: '#6366f1' },
            { hue: 180, color: '#14b8a6' }, { hue: 190, color: '#06b6d4' }
        ];
        hueColors.forEach(({ hue, color }) => {
            const circle = document.createElement('div');
            circle.style.cssText = `
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background-color: ${color};
                cursor: pointer;
                flex-shrink: 0;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                transition: transform 0.15s;
            `;
            circle.addEventListener('mouseenter', () => circle.style.transform = 'scale(1.08)');
            circle.addEventListener('mouseleave', () => circle.style.transform = 'scale(1)');
            circle.addEventListener('click', () => {
                currentHue = hue;
                drawRainbowCanvas();
                updateColor();
                updateIndicators();
            });
            hueSlider.appendChild(circle);
        });

        const mainArea = document.createElement('div');
        mainArea.style.cssText = `display: flex; gap: 8px; margin-bottom: 8px; height: ${pickerHeight * 0.5}px;`;

        const canvasWrapper = document.createElement('div');
        canvasWrapper.style.cssText = `flex: 1; position: relative; border-radius: 12px; overflow: hidden; cursor: crosshair; touch-action: none;`;
        const rainbowCanvas = document.createElement('canvas');
        rainbowCanvas.style.cssText = `width: 100%; height: 100%; display: block;`;
        canvasWrapper.appendChild(rainbowCanvas);

        const mainIndicator = document.createElement('div');
        mainIndicator.style.cssText = `
            position: absolute;
            width: 12px;
            height: 12px;
            border: 2px solid white;
            border-radius: 50%;
            box-shadow: 0 1px 4px rgba(0,0,0,0.3);
            transform: translate(-50%,-50%);
            pointer-events: none;
            left: 50%;
            top: 50%;
        `;
        canvasWrapper.appendChild(mainIndicator);

        const lightnessSlider = document.createElement('div');
        lightnessSlider.style.cssText = `
            width: 24px;
            border-radius: 8px;
            position: relative;
            cursor: pointer;
            touch-action: none;
        `;
        const lightHandle = document.createElement('div');
        lightHandle.style.cssText = `
            position: absolute;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: white;
            border: 2px solid #d1d5db;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            left: 50%;
            transform: translate(-50%, -50%);
            top: 50%;
        `;
        lightnessSlider.appendChild(lightHandle);

        mainArea.appendChild(canvasWrapper);
        mainArea.appendChild(lightnessSlider);

        const saturationSlider = document.createElement('div');
        saturationSlider.style.cssText = `
            width: 100%;
            height: 20px;
            border-radius: 8px;
            position: relative;
            cursor: pointer;
            margin-bottom: 8px;
            touch-action: none;
            background: linear-gradient(to right, #888, red);
        `;
        const satHandle = document.createElement('div');
        satHandle.style.cssText = `
            position: absolute;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: white;
            border: 2px solid #d1d5db;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            top: 50%;
            left: 100%;
            transform: translate(-50%,-50%);
        `;
        saturationSlider.appendChild(satHandle);

        const previewArea = document.createElement('div');
        previewArea.style.cssText = `display:flex; align-items:center; gap:8px; margin-bottom:10px;`;
        const colorPreview = document.createElement('div');
        colorPreview.style.cssText = `
            width: 28px;
            height: 28px;
            border-radius: 50%;
            box-shadow: 0 1px 6px rgba(0,0,0,0.15);
            flex-shrink: 0;
            background-color: #ff0000;
        `;
        const colorInput = document.createElement('input');
        colorInput.type = 'text';
        colorInput.value = '#ff0000';
        colorInput.style.cssText = `
            flex: 1;
            padding: 5px 0;
            padding-left:2px;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            font-family: monospace;
            font-size: 12px;
            color: #1f2937;
            outline: none;
        `;
        previewArea.appendChild(colorPreview);
        previewArea.appendChild(colorInput);

        const applyButton = document.createElement('button');
        applyButton.textContent = '적용';
        applyButton.style.cssText = `
            width: 100%;
            padding: 8px;
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
        `;

        pickerContainer.appendChild(hueSlider);
        pickerContainer.appendChild(mainArea);
        pickerContainer.appendChild(saturationSlider);
        pickerContainer.appendChild(previewArea);
        pickerContainer.appendChild(applyButton);
        this.toolbar.appendChild(pickerContainer);

        function drawRainbowCanvas() {
            const rect = rainbowCanvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            rainbowCanvas.width = Math.round(rect.width * dpr);
            rainbowCanvas.height = Math.round(rect.height * dpr);
            rainbowCanvas.style.width = rect.width + 'px';
            rainbowCanvas.style.height = rect.height + 'px';
            const ctx = rainbowCanvas.getContext('2d');
            ctx.clearRect(0, 0, rainbowCanvas.width, rainbowCanvas.height);

            for (let x = 0; x < rainbowCanvas.width; x++) {
                const hue = (x / Math.max(1, (rainbowCanvas.width - 1))) * 360;
                ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
                ctx.fillRect(x, 0, 1, rainbowCanvas.height);
            }

            let g1 = ctx.createLinearGradient(0, 0, 0, rainbowCanvas.height/2);
            g1.addColorStop(0, 'rgba(255,255,255,1)');
            g1.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g1;
            ctx.fillRect(0, 0, rainbowCanvas.width, rainbowCanvas.height/2);

            let g2 = ctx.createLinearGradient(0, rainbowCanvas.height/2, 0, rainbowCanvas.height);
            g2.addColorStop(0, 'rgba(0,0,0,0)');
            g2.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = g2;
            ctx.fillRect(0, rainbowCanvas.height/2, rainbowCanvas.width, rainbowCanvas.height/2);
        }

        function updateSaturationSlider() {
            const leftColor = `hsl(${currentHue}, 0%, ${currentLightness}%)`;
            const rightColor = `hsl(${currentHue}, 100%, ${currentLightness}%)`;
            saturationSlider.style.background = `linear-gradient(to right, ${leftColor}, ${rightColor})`;
            satHandle.style.left = `${currentSaturation}%`;
        }

        function updateLightnessSlider() {
            const topColor = `hsl(${currentHue}, ${currentSaturation}%, 100%)`;
            const bottomColor = `hsl(${currentHue}, ${currentSaturation}%, 0%)`;
            lightnessSlider.style.background = `linear-gradient(to bottom, ${topColor}, ${bottomColor})`;
            lightHandle.style.top = `${100 - currentLightness}%`;
        }

        function updateIndicators() {
            const xPercent = (currentHue / 360) * 100;
            const yPercent = (100 - currentLightness);
            mainIndicator.style.left = `${xPercent}%`;
            mainIndicator.style.top = `${yPercent}%`;
        }

        let draggingMain = false;
        let draggingSat = false;
        let draggingLight = false;
        let activePointerId = null;

        function handleMainMove(e) {
            const rect = rainbowCanvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
            currentHue = Math.round(x * 360);
            currentLightness = Math.round((1 - y) * 100);
            updateColor();
            updateIndicators();
        }

        function handleSatMove(e) {
            const rect = saturationSlider.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            currentSaturation = Math.round(x * 100);
            updateColor();
            updateIndicators();
        }

        function handleLightMove(e) {
            const rect = lightnessSlider.getBoundingClientRect();
            const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
            currentLightness = Math.round((1 - y) * 100);
            updateColor();
            updateIndicators();
        }

        if (window.PointerEvent) {
            rainbowCanvas.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                draggingMain = true;
                activePointerId = e.pointerId;
                try { rainbowCanvas.setPointerCapture(e.pointerId); } catch (err) {}
                handleMainMove(e);
            });
            rainbowCanvas.addEventListener('pointermove', (e) => {
                if (draggingMain && e.pointerId === activePointerId) handleMainMove(e);
            });
            rainbowCanvas.addEventListener('pointerup', (e) => {
                if (e.pointerId === activePointerId) {
                    draggingMain = false;
                    try { rainbowCanvas.releasePointerCapture(e.pointerId); } catch (err) {}
                    activePointerId = null;
                }
            });
            rainbowCanvas.addEventListener('pointercancel', () => { draggingMain = false; activePointerId = null; });

            saturationSlider.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                draggingSat = true;
                activePointerId = e.pointerId;
                try { saturationSlider.setPointerCapture(e.pointerId); } catch (err) {}
                handleSatMove(e);
            });
            satHandle.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                draggingSat = true;
                activePointerId = e.pointerId;
                try { satHandle.setPointerCapture(e.pointerId); } catch (err) {}
                handleSatMove(e);
            });
            document.addEventListener('pointermove', (e) => { if (draggingSat && e.pointerId === activePointerId) handleSatMove(e); });
            document.addEventListener('pointerup', (e) => {
                if (draggingSat && e.pointerId === activePointerId) {
                    draggingSat = false;
                    try { saturationSlider.releasePointerCapture(e.pointerId); } catch (err) {}
                    try { satHandle.releasePointerCapture(e.pointerId); } catch (err) {}
                    activePointerId = null;
                }
            });

            lightnessSlider.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                draggingLight = true;
                activePointerId = e.pointerId;
                try { lightnessSlider.setPointerCapture(e.pointerId); } catch (err) {}
                handleLightMove(e);
            });
            lightHandle.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                draggingLight = true;
                activePointerId = e.pointerId;
                try { lightHandle.setPointerCapture(e.pointerId); } catch (err) {}
                handleLightMove(e);
            });
            document.addEventListener('pointermove', (e) => { if (draggingLight && e.pointerId === activePointerId) handleLightMove(e); });
            document.addEventListener('pointerup', (e) => {
                if (draggingLight && e.pointerId === activePointerId) {
                    draggingLight = false;
                    try { lightnessSlider.releasePointerCapture(e.pointerId); } catch (err) {}
                    try { lightHandle.releasePointerCapture(e.pointerId); } catch (err) {}
                    activePointerId = null;
                }
            });
        } else {
            rainbowCanvas.addEventListener('mousedown', (e) => { draggingMain = true; handleMainMove(e); });
            document.addEventListener('mousemove', (e) => { if (draggingMain) handleMainMove(e); });
            document.addEventListener('mouseup', () => { draggingMain = false; });

            saturationSlider.addEventListener('mousedown', (e) => { draggingSat = true; handleSatMove(e); });
            satHandle.addEventListener('mousedown', (e) => { draggingSat = true; handleSatMove(e); });
            document.addEventListener('mousemove', (e) => { if (draggingSat) handleSatMove(e); });
            document.addEventListener('mouseup', () => { draggingSat = false; });

            lightnessSlider.addEventListener('mousedown', (e) => { draggingLight = true; handleLightMove(e); });
            lightHandle.addEventListener('mousedown', (e) => { draggingLight = true; handleLightMove(e); });
            document.addEventListener('mousemove', (e) => { if (draggingLight) handleLightMove(e); });
            document.addEventListener('mouseup', () => { draggingLight = false; });
        }

        colorInput.addEventListener('input', () => {
            const hex = colorInput.value.trim();
            if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                const hsl = hexToHsl(hex);
                currentHue = hsl.h;
                currentSaturation = hsl.s;
                currentLightness = hsl.l;
                drawRainbowCanvas();
                updateColor();
                updateIndicators();
            }
        });

        applyButton.addEventListener('click', () => {
            if (self.restoreSelection) self.restoreSelection();
            if (self.execCommand) self.execCommand(command, colorInput.value);
            closeModal();
            if (self.createUndoPoint) self.createUndoPoint();
        });

        function closeModal() {
            if (pickerContainer.parentNode) pickerContainer.parentNode.removeChild(pickerContainer);
            document.removeEventListener('mousedown', closeHandler);
            document.removeEventListener('keydown', handleEsc);
            window.removeEventListener('resize', resizeHandler);
            draggingMain = draggingSat = draggingLight = false;
            activePointerId = null;
        }

        const closeHandler = (e) => {
            if (!pickerContainer.contains(e.target) && e.target !== button) {
                closeModal();
            }
        };

        const handleEsc = (e) => {
            if (e.key === 'Escape') closeModal();
        };

        const resizeHandler = () => {
            requestAnimationFrame(() => {
                drawRainbowCanvas();
                updateIndicators();
                updateSaturationSlider();
                updateLightnessSlider();
            });
        };
        window.addEventListener('resize', resizeHandler);

        requestAnimationFrame(() => {
            document.addEventListener('mousedown', closeHandler);
            document.addEventListener('keydown', handleEsc);
        });

        function initialSetup() {
            drawRainbowCanvas();
            updateSaturationSlider();
            updateLightnessSlider();
            updateIndicators();
            updateColor();
        }
        requestAnimationFrame(initialSetup);

        function hslToHex(h, s, l) {
            l /= 100;
            const a = s * Math.min(l, 1 - l) / 100;
            const f = n => {
                const k = (n + h / 30) % 12;
                const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
                return Math.round(255 * color).toString(16).padStart(2, '0');
            };
            return `#${f(0)}${f(8)}${f(4)}`;
        }
        function hexToHsl(hex) {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            if (!result) return { h: 0, s: 0, l: 0 };
            let r = parseInt(result[1], 16) / 255;
            let g = parseInt(result[2], 16) / 255;
            let b = parseInt(result[3], 16) / 255;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            let h, s, l = (max + min) / 2;
            if (max === min) {
                h = s = 0;
            } else {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                    case g: h = ((b - r) / d + 2) / 6; break;
                    case b: h = ((r - g) / d + 4) / 6; break;
                }
            }
            return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
        }
    }

    toggleAlignment(button) {
        const alignments = ['left', 'center', 'right'];
        const commands = ['justifyLeft', 'justifyCenter', 'justifyRight'];
        const icons = ['format_align_left', 'format_align_center', 'format_align_right'];
        
        let currentIndex = alignments.indexOf(this.alignmentState);
        currentIndex = (currentIndex + 1) % alignments.length;
        
        this.alignmentState = alignments[currentIndex];
        button.querySelector('.material-icons').textContent = icons[currentIndex];
        
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const block = this.getClosestBlock(range.commonAncestorContainer);
        
        if (block) {
            block.style.textAlign = this.alignmentState;
        }
        
        this.execCommand(commands[currentIndex]);
        this.createUndoPoint();
    }

    showDropdown(element, button) {
        const buttonRect = button.getBoundingClientRect();
        const toolbarRect = this.toolbar.getBoundingClientRect();
        
        const dropdownContainer = document.createElement('div');
        dropdownContainer.style.cssText = `
            position: absolute;
            top: ${buttonRect.bottom - toolbarRect.top}px;
            left: ${buttonRect.left - toolbarRect.left}px;
            z-index: 10000;
        `;
        
        dropdownContainer.appendChild(element);
        this.toolbar.appendChild(dropdownContainer);
        
        const dropdownRect = element.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        
        if (dropdownRect.right > viewportWidth) {
            const overflow = dropdownRect.right - viewportWidth;
            dropdownContainer.style.left = `${parseInt(dropdownContainer.style.left) - overflow - 10}px`;
        }
        
        const closeHandler = (e) => {
            if (!element.contains(e.target) && e.target !== button) {
                dropdownContainer.remove();
                document.removeEventListener('mousedown', closeHandler);
            }
        };
        
        requestAnimationFrame(() => {
            document.addEventListener('mousedown', closeHandler);
        });
    }

    insertAtCursor(element) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        let currentBlock = this.getClosestBlock(range.startContainer);

        if (!currentBlock || currentBlock === this.editor) {
            currentBlock = document.createElement('p');
            currentBlock.innerHTML = '<br>';
            this.editor.appendChild(currentBlock);
        }

        const wrapper = document.createElement('p');
        wrapper.appendChild(element);
        currentBlock.parentNode.insertBefore(wrapper, currentBlock.nextSibling);

        this.normalizeContent();
        this.createUndoPoint();
    }

    // =============================================
    // 콘텐츠 마이그레이션
    // =============================================

    /**
     * 타 에디터로 작성된 콘텐츠인지 감지.
     * 반환: true = 외부 에디터 콘텐츠, false = T2Editor 네이티브 or 단순 텍스트
     */
    detectForeignContent(html) {
        if (!html || !html.trim()) return false;

        const temp = document.createElement('div');
        temp.innerHTML = html;

        // T2Editor 네이티브 클래스가 있으면 자체 콘텐츠
        if (temp.querySelector('[class*="t2-"]')) return false;

        // 알려진 타 에디터 시그니처
        const foreignSelectors = [
            '[class*="ql-"]',          // Quill
            '[class*="mce-"]',         // TinyMCE
            '[data-mce-src]',
            '[data-mce-href]',
            '[class*="ck-"]',          // CKEditor 5
            '[data-cke-saved-src]',    // CKEditor 4
            '[data-cke-saved-href]',
            '[class*="fr-"]',          // Froala
            '[class*="note-"]',        // Summernote
            '[class*="ProseMirror"]',  // ProseMirror 기반
            '[class*="trix-"]',        // Trix
        ];
        for (const sel of foreignSelectors) {
            if (temp.querySelector(sel)) return true;
        }

        // 리치 미디어/구조 요소가 있으면 외부 에디터로 간주
        const richTags = ['img', 'iframe', 'table', 'pre', 'figure', 'blockquote',
                          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol'];
        for (const tag of richTags) {
            if (temp.querySelector(tag)) return true;
        }

        // 인라인 스타일이 과도하게 붙어 있는 경우 (복붙 등)
        const styledEls = temp.querySelectorAll('[style]');
        if (styledEls.length >= 3) return true;

        return false;
    }

    /**
     * 외부 에디터 HTML → T2Editor 전용 구조로 변환.
     */
    migrateContent(html) {
        const temp = document.createElement('div');
        temp.innerHTML = html;

        // 1. 알려진 외부 에디터 클래스/속성 제거
        const foreignAttrPatterns = [
            'data-mce-src', 'data-mce-href', 'data-mce-style',
            'data-cke-saved-src', 'data-cke-saved-href',
        ];
        temp.querySelectorAll('*').forEach(el => {
            foreignAttrPatterns.forEach(attr => el.removeAttribute(attr));

            if (el.className && typeof el.className === 'string') {
                const isForeign = /\b(ql-|mce-|ck-|fr-|note-|ProseMirror|trix-)/.test(el.className);
                if (isForeign) el.removeAttribute('class');
            }
        });

        // 2. figure/figcaption 언랩 (자식 노드를 부모로 올림, figcaption 제거)
        temp.querySelectorAll('figcaption').forEach(fc => fc.remove());
        temp.querySelectorAll('figure').forEach(figure => {
            const frag = document.createDocumentFragment();
            while (figure.firstChild) frag.appendChild(figure.firstChild);
            figure.parentNode.replaceChild(frag, figure);
        });

        // 3. blockquote → 스타일 적용된 p
        temp.querySelectorAll('blockquote').forEach(bq => {
            const p = document.createElement('p');
            p.style.cssText = 'border-left:3px solid #ccc; padding-left:14px; color:#555; margin:8px 0;';
            p.innerHTML = bq.innerHTML;
            bq.parentNode.replaceChild(p, bq);
        });

        // 4. img → t2-media-block
        // 깊은 복사 순회이므로 querySelectorAll 스냅샷 사용
        Array.from(temp.querySelectorAll('img')).forEach(img => {
            if (img.closest('.t2-media-block')) return;
            const block = this._migration_createImageBlock(img);
            img.parentNode.replaceChild(block, img);
        });

        // 5. iframe → t2-media-block
        Array.from(temp.querySelectorAll('iframe')).forEach(iframe => {
            if (iframe.closest('.t2-media-block')) return;
            const block = this._migration_createIframeBlock(iframe);
            iframe.parentNode.replaceChild(block, iframe);
        });

        // 6. pre → t2-code-block
        Array.from(temp.querySelectorAll('pre')).forEach(pre => {
            if (pre.closest('.t2-code-block')) return;
            const block = this._migration_createCodeBlock(pre);
            pre.parentNode.replaceChild(block, pre);
        });

        // 7. table → t2-table-wrapper
        Array.from(temp.querySelectorAll('table')).forEach(table => {
            if (table.closest('.t2-table-wrapper')) return;
            const block = this._migration_createTableBlock(table);
            table.parentNode.replaceChild(block, table);
        });

        // 8. h1-h6 유지 (T2Editor는 block으로 취급), div → p 변환
        Array.from(temp.querySelectorAll('div')).forEach(div => {
            if (div.querySelector('.t2-media-block, .t2-code-block, .t2-table-wrapper, .t2-file-block')) return;
            const p = document.createElement('p');
            p.innerHTML = div.innerHTML;
            // 인라인 스타일 중 text-align만 유지
            const align = div.style.textAlign;
            if (align) p.style.textAlign = align;
            div.parentNode.replaceChild(p, div);
        });

        // 9. 최상위 텍스트 노드 → p 래핑
        Array.from(temp.childNodes).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                const p = document.createElement('p');
                node.parentNode.insertBefore(p, node);
                p.appendChild(node);
            }
        });

        console.log('T2Editor: 마이그레이션 완료');
        return temp.innerHTML;
    }

    _migration_createImageBlock(img) {
        const block = document.createElement('div');
        block.className = 't2-media-block';
        block.contentEditable = false;

        const inner = document.createElement('div');
        // 원본 width/height 스타일 보존
        const w = img.getAttribute('width') || img.style.width || '';
        const h = img.getAttribute('height') || img.style.height || '';
        let styleStr = 'display:inline-block; max-width:100%; position:relative;';
        if (w) styleStr += ` width:${isNaN(w) ? w : w + 'px'};`;
        if (h) styleStr += ` height:${isNaN(h) ? h : h + 'px'};`;
        inner.style.cssText = styleStr;

        const newImg = img.cloneNode(true);
        newImg.style.maxWidth = '100%';
        newImg.style.display = 'block';
        // 불필요한 width/height 어트리뷰트 제거 (style로 대체)
        newImg.removeAttribute('width');
        newImg.removeAttribute('height');

        inner.appendChild(newImg);
        block.appendChild(inner);
        return block;
    }

    _migration_createIframeBlock(iframe) {
        const block = document.createElement('div');
        block.className = 't2-media-block';
        block.contentEditable = false;

        const inner = document.createElement('div');
        const w = iframe.getAttribute('width') || '560';
        const h = iframe.getAttribute('height') || '315';
        inner.style.cssText = `display:inline-block; width:${isNaN(w) ? w : w + 'px'}; height:${isNaN(h) ? h : h + 'px'};`;

        const newIframe = iframe.cloneNode(true);
        newIframe.style.width = '100%';
        newIframe.style.height = '100%';
        newIframe.setAttribute('allowfullscreen', '');

        inner.appendChild(newIframe);
        block.appendChild(inner);
        return block;
    }

    _migration_createCodeBlock(pre) {
        const codeEl = pre.querySelector('code');
        const content = codeEl ? codeEl.textContent : pre.textContent;
        const langMatch = codeEl?.className?.match(/language-(\w+)/);
        const lang = langMatch ? langMatch[1] : 'text';

        const block = document.createElement('div');
        block.className = 't2-code-block';
        block.contentEditable = false;
        block.setAttribute('data-language', lang);

        const header = document.createElement('div');
        header.className = 't2-code-header';
        header.innerHTML = `<span class="t2-code-language">${lang}</span>`;

        const newPre = document.createElement('pre');
        const newCode = document.createElement('code');
        if (lang !== 'text') newCode.className = `language-${lang}`;
        newCode.textContent = content;
        newPre.appendChild(newCode);

        block.appendChild(header);
        block.appendChild(newPre);
        return block;
    }

    _migration_createTableBlock(table) {
        const wrapper = document.createElement('div');
        wrapper.className = 't2-table-wrapper';
        wrapper.contentEditable = false;

        const newTable = table.cloneNode(true);
        if (!newTable.classList.contains('t2-table')) newTable.classList.add('t2-table');

        const isLarge = newTable.rows.length > 10 ||
                        (newTable.rows[0] && newTable.rows[0].cells.length > 10);

        if (isLarge) {
            newTable.classList.add('t2-table-large');
            const scrollWrapper = document.createElement('div');
            scrollWrapper.className = 't2-table-scroll-wrapper';
            scrollWrapper.appendChild(newTable);
            wrapper.appendChild(scrollWrapper);
        } else {
            wrapper.appendChild(newTable);
        }

        return wrapper;
    }

    /**
     * 마이그레이션 확인 팝업 표시.
     * 확인 시 migratedHtml로 에디터 재설정.
     */
    showMigrationPrompt(originalHtml) {
        const self = this;

        // 다크모드 감지
        const isDark = document.documentElement.getAttribute('data-t2editor-theme') === 'dark';

        const overlay = document.createElement('div');
        overlay.className = 't2-migration-overlay';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.45);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: t2FadeIn 0.15s ease;
        `;

        const dialog = document.createElement('div');
        dialog.className = 't2-migration-dialog';
        dialog.style.cssText = `
            background: ${isDark ? '#1e1e2e' : '#ffffff'};
            color: ${isDark ? '#cdd6f4' : '#1f2937'};
            border-radius: 14px;
            padding: 28px 32px 24px;
            max-width: 400px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.25);
            border: 1px solid ${isDark ? '#313244' : '#e5e7eb'};
            text-align: center;
            animation: t2SlideUp 0.2s ease;
        `;

        dialog.innerHTML = `
            <style>
                @keyframes t2FadeIn { from { opacity:0 } to { opacity:1 } }
                @keyframes t2SlideUp { from { transform:translateY(12px); opacity:0 } to { transform:translateY(0); opacity:1 } }
                .t2-mig-icon { font-size:40px; margin-bottom:12px; }
                .t2-mig-title { font-size:17px; font-weight:700; margin-bottom:8px; }
                .t2-mig-desc { font-size:13px; line-height:1.6; opacity:0.75; margin-bottom:22px; }
                .t2-mig-actions { display:flex; gap:10px; justify-content:center; }
                .t2-mig-btn {
                    padding: 9px 22px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    border: none;
                    transition: opacity 0.15s, transform 0.1s;
                }
                .t2-mig-btn:hover { opacity:0.85; transform:translateY(-1px); }
                .t2-mig-btn:active { transform:translateY(0); }
                .t2-mig-btn-cancel {
                    background: ${isDark ? '#313244' : '#f3f4f6'};
                    color: ${isDark ? '#cdd6f4' : '#374151'};
                }
                .t2-mig-btn-confirm {
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: #fff;
                }
            </style>
            <div class="t2-mig-icon">
                <span class="material-icons" style="font-size:40px; color:#667eea; vertical-align:middle;">transform</span>
            </div>
            <div class="t2-mig-title">콘텐츠 변환</div>
            <div class="t2-mig-desc">
                다른 에디터로 작성된 콘텐츠가 감지되었습니다.<br>
                T2Editor 전용 형식으로 변환하시겠습니까?
            </div>
            <div class="t2-mig-actions">
                <button class="t2-mig-btn t2-mig-btn-cancel">취소</button>
                <button class="t2-mig-btn t2-mig-btn-confirm">변환</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // ESC 닫기
        const escHandler = (e) => {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('keydown', escHandler);

        // 오버레이 외부 클릭 닫기
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        function close() {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }

        dialog.querySelector('.t2-mig-btn-cancel').addEventListener('click', close);

        dialog.querySelector('.t2-mig-btn-confirm').addEventListener('click', () => {
            close();
            const migratedHtml = self.migrateContent(originalHtml);
            self._doSetContent(migratedHtml);
            self.createUndoPoint();
            T2Utils.showNotification('콘텐츠가 T2Editor 형식으로 변환되었습니다.', 'success', 2500);
        });
    }

    // =============================================
    // setContent: 마이그레이션 게이트웨이
    // =============================================

    setContent(html) {
        if (!html) return;

        if (this.migrationMode !== false && this.detectForeignContent(html)) {
            if (this.migrationMode === 'auto') {
                console.log('T2Editor: 자동 마이그레이션 실행');
                html = this.migrateContent(html);
                this._doSetContent(html);
            } else {
                // 'prompt': 원본 콘텐츠 먼저 표시 후 팝업
                this._doSetContent(html);
                // DOM 렌더링 후 팝업 표시
                setTimeout(() => this.showMigrationPrompt(html), 150);
            }
        } else {
            this._doSetContent(html);
        }
    }

    /**
     * 실제 에디터 콘텐츠 설정 (구 setContent 로직)
     */
    _doSetContent(html) {
        this.editor.innerHTML = html;

        const essentialPlugins = ['image', 'code', 'video', 'file', 'table'];
        const allLoaded = essentialPlugins.every(name =>
            this.pluginLoadStatus.get(name) === 'loaded'
        );

        if (allLoaded) {
            this.processContentSet(html);
        } else {
            console.log('Plugins not ready, queuing content initialization');
            this.contentSetQueue = html;

            setTimeout(() => {
                if (this.contentSetQueue) {
                    console.warn('Timeout: Processing content without all plugins');
                    this.processContentSet(this.contentSetQueue);
                    this.contentSetQueue = null;
                }
            }, 3000);
        }
    }

    processContentSet(html) {
        console.log('Processing content set with plugins');
        
        for (let [name, plugin] of this.plugins) {
            if (plugin.onContentSet) {
                try {
                    plugin.onContentSet(html);
                } catch (error) {
                    console.error(`Plugin ${name} onContentSet failed:`, error);
                }
            }
        }
        
        this.normalizeContent();
        
        setTimeout(() => {
            for (let [name, plugin] of this.plugins) {
                if (plugin.initializeImageBlocks) plugin.initializeImageBlocks();
                if (plugin.initializeCodeBlocks) plugin.initializeCodeBlocks();
                if (plugin.initializeVideoBlocks) plugin.initializeVideoBlocks();
                if (plugin.initializeFileBlocks) plugin.initializeFileBlocks();
                if (plugin.initializeTables) plugin.initializeTables();
                if (plugin.initializeDrawingBlocks) plugin.initializeDrawingBlocks();
            }
        }, 100);
    }

    registerPlugin(name, plugin) {
        this.plugins.set(name, plugin);
        
        if (name === 'collab') {
            this.collab = plugin;
        }
    }

    getPlugin(name) {
        return this.plugins.get(name);
    }

    generateUid() {
        const random = Math.floor(Math.random() * 1000000000);
        const timestamp = new Date().getTime();
        return `${random}${timestamp}`;
    }

    sanitizeHTML(html) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        const allowedTags = ['b', 'i', 'u', 's', 'strong', 'em', 'br', 'p', 'div', 'span', 'a', 'img', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
        const allowedAttributes = ['href', 'src', 'alt', 'title', 'style'];
        
        const cleanNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                return node;
            }
            
            if (node.nodeType === Node.ELEMENT_NODE) {
                const tagName = node.tagName.toLowerCase();
                
                if (!allowedTags.includes(tagName)) {
                    return document.createTextNode(node.textContent);
                }
                
                const attributes = Array.from(node.attributes);
                attributes.forEach(attr => {
                    if (!allowedAttributes.includes(attr.name)) {
                        node.removeAttribute(attr.name);
                    }
                });
                
                const childNodes = Array.from(node.childNodes);
                childNodes.forEach(child => {
                    const cleaned = cleanNode(child);
                    if (cleaned !== child) {
                        node.replaceChild(cleaned, child);
                    }
                });
            }
            
            return node;
        };
        
        const nodes = Array.from(tempDiv.childNodes);
        nodes.forEach((node, index) => {
            const cleaned = cleanNode(node);
            if (cleaned !== node) {
                tempDiv.replaceChild(cleaned, node);
            }
        });
        
        return tempDiv.innerHTML;
    }

    handleBulletPoints() {
        // 추후 구현
    }

    showButtonLoading(button) {
        if (!button || button.querySelector('.t2-btn-loading-overlay')) return;
        
        const overlay = document.createElement('div');
        overlay.className = 't2-btn-loading-overlay';
        
        const spinner = document.createElement('div');
        spinner.className = 't2-btn-loading-spinner';
        
        overlay.appendChild(spinner);
        button.appendChild(overlay);
        button.disabled = true;
    }

    hideButtonLoading(button) {
        if (!button) return;
        
        const overlay = button.querySelector('.t2-btn-loading-overlay');
        if (overlay) {
            overlay.remove();
        }
        button.disabled = false;
    }
}

window.T2Editor = T2Editor;
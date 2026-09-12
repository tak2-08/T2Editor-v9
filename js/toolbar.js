// Path: T2Editor/js/toolbar.js

(function() {
    'use strict';

    const style = document.createElement('style');
    style.textContent = `
        .t2-toolbar-group-btn {
            position: relative;
            min-width: 36px;
            transition: background-color 0.2s;
        }
        
        .t2-toolbar-group-btn.active {
            background-color: rgba(99, 102, 241, 0.15);
        }

        [data-t2editor-theme="dark"] .t2-toolbar-group-btn.active {
            background-color: rgba(99, 102, 241, 0.25);
        }

        .t2-subtoolbar-container {
            position: relative;
            width: 100%;
            overflow: hidden;
            max-height: 0;
            opacity: 0;
            transition: max-height 0.2s ease-out, opacity 0.2s ease-out;
            background: #f8f9fa;
            border-bottom: 1px solid #e0e0e0;
        }

        [data-t2editor-theme="dark"] .t2-subtoolbar-container {
            background: #1e1e1e;
            border-bottom-color: #333;
        }

        .t2-subtoolbar-container.active {
            max-height: 60px;
            opacity: 1;
        }

        .t2-subtoolbar {
            display: flex;
            gap: 4px;
            padding: 8px 50px 8px 8px;
            overflow-x: auto;
            overflow-y: hidden;
            scrollbar-width: none;
            -ms-overflow-style: none;
        }

        .t2-subtoolbar::-webkit-scrollbar {
            display: none;
        }

        .t2-subtoolbar .t2-btn {
            flex-shrink: 0;
        }

        .t2-subtoolbar-close {
            position: absolute;
            top: 8px;
            right: 8px;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
            border: 1px solid #aaa;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            z-index: 10;
        }

        [data-t2editor-theme="dark"] .t2-subtoolbar-close {
            background: rgba(255, 255, 255, 0.1);
        }

        .t2-subtoolbar-close:hover {
            background: rgba(0, 0, 0, 0.2);
            transform: scale(1.05);
        }

        [data-t2editor-theme="dark"] .t2-subtoolbar-close:hover {
            background: rgba(255, 255, 255, 0.2);
        }

        .t2-subtoolbar-close .material-icons {
            font-size: 20px;
            color: #666;
        }

        [data-t2editor-theme="dark"] .t2-subtoolbar-close .material-icons {
            color: #aaa;
        }

        .t2-btn.t2-hidden {
            display: none !important;
        }
    `;
    document.head.appendChild(style);

    class T2Toolbar {
        constructor(container) {
            this.container = container;
            this.toolbar = container.querySelector('.t2-toolbar');
            if (!this.toolbar) return;

            this.config = window.T2_TOOLBAR_GROUPS || this.getT2DefaultConfig();
            this.currentRange = null;
            this.groupButtons = new Map();
            this.subtoolbarContainer = null;
            this.activeGroupId = null;
            this.observers = new Map();
            this.currentGroupButtons = [];
            this.buttonHandlerMap = new Map();

            this.initT2Toolbar();
        }

        getT2DefaultConfig() {
            return {
                '0-599': [
                    {
                        groupIcon: 'text_fields',
                        groupLabel: '텍스트',
                        buttons: ['fontSize', 'bold', 'italic', 'underline', 'strikeThrough', 'justifyContent', 'foreColor', 'backColor', 'createLink', 'insertCodeBlock'],
                        position: 3
                    },
                    {
                        groupIcon: 'photo_camera',
                        groupLabel: '콘텐츠 업로드',
                        buttons: ['attachFile', 'insertImage', 'insertYouTube', 'insertTable'],
                        position: 4
                    },
                    {
                        groupIcon: 'more_horiz',
                        groupLabel: '기타 기능',
                        buttons: ['insertCodeBlock', 'createLink', 'insertMeme', 'createClipUrl', 'insertDrawing', 'collab', 'exportHTML'],
                        position: 19
                    }
                ],
                '600-1023': [
                    {
                        groupIcon: 'text_fields',
                        groupLabel: '텍스트',
                        buttons: ['fontSize', 'strikeThrough', 'justifyContent', 'foreColor', 'backColor', 'insertCodeBlock'],
                        position: 2
                    },
                    {
                        groupIcon: 'more_horiz',
                        groupLabel: '기타 기능',
                        buttons: ['insertTable', 'insertCodeBlock', 'insertMeme', 'createClipUrl', 'insertDrawing', 'collab', 'exportHTML'],
                        position: 19
                    }
                ]
            };
        }

        initT2Toolbar() {
            this.createT2Subtoolbar();
            this.setupT2ResizeObserver();
            this.setupT2MainToolbarClick();
            this.handleT2Resize();
        }

        createT2Subtoolbar() {
            this.subtoolbarContainer = document.createElement('div');
            this.subtoolbarContainer.className = 't2-subtoolbar-container';
            
            const subtoolbar = document.createElement('div');
            subtoolbar.className = 't2-subtoolbar';
            
            const closeBtn = document.createElement('button');
            closeBtn.className = 't2-subtoolbar-close';
            closeBtn.type = 'button';
            closeBtn.innerHTML = '<span class="material-icons">close</span>';
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closeT2Subtoolbar();
            });
            
            this.subtoolbarContainer.appendChild(subtoolbar);
            this.subtoolbarContainer.appendChild(closeBtn);
            this.toolbar.parentNode.insertBefore(this.subtoolbarContainer, this.toolbar.nextSibling);
        }

        setupT2ResizeObserver() {
            if (typeof ResizeObserver !== 'undefined') {
                const resizeObserver = new ResizeObserver(() => this.handleT2Resize());
                resizeObserver.observe(this.toolbar);
            } else {
                window.addEventListener('resize', () => this.handleT2Resize());
            }
        }

        setupT2MainToolbarClick() {
            this.toolbar.addEventListener('click', (e) => {
                const button = e.target.closest('.t2-btn');
                
                if (!button || button.classList.contains('t2-toolbar-group-btn')) {
                    return;
                }
                
                const command = button.getAttribute('data-command');
                if (!command) return;
                
                const isInCurrentGroup = this.currentGroupButtons.includes(command);
                
                if (!isInCurrentGroup) {
                    this.closeT2Subtoolbar();
                }
            });
        }

        handleT2Resize() {
            const width = this.toolbar.offsetWidth;
            const newRange = this.getT2ActiveRange(width);

            if (newRange !== this.currentRange) {
                this.currentRange = newRange;
                this.updateT2Toolbar();
            }
        }

        getT2ActiveRange(width) {
            for (const range in this.config) {
                const [min, max] = range.split('-').map(Number);
                if (width >= min && width <= max) {
                    return range;
                }
            }
            return null;
        }

        updateT2Toolbar() {
            this.groupButtons.forEach((btn, id) => {
                btn.remove();
                this.stopObservingT2Buttons(id);
            });
            this.groupButtons.clear();
            this.buttonHandlerMap.clear();
            this.closeT2Subtoolbar();

            this.toolbar.querySelectorAll('.t2-btn').forEach(btn => {
                btn.classList.remove('t2-hidden');
            });

            if (!this.currentRange) return;

            const groups = this.config[this.currentRange];
            if (!groups || !Array.isArray(groups)) return;

            const sortedGroups = [...groups].sort((a, b) => (b.position || 0) - (a.position || 0));

            sortedGroups.forEach((group, idx) => {
                this.createT2GroupButton(group, `group-${this.currentRange}-${idx}`);
            });
        }

        createT2GroupButton(group, groupId) {
            const buttons = this.toolbar.querySelectorAll('.t2-btn');
            const buttonsToHide = [];
            
            group.buttons.forEach(cmd => {
                const btn = Array.from(buttons).find(b => 
                    b.getAttribute('data-command') === cmd && !b.classList.contains('t2-hidden')
                );
                if (btn) buttonsToHide.push(btn);
            });

            if (buttonsToHide.length === 0) return;

            const groupBtn = document.createElement('button');
            groupBtn.className = 't2-btn t2-toolbar-group-btn';
            groupBtn.type = 'button';
            groupBtn.title = group.groupLabel || '';
            groupBtn.innerHTML = `<span class="material-icons">${group.groupIcon}</span>`;
            groupBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleT2Subtoolbar(groupId, buttonsToHide, group.buttons);
            });

            const position = group.position || 0;
            const allButtons = Array.from(this.toolbar.querySelectorAll('.t2-btn'));
            const insertBefore = allButtons[position] || null;
            
            if (insertBefore) {
                this.toolbar.insertBefore(groupBtn, insertBefore);
            } else {
                this.toolbar.appendChild(groupBtn);
            }

            this.groupButtons.set(groupId, groupBtn);

            buttonsToHide.forEach(btn => btn.classList.add('t2-hidden'));
        }

        toggleT2Subtoolbar(groupId, buttons, commandList) {
            if (this.activeGroupId === groupId) {
                this.closeT2Subtoolbar();
            } else {
                this.openT2Subtoolbar(groupId, buttons, commandList);
            }
        }

        openT2Subtoolbar(groupId, buttons, commandList) {
            this.closeT2Subtoolbar();
            
            this.currentGroupButtons = commandList || [];
            
            const subtoolbar = this.subtoolbarContainer.querySelector('.t2-subtoolbar');
            subtoolbar.innerHTML = '';

            buttons.forEach(originalBtn => {
                const clonedBtn = originalBtn.cloneNode(true);
                clonedBtn.classList.remove('t2-hidden');
                
                const handleClick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const command = originalBtn.getAttribute('data-command');
                    
                    const editorContainer = this.container;
                    const editorId = editorContainer.id.replace('_container', '');
                    const editorInstance = window[editorId + '_editor'];
                    
                    if (editorInstance && editorInstance.handleCommand) {
                        editorInstance.handleCommand(command, originalBtn);
                    } else {
                        const clickEvent = new MouseEvent('click', {
                            bubbles: true,
                            cancelable: true,
                            view: window
                        });
                        originalBtn.dispatchEvent(clickEvent);
                    }
                };
                
                clonedBtn.addEventListener('click', handleClick);
                this.buttonHandlerMap.set(clonedBtn, handleClick);

                subtoolbar.appendChild(clonedBtn);

                this.observeT2Button(groupId, originalBtn, clonedBtn);
            });

            this.subtoolbarContainer.classList.add('active');
            this.activeGroupId = groupId;
            
            const groupBtn = this.groupButtons.get(groupId);
            if (groupBtn) groupBtn.classList.add('active');
        }

        closeT2Subtoolbar() {
            if (!this.activeGroupId) return;

            this.subtoolbarContainer.classList.remove('active');
            
            const groupBtn = this.groupButtons.get(this.activeGroupId);
            if (groupBtn) groupBtn.classList.remove('active');

            this.stopObservingT2Buttons(this.activeGroupId);
            
            const subtoolbar = this.subtoolbarContainer.querySelector('.t2-subtoolbar');
            if (subtoolbar) {
                subtoolbar.querySelectorAll('.t2-btn').forEach(btn => {
                    const handler = this.buttonHandlerMap.get(btn);
                    if (handler) {
                        btn.removeEventListener('click', handler);
                        this.buttonHandlerMap.delete(btn);
                    }
                });
            }
            
            this.activeGroupId = null;
            this.currentGroupButtons = [];
        }

        observeT2Button(groupId, original, clone) {
            if (!this.observers.has(groupId)) {
                this.observers.set(groupId, []);
            }

            const observer = new MutationObserver(() => {
                this.syncT2ButtonState(original, clone);
            });

            observer.observe(original, {
                attributes: true,
                attributeFilter: ['disabled', 'class', 'style'],
                childList: true,
                characterData: true,
                subtree: true
            });

            this.observers.get(groupId).push(observer);
            this.syncT2ButtonState(original, clone);
        }

        syncT2ButtonState(original, clone) {
            if (original.disabled) {
                clone.disabled = true;
            } else {
                clone.disabled = false;
            }

            const classesToSync = ['active', 'disabled'];
            classesToSync.forEach(cls => {
                if (original.classList.contains(cls)) {
                    clone.classList.add(cls);
                } else {
                    clone.classList.remove(cls);
                }
            });

            if (original.style.color) {
                clone.style.color = original.style.color;
            }

            const originalIcon = original.querySelector('.material-icons');
            const cloneIcon = clone.querySelector('.material-icons');
            if (originalIcon && cloneIcon && originalIcon.textContent !== cloneIcon.textContent) {
                cloneIcon.textContent = originalIcon.textContent;
            }
        }

        stopObservingT2Buttons(groupId) {
            const observers = this.observers.get(groupId);
            if (observers) {
                observers.forEach(obs => obs.disconnect());
                this.observers.delete(groupId);
            }
        }
    }

    function initT2Toolbar() {
        const containers = document.querySelectorAll('.t2-editor-container');
        containers.forEach(container => {
            if (!container._t2Toolbar) {
                container._t2Toolbar = new T2Toolbar(container);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(initT2Toolbar, 300);
        });
    } else {
        setTimeout(initT2Toolbar, 300);
    }

    window.T2Toolbar = T2Toolbar;
})();
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
        // [iOS-ENTER-FIX] iOS Safari + 한국어 IME 환경에서 isComposing 값이 항상 false 로
        // 보고되는 WebKit 버그(contenteditable.realerror.com 사례: "isComposing is always
        // false in iOS Safari Korean IME") 때문에, 우리가 자체적으로 composition 라이프사이클을
        // 추적해야 한다. compositionstart/compositionend 이벤트는 iOS Safari 에서도 정상 발화되므로
        // 이 플래그가 IME 조합 종료 시점을 알아내는 "실측 진실(ground truth)" 역할을 한다.
        this._isComposing = false;
        // 조합이 막 끝난 직후에 들어오는 합성 Enter(첫 탭이 commit 으로 소비된 뒤 곧이어
        // 발생하는 keydown/beforeinput) 를 식별하기 위해 짧은 grace window 를 둔다.
        this._lastCompositionEndAt = 0;

        // ════════════════════════════════════════════════════════════════════
        // [iOS-SPACE-FIX v3] iOS Safari 빈 블록 / 줄끝(trailing) 스페이스 버그 정책
        // ────────────────────────────────────────────────────────────────────
        // 증상 이력:
        //   (패치1, Enter 지연 패치 후) 빈 줄에서 첫 스페이스가 무시됨.
        //   (패치2, 첫 스페이스 NBSP 삽입 후) 첫 스페이스는 들어가는 것처럼 보이나,
        //     두 번째 스페이스부터는 "커서가 앞뒤로 깜빡이듯" 왔다갔다 할 뿐
        //     공백이 시각적으로 누적되지 않음. 사용자는 SP 가 계속 입력되지 않는다고 느낌.
        //
        // 원인(Apple WebKit 공식 + W3C/CSS 사양 종합):
        //   ① CSS Text Module Level 3 — Trimming and Positioning §4.1:
        //      > "UA may visually collapse the character advance widths of any
        //      >  that would otherwise overflow line boxes ... at the end of
        //      >  a soft-wrap opportunity"
        //      즉 `white-space: pre-wrap` 이라도 줄 끝(line break / <br> 직전) 공백은
        //      "폭 0" 으로 렌더링되는 것이 사양상 허용되며, WebKit 은 실제로 그렇게 함.
        //      → DOM 엔 SP 가 들어가지만 캐럿이 시각적으로 전진하지 않는다.
        //      → 같은 자리에서 SP 를 더 눌러도 같은 위치에 SP 가 누적될 뿐, 폭은 0.
        //      → 사용자에겐 "커서가 뒤로 갔다 앞으로 왔다" 깜빡이는 것처럼 보임.
        //      참고: WebKit Bugzilla #54598 / #61483, Chromium Issue #41324181.
        //   ② iOS Safari 의 IME 후속 입력 디스패치 큐는 compositionend 직후 첫
        //      "insertText" 가 빈 블록을 대상으로 할 때 한 차례 swallow 되는 사례.
        //   ③ setCaretToStart() 가 element offset 0 에 커서를 두면, 일반 SP 가
        //      WebKit 의 markup-whitespace 압축 경로에 걸려 아예 DOM 에도 못 들어감.
        //
        // 해결: 3 중 방어선 (패치3)
        //   ① 정공법(확장) — Apple WebKit Input Events 권장 처리:
        //      beforeinput 단계에서 inputType === 'insertText' && data === ' ' 일 때,
        //      현재 캐럿이 "trailing whitespace 영역" 인지 검사한다.
        //      → "trailing whitespace 영역" = 캐럿 다음에 BR 만 있거나 블록 끝인 위치.
        //      → 이 영역의 모든 SP 입력은 preventDefault() 후 NBSP(U+00A0) 로 직접 삽입.
        //      NBSP 는 사양상 line break 직전이라도 절대 collapse 되지 않는다.
        //      이렇게 해야 두 번째·세 번째 SP 도 폭이 살아 캐럿이 진짜로 전진한다.
        //   ② 빈 블록 특수 처리 — 첫 SP 시점에 블록을 ZWSP+NBSP+<br> 로 초기화하고
        //      캐럿을 NBSP 뒤(offset 2)로 둔다.
        //   ③ 꼼수 — 본 개발자 실측 우회:
        //      "커서 앞에 ZWSP(U+200B) 텍스트 노드만 있으면 줄바꿈/스페이스가 즉시 작동".
        //      → 모든 빈 P 블록에 항상 ZWSP+BR 를 유지하고(저장 시점에 제거),
        //         커서를 ZWSP 뒤(offset 1)로 둔다.
        //
        // 외부 출력:
        //   getSanitizedContent() 가 ZWSP 만 제거하고 NBSP 는 그대로 둔다. NBSP 는
        //   사용자가 "명시적으로 누른 공백" 의 의미적 보존이고, HTML 사양상 일반
        //   문자이므로 외부 노출되어도 문제 없다.
        // ════════════════════════════════════════════════════════════════════
        
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
        // [iOS-SPACE-FIX] iOS/Safari 에서는 빈 블록을 그냥 <br> 만 두면 첫 스페이스가
        // 무시되는 버그가 있어, ZWSP+BR 패턴으로 "가짜 비어있지 않은 상태" 를 유지한다.
        // 다른 플랫폼은 영향이 없으므로 통일해도 안전하며, getContent 직렬화 시점에 제거된다.
        if (this.isIOS || this.isSafari) {
            p.appendChild(document.createTextNode('\u200B'));
            p.appendChild(document.createElement('br'));
        } else {
            p.innerHTML = '<br>';
        }
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

        // ════════════════════════════════════════════════════════════════════
        // [iOS-ENTER-FIX] iOS / iOS Safari Enter 키 지연 문제 해결 블록
        // ────────────────────────────────────────────────────────────────────
        // 증상: iOS Safari 에서만, 한국어 IME 로 입력 중 줄바꿈 버튼(↵)을 눌러도
        //       바로 줄바꿈이 안 되고, (1) 커서 앞에 텍스트가 있거나 (2) 사용자가
        //       커서를 한 번 더 탭해 IME 조합을 강제 commit 해야만 동작한다.
        // 원인: WebKit 의 iOS Safari + 한국어 IME 조합에서 KeyboardEvent.isComposing 이
        //       항상 false 로 보고되어, 첫 번째 Enter 가 IME 의 "조합 종료" 신호로
        //       소비되고 두 번째 Enter 에서야 실제 줄바꿈이 일어난다.
        //       (Apple WebKit Input Events spec / contenteditable.realerror.com 사례)
        // 해결: 3중 방어선
        //   ① compositionstart/compositionend 로 자체 _isComposing 플래그를 운영해
        //      isComposing 보고 누락을 우회한다.
        //   ② Apple 권장 방식인 `beforeinput` 이벤트의 inputType === 'insertParagraph'
        //      를 가로채 preventDefault() 후 handleEnterKey() 를 직접 호출한다.
        //      (WebKit 블로그 "Enhanced Editing with Input Events" 참조)
        //   ③ ①·② 가 모두 실패한 경우의 최후 안전망으로, 새로 생성된 <p> 블록
        //      맨 앞에 Zero-Width Space(U+200B) 를 넣어 IME 컨텍스트를 강제 reset
        //      한다. 사용자에게는 비가시이므로 체감 오류가 사라진다.
        // ════════════════════════════════════════════════════════════════════
        if (this.isIOS) {
            // composition 라이프사이클 추적 — Apple/WebKit 공식 이벤트 사용
            this.editor.addEventListener('compositionstart', () => {
                this._isComposing = true;
            });
            this.editor.addEventListener('compositionend', () => {
                this._isComposing = false;
                this._lastCompositionEndAt = Date.now();
            });

            // [핵심] Apple 권장 방식: beforeinput 가로채기
            // - iOS 화상 키보드의 ↵ 는 keydown 단계에서 isComposing 이 거짓을 반환하더라도
            //   beforeinput 단계에서는 inputType 으로 정확히 "insertParagraph" 또는
            //   "insertLineBreak" 를 알려준다. 이를 가로채 우리 로직으로 처리한다.
            //
            // [iOS-SPACE-FIX] 동일 핸들러에서 "빈 블록 시작점의 첫 스페이스" 도 가로채
            // 직접 NBSP(U+00A0) 텍스트 노드를 삽입해 WebKit 의 markup-whitespace 압축을
            // 우회한다. NBSP 는 화면상 일반 스페이스와 동일하게 보이며, 이후 이어지는
            // 스페이스부터는 일반 스페이스로 입력해도 정상 동작한다.
            this.editor.addEventListener('beforeinput', (e) => {
                const t = e.inputType;

                // ─── (1) Enter 처리 ─────────────────────────────────────────
                if (t === 'insertParagraph' || t === 'insertLineBreak') {
                    // 사용자가 IME 조합 도중 ↵ 를 눌렀다면, 그 첫 탭은 "조합 commit" 으로
                    // 양보(=preventDefault 하지 않음)한다. 그래야 글자가 사라지지 않는다.
                    if (this._isComposing) return;
                    e.preventDefault();
                    this.handleEnterKey();
                    return;
                }

                // ─── (2) 스페이스 처리 (빈 블록 + trailing whitespace 영역) ────
                // Apple WebKit Input Events 권장 처리: beforeinput 에서 직접 텍스트 삽입.
                // (B) 케이스 — 캐럿 오른쪽이 줄 끝(BR/블록 끝) 이면 NBSP 로 삽입해
                //              WebKit 의 trailing-space collapse 를 회피.
                if (t === 'insertText' && e.data === ' ' && !this._isComposing) {
                    this._handleEmptyBlockSpace(e);
                    return;
                }
            });

            // Backspace 는 기존 정책 그대로 유지
            this.editor.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace') {
                    this.handleBackspace(e);
                }
            });
        } else if (this.isSafari) {
            // macOS 데스크톱 Safari — 기존 동작 유지 (Enter 는 사용자 보고 문제 없음)
            // 단, 빈 블록 / trailing whitespace SP 버그는 macOS Safari 에서도
            // 동일하게 재현되므로 [iOS-SPACE-FIX v3] 의 beforeinput insertText
            // 가로채기는 동일하게 적용한다.
            this.editor.addEventListener('beforeinput', (e) => {
                if (e.inputType === 'insertText' && e.data === ' ' && !this._isComposing) {
                    this._handleEmptyBlockSpace(e);
                }
            });
            this.editor.addEventListener('compositionstart', () => { this._isComposing = true; });
            this.editor.addEventListener('compositionend',   () => { this._isComposing = false; });
            this.editor.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace') {
                    this.handleBackspace(e);
                }
            });
        } else {
            // Android / Windows / Linux 등 — 기존 keydown 가로채기 그대로
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

        // [DEPRECATED→FIX] DOMNodeInserted 는 Mutation Events 스펙으로
        // 모든 주요 브라우저에서 deprecated, Chrome 124+ 에서 제거 예정.
        // 성능 저하(동기 이벤트) 문제도 있어 MutationObserver 로 교체.
        // childList: true 로 editor 직계 자식 추가만 감지하여 handleNodeInserted 위임.
        this._nodeInsertedObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    this.handleNodeInserted({ target: node });
                }
            }
        });
        this._nodeInsertedObserver.observe(this.editor, { childList: true });
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
                
                // [FIX-타이밍] contentSetQueue 레이스 컨디션 수정
                // 기존: 우선순위 그룹 로드마다 즉시 큐 소비 →
                //   priority 1(video) 로드 시 큐가 소비되어 priority 4(code, file)가
                //   로드될 때 이미 큐가 null → onContentSet 미호출.
                // 수정: 설정된 essential 플러그인이 모두 로드된 후에만 큐를 소비.
                if (this.contentSetQueue) {
                    var essentialPlugins = ['image', 'code', 'video', 'file', 'table'];
                    var configuredEssentials = essentialPlugins.filter(function(name) {
                        return this.config.plugins.includes(name);
                    }.bind(this));
                    var allEssentialLoaded = configuredEssentials.every(function(name) {
                        return this.pluginLoadStatus.get(name) === 'loaded';
                    }.bind(this));
                    if (allEssentialLoaded) {
                        console.log('All essential plugins loaded — processing queued content');
                        this.processContentSet(this.contentSetQueue);
                        this.contentSetQueue = null;
                    }
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

        // [SEC-PLUGIN-NAME] 플러그인 이름을 알파벳·숫자·언더스코어·하이픈으로만 제한.
        // 검증 없이 name 을 script.src 에 삽입하면:
        //   · "../../../evil" 형태의 경로 탈출로 서버 내 임의 JS 로드
        //   · T2EDITOR_PLUGINS 배열이 XSS 등으로 변조된 경우 크로스-오리진 스크립트 삽입
        // name 은 loadPluginsWithPriority() 에서 window.T2EDITOR_PLUGINS 를 그대로
        // 사용하므로 신뢰할 수 없는 값이 전달될 수 있다.
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            console.error(`[SEC] Plugin name rejected (invalid characters): "${name}"`);
            this.pluginLoadStatus.set(name, 'failed');
            return Promise.reject(new Error(`Invalid plugin name: ${name}`));
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

    // ─────────────────────────────────────────────────────────────────────
    // [iOS-SPACE-FIX v3] 빈 블록 + 줄끝(trailing) 스페이스 통합 처리
    // ─────────────────────────────────────────────────────────────────────
    // beforeinput 가 inputType='insertText', data=' ' 일 때 호출.
    //
    // 두 가지 케이스를 모두 NBSP 로 직접 삽입한다:
    //   (A) 빈 블록(또는 ZWSP-만-있는 블록)의 시작점
    //   (B) trailing whitespace 영역 — 캐럿 "오른쪽" 에 BR 만 있거나 블록 끝
    //
    // 이유:
    //   CSS Text §4.1 에 따라 UA 는 줄끝 SP 의 advance width 를 0 으로 렌더할 수 있고,
    //   WebKit 은 실제로 그렇게 한다. 따라서 (B) 위치에 일반 SP 를 두 번 이상 누르면
    //   DOM 에는 들어가지만 시각적으로 캐럿이 멈춘 듯 깜빡이게 된다. NBSP 는 line break
    //   직전에도 collapse 되지 않으므로 캐럿이 정상적으로 전진한다.
    // 반환값:
    //   true  → 처리 완료 (caller 가 추가 작업 안 함)
    //   false → 우리가 처리하지 않음 (브라우저 기본 동작에 맡김)
    _handleEmptyBlockSpace(e) {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return false;
        const range = selection.getRangeAt(0);
        if (!range.collapsed) return false;

        const block = this.getClosestBlock(range.startContainer);
        if (!block || block === this.editor) return false;

        // ─── (A) 빈 블록 분기 ──────────────────────────────────────────────
        // 블록의 "실질 텍스트" (ZWSP/제로폭 문자 제거) 가 비어 있으면 풀 리셋.
        const realText = (block.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
        if (realText.length === 0) {
            e.preventDefault();

            // 블록을 "ZWSP+NBSP+BR" 상태로 만들고 캐럿을 NBSP 뒤(offset 2)로 둔다.
            const textNode = document.createTextNode('\u200B\u00A0');
            block.innerHTML = '';
            block.appendChild(textNode);
            block.appendChild(document.createElement('br'));

            const newRange = document.createRange();
            newRange.setStart(textNode, textNode.length); // ZWSP(1) + NBSP(1) = offset 2
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);

            // input 이벤트가 자동으로 발화되지 않으므로 후처리를 명시적으로 실행
            this.autoSave();
            this.createUndoPoint();
            this.updateCharCount();
            return true;
        }

        // ─── (B) trailing whitespace 영역 분기 ────────────────────────────
        // 캐럿 "오른쪽" 에 보이는 컨텐츠가 없는지(=BR 뿐이거나 블록 끝) 확인.
        if (!this._isCaretAtTrailingWhitespaceZone(range, block)) return false;

        e.preventDefault();

        // 캐럿 위치에 NBSP(U+00A0) 텍스트를 삽입한다.
        // 가능하면 현재 텍스트 노드의 그 위치에 직접 데이터 추가(undo 친화적, 노드 분열 최소).
        const startNode = range.startContainer;
        const startOffset = range.startOffset;

        if (startNode.nodeType === Node.TEXT_NODE) {
            // 텍스트 노드 내부 → insertData 로 NBSP 삽입
            startNode.insertData(startOffset, '\u00A0');
            const newRange = document.createRange();
            newRange.setStart(startNode, startOffset + 1);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
        } else {
            // 요소 노드 경계 → NBSP 텍스트 노드를 삽입하고 캐럿을 그 뒤로
            const nbspNode = document.createTextNode('\u00A0');
            range.insertNode(nbspNode);
            const newRange = document.createRange();
            newRange.setStart(nbspNode, nbspNode.length);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
        }

        // 후처리
        this.autoSave();
        this.createUndoPoint();
        this.updateCharCount();
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────
    // [iOS-SPACE-FIX v3] 캐럿이 trailing whitespace 영역에 있는지 판정
    // ─────────────────────────────────────────────────────────────────────
    // "오른쪽" 에 시각적 컨텐츠(텍스트/이미지/인라인 요소 등) 가 전혀 없는지 검사한다.
    // BR 만 있거나 ZWSP/공백 텍스트뿐이라면 trailing whitespace 영역.
    //
    // 판정 알고리즘:
    //   1) 시작 컨테이너부터 블록 끝까지 Range 로 범위 잡기
    //   2) 그 범위 내 텍스트(.textContent)에서 제로폭 문자 제거 + 일반 공백/NBSP 도 제거
    //   3) 남은 가시 문자가 0 이면 trailing 영역으로 본다.
    //   4) 이 범위 안의 요소가 BR 외의 인라인 시각 요소(img/svg/code/span with content 등)
    //      를 포함하면 trailing 영역이 아님 (textContent 검사로는 img 가 안 잡히므로 별도 검사).
    _isCaretAtTrailingWhitespaceZone(range, block) {
        try {
            const tailRange = document.createRange();
            tailRange.setStart(range.startContainer, range.startOffset);
            tailRange.setEndAfter(block.lastChild || block);

            // 가시 요소(이미지/미디어/플레이스홀더가 아닌 인라인 컨텐츠) 가 있으면 trailing 아님
            const frag = tailRange.cloneContents();
            if (frag.querySelector && frag.querySelector(
                'img, svg, video, audio, iframe, canvas, object, embed, input, button, select, textarea, code, .t2-media-block, .t2-file-block, .t2-drawing-block, .t2-code-block'
            )) {
                return false;
            }

            // 남은 텍스트에서 제로폭/공백/NBSP 까지 모두 제거 후 길이 0 이면 trailing 영역
            const tailText = (frag.textContent || '')
                .replace(/[\u200B\u200C\u200D\uFEFF\u00A0\s]/g, '');
            return tailText.length === 0;
        } catch (_) {
            return false;
        }
    }

    handleEnterKey() {
        const selection = window.getSelection();
        // [BUG-FIX] selection이 없거나 Range가 없으면 getRangeAt(0)이 예외를 던짐
        if (!selection || !selection.rangeCount) return;
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
        // [iOS-ENTER-FIX — 3차 안전망] 새 블록의 초기 placeholder를 결정한다.
        //
        // ⚠️ 주의: 이미 _createInvisibleBoundaryParagraph (line 806) 에서는
        //   iOS/Safari에서 "ZWSP+BR 조합이 커서를 비정상 위치에 떨어뜨린다"는 이유로
        //   ZWSP를 회피하는 정책이 있다. 그런데 우리는 정반대로 하려는가? — 아니다.
        //   와이드 경우(잘라난 텍스트가 있는 상태) 에서는 ZWSP 없이도 되며,
        //   우리는 *빈* 블록(조합 종료 후 새 줄) 에만 ZWSP를 넣어 IME 컨텍스트를
        //   강제 도며, setCaretToStart 가 안정적으로 offset 0 을 지정하게 된다.
        //   과거 "ZWSP+BR 커서 이상" 현상은 ZWSP 가 *드문게* 삽입되던 상황이고,
        //   우리는 계속 생성되는 새 라인이므로 사용자 경험에 영향이 없다.
        //
        //   주의 ② _normalizeInvisibleBoundaryParagraph (line 837) 가 iOS에서
        //   ZWSP+BR 을 자동으로 <br> 로 정규화한다. 이는 우리 패치에 문제 없다:
        //   정규화가 일어나는 시점은 우리가 이미 커서를 그 블록에 놓은 다음이고,
        //   이시점엔 IME 조합 commit 이 이미 완료되었으므로 "이번 Enter" 의 목적은
        //   달성된 상태다. 이후 ZWSP 가 제거되어 <br> 만 남아도 정상.
        const emptyBlockHTML = this.isIOS ? '\u200B<br>' : '<br>';
        
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
                currentBlock.innerHTML = emptyBlockHTML;
            }
            
            if (afterContent.textContent.trim()) {
                newBlock.appendChild(afterContent);
            } else {
                newBlock.innerHTML = emptyBlockHTML;
            }
        } else {
            newBlock.innerHTML = emptyBlockHTML;
        }
        
        currentBlock.parentNode.insertBefore(newBlock, currentBlock.nextSibling);
        this.setCaretToStart(newBlock);
        
        this.normalizeContent();
        this.createUndoPoint();
        this.autoSave();
    }

    handleBackspace(e) {
        const selection = window.getSelection();
        // [BUG-FIX] selection이 없거나 Range가 없으면 getRangeAt(0)이 예외를 던짐
        if (!selection || !selection.rangeCount) return;
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
                // [SEC-XSS] beforeText/afterText는 textContent에서 추출된 평문이므로
                // innerHTML에 삽입하기 전 반드시 HTML 이스케이프 필요.
                // 미처리 시 사용자가 입력한 <, > 등이 태그로 해석돼 XSS 가능.
                const escapeForHtml = (str) => str
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#x27;');
                currentBlock.innerHTML = escapeForHtml(beforeText) + sanitizedHTML + escapeForHtml(afterText);
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
            // [iOS-SPACE-FIX] 텍스트 노드가 ZWSP(U+200B) 로만 시작하면, 커서를 그 "뒤" (offset 1)
            // 에 둔다. 이렇게 해야 사용자의 첫 입력(특히 스페이스)이 ZWSP 보호 영역
            // 안에서 발생해 WebKit 의 markup-whitespace 압축을 우회한다.
            // (꼼수 우회의 핵심 — 본 개발자 실측 발견)
            const text = target.textContent || '';
            if (text.charCodeAt(0) === 0x200B) {
                range.setStart(target, 1);
            } else {
                range.setStart(target, 0);
            }
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
            
            // [BUG-FIX] walk.previousNode() 를 return 문에서 여러 번 호출하면
            // 호출마다 TreeWalker 커서가 이동하여 서로 다른 노드를 참조하는 버그 발생.
            // 변수에 한 번만 저장 후 재사용.
            const fallbackNode = walk.previousNode();
            return {
                node: fallbackNode || element,
                offset: fallbackNode ? fallbackNode.textContent.length : 0
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


    _createInvisibleBoundaryParagraph(includeBreak = true) {
        const p = document.createElement('p');

        // [iOS-SPACE-FIX] (구) 정책: iOS/Safari 는 ZWSP+BR 에서 커서 위치 이상이 있어 <br> 만 사용.
        // (신) 정책: iOS/Safari 의 빈 블록 첫 스페이스 무시 버그가 더 큰 사용자 영향이므로
        //          ZWSP+BR 패턴을 모든 플랫폼에서 통일 사용한다. setCaretToStart 가
        //          ZWSP 텍스트 노드를 인지해 그 뒤(offset 1)에 커서를 두도록 함께 보완됨.
        p.appendChild(document.createTextNode('\u200B'));
        if (includeBreak) p.appendChild(document.createElement('br'));
        return p;
    }

    _isEditorEmptyParagraph(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE || node.tagName !== 'P') return false;
        if (node.querySelector('img, iframe, video, audio, table, pre, code, .t2-media-block, .t2-table-wrapper, .t2-code-block, .t2-file-block, .t2-drawing-block')) return false;

        const text = (node.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim();
        if (text) return false;

        const html = (node.innerHTML || '')
            .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
            .replace(/&ZeroWidthSpace;/gi, '')
            .trim()
            .toLowerCase();

        return !html || html === '<br>' || html === '<br/>' || html === '<br />' || /^(&nbsp;|\s|<br\s*\/?>)*$/i.test(html);
    }

    _normalizeInvisibleBoundaryParagraph(p, includeBreak = true) {
        if (!this._isEditorEmptyParagraph(p)) return;

        // [iOS-SPACE-FIX] iOS/Safari 분기에서 ZWSP 를 제거하던 (구) 정책이
        // "엔터 직후 첫 스페이스 무시" 버그를 다시 살리는 원인이었다.
        // (구): if (this.isIOS || this.isSafari) { p.innerHTML = '<br>'; return; }
        // (신): 모든 플랫폼에서 ZWSP+BR 을 유지해 빈 블록을 항상 "가짜 비어있지 않은 상태"로
        //      만든다. 저장/내보내기 시점에 ZWSP 가 제거되므로 외부 노출 X.
        p.replaceChildren(document.createTextNode('\u200B'));
        if (includeBreak) p.appendChild(document.createElement('br'));
    }

    _isEditorBlockNode(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        return !!(
            node.classList?.contains('t2-media-block') ||
            node.classList?.contains('t2-code-block') ||
            node.classList?.contains('t2-file-block') ||
            node.classList?.contains('t2-table-wrapper') ||
            node.classList?.contains('t2-drawing-block') ||
            node.getAttribute?.('data-t2-block')
        );
    }

    ensureBlockBoundaryLines(block) {
        if (!this._isEditorBlockNode(block) || !block.parentNode) return;

        block.contentEditable = false;

        let prev = block.previousElementSibling;
        if (!this._isEditorEmptyParagraph(prev)) {
            const topBreak = this._createInvisibleBoundaryParagraph(true);
            block.parentNode.insertBefore(topBreak, block);
            prev = topBreak;
        } else {
            this._normalizeInvisibleBoundaryParagraph(prev, true);
        }

        let next = block.nextElementSibling;
        if (!this._isEditorEmptyParagraph(next)) {
            const bottomBreak = this._createInvisibleBoundaryParagraph(false);
            block.parentNode.insertBefore(bottomBreak, block.nextSibling);
            next = bottomBreak;
        } else {
            this._normalizeInvisibleBoundaryParagraph(next, false);
        }

        // 블록 바로 위/아래에는 커서 착지용 문단 1개만 유지한다.
        let extraPrev = prev ? prev.previousElementSibling : null;
        while (this._isEditorEmptyParagraph(extraPrev)) {
            const current = extraPrev;
            extraPrev = extraPrev.previousElementSibling;
            current.remove();
        }

        let extraNext = next ? next.nextElementSibling : null;
        while (this._isEditorEmptyParagraph(extraNext)) {
            const current = extraNext;
            extraNext = extraNext.nextElementSibling;
            current.remove();
        }
    }

    insertBlockWithBoundaryLines(block, savedRange = null) {
        if (!block) return false;

        const selection = window.getSelection();
        let range = savedRange;

        if (selection && range) {
            try {
                selection.removeAllRanges();
                selection.addRange(range);
            } catch (_) { /* selection 복구 실패 시 fallback 삽입 */ }
        }

        if (!range && selection && selection.rangeCount > 0) {
            range = selection.getRangeAt(0);
        }

        if (range && !range.collapsed) {
            range.deleteContents();
        }

        let currentBlock = range ? this.getClosestBlock(range.startContainer) : null;

        if (currentBlock && currentBlock !== this.editor && currentBlock.parentNode) {
            const topBreak = this._createInvisibleBoundaryParagraph(true);
            currentBlock.parentNode.insertBefore(topBreak, currentBlock.nextSibling);
            topBreak.parentNode.insertBefore(block, topBreak.nextSibling);
        } else {
            this.editor.appendChild(this._createInvisibleBoundaryParagraph(true));
            this.editor.appendChild(block);
        }

        const bottomBreak = this._createInvisibleBoundaryParagraph(false);
        block.parentNode.insertBefore(bottomBreak, block.nextSibling);
        this.ensureBlockBoundaryLines(block);

        if (selection) {
            const newRange = document.createRange();
            newRange.setStart(bottomBreak, 0);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
        }

        return true;
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
                const isMediaBlock = this._isEditorBlockNode(node);

                if (isMediaBlock) {
                    this.ensureBlockBoundaryLines(node);
                    lastMediaBlock = node;
                } else {
                    if (this._isEditorEmptyParagraph(node)) {
                        this._normalizeInvisibleBoundaryParagraph(node, true);
                    }
                }
            }
        });

        if (!this.editor.firstChild) {
            const p = document.createElement('p');
            // [iOS-SPACE-FIX] iOS/Safari 분기에서 ZWSP 를 빼던 (구) 정책 제거.
            // 빈 줄은 모든 플랫폼에서 ZWSP+BR 로 통일한다.
            p.innerHTML = '\u200B<br>';
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
        // [iOS-SPACE-FIX] 초기 빈 줄도 ZWSP+BR 로 통일 (빈 블록 첫 스페이스 버그 우회)
        if (this.isIOS || this.isSafari) {
            p.appendChild(document.createTextNode('\u200B'));
            p.appendChild(document.createElement('br'));
        } else {
            p.innerHTML = '<br>';
        }
        this.editor.innerHTML = '';
        this.editor.appendChild(p);
        this.setCaretToStart(p);
    }

    // ─────────────────────────────────────────────────────────────────────
    // [iOS-SPACE-FIX] 외부 출력/DB 제출용 제로폭 제거 헬퍼
    // ─────────────────────────────────────────────────────────────────────
    // 에디터 내부에서는 ZWSP 가 빈 블록 첫 스페이스 버그 우회책으로 존재하지만,
    // DB 저장·폼 제출·출력 등 외부로 나갈 때는 제거해야 한다. 별도 이름으로 노출.
    getSanitizedContent() {
        const tmp = document.createElement('div');
        tmp.innerHTML = this.editor.innerHTML;

        // 1) 텍스트 노드의 제로폭 문자(ZWSP/ZWNJ/ZWJ/BOM) 제거
        const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT, null, false);
        const txts = [];
        let n;
        while ((n = walker.nextNode())) txts.push(n);
        txts.forEach((t) => {
            const cleaned = t.nodeValue.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
            if (cleaned === '') {
                // 텍스트가 제로폭 뿐이었다면 노드 자체를 제거 (항상 BR 이 남아 빈 줄 표현은 유지됨)
                t.parentNode && t.parentNode.removeChild(t);
            } else {
                t.nodeValue = cleaned;
            }
        });

        return tmp.innerHTML.replace(/<p>\s*<\/p>/g, '<p><br></p>');
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
        // [SEC-NOTE] undo 스택은 에디터 자신의 이전 상태(innerHTML)만 저장.
        // 스택에 쌓이는 경로: setContent(DB 신뢰 콘텐츠), handlePaste(sanitizeHTML 통과),
        // 사용자 직접 타이핑(텍스트). 외부 비신뢰 HTML이 직접 삽입되는 경로 없음.
        // script 태그는 innerHTML 설정 시 실행되지 않으며, img onerror 등은
        // sanitizeHTML 단계에서 이미 제거되므로 별도 재검증 불필요.
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
            case 'fontSize': {
                // [BUG-FIX] switch-case 내 const/let 선언은 블록 스코프({})가 없으면
                // switch 전체가 하나의 스코프로 취급되어 중복 선언 오류 및 strict mode
                // SyntaxError 발생 가능. 명시적 블록으로 스코프를 격리.
                // [BUG-FIX] rangeCount 미검증 시 getRangeAt(0) 예외 — 가드 추가.
                const selection = window.getSelection();
                if (!selection || !selection.rangeCount) break;
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
            }
            default:
                document.execCommand(command, false, value);
        }
        
        this.normalizeContent();
    }

    saveSelection() {
        // [BUG-FIX] rangeCount === 0 상태에서 getRangeAt(0) 호출 시 예외.
        // 컬러 피커 열기 직전(foreColor/backColor 커맨드)에 호출되므로 노출 빈도 높음.
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            this.savedSelection = sel.getRangeAt(0).cloneRange();
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
        // [iOS-SPACE-FIX] 자동저장 스냅샷은 다음 세션에서 복원하므로 ZWSP 는 그대로 보존한다.
        // (보존해야 복원 직후에도 빈 블록 첫 스페이스 버그 우회가 계속 동작)
        // 외부(DB 제출·출력) 용 정말 깨끗한 HTML 이 필요하면 getSanitizedContent() 을 쓴다.
        const normalizedContent = content.replace(/<p>\s*<\/p>/g, '<p><br></p>');

        // [FIX-AUTOSAVE-META] 순수 HTML 문자열 대신 메타데이터 포함 JSON으로 저장.
        // savedAt: 복원 시 신선도 판단(48h 초과 시 사용자 확인)에 활용.
        const snapshot = JSON.stringify({
            content: normalizedContent,
            savedAt: Date.now()
        });

        try {
            localStorage.setItem('t2editor-autosave', snapshot);
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
            const raw = localStorage.getItem('t2editor-autosave');
            if (!raw || raw.trim() === '') return;

            // [FIX-AUTOSAVE-META] 신규 JSON 포맷({ content, savedAt }) 파싱.
            // 구 포맷(순수 HTML 문자열)은 JSON.parse 실패 시 폴백 처리.
            let saved, savedAt = null;
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.content === 'string') {
                    saved   = parsed.content;
                    savedAt = (typeof parsed.savedAt === 'number') ? parsed.savedAt : null;
                } else {
                    saved = raw;
                }
            } catch {
                saved = raw; // JSON 파싱 실패 → 구 포맷 HTML 문자열 폴백
            }

            if (!saved || saved.trim() === '') return;

            const currentContent = this.editor.innerHTML;
            const isEmpty = !currentContent ||
                           currentContent === '<p><br></p>' ||
                           currentContent === '<p>\u200B<br></p>' ||
                           currentContent.trim() === '';

            if (!isEmpty) return;

            // [FIX-AUTOSAVE-STALE] 48시간 초과 자동 저장은 사용자 확인 후 복원.
            // 오래된 데이터를 무조건 신뢰하지 않도록 보호.
            const STALE_MS = 48 * 60 * 60 * 1000;
            if (savedAt !== null && (Date.now() - savedAt) > STALE_MS) {
                const hoursAgo = Math.round((Date.now() - savedAt) / 3600000);
                const confirmed = window.confirm(
                    `약 ${hoursAgo}시간 전에 자동 저장된 내용이 있습니다.\n` +
                    `복원하시겠습니까?\n(취소하면 저장 내용이 삭제됩니다.)`
                );
                if (!confirmed) {
                    this.clearAutoSave();
                    return;
                }
            }

            // [FIX-AUTOSAVE-LAYOUT] 기존: innerHTML 직접 대입 + normalizeContent()만 호출
            //   → 플러그인 onContentSet(), initializeXxxBlocks() 미실행
            //   → 이미지·코드·비디오·파일 블록 컨트롤/이벤트 미복원
            // 수정: _doSetContent() 경유 → _sanitizeStoredContent() + processContentSet() 위임
            this._doSetContent(saved);
            console.log('AutoSave: Content restored from localStorage');

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
                    // [FIX-AUTOSAVE-META] autoSave()와 동일한 JSON 스냅샷 포맷 유지
                    localStorage.setItem('t2editor-autosave', JSON.stringify({ content: normalizedContent, savedAt: Date.now() }));
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

        // ── 1. Viewport-safe fixed positioning ─────────────────────────────────
        // Picker is appended to document.body with position:fixed so it is never
        // clipped by the editor container or toolbar overflow, and works equally
        // on desktop and mobile.
        const PICKER_W    = 224;   // must match CSS width (.t2-color-picker-container)
        const PICKER_H_EST = 320;  // estimated rendered height (used only for flip logic)

        const btnRect = button.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let left = btnRect.left;
        let top  = btnRect.bottom + 8;

        // Clamp horizontally
        if (left + PICKER_W > vw - 8) left = vw - PICKER_W - 8;
        if (left < 8) left = 8;

        // Flip upward when there is not enough space below
        if (top + PICKER_H_EST > vh - 8) top = Math.max(8, btnRect.top - PICKER_H_EST - 8);

        // ── 2. Build DOM (CSS classes drive all visual styling) ─────────────────
        const pickerContainer = document.createElement('div');
        pickerContainer.className = 't2-color-picker-container';
        // Only position-related props are set inline; colours come from CSS/dark.css
        pickerContainer.style.cssText = `left:${left}px; top:${top}px;`;

        let currentHue        = 0;
        let currentSaturation = 100;
        let currentLightness  = 50;

        // Hue quick-select row
        const hueRow = document.createElement('div');
        hueRow.className = 't2-cp-hue-row';
        const HUE_COLORS = [
            { hue: 0,   color: '#ef4444' }, { hue: 30,  color: '#f97316' },
            { hue: 60,  color: '#eab308' }, { hue: 120, color: '#22c55e' },
            { hue: 200, color: '#3b82f6' }, { hue: 270, color: '#a855f7' },
            { hue: 330, color: '#ec4899' }, { hue: 240, color: '#6366f1' },
            { hue: 180, color: '#14b8a6' }, { hue: 190, color: '#06b6d4' }
        ];
        HUE_COLORS.forEach(({ hue, color }) => {
            const circle = document.createElement('div');
            circle.className = 't2-cp-hue-circle';
            circle.style.backgroundColor = color;
            circle.addEventListener('click', () => {
                currentHue = hue;
                drawCanvas();
                updateAll();
            });
            hueRow.appendChild(circle);
        });

        // Main area: canvas (hue/lightness) + vertical lightness fine-tune slider
        const mainArea = document.createElement('div');
        mainArea.className = 't2-cp-main';

        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 't2-cp-canvas';

        const rainbowCanvas = document.createElement('canvas');
        rainbowCanvas.style.cssText = 'width:100%; height:100%; display:block;';
        canvasWrapper.appendChild(rainbowCanvas);

        const mainIndicator = document.createElement('div');
        mainIndicator.className = 't2-cp-indicator';
        mainIndicator.style.cssText = 'left:50%; top:50%;';
        canvasWrapper.appendChild(mainIndicator);

        // Vertical lightness slider
        const lSlider = document.createElement('div');
        lSlider.className = 't2-cp-l-slider';
        const lHandle = document.createElement('div');
        lHandle.className = 't2-cp-handle';
        lHandle.style.cssText = 'top:50%; left:50%;';
        lSlider.appendChild(lHandle);

        mainArea.appendChild(canvasWrapper);
        mainArea.appendChild(lSlider);

        // Horizontal saturation slider
        const sSlider = document.createElement('div');
        sSlider.className = 't2-cp-s-slider';
        const sHandle = document.createElement('div');
        sHandle.className = 't2-cp-handle';
        sHandle.style.cssText = 'top:50%; left:100%;';
        sSlider.appendChild(sHandle);

        // Preview row: colour swatch + hex input
        const previewArea = document.createElement('div');
        previewArea.className = 't2-cp-preview';
        const colorSwatch = document.createElement('div');
        colorSwatch.className = 't2-cp-swatch';
        colorSwatch.style.backgroundColor = '#ff0000';
        const hexInput = document.createElement('input');
        hexInput.type = 'text';
        hexInput.className = 't2-cp-hex-input';
        hexInput.value = '#ff0000';
        previewArea.appendChild(colorSwatch);
        previewArea.appendChild(hexInput);

        // Apply button
        const applyBtn = document.createElement('button');
        applyBtn.className = 't2-cp-apply';
        applyBtn.textContent = '적용';

        pickerContainer.appendChild(hueRow);
        pickerContainer.appendChild(mainArea);
        pickerContainer.appendChild(sSlider);
        pickerContainer.appendChild(previewArea);
        pickerContainer.appendChild(applyBtn);
        document.body.appendChild(pickerContainer);  // ← body, not toolbar

        // ── 3. Colour math helpers ─────────────────────────────────────────────
        function hslToHex(h, s, l) {
            l /= 100;
            const a = s * Math.min(l, 1 - l) / 100;
            const f = n => {
                const k = (n + h / 30) % 12;
                const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
                return Math.round(255 * c).toString(16).padStart(2, '0');
            };
            return `#${f(0)}${f(8)}${f(4)}`;
        }
        function hexToHsl(hex) {
            const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            if (!m) return { h: 0, s: 0, l: 0 };
            let r = parseInt(m[1], 16) / 255;
            let g = parseInt(m[2], 16) / 255;
            let b = parseInt(m[3], 16) / 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            let h, s, l = (max + min) / 2;
            if (max === min) { h = s = 0; }
            else {
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

        // ── 4. Canvas draw & slider update ─────────────────────────────────────
        function drawCanvas() {
            const rect = rainbowCanvas.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const dpr = window.devicePixelRatio || 1;
            rainbowCanvas.width  = Math.round(rect.width  * dpr);
            rainbowCanvas.height = Math.round(rect.height * dpr);
            const ctx = rainbowCanvas.getContext('2d');
            for (let x = 0; x < rainbowCanvas.width; x++) {
                ctx.fillStyle = `hsl(${(x / (rainbowCanvas.width - 1)) * 360}, 100%, 50%)`;
                ctx.fillRect(x, 0, 1, rainbowCanvas.height);
            }
            const g1 = ctx.createLinearGradient(0, 0, 0, rainbowCanvas.height / 2);
            g1.addColorStop(0, 'rgba(255,255,255,1)');
            g1.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g1;
            ctx.fillRect(0, 0, rainbowCanvas.width, rainbowCanvas.height / 2);
            const g2 = ctx.createLinearGradient(0, rainbowCanvas.height / 2, 0, rainbowCanvas.height);
            g2.addColorStop(0, 'rgba(0,0,0,0)');
            g2.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = g2;
            ctx.fillRect(0, rainbowCanvas.height / 2, rainbowCanvas.width, rainbowCanvas.height / 2);
        }

        function updateSSlider() {
            sSlider.style.background = `linear-gradient(to right,
                hsl(${currentHue},0%,${currentLightness}%),
                hsl(${currentHue},100%,${currentLightness}%))`;
            sHandle.style.left = `${currentSaturation}%`;
        }
        function updateLSlider() {
            lSlider.style.background = `linear-gradient(to bottom,
                hsl(${currentHue},${currentSaturation}%,100%),
                hsl(${currentHue},${currentSaturation}%,0%))`;
            lHandle.style.top = `${100 - currentLightness}%`;
        }
        function updateIndicator() {
            mainIndicator.style.left = `${(currentHue / 360) * 100}%`;
            mainIndicator.style.top  = `${100 - currentLightness}%`;
        }
        function updateAll() {
            const hex = hslToHex(currentHue, currentSaturation, currentLightness);
            colorSwatch.style.backgroundColor = hex;
            hexInput.value = hex;
            updateSSlider();
            updateLSlider();
            updateIndicator();
        }

        // ── 5. Unified pointer/mouse drag handling ─────────────────────────────
        // Handles have pointer-events:none (CSS), so events fall through to the
        // slider element — no separate handle listeners needed.
        let dragging    = null;   // 'main' | 'sat' | 'light'
        let capturedId  = null;

        function relPos(e, el) {
            const r = el.getBoundingClientRect();
            return {
                x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                y: Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height))
            };
        }
        function applyMove(e) {
            if      (dragging === 'main')  { const p = relPos(e, rainbowCanvas); currentHue = Math.round(p.x * 360); currentLightness = Math.round((1 - p.y) * 100); }
            else if (dragging === 'sat')   { currentSaturation = Math.round(relPos(e, sSlider).x * 100); }
            else if (dragging === 'light') { currentLightness  = Math.round((1 - relPos(e, lSlider).y) * 100); }
            updateAll();
        }
        function startDrag(type, captureEl, e) {
            e.preventDefault();
            dragging = type;
            if (window.PointerEvent) {
                capturedId = e.pointerId;
                try { captureEl.setPointerCapture(e.pointerId); } catch (_) {}
            }
            applyMove(e);
        }
        const onMove = (e) => {
            if (!dragging) return;
            if (window.PointerEvent && e.pointerId !== capturedId) return;
            applyMove(e);
        };
        const onUp = (e) => {
            if (window.PointerEvent && e.pointerId !== capturedId) return;
            dragging = null; capturedId = null;
        };

        if (window.PointerEvent) {
            rainbowCanvas.addEventListener('pointerdown', (e) => startDrag('main',  rainbowCanvas, e));
            sSlider.addEventListener(      'pointerdown', (e) => startDrag('sat',   sSlider,       e));
            lSlider.addEventListener(      'pointerdown', (e) => startDrag('light', lSlider,       e));
            document.addEventListener('pointermove',   onMove);
            document.addEventListener('pointerup',     onUp);
            document.addEventListener('pointercancel', onUp);
        } else {
            rainbowCanvas.addEventListener('mousedown', (e) => startDrag('main',  rainbowCanvas, e));
            sSlider.addEventListener(      'mousedown', (e) => startDrag('sat',   sSlider,       e));
            lSlider.addEventListener(      'mousedown', (e) => startDrag('light', lSlider,       e));
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
        }

        // ── 6. Hex input ───────────────────────────────────────────────────────
        hexInput.addEventListener('input', () => {
            const v = hexInput.value.trim();
            if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
                const hsl = hexToHsl(v);
                currentHue = hsl.h; currentSaturation = hsl.s; currentLightness = hsl.l;
                drawCanvas();
                updateAll();
            }
        });

        // ── 7. Apply ───────────────────────────────────────────────────────────
        applyBtn.addEventListener('click', () => {
            // [SEC-INPUT] hexInput.value 를 execCommand 에 전달하기 전 형식 검증.
            // 비정상 값(e.g. 'expression(alert(1))')이 CSS color 값으로 주입되는 경로를 차단.
            const hexVal = hexInput.value.trim();
            if (!/^#[0-9A-Fa-f]{6}$/.test(hexVal)) {
                console.warn('[SEC] Invalid hex color rejected:', hexVal);
                return;
            }
            self.restoreSelection();
            self.execCommand(command, hexVal);
            closeModal();
            self.createUndoPoint();
        });

        // ── 8. Close & cleanup ─────────────────────────────────────────────────
        function closeModal() {
            pickerContainer.remove();
            document.removeEventListener('pointerdown',   outsideClose);
            document.removeEventListener('touchstart',    outsideClose, { passive: true });
            document.removeEventListener('mousedown',     outsideClose);
            document.removeEventListener('pointermove',   onMove);
            document.removeEventListener('pointerup',     onUp);
            document.removeEventListener('pointercancel', onUp);
            document.removeEventListener('mousemove',     onMove);
            document.removeEventListener('mouseup',       onUp);
            document.removeEventListener('keydown',       onEsc);
            window.removeEventListener('resize',          onResize);
            window.removeEventListener('scroll',          onScroll, true);
            dragging = null; capturedId = null;
        }
        const outsideClose = (e) => {
            if (!pickerContainer.contains(e.target) && e.target !== button) closeModal();
        };
        const onEsc = (e) => { if (e.key === 'Escape') closeModal(); };
        // On resize: redraw canvas and keep sliders correct
        const onResize = () => requestAnimationFrame(() => { drawCanvas(); updateAll(); });
        // On scroll: reposition picker to track the (sticky) toolbar button
        const onScroll = () => {
            const r = button.getBoundingClientRect();
            let l2 = r.left, t2 = r.bottom + 8;
            if (l2 + PICKER_W > vw - 8) l2 = vw - PICKER_W - 8;
            if (l2 < 8) l2 = 8;
            if (t2 + PICKER_H_EST > vh - 8) t2 = Math.max(8, r.top - PICKER_H_EST - 8);
            pickerContainer.style.left = l2 + 'px';
            pickerContainer.style.top  = t2 + 'px';
        };

        // Attach close listeners after current event has fully propagated
        requestAnimationFrame(() => {
            document.addEventListener('pointerdown',  outsideClose);
            document.addEventListener('touchstart',   outsideClose, { passive: true });
            document.addEventListener('mousedown',    outsideClose);
            document.addEventListener('keydown',      onEsc);
            window.addEventListener('resize',         onResize);
            window.addEventListener('scroll',         onScroll, true);
        });

        // ── 9. Initial render ──────────────────────────────────────────────────
        requestAnimationFrame(() => { drawCanvas(); updateAll(); });
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
        // [BUG-FIX] rangeCount 미검증 시 getRangeAt(0) 예외 — 가드 추가.
        // 툴바 버튼 클릭 직후 selection 이 editor 밖에 있거나 비어 있을 수 있음.
        if (!selection || !selection.rangeCount) {
            this.execCommand(commands[currentIndex]);
            this.createUndoPoint();
            return;
        }
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

        // 1. 알려진 외부 에디터 클래스/속성 제거 + 이벤트 핸들러/script 일괄 제거
        const foreignAttrPatterns = [
            'data-mce-src', 'data-mce-href', 'data-mce-style',
            'data-cke-saved-src', 'data-cke-saved-href',
        ];

        // [SEC-XSS] <script> 요소 선제 제거 — innerHTML 파싱 직후 즉시 처리.
        // 이후 단계(blockquote → p, div → p)에서 innerHTML을 복사하기 전에
        // 위험 요소를 완전히 제거하여 이벤트 핸들러 실행 경로를 차단함.
        Array.from(temp.querySelectorAll('script, style')).forEach(el => el.remove());

        temp.querySelectorAll('*').forEach(el => {
            foreignAttrPatterns.forEach(attr => el.removeAttribute(attr));

            if (el.className && typeof el.className === 'string') {
                const isForeign = /\b(ql-|mce-|ck-|fr-|note-|ProseMirror|trix-)/.test(el.className);
                if (isForeign) el.removeAttribute('class');
            }

            // [SEC-XSS] 인라인 이벤트 핸들러 일괄 제거 (on* 속성).
            // cloneNode / innerHTML 복사 시 이벤트 핸들러가 전파되는 것을 방지.
            // 배열 스냅샷 사용: 순회 중 속성 제거 시 NamedNodeMap 인덱스 이동 방지.
            Array.from(el.attributes).forEach(attr => {
                if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
            });
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

        // [SEC-XSS] cloneNode(true)는 원본의 모든 어트리뷰트를 복사함.
        // 위험 프로토콜(javascript:, vbscript:, data:) src 및
        // 인라인 이벤트 핸들러(onload, onerror 등) 제거.
        const imgSrc = newImg.getAttribute('src') || '';
        const normalizedImgSrc = imgSrc.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^(javascript|vbscript|data):/i.test(normalizedImgSrc)) {
            newImg.removeAttribute('src');
        }
        Array.from(newImg.attributes).forEach(attr => {
            if (/^on/i.test(attr.name)) newImg.removeAttribute(attr.name);
        });

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

        // [SEC-XSS] cloneNode(true)는 원본의 모든 어트리뷰트를 복사함.
        // 위험 프로토콜(javascript:, vbscript:, data:) src 및
        // 인라인 이벤트 핸들러(onload, onerror 등) 제거.
        const iframeSrc = newIframe.getAttribute('src') || '';
        const normalizedIframeSrc = iframeSrc.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^(javascript|vbscript|data):/i.test(normalizedIframeSrc)) {
            newIframe.removeAttribute('src');
        }
        Array.from(newIframe.attributes).forEach(attr => {
            if (/^on/i.test(attr.name)) newIframe.removeAttribute(attr.name);
        });

        // [SEC-IFRAME-ALLOWLIST] 허용되지 않는 도메인의 iframe 차단.
        // 마이그레이션 과정에서 타 에디터의 임의 iframe 이 삽입되는 경우를 방지.
        const finalSrc = newIframe.getAttribute('src') || '';
        if (!T2Editor._isAllowedIframeSrc(finalSrc)) {
            // 비허용 iframe → 플레이스홀더 텍스트 단락으로 대체
            const placeholder = document.createElement('p');
            // [SEC-XSS] finalSrc 를 textContent 로 삽입 (innerHTML 아님)
            placeholder.textContent = `[외부 미디어 제거됨: ${finalSrc || '출처 불명'}]`;
            return placeholder;
        }

        // [SEC-SANDBOX] 허용된 iframe 에 sandbox 속성 적용
        // srcdoc 속성 제거 (임의 HTML 인젝션 벡터)
        newIframe.removeAttribute('srcdoc');
        T2Editor._applyIframeSandbox(newIframe, finalSrc);

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
        // [SEC-XSS] DB/마이그레이션 콘텐츠에 잔류할 수 있는 스크립트·위험 URL·
        // 비허용 iframe 을 제거한다. t2-* 블록 구조(iframe sandbox 포함)는 보존.
        const safeHtml = this._sanitizeStoredContent(html);
        this.editor.innerHTML = safeHtml;

        const essentialPlugins = ['image', 'code', 'video', 'file', 'table'];
        const allLoaded = essentialPlugins.every(name =>
            this.pluginLoadStatus.get(name) === 'loaded'
        );

        if (allLoaded) {
            // [SEC-XSS] 원본 html 대신 새니타이즈된 safeHtml 을 전달한다.
            // 플러그인 onContentSet() 내부에서 tempDiv.innerHTML = html 패턴을
            // 사용하는 경우, 원본 html 의 on* 핸들러 등이 DOM 파싱 시 실행될 수 있음.
            this.processContentSet(safeHtml);
        } else {
            console.log('Plugins not ready, queuing content initialization');
            // [SEC-XSS] 큐에도 safeHtml 저장 — 이후 소비 시 동일 보호 적용
            this.contentSetQueue = safeHtml;

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
        // [BUG-FIX] Math.random() + timestamp 조합은 동일 밀리초 내에
        // 복수 에디터가 초기화될 때 충돌 가능 (e.g. 페이지 내 다중 에디터).
        // crypto.randomUUID()는 RFC 4122 v4 UUID를 암호학적으로 안전하게 생성.
        // 구형 브라우저(iOS 14 이하 등) 폴백으로 기존 방식 유지.
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID().replace(/-/g, '');
        }
        const random = Math.floor(Math.random() * 1000000000);
        const timestamp = new Date().getTime();
        return `${random}${timestamp}`;
    }

    sanitizeHTML(html) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // [SEC-XSS] iframe 은 의도적으로 allowedTags 에서 제외한다.
        // paste 경로로 삽입된 임의 iframe 은 항상 textContent 로 변환.
        // video 플러그인이 정식으로 iframe 을 생성할 때는 이 함수를 거치지 않고
        // createVideoBlock() → _applyIframeSandbox() 경로를 사용한다.
        const allowedTags = ['b', 'i', 'u', 's', 'strong', 'em', 'br', 'p', 'div', 'span', 'a', 'img', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
        // [SEC-XSS] 'style' 속성 제거: CSS expression()/data-URI 기반 인젝션 차단
        const allowedAttributes = ['href', 'src', 'alt', 'title'];
        
        // [SEC-XSS] href/src에서 위험 프로토콜 차단
        // 공백·제어문자 제거 후 소문자로 비교하여 인코딩 우회 방지
        const isSafeUrl = (value) => {
            const normalized = value.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
            return !/^(javascript|vbscript|data):/i.test(normalized);
        };
        
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
                    } else if ((attr.name === 'href' || attr.name === 'src') && !isSafeUrl(attr.value)) {
                        // [SEC-XSS] javascript:, vbscript:, data: URL 제거
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

    // =========================================================================
    // [SEC-PLUGIN-API] 플러그인 DOM 쓰기 중앙 경계 (P0 / P1)
    //
    // 목적:
    //   플러그인이 `block.innerHTML = html` 을 직접 실행하지 않고,
    //   반드시 이 API 를 통해 DOM 에 HTML 을 반영하도록 강제한다.
    //   중앙 게이트웨이를 통해:
    //     P0  ① 프로필 기반 새니타이즈 (허용 태그·속성·iframe allowlist 검증)
    //         ② on* 이벤트 핸들러, 위험 프로토콜 URL 제거
    //         ③ iframe sandbox 자동 적용
    //     P1  ④ 블록 마커 보정 경고
    //         ⑤ 개발 모드 감사 마커 부여
    //
    // 플러그인 적용 방법:
    //   AS-IS: block.innerHTML = html;
    //   TO-BE: editor.setPluginHTML(block, html, { plugin: 'video' });
    //   또는 : block.innerHTML = editor.sanitizePluginHTML(html, 'video');
    //
    // 다음 세션(각 플러그인 패치) 전까지 플러그인은 AS-IS 동작하지만,
    // 이 API 가 코어에 존재하므로 플러그인 수정만으로 즉시 보안 격상 가능.
    // =========================================================================

    /**
     * 플러그인별 허용 프로필을 반환한다.
     * 각 플러그인이 생성하는 HTML 구조에 맞게 허용 범위를 최소화한다.
     *
     * @param  {string} pluginName
     * @returns {object} profile
     */
    static _getPluginProfile(pluginName) {
        // 공통 data-* 속성 (모든 블록 타입이 사용)
        const COMMON = ['data-t2-block', 'data-block-id', 'data-events-setup'];

        const PROFILES = {
            // ── 비디오 플러그인 ───────────────────────────────────────────────
            // iframe 허용, allowlist 필수, img/audio/table 불허
            video: {
                allowIframe:            true,
                iframeRequireAllowlist: true,
                allowImg:               false,
                allowAudio:             false,
                allowPreCode:           false,
                allowTable:             false,
                allowDownloadLink:      false,
                allowedDataAttrs: [
                    ...COMMON,
                    'data-video-type', 'data-video-url', 'data-video-id',
                ],
            },

            // ── 이미지 플러그인 ───────────────────────────────────────────────
            // img 허용, iframe 불허
            image: {
                allowIframe:            false,
                iframeRequireAllowlist: false,
                allowImg:               true,
                allowAudio:             false,
                allowPreCode:           false,
                allowTable:             false,
                allowDownloadLink:      false,
                allowedDataAttrs:       COMMON,
            },

            // ── 파일 플러그인 ─────────────────────────────────────────────────
            // img(아이콘), audio(미리듣기), download 링크 허용
            file: {
                allowIframe:            false,
                iframeRequireAllowlist: false,
                allowImg:               true,
                allowAudio:             true,
                allowPreCode:           false,
                allowTable:             false,
                allowDownloadLink:      true,
                allowedDataAttrs: [
                    ...COMMON,
                    'data-file-type', 'data-file-name', 'data-file-size',
                    'data-file-url',  'data-mime',
                ],
            },

            // ── 코드 플러그인 ─────────────────────────────────────────────────
            // pre/code 허용, iframe/img/audio 불허
            code: {
                allowIframe:            false,
                iframeRequireAllowlist: false,
                allowImg:               false,
                allowAudio:             false,
                allowPreCode:           true,
                allowTable:             false,
                allowDownloadLink:      false,
                allowedDataAttrs: [
                    ...COMMON,
                    'data-language',
                ],
            },

            // ── 테이블 플러그인 ───────────────────────────────────────────────
            // table 구조 + 셀 내 img 허용
            table: {
                allowIframe:            false,
                iframeRequireAllowlist: false,
                allowImg:               true,
                allowAudio:             false,
                allowPreCode:           false,
                allowTable:             true,
                allowDownloadLink:      false,
                allowedDataAttrs:       COMMON,
            },

            // ── 드로우 플러그인 ───────────────────────────────────────────────
            // img (canvas export) 허용
            draw: {
                allowIframe:            false,
                iframeRequireAllowlist: false,
                allowImg:               true,
                allowAudio:             false,
                allowPreCode:           false,
                allowTable:             false,
                allowDownloadLink:      false,
                allowedDataAttrs:       COMMON,
            },

            // ── 링크 플러그인 ─────────────────────────────────────────────────
            link: {
                allowIframe:            false,
                iframeRequireAllowlist: false,
                allowImg:               false,
                allowAudio:             false,
                allowPreCode:           false,
                allowTable:             false,
                allowDownloadLink:      false,
                allowedDataAttrs:       [],
            },

            // ── AI / AI-rearrange / export / search / collab / clipurl ────────
            // 이 플러그인들은 직접 블록 HTML 을 쓰지 않거나,
            // 최종 패치 세션에서 개별 분석 후 프로필을 구체화한다.
            // 그 전까지 안전 기본값(img 허용, iframe 불허) 적용.
        };

        // 등록되지 않은 플러그인 → 최소 허용 프로필 (안전 기본값)
        return PROFILES[pluginName] || {
            allowIframe:            false,
            iframeRequireAllowlist: true,
            allowImg:               true,
            allowAudio:             false,
            allowPreCode:           false,
            allowTable:             false,
            allowDownloadLink:      false,
            allowedDataAttrs:       COMMON,
        };
    }

    /**
     * 플러그인이 생성한 HTML 을 프로필 기반으로 새니타이즈한다.
     * `block.innerHTML = html` 하기 전 이 함수를 반드시 통과시킨다.
     *
     * 처리 순서:
     *   1. 즉시 실행 가능 태그 제거 (script, object, embed …)
     *   2. on* 이벤트 핸들러 무조건 제거
     *   3. srcdoc 제거
     *   4. href → sanitizeURL('href')
     *   5. src  → sanitizeURL('src')
     *   6. iframe: allowIframe 검사 → allowlist 검사 → sandbox 강제 적용
     *   7. audio, img, pre/code, table: 프로필 허용 여부 검사
     *   8. data-* 속성: 화이트리스트 외 제거
     *
     * @param  {string} html       플러그인이 생성한 HTML 문자열
     * @param  {string} pluginName 플러그인 이름
     * @returns {string}           새니타이즈된 HTML
     */
    sanitizePluginHTML(html, pluginName) {
        if (!html) return '';

        const profile = T2Editor._getPluginProfile(pluginName);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        // ── 1. 즉시 실행 가능 태그 제거 ──────────────────────────────────────
        tempDiv.querySelectorAll('script,object,embed,base,meta,link[rel="import"]')
               .forEach(el => el.remove());

        // ── 2-8. 전체 요소 순회 ───────────────────────────────────────────────
        // querySelectorAll 은 정적 NodeList → 순회 중 remove() 안전
        tempDiv.querySelectorAll('*').forEach(el => {
            const tag = el.tagName.toLowerCase();

            // (2) on* 이벤트 핸들러 무조건 제거
            Array.from(el.attributes).forEach(attr => {
                if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
            });

            // (3) srcdoc 제거
            if (el.hasAttribute('srcdoc')) el.removeAttribute('srcdoc');

            // (4) href 검증
            if (el.hasAttribute('href')) {
                const safe = T2Utils.sanitizeURL(el.getAttribute('href'), 'href');
                if (!safe) el.removeAttribute('href');
            }

            // (5) src 검증 (data: URI 는 img/audio 허용 — context='src')
            if (el.hasAttribute('src')) {
                const safe = T2Utils.sanitizeURL(el.getAttribute('src'), 'src');
                if (!safe) el.removeAttribute('src');
            }

            // (6) iframe 처리
            if (tag === 'iframe') {
                if (!profile.allowIframe) { el.remove(); return; }
                const src = el.getAttribute('src') || '';
                if (profile.iframeRequireAllowlist && !T2Editor._isAllowedIframeSrc(src)) {
                    el.remove(); return;
                }
                // sandbox 강제 재적용 (기존 속성 덮어쓰기)
                el.removeAttribute('sandbox');
                T2Editor._applyIframeSandbox(el, src);
                return; // iframe 은 이후 data-* 검사 불필요
            }

            // (7a) audio — 프로필 불허
            if (tag === 'audio' && !profile.allowAudio) { el.remove(); return; }

            // (7b) img — 프로필 불허
            if (tag === 'img' && !profile.allowImg) { el.remove(); return; }

            // (7c) pre/code — code 플러그인 전용
            if ((tag === 'pre' || tag === 'code') && !profile.allowPreCode) {
                const text = document.createTextNode(el.textContent);
                if (el.parentNode) el.parentNode.replaceChild(text, el);
                return;
            }

            // (7d) table 구조 — table 플러그인 전용
            if (['table','thead','tbody','tr','th','td','colgroup','col'].includes(tag) &&
                !profile.allowTable) {
                el.remove(); return;
            }

            // (8) 허용된 data-* 속성만 유지 (화이트리스트)
            const allowedData = profile.allowedDataAttrs || [];
            Array.from(el.attributes).forEach(attr => {
                if (attr.name.startsWith('data-') && !allowedData.includes(attr.name)) {
                    el.removeAttribute(attr.name);
                }
            });
        });

        return tempDiv.innerHTML;
    }

    /**
     * 플러그인의 DOM 쓰기를 중앙 제어하는 래퍼.
     * 직접 `target.innerHTML = html` 대신 이 함수를 사용한다.
     *
     * 내부 처리:
     *   1. sanitizePluginHTML() 로 새니타이즈
     *   2. 블록 마커 누락 경고 (t2-media-block 등)
     *   3. target.innerHTML 에 반영
     *   4. 개발 모드(__T2EDITOR_DEV__) 에서 감사 마커 속성 추가
     *
     * @param {Element}  target          HTML 을 삽입할 DOM 요소
     * @param {string}   html            삽입할 HTML 문자열
     * @param {object}   [opts]          옵션
     * @param {string}   [opts.plugin]   플러그인 이름 (프로필 조회용)
     * @param {string}   [opts.debugLabel] 로그·마커에 사용할 레이블
     */
    setPluginHTML(target, html, opts) {
        opts = opts || {};

        if (!target || !(target instanceof Element)) {
            console.error('[T2Editor][SEC] setPluginHTML: target 이 유효하지 않습니다.', target);
            return;
        }

        const pluginName = opts.plugin     || 'unknown';
        const label      = opts.debugLabel || pluginName;

        // ── 1. 새니타이즈 ────────────────────────────────────────────────────
        const safeHtml = this.sanitizePluginHTML(html, pluginName);

        // ── 2. 블록 마커 경고 ─────────────────────────────────────────────────
        const hasBlockClass =
            target.classList.contains('t2-media-block')   ||
            target.classList.contains('t2-code-block')    ||
            target.classList.contains('t2-table-wrapper') ||
            target.classList.contains('t2-file-block');
        if (!hasBlockClass) {
            console.warn(
                `[T2Editor][SEC] setPluginHTML: target 에 블록 클래스가 없습니다 ` +
                `(plugin: ${label}). t2-media-block 등을 먼저 지정하세요.`
            );
        }

        // ── 3. DOM 반영 ───────────────────────────────────────────────────────
        target.innerHTML = safeHtml;

        // ── 4. 개발 모드 감사 마커 ────────────────────────────────────────────
        // window.__T2EDITOR_DEV__ = true; 로 활성화 (배포 환경에서는 미정의)
        if (typeof window.__T2EDITOR_DEV__ !== 'undefined' && window.__T2EDITOR_DEV__) {
            target.setAttribute('data-t2-writer',   label);
            target.setAttribute('data-t2-write-ts', String(Date.now()));
        }
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

    // =========================================================================
    // [SEC-IFRAME-ALLOWLIST] iframe 허용 도메인 & sandbox 정적 유틸리티
    //
    // 사용처:
    //   · _migration_createIframeBlock()  — 마이그레이션 시 검증
    //   · _sanitizeStoredContent()        — DB/autosave 콘텐츠 복원 시 검증
    //   · video.js createVideoBlock()     — 비디오 블록 생성 시 sandbox 적용
    //   · video.js initializeVideoBlocks() — 기존 iframe 재초기화 시 검증
    //
    // 허용 도메인 출처:
    //   1. window.T2EDITOR_ALLOWED_IFRAME_DOMAINS  (editor_lib.php 가 주입)
    //   2. location.hostname  (현재 서버는 항상 허용 — video_view.php 등)
    // =========================================================================

    /**
     * 허용 iframe 도메인 Set 반환 (한 페이지에서 1회만 계산, 이후 캐시).
     * @returns {Set<string>}
     */
    static _iframeAllowedDomains() {
        if (T2Editor._iframeDomainsCache) return T2Editor._iframeDomainsCache;

        const configured = Array.isArray(window.T2EDITOR_ALLOWED_IFRAME_DOMAINS)
            ? window.T2EDITOR_ALLOWED_IFRAME_DOMAINS.map(d => String(d).toLowerCase().trim()).filter(Boolean)
            : [];

        // 현재 서버 호스트는 항상 허용 (video_view.php 등 same-origin 콘텐츠)
        const serverHost = (typeof location !== 'undefined' ? location.hostname : '').toLowerCase();

        T2Editor._iframeDomainsCache = new Set([...configured, serverHost].filter(Boolean));
        return T2Editor._iframeDomainsCache;
    }

    /**
     * iframe src 가 허용된 출처인지 판단한다.
     *
     * 규칙:
     *   - 빈 문자열             → false
     *   - javascript:/vbscript:/data: → false (프로토콜 인젝션 차단)
     *   - 상대 경로             → true  (same-origin — 경로 탈출은 서버가 검증)
     *   - 절대 URL / 프로토콜 상대 URL → 도메인이 허용 목록에 있으면 true
     *     (정확 일치 또는 허용 도메인의 서브도메인)
     *
     * @param {string} src
     * @returns {boolean}
     */
    static _isAllowedIframeSrc(src) {
        if (!src || String(src).trim() === '') return false;

        // 위험 프로토콜 선제 차단 (공백·제어문자 제거 후 소문자 비교)
        const normalized = String(src).replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^(javascript|vbscript|data):/i.test(normalized)) return false;

        // 절대 URL / 프로토콜 상대 URL 여부 확인
        const isAbsolute = /^(https?:)?\/\//i.test(src);
        if (!isAbsolute) return true; // 상대 경로 → same-origin → 허용

        // 도메인 추출 및 허용 목록 대조
        try {
            const url = new URL(src.startsWith('//') ? 'https:' + src : src);
            const host = url.hostname.toLowerCase();
            if (!host) return false;

            const allowed = T2Editor._iframeAllowedDomains();
            if (allowed.has(host)) return true;

            // 서브도메인 매칭: host 가 허용 도메인의 서브도메인인 경우
            for (const domain of allowed) {
                if (domain && host.endsWith('.' + domain)) return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    /**
     * iframe 요소에 적절한 sandbox 속성을 적용한다.
     *
     * 이미 sandbox 가 설정되어 있으면 덮어쓰지 않는다 (호출자가 강제 재설정을
     * 원할 때는 직접 removeAttribute('sandbox') 후 호출).
     *
     * same-origin iframe (video_view.php 등):
     *   sandbox="allow-scripts allow-same-origin allow-forms"
     *   ※ allow-same-origin 포함이지만 cross-origin이 아니므로 부모 DOM 접근 불가
     *
     * cross-origin iframe (YouTube, Vimeo 등):
     *   sandbox="allow-scripts allow-same-origin allow-popups
     *            allow-popups-to-escape-sandbox allow-presentation"
     *   ※ allow-top-navigation 의도적 제외 — 부모 페이지 리다이렉션 차단
     *
     * @param {HTMLIFrameElement} iframe
     * @param {string} src  iframe 의 src 속성값 (getAttribute 결과)
     */
    static _applyIframeSandbox(iframe, src) {
        if (iframe.hasAttribute('sandbox')) return; // 이미 설정됨 → 유지

        let isSameOrigin = false;
        try {
            if (!src || !/^(https?:)?\/\//i.test(src)) {
                isSameOrigin = true; // 상대 경로 = same-origin
            } else {
                const url = new URL(src.startsWith('//') ? 'https:' + src : src);
                isSameOrigin = url.hostname.toLowerCase() ===
                               (typeof location !== 'undefined' ? location.hostname.toLowerCase() : '');
            }
        } catch { /* URL 파싱 실패 → cross-origin 으로 취급 */ }

        if (isSameOrigin) {
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
        } else {
            iframe.setAttribute('sandbox',
                'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation');
        }
    }

    // =========================================================================
    // [SEC-XSS] 저장 콘텐츠용 경량 새니타이저
    //
    // 목적: DB/마이그레이션/autosave 로 복원된 HTML 에 남아 있을 수 있는
    //       XSS 페이로드를 제거하면서, t2-* 블록 구조(iframe, img, div 등)는
    //       그대로 보존한다.
    //
    // sanitizeHTML() 과의 차이:
    //   - sanitizeHTML: paste 용, 허용 태그 외 모두 textContent 변환 (엄격)
    //   - _sanitizeStoredContent: 저장 콘텐츠 용, 구조 보존 + 위험 요소만 제거 (관대)
    //
    // 제거 대상:
    //   · <script>, <object>, <embed> 태그
    //   · on* 인라인 이벤트 핸들러 속성
    //   · href / src 의 javascript:, vbscript: 프로토콜
    //     (data: 는 img/video 정상 사용 케이스가 있어 허용; srcdoc 는 별도 처리)
    //   · 허용 도메인 외 iframe (제거 + sandbox 미적용 iframe 에 sandbox 추가)
    // =========================================================================
    _sanitizeStoredContent(html) {
        if (!html) return html;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        // 1. 즉시 실행 가능한 태그 제거
        tempDiv.querySelectorAll('script, object, embed').forEach(el => el.remove());

        // 2. 전체 요소 순회: 이벤트 핸들러·위험 URL 제거, iframe 검증
        //    querySelectorAll 은 정적 NodeList 반환 → forEach 중 remove 안전
        //
        // [NOTE-PRESERVE] 아래 항목들은 의도적으로 제거하지 않는다:
        //   · data-t2-block, data-video-type, data-video-url, data-video-id
        //     — 비디오 블록 URL 복구 기준 (video.js initializeVideoBlocks 의존)
        //   · .t2-video-source[href] 앵커
        //     — iframe/data-* 모두 손실된 경우의 최후 fallback URL 저장소
        //     — href 는 isSafeHref() 검사를 통과하므로 정상 허용됨
        const isSafeUrl = (v) => {
            const n = String(v).replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
            // [SEC-XSS] href 의 data: 프로토콜 차단 추가.
            // data:text/html,<script>... 형태로 클릭 시 스크립트 실행 가능(Chrome 등).
            // src 는 img/video 의 data: URI 가 정상 사용 케이스이므로 계속 허용.
            // 이 함수는 href 와 src 양쪽에 쓰이므로, 호출 시 컨텍스트를 인자로 받아 구분한다.
            return !/^(javascript|vbscript):/i.test(n);
        };
        const isSafeHref = (v) => {
            const n = String(v).replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
            // href: javascript:, vbscript:, data: 모두 차단
            return !/^(javascript|vbscript|data):/i.test(n);
        };

        tempDiv.querySelectorAll('*').forEach(el => {
            // (a) on* 이벤트 핸들러 제거
            Array.from(el.attributes).forEach(attr => {
                if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
            });

            // (b) href / src 위험 프로토콜 차단
            if (el.hasAttribute('href') && !isSafeHref(el.getAttribute('href'))) {
                el.removeAttribute('href');
            }
            if (el.hasAttribute('src') && !isSafeUrl(el.getAttribute('src'))) {
                el.removeAttribute('src');
            }

            // (c) srcdoc 속성 제거 (임의 HTML 인젝션 벡터)
            if (el.hasAttribute('srcdoc')) el.removeAttribute('srcdoc');

            // (d) iframe: 허용 도메인 확인 + sandbox 적용
            if (el.tagName === 'IFRAME') {
                const src = el.getAttribute('src') || '';
                if (!T2Editor._isAllowedIframeSrc(src)) {
                    // 비허용 도메인 iframe 제거
                    el.remove();
                } else {
                    // 허용 도메인이지만 sandbox 미적용 → 적용
                    T2Editor._applyIframeSandbox(el, src);
                }
            }
        });

        return tempDiv.innerHTML;
    }
}

window.T2Editor = T2Editor;
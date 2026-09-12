//Path: T2Editor/plugin/export/export.js

class T2ExportPlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['exportHTML'];
    }

    handleCommand(command, button) {
        switch(command) {
            case 'exportHTML':
                this.exportToHTML();
                break;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // [SEC-EXPORT-BOUNDARY]
    // export 플러그인은 에디터 DOM 에 직접 쓰지는 않지만, 다운로드용 HTML 문서를
    // 새로 생성한다. 따라서 core.js / utils.js 의 공통 보안 경계를 출력 단계에도
    // 적용한다.
    //   · 제목/날짜: HTML/속성 컨텍스트 이스케이프
    //   · 본문: core 저장 콘텐츠 새니타이저 + utils URL 새니타이저
    //   · iframe: core allowlist + sandbox 강제 적용
    //   · 템플릿: 스크립트/이벤트/위험 URL 제거 후 최종 문서 직렬화
    // ─────────────────────────────────────────────────────────────────────

    exportToHTML() {
        const rawTitle = prompt('내보낼 HTML 파일의 제목을 입력하세요:', '문서 제목');
        const title = this.normalizeTitle(rawTitle || 'T2Editor 내보내기');
        const skinUrl = this.buildSkinUrl();

        fetch(skinUrl, { credentials: 'same-origin' })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.text();
            })
            .then(template => {
                const exportHtml = this.renderExportDocument(template, title);
                this.downloadHTML(exportHtml, this.buildDownloadFileName(title));
            })
            .catch(error => {
                console.error('내보내기 템플릿 로드 실패:', error);
                this.exportWithDefaultTemplate(title);
            });
    }

    exportWithDefaultTemplate(title) {
        const safeTitle = this.normalizeTitle(title || 'T2Editor 내보내기');
        const exportHtml = this.renderExportDocument(this.getDefaultTemplate(), safeTitle);
        this.downloadHTML(exportHtml, this.buildDownloadFileName(safeTitle));
    }

    renderExportDocument(template, title) {
        const normalizedTemplate = this.normalizeTemplate(template);
        const editorContent = this.processContentForExport();
        const exportDate = new Date().toLocaleString();

        const exportHtml = normalizedTemplate
            .replace(/\{\{TITLE\}\}/g, this.escapeTemplateText(title))
            .replace(/\{\{CONTENT\}\}/g, editorContent)
            .replace(/\{\{EXPORT_DATE\}\}/g, this.escapeTemplateText(exportDate));

        return this.sanitizeExportDocument(exportHtml);
    }

    normalizeTemplate(template) {
        const raw = (typeof template === 'string') ? template : '';
        const hasContentSlot = raw.indexOf('{{CONTENT}}') !== -1;
        if (!hasContentSlot) return this.getDefaultTemplate();

        // fragment 스킨도 유효한 standalone HTML 로 내보낼 수 있도록 shell 을 제공한다.
        if (!/<html[\s>]/i.test(raw) && !/<!doctype/i.test(raw)) {
            return this.getFragmentTemplate(raw);
        }
        return raw;
    }

    getFragmentTemplate(fragment) {
        return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{TITLE}}</title>
    <style>
        ${this.getExportStyles()}
    </style>
</head>
<body>
    <div class="container">
        <main class="content">
            ${fragment}
        </main>
    </div>
</body>
</html>`;
    }

    getDefaultTemplate() {
        return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{TITLE}}</title>
    <style>
        ${this.getExportStyles()}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>{{TITLE}}</h1>
            <p class="export-date">내보낸 날짜: {{EXPORT_DATE}}</p>
        </header>
        <main class="content">
            {{CONTENT}}
        </main>
        <footer>
            <p class="powered-by">T2Editor로 작성됨</p>
        </footer>
    </div>
</body>
</html>`;
    }

    processContentForExport() {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = this.getCurrentEditorHTML();

        this.removeEditorOnlyUI(tempDiv);
        this.hardenCodeBlocks(tempDiv);
        this.normalizeTablesForExport(tempDiv);
        this.normalizeMediaForExport(tempDiv);
        this.sanitizeNodeTree(tempDiv);

        return this.sanitizeExportContent(tempDiv.innerHTML);
    }

    getCurrentEditorHTML() {
        if (!this.editor || !this.editor.editor) return '';
        return this.editor.editor.innerHTML || '';
    }

    removeEditorOnlyUI(root) {
        root.querySelectorAll([
            '.t2-media-controls',
            '.t2-move-controls',
            '.t2-table-controls',
            '.t2-table-download-btn',
            '.t2-code-toolbar'
        ].join(',')).forEach(el => el.remove());
    }

    hardenCodeBlocks(root) {
        root.querySelectorAll('.t2-code-block pre').forEach(pre => {
            pre.setAttribute('contenteditable', 'false');
            pre.style.overflowX = 'auto';
            pre.style.maxWidth = '100%';
        });

        root.querySelectorAll('.t2-code-block code, pre > code').forEach(code => {
            const rawText = code.textContent || '';
            code.textContent = rawText;
            code.removeAttribute('data-events-setup');
            code.removeAttribute('contenteditable');
        });
    }

    normalizeTablesForExport(root) {
        root.querySelectorAll('.t2-table-wrapper').forEach(wrapper => {
            const table = wrapper.querySelector('table');
            if (!table) return;

            wrapper.querySelectorAll('.t2-table-controls, .t2-table-download-btn').forEach(el => el.remove());

            const hasScrollWrapper = !!wrapper.querySelector('.t2-table-scroll-wrapper');
            const isLargeTable = table.classList.contains('t2-table-large') ||
                (table.rows.length > 10 || (table.rows[0] && table.rows[0].cells.length > 10));

            if (hasScrollWrapper || isLargeTable) {
                const scrollContainer = document.createElement('div');
                scrollContainer.className = 'table-responsive';
                scrollContainer.style.cssText = 'display:block; width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch;';

                const scrollWrapper = wrapper.querySelector('.t2-table-scroll-wrapper');
                if (scrollWrapper) {
                    scrollWrapper.parentNode.insertBefore(table, scrollWrapper);
                    scrollWrapper.remove();
                }

                scrollContainer.appendChild(table);
                wrapper.parentNode.insertBefore(scrollContainer, wrapper);
                wrapper.remove();
            } else {
                wrapper.parentNode.insertBefore(table, wrapper);
                wrapper.remove();
            }
        });
    }

    normalizeMediaForExport(root) {
        root.querySelectorAll('img').forEach(img => {
            this.rewriteUrlAttribute(img, 'src', 'src');
        });

        root.querySelectorAll('audio, video, source').forEach(media => {
            this.rewriteUrlAttribute(media, 'src', 'src');
            if ((media.tagName || '').toLowerCase() !== 'source' && !media.hasAttribute('controls')) {
                media.setAttribute('controls', 'controls');
            }
        });

        root.querySelectorAll('a[href]').forEach(anchor => {
            this.rewriteUrlAttribute(anchor, 'href', 'href');
            if ((anchor.getAttribute('target') || '').toLowerCase() === '_blank') {
                anchor.setAttribute('rel', 'noopener noreferrer');
            }
        });

        root.querySelectorAll('iframe').forEach(iframe => {
            const container = iframe.closest('.t2-media-block')?.querySelector('div:first-child');
            if (container) {
                iframe.style.width = container.style.width || iframe.style.width || '100%';
                iframe.style.height = container.style.height || iframe.style.height || '315px';
            }
            this.applyIframeBoundary(iframe);
        });
    }

    sanitizeExportContent(html) {
        let safe = String(html || '');

        // core.js 저장 콘텐츠 경계 재사용: DB/autosave 복구와 동일한 위험 태그·URL·iframe 검증.
        if (this.editor && typeof this.editor._sanitizeStoredContent === 'function') {
            try {
                safe = this.editor._sanitizeStoredContent(safe);
            } catch (error) {
                console.warn('[T2ExportPlugin][SEC] core stored-content sanitizer failed; fallback sanitizer will run.', error);
            }
        }

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = safe;
        this.sanitizeNodeTree(tempDiv);
        return tempDiv.innerHTML;
    }

    sanitizeExportDocument(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(String(html || ''), 'text/html');

        this.sanitizeNodeTree(doc);

        if (!doc.documentElement.getAttribute('lang')) {
            doc.documentElement.setAttribute('lang', 'ko');
        }

        if (!doc.querySelector('meta[charset]')) {
            const meta = doc.createElement('meta');
            meta.setAttribute('charset', 'UTF-8');
            doc.head.insertBefore(meta, doc.head.firstChild);
        }

        return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    }

    sanitizeNodeTree(root) {
        if (!root || !root.querySelectorAll) return;

        root.querySelectorAll('script, object, embed, base, link[rel="import"], meta[http-equiv="refresh"], svg, math')
            .forEach(el => el.remove());

        root.querySelectorAll('*').forEach(el => {
            const tag = (el.tagName || '').toLowerCase();

            Array.from(el.attributes).forEach(attr => {
                const name = attr.name;
                if (/^on/i.test(name)) {
                    el.removeAttribute(name);
                }
            });

            if (el.hasAttribute('srcdoc')) el.removeAttribute('srcdoc');

            if (el.hasAttribute('style')) {
                const safeStyle = this.sanitizeStyleAttribute(el.getAttribute('style'));
                if (safeStyle) el.setAttribute('style', safeStyle);
                else el.removeAttribute('style');
            }

            if (el.hasAttribute('href')) {
                this.rewriteUrlAttribute(el, 'href', 'href');
            }

            if (el.hasAttribute('xlink:href')) {
                this.rewriteUrlAttribute(el, 'xlink:href', 'href');
            }

            if (el.hasAttribute('src') && tag !== 'iframe') {
                this.rewriteUrlAttribute(el, 'src', 'src');
            }

            if (tag === 'iframe') {
                this.applyIframeBoundary(el);
            }
        });
    }

    rewriteUrlAttribute(el, attrName, context) {
        const raw = el.getAttribute(attrName);
        if (!raw) return;

        const tag = (el.tagName || '').toLowerCase();
        const safe = this.sanitizeURL(raw, context || 'href', tag);
        if (!safe) {
            el.removeAttribute(attrName);
            return;
        }

        el.setAttribute(attrName, this.toAbsoluteURL(safe));
    }

    sanitizeURL(url, context, tagName) {
        if (!url || typeof url !== 'string') return '';

        const normalized = url.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^(javascript|vbscript):/.test(normalized)) return '';
        if ((context || 'href') === 'href' && /^data:/.test(normalized)) return '';
        if (/^data:/.test(normalized) && !this.isAllowedDataURI(normalized, tagName)) return '';

        if (window.T2Utils && typeof T2Utils.sanitizeURL === 'function') {
            const safe = T2Utils.sanitizeURL(url, context || 'href');
            if (!safe) return '';
        }

        return url;
    }

    isAllowedDataURI(normalizedUrl, tagName) {
        const tag = (tagName || '').toLowerCase();
        if (tag === 'img') return /^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(normalizedUrl);
        if (tag === 'audio' || tag === 'source') return /^data:audio\//i.test(normalizedUrl) || /^data:video\//i.test(normalizedUrl);
        if (tag === 'video') return /^data:video\//i.test(normalizedUrl);
        return false;
    }

    toAbsoluteURL(url) {
        const value = String(url || '').trim();
        if (!value) return '';
        if (/^(data:|mailto:|tel:|#)/i.test(value)) return value;

        try {
            return new URL(value, window.location.href).href;
        } catch (_) {
            return value;
        }
    }

    applyIframeBoundary(iframe) {
        if (!iframe || !iframe.getAttribute) return;

        const src = iframe.getAttribute('src') || '';
        const safeSrc = this.sanitizeURL(src, 'iframe-src', 'iframe');
        const allowedByCore = (typeof T2Editor !== 'undefined' && typeof T2Editor._isAllowedIframeSrc === 'function')
            ? T2Editor._isAllowedIframeSrc(src)
            : false;

        if (!safeSrc || !allowedByCore) {
            iframe.remove();
            return;
        }

        iframe.setAttribute('src', this.toAbsoluteURL(safeSrc));
        iframe.removeAttribute('srcdoc');
        iframe.removeAttribute('sandbox');

        if (typeof T2Editor !== 'undefined' && typeof T2Editor._applyIframeSandbox === 'function') {
            T2Editor._applyIframeSandbox(iframe, iframe.getAttribute('src') || safeSrc);
        } else {
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation');
        }
    }

    sanitizeStyleAttribute(styleValue) {
        if (!styleValue) return '';
        const raw = String(styleValue);
        const compact = raw
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
            .toLowerCase();

        if (/(expression\s*\(|javascript\s*:|vbscript\s*:|@import|-moz-binding\s*:|behavior\s*:)/i.test(compact)) {
            return '';
        }

        if (/url\s*\(/i.test(compact) && /(data\s*:\s*text\/html|javascript\s*:|vbscript\s*:)/i.test(compact)) {
            return '';
        }

        return raw;
    }

    escapeTemplateText(value) {
        if (window.T2Utils && typeof T2Utils.escapeAttr === 'function') {
            return T2Utils.escapeAttr(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    normalizeTitle(title) {
        const normalized = String(title == null ? '' : title)
            .replace(/[\u0000-\u001F\u007F]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return (normalized || 'T2Editor 내보내기').slice(0, 120);
    }

    buildDownloadFileName(title) {
        const base = this.normalizeTitle(title || 'T2Editor 내보내기');
        const sanitized = (window.T2Utils && typeof T2Utils.sanitizeFileName === 'function')
            ? T2Utils.sanitizeFileName(base)
            : base.replace(/[\\/:*?"<>|]/g, '_');

        const safeBase = (sanitized || 'T2Editor_Export')
            .replace(/^\.+/, '')
            .replace(/[\u0000-\u001F\u007F]/g, '_')
            .slice(0, 120) || 'T2Editor_Export';

        return safeBase.toLowerCase().endsWith('.html') ? safeBase : safeBase + '.html';
    }

    buildSkinUrl() {
        const base = (typeof t2editor_url !== 'undefined')
            ? t2editor_url
            : (window.T2EDITOR_URL || '');

        try {
            return new URL('plugin/export/export_html_skin.html', String(base).replace(/\/?$/, '/') || window.location.href).href;
        } catch (_) {
            return String(base || '').replace(/\/?$/, '/') + 'plugin/export/export_html_skin.html';
        }
    }

    getExportStyles() {
        return `
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background-color: #fff;
            }
            
            .container {
                background: #fff;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                padding: 40px;
            }
            
            header {
                text-align: center;
                margin-bottom: 40px;
                padding-bottom: 20px;
                border-bottom: 2px solid #eee;
            }
            
            header h1 {
                color: #2c3e50;
                margin: 0;
                font-size: 2.5em;
                font-weight: 300;
            }
            
            .export-date {
                color: #7f8c8d;
                margin: 10px 0 0 0;
                font-size: 0.9em;
            }
            
            .content {
                margin-bottom: 40px;
            }
            
            footer {
                text-align: center;
                padding-top: 20px;
                border-top: 1px solid #eee;
            }
            
            .powered-by {
                color: #95a5a6;
                font-size: 0.8em;
                margin: 0;
            }
            
            /* 미디어 블록 스타일 */
            .t2-media-block {
                margin: 20px 0;
                text-align: center;
            }
            
            .t2-media-block img,
            .t2-media-block iframe,
            .t2-media-block video {
                border-radius: 15px !important;
                border: none !important;
                margin: 0 auto !important;
                max-width: 100%;
                height: auto;
            }
            
            /* 파일 블록 스타일 */
            .file-container {
                width: 100%;
                max-width: 360px;
                background: white;
                border-radius: 12px;
                border: 1px solid #4a4a4a;
                padding: 20px;
                display: flex;
                align-items: center;
                font-family: Roboto, Arial, sans-serif;
                margin: 10px auto;
                text-decoration: none;
                color: inherit;
            }
            
            .file-icon {
                width: 42px;
                height: 52px;
                border-radius: 6px;
                margin-right: 20px;
                position: relative;
                flex-shrink: 0;
                overflow: hidden;
                background-color: #E8B56F;
            }
            
            .file-info {
                flex-grow: 1;
                min-width: 0;
            }
            
            .file-name {
                font-size: 17px;
                font-weight: 500;
                color: rgba(0,0,0,0.87);
                margin: 0 0 6px 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .file-details {
                color: rgba(0,0,0,0.6);
                font-size: 14px;
                line-height: 1.5;
            }
            
            .file-details span {
                display: inline-block;
                margin-right: 12px;
            }
            
            /* 오디오 파일 스타일 */
            .audio-file-container {
                width: 100%;
                max-width: 380px;
                background: white;
                border-radius: 12px;
                border: 1px solid #cdcdcd;
                padding: 20px;
                display: flex;
                align-items: center;
                font-family: Roboto, Arial, sans-serif;
                margin: 10px auto;
                text-decoration: none;
                color: inherit;
            }
            
            .audio-file-icon {
                width: 36px;
                height: 45px;
                background-color: #7C4DFF;
                border-radius: 6px;
                margin-right: 20px;
                position: relative;
                flex-shrink: 0;
                overflow: hidden;
            }
            
            .audio-file-name {
                font-size: 17px;
                font-weight: 500;
                color: rgba(0,0,0,0.87);
                margin: 0 0 6px 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .audio-file-details {
                color: rgba(0,0,0,0.6);
                font-size: 12px;
                line-height: 1.5;
                display: flex;
                gap: 12px;
            }
            
            /* 테이블 스타일 */
            .t2-table {
                width: 100%;
                border-collapse: collapse;
                margin: 15px 0;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                box-shadow: 0 2px 6px rgba(0,0,0,0.1);
                border-radius: 8px;
                overflow: hidden;
            }
            
            .t2-table th,
            .t2-table td {
                border: 1px solid #e0e0e0;
                padding: 12px;
                vertical-align: top;
                text-align: left;
            }
            
            .t2-table th {
                background-color: #f5f7fa;
                font-weight: 600;
                color: #334155;
            }
            
            .table-responsive {
                display: block;
                width: 100%;
                overflow-x: auto;
                margin-bottom: 1rem;
                -webkit-overflow-scrolling: touch;
                border-radius: 8px;
                box-shadow: 0 2px 6px rgba(0,0,0,0.1);
            }
            
            .t2-table.t2-table-large {
                min-width: 800px;
            }
            
            /* 코드 블록 스타일 */
            .t2-code-block {
                background: #f8f9fa;
                border: 1px solid #e9ecef;
                border-radius: 8px;
                padding: 16px;
                margin: 20px 0;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                overflow-x: auto;
            }
            
            .t2-code-block pre {
                margin: 0;
                white-space: pre;
                overflow-x: auto;
            }
            
            .t2-code-block code {
                background: none;
                padding: 0;
                font-size: 14px;
                line-height: 1.5;
                color: #212529;
            }
            
            /* 링크 스타일 */
            a {
                color: #4A90E2;
                text-decoration: none;
                transition: color 0.2s ease;
            }
            
            a:hover {
                color: #357ABD;
                text-decoration: underline;
            }
            
            /* 반응형 스타일 */
            @media (max-width: 768px) {
                body {
                    padding: 10px;
                }
                
                .container {
                    padding: 20px;
                }
                
                header h1 {
                    font-size: 2em;
                }
                
                .file-container,
                .audio-file-container {
                    max-width: 100%;
                }
            }
            
            /* 인쇄 스타일 */
            @media print {
                body {
                    background: white;
                    color: black;
                }
                
                .container {
                    box-shadow: none;
                    border: none;
                }
                
                .t2-media-block iframe {
                    border: 1px solid #ccc;
                    background: #f9f9f9;
                }
                
                .t2-media-block iframe::after {
                    content: "비디오: " attr(src);
                    display: block;
                    padding: 10px;
                    background: #f0f0f0;
                    font-size: 12px;
                }
            }
        `;
    }


    downloadHTML(html, filename) {
        const safeFilename = this.buildDownloadFileName(filename || 'T2Editor_Export.html');
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = safeFilename;
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            if (a.parentNode) a.parentNode.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);

        if (window.T2Utils && typeof T2Utils.showNotification === 'function') {
            T2Utils.showNotification('HTML 파일이 다운로드되었습니다.', 'success');
        }
    }

    exportToMarkdown() {
        const content = this.processContentForMarkdown();
        const markdown = this.htmlToMarkdown(content);

        const rawFilename = prompt('마크다운 파일명을 입력하세요:', 'document.md') || 'document.md';
        const filename = this.buildMarkdownFileName(rawFilename);
        T2Utils.downloadTextFile(markdown, filename, 'text/markdown');
    }

    processContentForMarkdown() {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = this.sanitizeExportContent(this.getCurrentEditorHTML());
        this.removeEditorOnlyUI(tempDiv);
        this.hardenCodeBlocks(tempDiv);
        this.sanitizeNodeTree(tempDiv);
        return tempDiv.innerHTML;
    }

    htmlToMarkdown(html) {
        const container = document.createElement('div');
        container.innerHTML = this.sanitizeExportContent(html);

        const walk = (node) => {
            if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
            if (node.nodeType !== Node.ELEMENT_NODE) return '';

            const tag = node.tagName.toLowerCase();
            const children = Array.from(node.childNodes).map(walk).join('');

            switch (tag) {
                case 'h1': return `# ${children.trim()}\n\n`;
                case 'h2': return `## ${children.trim()}\n\n`;
                case 'h3': return `### ${children.trim()}\n\n`;
                case 'h4': return `#### ${children.trim()}\n\n`;
                case 'h5': return `##### ${children.trim()}\n\n`;
                case 'h6': return `###### ${children.trim()}\n\n`;
                case 'strong':
                case 'b': return `**${children}**`;
                case 'em':
                case 'i': return `*${children}*`;
                case 'code': return node.closest('pre') ? children : `\`${children}\``;
                case 'pre': return `\n\`\`\`\n${node.textContent || ''}\n\`\`\`\n\n`;
                case 'br': return '\n';
                case 'p': return `${children.trim()}\n\n`;
                case 'a': {
                    const href = this.sanitizeURL(node.getAttribute('href') || '', 'href', 'a');
                    return href ? `[${children.trim() || href}](${href})` : children;
                }
                case 'img': {
                    const src = this.sanitizeURL(node.getAttribute('src') || '', 'src', 'img');
                    const alt = node.getAttribute('alt') || '';
                    return src ? `![${alt}](${src})` : '';
                }
                case 'li': return `- ${children.trim()}\n`;
                case 'ul':
                case 'ol': return `\n${children}\n`;
                case 'div':
                case 'section':
                case 'article':
                case 'main': return `${children}\n`;
                default: return children;
            }
        };

        return Array.from(container.childNodes)
            .map(walk)
            .join('')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    buildMarkdownFileName(filename) {
        const base = this.normalizeTitle(filename || 'document.md');
        const sanitized = (window.T2Utils && typeof T2Utils.sanitizeFileName === 'function')
            ? T2Utils.sanitizeFileName(base)
            : base.replace(/[\\/:*?"<>|]/g, '_');
        return sanitized.toLowerCase().endsWith('.md') ? sanitized : sanitized + '.md';
    }

    exportToPDF() {
        if (window.T2Utils && typeof T2Utils.showNotification === 'function') {
            T2Utils.showNotification('PDF 내보내기는 추후 지원 예정입니다.', 'info');
        }
    }
}

window.T2ExportPlugin = T2ExportPlugin;

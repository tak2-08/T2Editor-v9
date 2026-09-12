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

    exportToHTML() {
        // 문서 제목 입력받기
        let title = prompt('내보낼 HTML 파일의 제목을 입력하세요:', '문서 제목') || "T2Editor 내보내기";
        
        // HTML 스킨 템플릿 가져오기
        fetch(t2editor_url + "/plugin/export/export_html_skin.html")
            .then(response => response.text())
            .then(template => {
                // 현재 에디터 내용 처리
                let editorContent = this.processContentForExport();
                
                // 템플릿에 내용 주입
                let exportHtml = template
                    .replace(/\{\{TITLE\}\}/g, title)
                    .replace(/\{\{CONTENT\}\}/g, editorContent)
                    .replace(/\{\{EXPORT_DATE\}\}/g, new Date().toLocaleString());
                
                // 파일 다운로드
                this.downloadHTML(exportHtml, T2Utils.sanitizeFileName(title) + '.html');
            })
            .catch(error => {
                console.error('내보내기 템플릿 로드 실패:', error);
                // 기본 템플릿 사용
                this.exportWithDefaultTemplate(title);
            });
    }

    exportWithDefaultTemplate(title) {
        const editorContent = this.processContentForExport();
        const defaultTemplate = this.getDefaultTemplate();
        
        const exportHtml = defaultTemplate
            .replace(/\{\{TITLE\}\}/g, title)
            .replace(/\{\{CONTENT\}\}/g, editorContent)
            .replace(/\{\{EXPORT_DATE\}\}/g, new Date().toLocaleString());
        
        this.downloadHTML(exportHtml, T2Utils.sanitizeFileName(title) + '.html');
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
        console.log('내보내기 처리 시작');
        
        // 에디터 전체 콘텐츠 복제
        let tempDiv = document.createElement('div');
        tempDiv.innerHTML = this.editor.editor.innerHTML;
        console.log('원본 콘텐츠 길이:', tempDiv.innerHTML.length);
        
        // 미디어 블록 처리
        tempDiv.querySelectorAll('.t2-media-block').forEach(block => {
            console.log('미디어 블록 발견:', block.className);
            
            // 컨트롤 제거
            const controls = block.querySelector('.t2-media-controls');
            if (controls) {
                controls.remove();
                console.log('미디어 컨트롤 제거됨');
            }
        });
        
        // 이미지 경로 절대 경로로 변환
        tempDiv.querySelectorAll('img').forEach(img => {
            let src = img.getAttribute('src');
            console.log('이미지 경로 처리:', src);
            
            // 상대 경로인 경우만 절대 경로로 변환
            if (src && !src.startsWith('http') && !src.startsWith('data:')) {
                let origin = window.location.origin;
                
                if (!src.startsWith('/')) {
                    let currentPath = window.location.pathname.substring(0, 
                        window.location.pathname.lastIndexOf('/') + 1);
                    img.src = origin + currentPath + src;
                } else {
                    img.src = origin + src;
                }
                
                console.log('이미지 경로 변환됨:', img.src);
            }
        });
        
        // 유튜브 iframe 보존 및 스타일 적용
        tempDiv.querySelectorAll('iframe').forEach(iframe => {
            console.log('iframe 발견:', iframe.src);
            
            let container = iframe.closest('.t2-media-block')?.querySelector('div:first-child');
            if (container) {
                iframe.style.width = container.style.width || '100%';
                iframe.style.height = container.style.height || '315px';
                console.log('iframe 스타일 적용:', iframe.style.width, iframe.style.height);
            }
        });
        
        // 테이블 처리
        tempDiv.querySelectorAll('.t2-table-wrapper').forEach(wrapper => {
            console.log('테이블 래퍼 발견');
            const table = wrapper.querySelector('table');
            if (table) {
                // 테이블 컨트롤 제거
                const controls = wrapper.querySelector('.t2-table-controls');
                if (controls) controls.remove();
                
                // 다운로드 버튼 제거
                const downloadBtn = wrapper.querySelector('.t2-table-download-btn');
                if (downloadBtn) downloadBtn.remove();
                
                // 스크롤 래퍼 처리
                const scrollWrapper = wrapper.querySelector('.t2-table-scroll-wrapper');
                if (scrollWrapper) {
                    let scrollContainer = document.createElement('div');
                    scrollContainer.className = 'table-responsive';
                    scrollContainer.style.cssText = 'display:block; width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch;';
                    
                    scrollWrapper.parentNode.insertBefore(table, scrollWrapper);
                    scrollWrapper.remove();
                    
                    scrollContainer.appendChild(table);
                    wrapper.parentNode.insertBefore(scrollContainer, wrapper);
                    wrapper.remove();
                    
                    console.log('테이블 스크롤 래퍼 처리 완료');
                } else {
                    // 작은 테이블은 그냥 래퍼에서 꺼냄
                    wrapper.parentNode.insertBefore(table, wrapper);
                    wrapper.remove();
                    console.log('일반 테이블 처리 완료');
                }
            }
        });
        
        // 파일 블록 처리
        tempDiv.querySelectorAll('.t2-file-block').forEach(block => {
            console.log('파일 블록 발견');
            // 컨트롤 제거
            const controls = block.querySelector('.t2-media-controls');
            if (controls) controls.remove();
        });
        
        // 코드 블록 처리
        tempDiv.querySelectorAll('.t2-code-block').forEach(block => {
            console.log('코드 블록 발견');
            // 툴바 제거
            const toolbar = block.querySelector('.t2-code-toolbar');
            if (toolbar) toolbar.remove();
        });
        
        console.log('최종 내보내기 콘텐츠 길이:', tempDiv.innerHTML.length);
        return tempDiv.innerHTML;
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
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        // 정리
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
        
        T2Utils.showNotification('HTML 파일이 다운로드되었습니다.', 'success');
    }

    exportToMarkdown() {
        const content = this.processContentForMarkdown();
        const markdown = this.htmlToMarkdown(content);
        
        const filename = prompt('마크다운 파일명을 입력하세요:', 'document.md') || 'document.md';
        T2Utils.downloadTextFile(markdown, filename, 'text/markdown');
    }

    processContentForMarkdown() {
        let tempDiv = document.createElement('div');
        tempDiv.innerHTML = this.editor.editor.innerHTML;
        
        // 미디어 블록 및 컨트롤 제거
        tempDiv.querySelectorAll('.t2-media-controls, .t2-table-controls, .t2-code-toolbar').forEach(el => {
            el.remove();
        });
        
        return tempDiv.innerHTML;
    }

    htmlToMarkdown(html) {
        let markdown = html;
        
        // 제목 변환
        markdown = markdown.replace(/<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi, (match, level, text) => {
            return '#'.repeat(parseInt(level)) + ' ' + text.trim() + '\n\n';
        });
        
        // 굵은 글씨
        markdown = markdown.replace(/<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi, '**$2**');
        
        // 기울임 글씨
        markdown = markdown.replace(/<(em|i)[^>]*>(.*?)<\/(em|i)>/gi, '*$2*');
        
        // 링크
        markdown = markdown.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
        
        // 이미지
        markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)');
        markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![]($1)');
        
        // 코드 블록
        markdown = markdown.replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gis, '```\n$1\n```\n');
        
        // 인라인 코드
        markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
        
        // 문단
        markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
        
        // 줄바꿈
        markdown = markdown.replace(/<br[^>]*>/gi, '\n');
        
        // HTML 태그 제거
        markdown = markdown.replace(/<[^>]*>/g, '');
        
        // HTML 엔티티 디코딩
        markdown = markdown.replace(/&lt;/g, '<');
        markdown = markdown.replace(/&gt;/g, '>');
        markdown = markdown.replace(/&amp;/g, '&');
        markdown = markdown.replace(/&quot;/g, '"');
        markdown = markdown.replace(/&#39;/g, "'");
        
        // 여러 줄바꿈 정리
        markdown = markdown.replace(/\n{3,}/g, '\n\n');
        
        return markdown.trim();
    }

    exportToPDF() {
        // PDF 내보내기는 별도의 라이브러리 필요 (jsPDF 등)
        T2Utils.showNotification('PDF 내보내기는 추후 지원 예정입니다.', 'info');
    }
}

window.T2ExportPlugin = T2ExportPlugin;
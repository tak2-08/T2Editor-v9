//Path: T2Editor/js/utils.js

window.T2Utils = {
    
    // 모달 생성 및 관리
    createModal: function(content, className = '') {
        // [SEC-XSS] className을 template literal에 삽입하기 전 알파벳·숫자·하이픈·언더스코어·공백만 허용.
        // 검증 없이 외부 값을 className에 넣으면 예상치 못한 클래스 주입이 가능.
        const safeClassName = className.replace(/[^a-zA-Z0-9_\- ]/g, '');
        const modal = document.createElement('div');
        modal.className = `t2-modal-overlay ${safeClassName}`;
        modal.innerHTML = content;
        
        // ESC 키로 모달 닫기
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        // 모달 외부 클릭으로 닫기
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        });
        
        document.body.appendChild(modal);
        return modal;
    },

    // 파일 크기 포맷팅
    formatFileSize: function(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // 파일 타입에 따른 색상 반환
    getFileColor: function(type) {
        const colors = {
            'zip': '#E8B56F',
            'pdf': '#F44336',
            'txt': '#585858',
            'mp3': '#9C27B0',
            'm4a': '#2196F3'
        };
        return colors[type.toLowerCase()] || '#E8B56F';
    },

    // 파일명 정리 (특수문자 제거)
    sanitizeFileName: function(fileName) {
        return fileName.replace(/[\\/:*?"<>|]/g, '_');
    },

    // 드래그 앤 드롭 설정
    setupDragAndDrop: function(element, onFiles) {
        element.addEventListener('dragover', (e) => {
            e.preventDefault();
            element.classList.add('drag-over');
        });

        element.addEventListener('dragleave', (e) => {
            e.preventDefault();
            element.classList.remove('drag-over');
        });

        element.addEventListener('drop', (e) => {
            e.preventDefault();
            element.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                onFiles(Array.from(e.dataTransfer.files));
            }
        });
    },

    // HTTP 요청 (fetch 래퍼)
    request: async function(url, options = {}) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                ...options
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('Request failed:', error);
            throw error;
        }
    },

    // 이미지 유효성 검사
    validateImage: function(file) {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        return allowedTypes.includes(file.type);
    },

    // 파일 유효성 검사
    validateFile: function(file, allowedExtensions) {
        const fileExt = file.name.toLowerCase().split('.').pop();
        return allowedExtensions.includes(fileExt);
    },

    // URL 유효성 검사
    validateUrl: function(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    },

    // YouTube URL에서 비디오 ID 추출 (URL parser 기반)
    // [FIX] getVideoType()과 동일한 파싱 로직 재사용.
    getYouTubeVideoId: function(url) {
        const info = this.getVideoType(url);
        return (info && info.type === 'youtube') ? info.id : null;
    },

    // 비디오 타입 감지 (URL parser 기반)
    //
    // [FIX] 정규식 단순 패턴 매칭 → URL 객체 파싱으로 교체.
    // 지원 YouTube 형식:
    //   · youtube.com/watch?v=ID   · youtu.be/ID
    //   · youtube.com/embed/ID     · youtube.com/shorts/ID
    //   · youtube.com/live/ID      · youtube-nocookie.com/embed/ID
    //   · //www.youtube.com/...    (프로토콜 상대 URL 자동 보정)
    //   · www.youtube.com/...      (프로토콜 없는 URL 자동 보정)
    // 지원 직접 비디오:
    //   · window.T2EDITOR_UPLOAD_CONFIG.extensions.video 에 정의된 확장자
    //     (없으면 fallback: mp4/webm/ogg/mov/m4v/mkv/avi/wmv/flv)
    //   · URL path 기준 확장자 검사 → 쿼리스트링이 붙어 있어도 통과
    //   · 상대 경로도 지원
    getVideoType: function(url) {
        if (!url || typeof url !== 'string') return null;

        // ── 1단계: URL 정규화 ────────────────────────────────────────────────
        let raw = url.trim();
        // 프로토콜 상대 URL (//...) 보정
        if (raw.startsWith('//')) {
            raw = 'https:' + raw;
        }
        // 프로토콜 없는 절대 도메인 (www.youtube.com/...) 보정
        else if (/^(?:www\.|m\.|youtube\.|youtu\.)/i.test(raw)) {
            raw = 'https://' + raw;
        }

        // ── 2단계: YouTube 패턴 판별 ─────────────────────────────────────────
        // [SEC-XSS] video ID는 영숫자·하이픈·언더스코어 11자로 엄격 검증.
        // getVideoIframeUrl()이 동일한 패턴으로 2차 검증하므로 여기서는
        // 파싱 오류 없이 추출하는 것에 집중한다.
        const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
        try {
            const u = new URL(raw);
            const host = u.hostname.toLowerCase().replace(/^m\./, '').replace(/^www\./, '');

            // youtu.be/ID
            if (host === 'youtu.be') {
                const id = u.pathname.replace(/^\//, '').split('/')[0].split('?')[0];
                if (YT_ID_RE.test(id)) return { type: 'youtube', id };
            }

            // youtube.com 및 youtube-nocookie.com 변형 처리
            if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
                // /embed/ID
                const embedMatch = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
                if (embedMatch) return { type: 'youtube', id: embedMatch[1] };

                // /shorts/ID
                const shortsMatch = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
                if (shortsMatch) return { type: 'youtube', id: shortsMatch[1] };

                // /live/ID
                const liveMatch = u.pathname.match(/\/live\/([a-zA-Z0-9_-]{11})/);
                if (liveMatch) return { type: 'youtube', id: liveMatch[1] };

                // /watch?v=ID  또는  /watch?…&v=ID
                const vParam = u.searchParams.get('v');
                if (vParam && YT_ID_RE.test(vParam)) return { type: 'youtube', id: vParam };

                // /v/ID (레거시)
                const vMatch = u.pathname.match(/\/v\/([a-zA-Z0-9_-]{11})/);
                if (vMatch) return { type: 'youtube', id: vMatch[1] };
            }
        } catch(_) {
            // URL 파싱 실패 → 직접 비디오 경로로 계속 진행
        }

        // ── 3단계: 직접 비디오 파일 판별 ─────────────────────────────────────
        // [UPLOAD-CONFIG] window.T2EDITOR_UPLOAD_CONFIG 에서 허용 확장자 가져오기.
        // 주입 실패 시 하드코딩 fallback 사용.
        const cfg = window.T2EDITOR_UPLOAD_CONFIG;
        const allowedExts = (cfg && Array.isArray(cfg.extensions && cfg.extensions.video) && cfg.extensions.video.length)
            ? cfg.extensions.video.map(e => String(e).toLowerCase())
            : ['mp4', 'webm', 'ogg', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'flv'];

        // URL path 기준 확장자 검사 (쿼리스트링·프래그먼트 무시)
        let pathPart;
        try {
            pathPart = new URL(raw).pathname;
        } catch(_) {
            // 상대 경로 등 파싱 불가 → 원본에서 쿼리/프래그먼트 제거
            pathPart = raw.split('?')[0].split('#')[0];
        }
        const ext = pathPart.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
        if (ext && allowedExts.includes(ext)) {
            // 정규화된 URL 반환 (프로토콜 보정이 적용된 raw 사용)
            return { type: 'video', url: raw };
        }

        return null;
    },

    // 색상 헥스 코드 유효성 검사
    validateHexColor: function(hex) {
        return /^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$/.test(hex);
    },

    // 헥스 색상 코드 확장 (3자리 -> 6자리)
    expandHexColor: function(hex) {
        if (hex.length === 3) {
            return hex.split('').map(char => char + char).join('');
        }
        return hex;
    },

    // 엘리먼트가 뷰포트에 보이는지 확인
    isElementInViewport: function(el) {
        const rect = el.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    },

    // 디바운스 함수
    debounce: function(func, wait, immediate) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                timeout = null;
                if (!immediate) func(...args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func(...args);
        };
    },

    // 스로틀 함수
    throttle: function(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    // 깊은 복사
    deepClone: function(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => this.deepClone(item));
        if (typeof obj === 'object') {
            const clonedObj = {};
            for (let key in obj) {
                if (obj.hasOwnProperty(key)) {
                    clonedObj[key] = this.deepClone(obj[key]);
                }
            }
            return clonedObj;
        }
    },

    // 랜덤 문자열 생성
    generateRandomString: function(length = 10) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    },

    // HTML 이스케이프
    escapeHtml: function(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // ── [SEC-PLUGIN-UTILS] 플러그인 보안 헬퍼 ───────────────────────────────
    //
    // 플러그인이 user-controlled 값을 HTML 에 삽입하기 전 반드시 통과시켜야 하는
    // 최소 검증 함수들. core.js 의 sanitizePluginHTML() / setPluginHTML() 에서
    // 내부적으로 사용하며, 플러그인도 직접 호출할 수 있다.
    //
    // 사용 예:
    //   `<span>${T2Utils.escapeHtml(file.name)}</span>`
    //   `<a href="${T2Utils.sanitizeURL(url, 'href')}">`
    //   `<iframe src="${T2Utils.sanitizeURL(src, 'iframe-src')}">`
    // ─────────────────────────────────────────────────────────────────────────

    // URL 새니타이징 — 컨텍스트별 위험 프로토콜 차단
    //
    // context:
    //   'href'       → javascript:, vbscript:, data: 모두 차단
    //                  (data:text/html 클릭 시 스크립트 실행 가능)
    //   'src'        → javascript:, vbscript: 차단
    //                  (data: URI 는 img/audio 정상 사용 케이스 → 허용)
    //   'iframe-src' → src 규칙 + T2Editor 허용 도메인 allowlist 검증
    //
    // 반환: 안전한 URL 문자열, 위험하면 ''
    sanitizeURL: function(url, context) {
        if (!url || typeof url !== 'string') return '';
        context = context || 'href';

        // 공백·제어문자·zero-width 제거 후 소문자 비교 (인코딩 우회 방지)
        const normalized = url.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();

        // javascript:, vbscript: — 모든 컨텍스트에서 차단
        if (/^(javascript|vbscript):/.test(normalized)) return '';

        // href 컨텍스트: data: 도 차단
        if (context === 'href' && /^data:/.test(normalized)) return '';

        // iframe-src: T2Editor allowlist 검증
        // T2Editor 가 아직 정의되지 않은 경우 안전하게 차단
        if (context === 'iframe-src') {
            if (typeof T2Editor === 'undefined' || !T2Editor._isAllowedIframeSrc(url)) return '';
        }

        return url;
    },

    // HTML 속성 값 이스케이프 (속성 컨텍스트 특화)
    //
    // escapeHtml() 과의 차이:
    //   escapeHtml()  → textContent 기반, innerHTML 컨텍스트 (태그 내부 텍스트)
    //   escapeAttr()  → 단/쌍따옴표 포함 5자 모두 처리, 속성값 컨텍스트
    //
    // 사용 예:
    //   `<div class="${T2Utils.escapeAttr(userClass)}">`
    //   `<input value="${T2Utils.escapeAttr(userInput)}">`
    escapeAttr: function(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },

    // HTML 언이스케이프
    unescapeHtml: function(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
    },

    // CSS 유닛 파싱
    parseCSSUnit: function(value) {
        const match = value.match(/^(\d+(?:\.\d+)?)(px|em|rem|%|vh|vw)?$/);
        if (match) {
            return {
                value: parseFloat(match[1]),
                unit: match[2] || 'px'
            };
        }
        return null;
    },

    // 이미지 프리로드
    preloadImage: function(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    },

    // Canvas에서 이미지 다운로드
    downloadCanvasAsImage: function(canvas, filename, format = 'image/png', quality = 0.8) {
        const url = canvas.toDataURL(format, quality);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    // 텍스트 파일 다운로드
    downloadTextFile: function(content, filename, type = 'text/plain') {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    // 미디어 쿼리 매칭
    matchMedia: function(query) {
        return window.matchMedia(query).matches;
    },

    // 터치 디바이스 감지
    isTouchDevice: function() {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    },

    // 모바일 디바이스 감지
    isMobile: function() {
        return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    },

    // 요소의 계산된 스타일 가져오기
    getComputedStyle: function(element, property) {
        return window.getComputedStyle(element).getPropertyValue(property);
    },

    // 요소에 클래스 토글
    toggleClass: function(element, className, force) {
        if (force !== undefined) {
            element.classList.toggle(className, force);
        } else {
            element.classList.toggle(className);
        }
    },

    // 애니메이션 완료 대기
    waitForAnimation: function(element, animationName) {
        return new Promise(resolve => {
            const handler = (e) => {
                if (e.animationName === animationName) {
                    element.removeEventListener('animationend', handler);
                    resolve();
                }
            };
            element.addEventListener('animationend', handler);
        });
    },

    // 트랜지션 완료 대기
    waitForTransition: function(element, property) {
        return new Promise(resolve => {
            const handler = (e) => {
                if (!property || e.propertyName === property) {
                    element.removeEventListener('transitionend', handler);
                    resolve();
                }
            };
            element.addEventListener('transitionend', handler);
        });
    },

    // 안전한 JSON 파싱
    safeJsonParse: function(str, fallback = null) {
        try {
            return JSON.parse(str);
        } catch {
            return fallback;
        }
    },

    // 로컬 스토리지 안전한 읽기/쓰기
    storage: {
        get: function(key, fallback = null) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : fallback;
            } catch {
                return fallback;
            }
        },
        
        set: function(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch {
                return false;
            }
        },
        
        remove: function(key) {
            try {
                localStorage.removeItem(key);
                return true;
            } catch {
                return false;
            }
        }
    },

    // 에러 핸들링
    handleError: function(error, context = '') {
        console.error(`T2Editor Error ${context}:`, error);
        
        // 사용자에게 표시할 에러 메시지
        const userMessage = this.getUserFriendlyError(error);
        
        // 에러 알림 표시 (필요시)
        if (userMessage) {
            this.showNotification(userMessage, 'error');
        }
    },

    // 사용자 친화적 에러 메시지 변환
    getUserFriendlyError: function(error) {
        const errorMap = {
            'NetworkError': '네트워크 연결을 확인해주세요.',
            'TypeError': '예기치 않은 오류가 발생했습니다.',
            'ReferenceError': '일부 기능을 사용할 수 없습니다.',
            'SyntaxError': '데이터 형식에 오류가 있습니다.'
        };
        
        const errorType = error.constructor.name;
        return errorMap[errorType] || '오류가 발생했습니다. 다시 시도해주세요.';
    },

    // 알림 표시
    showNotification: function(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `t2-notification t2-notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 4px;
            color: white;
            font-size: 14px;
            z-index: 10000;
            transform: translateX(100%);
            transition: transform 0.3s ease;
        `;
        
        // 타입별 배경색
        const colors = {
            info: '#2196F3',
            success: '#4CAF50',
            warning: '#FF9800',
            error: '#F44336'
        };
        notification.style.backgroundColor = colors[type] || colors.info;
        
        document.body.appendChild(notification);
        
        // 애니메이션으로 표시
        requestAnimationFrame(() => {
            notification.style.transform = 'translateX(0)';
        });
        
        // 자동 제거
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, duration);
    }
};
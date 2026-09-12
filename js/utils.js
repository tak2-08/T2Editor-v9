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

    // YouTube URL에서 비디오 ID 추출
    getYouTubeVideoId: function(url) {
        const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[7].length === 11) ? match[7] : null;
    },

    // 비디오 타입 감지
    getVideoType: function(url) {
        // YouTube URL 패턴
        const youtubeRegExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const youtubeMatch = url.match(youtubeRegExp);
        
        if (youtubeMatch && youtubeMatch[2].length === 11) {
            return { type: 'youtube', id: youtubeMatch[2] };
        }
        
        // 직접 비디오 URL 패턴
        const videoRegExp = /\.(mp4|webm|ogg)$/i;
        const videoMatch = url.match(videoRegExp);
        
        if (videoMatch) {
            return { type: 'video', url: url };
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
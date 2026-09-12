// Path: T2Editor/plugin/file/audio_player.js
// iframe 내부 오디오 플레이어 로직
// video_player.js 와 동일한 IIFE 패턴 사용
(function () {
    'use strict';

    var SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

    // ─────────────────────────────────────────────────────────────────────────
    function safeParseJson(str, fallback) {
        try { return JSON.parse(str); } catch (e) { return fallback; }
    }

    function formatTime(secs) {
        if (!isFinite(secs) || isNaN(secs) || secs < 0) return '0:00';
        var m = Math.floor(secs / 60);
        var s = Math.floor(secs % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    // ── postMessage: 부모(에디터)에 iframe 높이 전달 ──────────────────────────
    // 부모 file.js 가 이 메시지를 받아 iframe.height 를 동적으로 조정한다.
    function notifyHeight() {
        var card = document.querySelector('[data-t2ap-player]');
        if (!card) return;
        var h = card.getBoundingClientRect().height;
        if (h <= 0) return;
        try {
            window.parent.postMessage({
                type: 't2audio:resize',
                height: Math.ceil(h) + 2   // 2px 여유 (테두리 아티팩트 방지)
            }, '*');
        } catch (e) {}
    }

    // ─────────────────────────────────────────────────────────────────────────
    function T2AudioPlayer(root) {
        this.root      = root;
        this.payload   = safeParseJson(root.getAttribute('data-payload') || '{}', {});
        this.speedIdx  = 2; // 기본 1×

        this.playBtn   = root.querySelector('[data-play]');
        this.playIcon  = root.querySelector('[data-play-icon], [data-play-icon] ~ svg, svg');
        this.speedBtn  = root.querySelector('[data-speed]');
        this.track     = root.querySelector('[data-track]');
        this.fill      = root.querySelector('[data-fill]');
        this.thumb     = root.querySelector('[data-thumb]');
        this.currentEl = root.querySelector('[data-current]');
        this.totalEl   = root.querySelector('[data-total]');

        // <audio> 동적 생성 (DOM에 숨겨 둠)
        this.audio           = document.createElement('audio');
        this.audio.src       = this.payload.url || '';
        this.audio.preload   = 'metadata';
        this.audio.style.cssText = 'display:none;position:absolute;width:0;height:0;';
        document.body.appendChild(this.audio);

        this._isSeeking = false;

        this._bindEvents();
    }

    var SVG_PLAY  = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="margin-left:2px"><path d="M8 5v14l11-7z"/></svg>';
    var SVG_PAUSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

    T2AudioPlayer.prototype._setPlaying = function (playing) {
        if (playing) {
            this.playBtn.innerHTML = SVG_PAUSE;
            this.playIcon = this.playBtn.querySelector('svg');
            this.playBtn.setAttribute('aria-label', '일시정지');
        } else {
            this.playBtn.innerHTML = SVG_PLAY;
            this.playIcon = this.playBtn.querySelector('svg');
            this.playBtn.setAttribute('aria-label', '재생');
        }
    };

    T2AudioPlayer.prototype._updateProgress = function () {
        var a = this.audio;
        if (!isFinite(a.duration) || a.duration <= 0) return;
        var pct = (a.currentTime / a.duration) * 100;
        this.fill.style.width  = pct + '%';
        this.thumb.style.left  = pct + '%';
        this.currentEl.textContent = formatTime(a.currentTime);
        this.track.setAttribute('aria-valuenow', Math.round(pct));
    };

    T2AudioPlayer.prototype._seekTo = function (clientX) {
        var rect = this.track.getBoundingClientRect();
        var x    = Math.max(0, Math.min(clientX - rect.left, rect.width));
        var pct  = rect.width > 0 ? x / rect.width : 0;
        var a    = this.audio;
        if (isFinite(a.duration) && a.duration > 0) {
            a.currentTime = pct * a.duration;
            this.fill.style.width  = (pct * 100) + '%';
            this.thumb.style.left  = (pct * 100) + '%';
            this.currentEl.textContent = formatTime(a.currentTime);
            this.track.setAttribute('aria-valuenow', Math.round(pct * 100));
        }
    };

    T2AudioPlayer.prototype._bindEvents = function () {
        var self  = this;
        var audio = this.audio;

        // ── audio 이벤트 ─────────────────────────────────────────────────────
        audio.addEventListener('loadedmetadata', function () {
            self.totalEl.textContent = formatTime(audio.duration);
        });
        audio.addEventListener('timeupdate', function () {
            if (!self._isSeeking) self._updateProgress();
        });
        audio.addEventListener('ended', function () {
            self._setPlaying(false);
            self.fill.style.width  = '0%';
            self.thumb.style.left  = '0%';
            self.currentEl.textContent = '0:00';
            self.track.setAttribute('aria-valuenow', '0');
        });

        // ── 재생 버튼 ─────────────────────────────────────────────────────────
        this.playBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (audio.paused) {
                audio.play().catch(function (err) {
                    console.warn('[T2Audio] play() 실패:', err);
                });
                self._setPlaying(true);
            } else {
                audio.pause();
                self._setPlaying(false);
            }
        });

        // scale(0.91) 탭 피드백
        this.playBtn.addEventListener('pointerdown', function () {
            self.playBtn.style.transform = 'scale(0.91)';
        });
        var resetScale = function () { self.playBtn.style.transform = ''; };
        this.playBtn.addEventListener('pointerup',     resetScale);
        this.playBtn.addEventListener('pointercancel', resetScale);
        this.playBtn.addEventListener('pointerleave',  resetScale);

        // ── 배속 badge ────────────────────────────────────────────────────────
        this.speedBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            self.speedIdx = (self.speedIdx + 1) % SPEEDS.length;
            var spd = SPEEDS[self.speedIdx];
            audio.playbackRate = spd;
            self.speedBtn.textContent = spd + '×';
        });

        // ── 진행바 시크 (Pointer Capture) ─────────────────────────────────────
        this.track.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            self._isSeeking = true;
            self.track.setPointerCapture(e.pointerId);
            self._seekTo(e.clientX);
        });
        this.track.addEventListener('pointermove', function (e) {
            if (!self._isSeeking) return;
            self._seekTo(e.clientX);
        });
        this.track.addEventListener('pointerup', function (e) {
            if (!self._isSeeking) return;
            self._isSeeking = false;
            self.track.releasePointerCapture(e.pointerId);
        });
        this.track.addEventListener('pointercancel', function () {
            self._isSeeking = false;
        });

        // ── 키보드 접근성 (Space = 재생/일시정지) ────────────────────────────
        document.addEventListener('keydown', function (e) {
            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
                self.playBtn.click();
            }
        });

        // ── postMessage: 부모로부터 명령 수신 ────────────────────────────────
        // (에디터가 재생 중지 등을 요청할 때 사용, video_player.js 동일 패턴)
        window.addEventListener('message', function (ev) {
            if (!ev.data || ev.data.type !== 't2audio:command') return;
            switch (ev.data.action) {
                case 'pause': audio.pause(); self._setPlaying(false); break;
                case 'play':  audio.play().catch(function(){}); self._setPlaying(true); break;
            }
        });
    };

    // ─────────────────────────────────────────────────────────────────────────
    // 초기화
    // ─────────────────────────────────────────────────────────────────────────
    function init() {
        var root = document.querySelector('[data-t2ap-player]');
        if (!root) return;

        new T2AudioPlayer(root);

        // Material Icons 로드 후 높이 알림
        // (폰트 로드 전 측정하면 높이가 다를 수 있다)
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                notifyHeight();
            });
        } else {
            setTimeout(notifyHeight, 300);
        }
        // ResizeObserver 로 카드 높이 변화 감시 (반응형)
        if (typeof ResizeObserver !== 'undefined') {
            var ro = new ResizeObserver(function () { notifyHeight(); });
            ro.observe(root);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
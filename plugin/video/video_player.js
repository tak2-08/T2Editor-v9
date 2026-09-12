(function () {
  'use strict';

  var COMMAND_TYPE   = 't2video:command';
  var EVENT_TYPE     = 't2video:event';
  var IDLE_DELAY_MS  = 2600;
  var SKIP_SECS      = 10;
  var LONGPRESS_MS   = 420;
  var DOUBLETAP_MS   = 280;
  var VOL_LP_MS      = 2000; // 볼륨 패널 long press 트리거 ms (모바일 2초)
  var VOL_HIDE_MS    = 1500; // 볼륨 패널 자동 숨김 ms
  var COMPACT_W      = 420;  // 이 px 미만이면 컴팩트 모드

  // ─────────────────────────────────────────────────────────────
  function safeParseJson(value, fallback) {
    try { return JSON.parse(value); } catch (e) { return fallback; }
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    var r = Math.floor(seconds);
    var h = Math.floor(r / 3600);
    var m = Math.floor((r % 3600) / 60);
    var s = r % 60;
    if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    return m + ':' + String(s).padStart(2,'0');
  }

  function isHlsSource(src) {
    if (!src) return false;
    var t = String(src.type || '').toLowerCase();
    var u = String(src.url || '').split('?')[0].split('#')[0].toLowerCase();
    return t === 'hls' || u.slice(-5) === '.m3u8';
  }

  function canPlayNativeHls(video) {
    return Boolean(
      video.canPlayType('application/vnd.apple.mpegurl') ||
      video.canPlayType('application/x-mpegURL')
    );
  }

  function findDefaultSource(sources) {
    if (!Array.isArray(sources) || sources.length === 0) return null;
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].default) return sources[i];
    }
    return sources[0];
  }

  // ─────────────────────────────────────────────────────────────
  function T2VideoPlayer(root) {
    this.root         = root;
    this.video        = root.querySelector('[data-video-el]');
    this.data         = safeParseJson(root.getAttribute('data-video') || '{}', {});
    this.sources      = Array.isArray(this.data.sources) ? this.data.sources : [];
    this.activeSource = null;
    this.idleTimer    = null;
    this.toastTimer   = null;
    this.lastVolume   = 1;

    // long-press state (배속)
    this._lpTimer     = null;
    this._lpActive    = false;
    this._lpSavedRate = 1;

    // double-tap state
    this._tapTimeout  = null;
    this._lastTapTime = 0;
    this._lastTapZone = '';

    // skip feedback timers
    this._skipTimerL = null;
    this._skipTimerR = null;

    // volume panel state
    this._volHideTimer  = null;
    this._volLpTimer    = null;
    this._volLpFired    = false;
    this._lastPtrType   = 'mouse';

    // 워터마크
    this._wmCanvas = null;
    this._wmTimer  = null;

    this.ui = {
      bigPlay:        root.querySelector('[data-big-play]'),
      chrome:         root.querySelector('[data-chrome]'),
      play:           root.querySelector('[data-play]'),
      mute:           root.querySelector('[data-mute]'),
      volumeWrap:     root.querySelector('[data-volume-wrap]'),
      volumePanel:    root.querySelector('[data-volume-panel]'),
      volume:         root.querySelector('[data-volume]'),
      progress:       root.querySelector('[data-progress]'),
      progressFill:   root.querySelector('[data-progress-fill]'),
      progressBuffer: root.querySelector('[data-progress-buffer]'),
      progressThumb:  root.querySelector('[data-progress-thumb]'),
      currentTime:    root.querySelector('[data-current-time]'),
      duration:       root.querySelector('[data-duration]'),
      quality:        root.querySelector('[data-quality]'),      // null when select removed
      extLabel:       root.querySelector('[data-ext-label]'),
      speedWrap:      root.querySelector('[data-speed-wrap]'),
      speedBtn:       root.querySelector('[data-speed-btn]'),
      speedMenu:      root.querySelector('[data-speed-menu]'),
      speedOptions:   root.querySelectorAll('[data-speed-option]'),
      fullscreen:     root.querySelector('[data-fullscreen]'),
      pip:            root.querySelector('[data-pip]'),
      toast:          root.querySelector('[data-toast]'),
      speedBadge:     root.querySelector('[data-speed-badge]'),
      skipLeft:       root.querySelector('[data-skip-left]'),
      skipRight:      root.querySelector('[data-skip-right]'),
      helpBtn:        root.querySelector('[data-help-btn]'),
      helpModal:      root.querySelector('[data-help-modal]'),
      helpClose:      root.querySelector('[data-help-close]'),
    };

    this.bind();
    this.bindVolumePanel();
    this.bindCustomSpeed();
    this.initCompactMode();
    this.renderQualityOptions();
    this.initExtLabel();
    this.initAntiDownload(); // ← [LAYER 2/3] 다운로드 방지 초기화
    this.initWatermark();    // ← [LAYER 2] 워터마크 초기화
    this.loadSource(findDefaultSource(this.sources), { preserveTime: false, autoplay: false });
    this.postEvent('ready', { id: this.data.id, title: this.data.title });
  }

  // ── bind ───────────────────────────────────────────────────────
  T2VideoPlayer.prototype.bind = function () {
    var self = this;

    // 재생 토글
    this.ui.play.addEventListener('click', function () { self.togglePlay(); });
    this.ui.bigPlay.addEventListener('click', function () { self.play(); });

    // 비디오 이벤트
    this.video.addEventListener('play', function () {
      self.root.classList.add('is-playing');
      self.postEvent('play', {});
      self.resetIdleTimer();
    });
    this.video.addEventListener('pause', function () {
      self.root.classList.remove('is-playing', 'is-idle');
      self.postEvent('pause', {});
    });
    this.video.addEventListener('loadedmetadata', function () {
      self.updateDuration();
      self.updateProgress();
    });
    this.video.addEventListener('durationchange', function () { self.updateDuration(); });
    this.video.addEventListener('timeupdate', function () {
      self.updateProgress();
      self.postEvent('timeupdate', { currentTime: self.video.currentTime, duration: self.video.duration || 0 });
    });
    this.video.addEventListener('progress', function () { self.updateBuffered(); });
    this.video.addEventListener('volumechange', function () { self.updateVolumeUI(); });
    this.video.addEventListener('ended', function () {
      self.root.classList.remove('is-playing', 'is-idle');
      self.postEvent('ended', {});
    });
    this.video.addEventListener('error', function () {
      self.showToast('영상 소스를 재생할 수 없습니다. URL, CORS, Range 요청 지원 여부를 확인하세요.');
      self.postEvent('error', { message: 'Video source failed to load.' });
    });

    // 프로그레스
    this.ui.progress.addEventListener('input', function () { self.seekBySlider(); });

    // 화질 (select 가 있을 때만)
    if (this.ui.quality) {
      this.ui.quality.addEventListener('change', function () {
        var selected = self.sources.find(function (s) {
          return self.sourceKey(s) === self.ui.quality.value;
        });
        self.loadSource(selected, { preserveTime: true, autoplay: !self.video.paused });
      });
    }

    // 전체화면 / PIP
    this.ui.fullscreen.addEventListener('click', function () { self.toggleFullscreen(); });
    this.ui.pip.addEventListener('click', function () { self.togglePictureInPicture(); });

    // 도움말
    if (this.ui.helpBtn) {
      this.ui.helpBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        self.toggleHelp(true);
      });
    }
    if (this.ui.helpClose) {
      this.ui.helpClose.addEventListener('click', function () { self.toggleHelp(false); });
    }
    if (this.ui.helpModal) {
      // 오버레이 배경 클릭 시 닫기
      this.ui.helpModal.addEventListener('click', function (e) {
        if (e.target === self.ui.helpModal) self.toggleHelp(false);
      });
      // Escape 키로 닫기
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self.ui.helpModal && !self.ui.helpModal.hidden) {
          self.toggleHelp(false);
        }
      });
    }

    // 아이들 타이머 리셋
    ['mousemove','mousedown','touchstart','keydown'].forEach(function (ev) {
      self.root.addEventListener(ev, function () { self.resetIdleTimer(); }, { passive: true });
    });

    // ── 키보드 단축키 ──────────────────────────────────
    this.root.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case ' ': case 'k': case 'K':
          e.preventDefault(); self.togglePlay(); break;
        case 'ArrowRight':
          e.preventDefault(); self.seek(self.video.currentTime + 5); break;
        case 'ArrowLeft':
          e.preventDefault(); self.seek(self.video.currentTime - 5); break;
        case 'm': case 'M':
          e.preventDefault(); self.toggleMute(); break;
        case 'f': case 'F':
          e.preventDefault(); self.toggleFullscreen(); break;
        case '>':
          e.preventDefault(); self.setSpeedStep(+0.25); break;
        case '<':
          e.preventDefault(); self.setSpeedStep(-0.25); break;
        default: break;
      }
    });

    // 전체화면 변경 감지
    document.addEventListener('fullscreenchange', function () {
      if (document.fullscreenElement) {
        self.root.classList.add('is-fullscreen');
      } else {
        self.root.classList.remove('is-fullscreen');
      }
    });

    window.addEventListener('message', function (ev) { self.handleCommand(ev.data); });

    // 터치 제스처 바인딩
    this.bindTouchGestures();
  };

  // ════════════════════════════════════════════════════════════════════════
  // [LAYER 2 + 3] 다운로드 방지 — 클라이언트 측 보호 레이어
  // ════════════════════════════════════════════════════════════════════════
  T2VideoPlayer.prototype.initAntiDownload = function () {
    var self  = this;
    var video = this.video;
    var root  = this.root;

    // ── [3-1] video 속성 강화 ─────────────────────────────────────────────
    // PHP HTML에 이미 선언했으나 JS로도 설정해 동적 교체에 대비합니다.
    video.setAttribute('controlsList', 'nodownload noremoteplayback');
    try { video.disableRemotePlayback = true; } catch (_) {}

    // ── [3-2] 드래그 방지 ───────────────────────────────────────────────
    // 비디오 엘리먼트를 드래그 앤 드롭으로 파일 관리자에 저장하는 것을 막습니다.
    video.setAttribute('draggable', 'false');
    video.addEventListener('dragstart', function (e) {
      e.preventDefault();
      return false;
    });

    // ── [3-3] 우클릭(컨텍스트 메뉴) 차단 ────────────────────────────────
    // "다른 이름으로 비디오 저장" 메뉴 항목을 노출하지 않습니다.
    video.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      return false;
    });
    root.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      return false;
    });

    // ── [3-4] 다운로드 유발 키보드 단축키 차단 (캡처 단계) ───────────────
    // Ctrl+S  : 페이지 저장
    // Ctrl+U  : 소스 보기
    // Ctrl+P  : 인쇄 (미디어 URL 노출 방지)
    // 참고: F12/Ctrl+Shift+I 등 DevTools 단축키는 브라우저가 JS보다 먼저
    //       가로채므로 여기서 차단해도 효과 없음 (고의적으로 제외).
    document.addEventListener('keydown', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;

      var key = (e.key || '').toLowerCase();
      if (key === 's' || key === 'u' || key === 'p') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }, true /* 캡처 단계 */);

    // ── [3-5] Page Visibility API — 탭 숨김 시 일시정지 ─────────────────
    // 화면 녹화 소프트웨어가 탭을 숨긴 채 녹화하는 패턴을 억제합니다.
    // 또한 탭이 비활성 상태일 때 불필요한 스트리밍을 중단합니다.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && !video.paused) {
        video.pause();
        self._pausedByVisibility = true;
      } else if (!document.hidden && self._pausedByVisibility) {
        self._pausedByVisibility = false;
        // 자동 재개하지 않음 — 사용자가 직접 재생 버튼을 누르도록 유도
      }
    });

    // ── [3-6] PiP 진입 시 워터마크 재렌더 ───────────────────────────────
    // Picture-in-Picture 창에도 워터마크가 표시되도록 이벤트 훅을 겁니다.
    video.addEventListener('enterpictureinpicture', function () {
      self._renderWatermark();
    });

    // ── [3-7] 선택 방지 ─────────────────────────────────────────────────
    // CSS user-select:none 이 이미 적용되어 있으나 JS로도 이중 처리합니다.
    root.addEventListener('selectstart', function (e) {
      e.preventDefault();
      return false;
    });

    // ── [3-8] data-video DOM 속성 즉시 제거 ──────────────────────────────
    // 초기화 직후 실제 URL 정보를 포함하는 속성을 DOM에서 삭제합니다.
    // JS는 이미 this.data 로 파싱을 완료했으므로 기능에 영향이 없습니다.
    root.removeAttribute('data-video');

    // ── [3-9] DevTools 진입 키보드 단축키 전면 차단 (캡처 단계) ─────────
    // F12, Ctrl+Shift+I/J/C/K, Ctrl+Alt+I (macOS 포함)
    document.addEventListener('keydown', function (e) {
      if (e.key === 'F12') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        var _k = (e.key || '').toLowerCase();
        if (_k === 'i' || _k === 'j' || _k === 'c' || _k === 'k') {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey &&
          (e.key || '').toLowerCase() === 'i') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }, true);

    // ── [3-10] Screen Capture API (getDisplayMedia) 인터셉트 ─────────────
    // 브라우저 화면 공유·녹화 API 호출 시 재생을 즉시 중단합니다.
    // 권한 다이얼로그 전에 실행되므로 녹화 시작 전 영상이 멈춥니다.
    try {
      if (navigator.mediaDevices &&
          typeof navigator.mediaDevices.getDisplayMedia === 'function') {
        var _origGDM = navigator.mediaDevices.getDisplayMedia
                        .bind(navigator.mediaDevices);
        navigator.mediaDevices.getDisplayMedia = function (constraints) {
          if (!video.paused) {
            video.pause();
            self._pausedByCapture = true;
          }
          self.showToast('화면 녹화/공유가 감지되어 재생을 중지했습니다.');
          return _origGDM(constraints);
        };
      }
    } catch (_) {}

    // ── [3-11] Mutation Observer — video·root 속성 외부 변경 감시 ────────
    // 외부 스크립트가 controls 재주입, data-video 재삽입을 시도할 경우
    // 즉시 원복합니다. src 변경은 감시하지 않아 정상 소스 전환은 허용합니다.
    if (typeof MutationObserver !== 'undefined') {
      var _mo = new MutationObserver(function (mutations) {
        for (var _mi = 0; _mi < mutations.length; _mi++) {
          var _m = mutations[_mi];
          if (_m.attributeName === 'controls') {
            video.removeAttribute('controls');
          }
          if (_m.attributeName === 'data-video') {
            _m.target.removeAttribute('data-video');
          }
        }
      });
      _mo.observe(video, {
        attributes: true,
        attributeFilter: ['controls', 'crossorigin'],
      });
      _mo.observe(root, {
        attributes: true,
        attributeFilter: ['data-video'],
      });
    }

    // ── [3-12] 인쇄 보호 (beforeprint / afterprint) ──────────────────────
    // 인쇄 미리보기 진입 시 플레이어 전체를 숨기고 재생을 중단합니다.
    // CSS @media print 와 이중 보호합니다.
    window.addEventListener('beforeprint', function () {
      if (!video.paused) {
        video.pause();
        self._pausedByPrint = true;
      }
      root.style.setProperty('visibility', 'hidden', 'important');
    });
    window.addEventListener('afterprint', function () {
      root.style.removeProperty('visibility');
      self._pausedByPrint = false;
    });

    // ── [3-13] DevTools 크기 기반 감지 + 재생 중단 ──────────────────────
    // 도킹 DevTools: outerWidth - innerWidth > 임계값
    // 도킹 DevTools(세로): outerHeight - innerHeight > 임계값
    // 언도킹/분리 창: 감지 불가 → 다른 레이어로 보완
    // 모바일은 outerWidth==innerWidth 이므로 오탐 없음
    (function () {
      var _dtOpen = false;
      // 비디오가 로드되고 2초 후부터 폴링을 시작해 초기 오탐 방지
      var _startTimer = window.setTimeout(function () {
        var _poll = window.setInterval(function () {
          var _wg = window.outerWidth  - window.innerWidth;
          var _hg = window.outerHeight - window.innerHeight;
          // OS 창 장식(border, scrollbar) 기본값을 넘는 차이만 양성으로 판단
          var _open = _wg > 180 || _hg > 220;
          if (_open && !_dtOpen) {
            _dtOpen = true;
            if (!video.paused) {
              video.pause();
              self._pausedByDevTools = true;
            }
            self.showToast('개발자 도구가 감지되어 재생을 중지했습니다.');
          } else if (!_open && _dtOpen) {
            _dtOpen = false;
            // 재생 재개는 사용자가 직접 버튼을 눌러야 함
          }
        }, 1500);
        self._dtPollId = _poll; // 필요 시 외부에서 참조 가능
      }, 2000);
      self._dtStartId = _startTimer;
    })();

    // ── [3-14] video.src / currentSrc 프로퍼티 재정의 ──────────────────
    // 브라우저 콘솔에서 video.src 또는 video.currentSrc 로 URL을
    // 직접 읽어도 빈 문자열이 반환되도록 인스턴스 레벨 디스크립터를 덮습니다.
    // 내부 재생 엔진은 prototype 수준의 원본 setter 를 통해 정상 동작합니다.
    try {
      var _hmeProto   = HTMLMediaElement.prototype;
      var _srcDesc    = Object.getOwnPropertyDescriptor(_hmeProto, 'src');
      if (_srcDesc && typeof _srcDesc.set === 'function') {
        Object.defineProperty(video, 'src', {
          get: function ()  { return ''; },
          set: function (v) { _srcDesc.set.call(this, v); },
          configurable: true,
          enumerable:   true,
        });
      }
      // currentSrc: 브라우저가 내부적으로 설정하는 읽기 전용 속성
      // prototype 원본을 래핑해 인스턴스 레벨에서 빈 값을 노출합니다.
      Object.defineProperty(video, 'currentSrc', {
        get: function () { return ''; },
        configurable: true,
      });
    } catch (_) {}

    // ── [3-15] poster·src 속성 데이터 로드 후 즉시 제거 ─────────────────
    // 첫 프레임이 렌더링되면 poster URL 이 더 이상 필요하지 않습니다.
    // HTML 속성에서 제거해 경로 노출을 차단합니다.
    // (video.src 는 프로퍼티 디스크립터로 은폐, attribute 는 여기서 처리)
    function _onFirstFrame() {
      video.removeEventListener('loadeddata', _onFirstFrame);
      video.removeAttribute('poster');
      // setAttribute 로 src 를 직접 주입한 경우를 대비한 추가 제거
      // (정상 경로인 .src 프로퍼티 설정은 attribute 에 반영되므로 제거해도 재생 유지)
      if (video.hasAttribute('src')) video.removeAttribute('src');
    }
    video.addEventListener('loadeddata', _onFirstFrame);

    // ── [3-16] Performance Resource Timing 주기적 클리어 ────────────────
    // performance.getEntriesByType('resource') 를 통해
    // 네트워크 요청 URL 을 추출하는 기법을 무력화합니다.
    try {
      if (typeof performance.setResourceTimingBufferSize === 'function') {
        performance.setResourceTimingBufferSize(0); // 새 항목 기록 중단
      }
      if (typeof performance.clearResourceTimings === 'function') {
        performance.clearResourceTimings();
        // 이후에도 쌓이지 않도록 버퍼 초과 이벤트에서 재클리어
        performance.addEventListener('resourcetimingbufferfull', function () {
          performance.clearResourceTimings();
        });
        // 폴링 방어: 300ms 마다 누적 항목 제거
        setInterval(function () { performance.clearResourceTimings(); }, 300);
      }
    } catch (_) {}

    // ── [3-17] 헤드리스 / 자동화 브라우저 감지 ─────────────────────────
    // Puppeteer, Playwright, PhantomJS 등 영상 자동 다운로드 도구가
    // 사용하는 headless 환경의 고유 흔적을 감지합니다.
    (function () {
      var _automationFlags = [
        // WebDriver (Selenium / Puppeteer CDP)
        navigator.webdriver === true,
        // PhantomJS
        typeof window.callPhantom !== 'undefined',
        typeof window._phantom    !== 'undefined',
        // CasperJS
        typeof window.__nightmare !== 'undefined',
        // Selenium 잔재
        typeof window._selenium            !== 'undefined',
        typeof window.domAutomation        !== 'undefined',
        typeof window.domAutomationController !== 'undefined',
        // Headless Chrome 누락 속성
        /HeadlessChrome/i.test(navigator.userAgent),
        // languages 배열이 빈 경우 (일부 headless)
        Array.isArray(navigator.languages) && navigator.languages.length === 0,
      ];
      if (_automationFlags.some(Boolean)) {
        video.pause();
        root.style.display = 'none';
        // postMessage 이벤트도 차단
        self.postEvent('blocked', { reason: 'automation' });
      }
    })();

    // ── [3-18] window.opener 무효화 ────────────────────────────────────
    // window.open() 으로 열린 경우 opener 참조를 통한
    // 부모 창 접근 및 크로스-창 스크립트 실행을 차단합니다.
    try { window.opener = null; } catch (_) {}
    try {
      if (window.opener !== null) {
        Object.defineProperty(window, 'opener', { value: null, writable: false });
      }
    } catch (_) {}

    // ── [3-19] JS-수준 Fetch / XHR URL 탐침 차단 ───────────────────────
    // 콘솔이나 주입 스크립트에서 video URL 을 직접 fetch() / XHR 로
    // 다운로드 시도할 경우 SecurityError 를 발생시킵니다.
    // ※ 브라우저 내부 미디어 엔진은 JS fetch/XHR 를 사용하지 않으므로
    //    정상 재생에는 영향이 없습니다.
    (function () {
      var _guardUrls = (self.sources || [])
        .map(function (s) { return String(s.url || ''); })
        .filter(function (u) { return u.length > 4; });

      if (_guardUrls.length === 0) return;

      function _isGuarded(url) {
        var u = String(url || '');
        for (var i = 0; i < _guardUrls.length; i++) {
          if (u.indexOf(_guardUrls[i]) !== -1) return true;
        }
        return false;
      }

      // fetch() 래핑
      var _origFetch = window.fetch;
      if (typeof _origFetch === 'function') {
        window.fetch = function (resource, init) {
          var _url = typeof resource === 'string'
                      ? resource
                      : (resource && resource.url ? resource.url : String(resource));
          if (_isGuarded(_url)) {
            return Promise.reject(new DOMException('Access denied', 'SecurityError'));
          }
          return _origFetch.apply(this, arguments);
        };
      }

      // XMLHttpRequest.open() 래핑
      var _origXhrOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        if (_isGuarded(url)) {
          throw new DOMException('Access denied', 'SecurityError');
        }
        return _origXhrOpen.apply(this, arguments);
      };
    })();

    // ── [3-20] video.captureStream() 차단 ──────────────────────────────
    // MediaRecorder API 를 통한 영상 스트림 녹화를 방지합니다.
    // captureStream() → MediaRecorder → ondataavailable 경로를 봉쇄합니다.
    (function () {
      var _blocked = function () {
        throw new DOMException('NotSupportedError: captureStream is disabled.', 'NotSupportedError');
      };
      ['captureStream', 'mozCaptureStream', 'webkitCaptureStream'].forEach(function (fn) {
        try {
          if (typeof video[fn] === 'function') {
            Object.defineProperty(video, fn, {
              value:        _blocked,
              writable:     false,
              configurable: false,
            });
          }
        } catch (_) {}
      });

      // MediaRecorder 생성자도 video 엘리먼트를 스트림으로 삼을 수 없게 래핑
      if (typeof window.MediaRecorder === 'function') {
        var _origMR = window.MediaRecorder;
        window.MediaRecorder = function (stream, options) {
          // MediaStream 의 video 트랙이 보호된 video 엘리먼트에서 온 것인지 탐지
          // (captureStream 을 이미 차단했으므로 여기는 2차 보호)
          return new _origMR(stream, options);
        };
        // 정적 메서드 복사
        Object.keys(_origMR).forEach(function (k) {
          try { window.MediaRecorder[k] = _origMR[k]; } catch (_) {}
        });
        window.MediaRecorder.prototype = _origMR.prototype;
      }
    })();

    // ── [3-21] 워터마크 캔버스 DOM 보호 ────────────────────────────────
    // 외부 스크립트가 canvas 를 제거하거나 숨기려 할 때
    // MutationObserver 로 감지하여 즉시 복원합니다.
    (function () {
      if (!self._wmCanvas) return;
      var _canvas = self._wmCanvas;

      var _FORCE_STYLE = [
        'display:block',
        'visibility:visible',
        'opacity:1',
        'pointer-events:none',
      ].join('!important;') + '!important';

      // style / class / hidden 속성 변경 감시
      var _attrGuard = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          if (m.target === _canvas) {
            _canvas.removeAttribute('hidden');
            _canvas.style.cssText = _FORCE_STYLE;
            _canvas.removeAttribute('class');
            _canvas.className = 't2vp-watermark';
          }
        });
      });
      _attrGuard.observe(_canvas, {
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden'],
      });

      // root 자식 목록 감시 — canvas 제거 시 재삽입
      var _childGuard = new MutationObserver(function (muts) {
        var removed = false;
        muts.forEach(function (m) {
          m.removedNodes.forEach(function (n) {
            if (n === _canvas) removed = true;
          });
        });
        if (removed) {
          root.appendChild(_canvas);
          _canvas.style.cssText = _FORCE_STYLE;
          self._renderWatermark();
        }
      });
      _childGuard.observe(root, { childList: true });
    })();
  };

  // ════════════════════════════════════════════════════════════════════════
  // [LAYER 2] 동적 캔버스 워터마크
  // 화면 녹화나 스크린샷으로 유출된 영상에서 유출자를 식별하기 위해
  // 접속자의 세션 해시(서버 생성)와 현재 시각을 반대각선으로 반복합니다.
  // ════════════════════════════════════════════════════════════════════════
  T2VideoPlayer.prototype.initWatermark = function () {
    var canvas = document.createElement('canvas');
    canvas.className = 't2vp-watermark';
    canvas.setAttribute('aria-hidden', 'true');
    // chrome 위, video 위에 삽입
    this.root.appendChild(canvas);
    this._wmCanvas = canvas;

    // 서버가 생성한 접속자 식별 시드 우선 사용.
    // 없으면 클라이언트 지문(화면·언어·TZ·플랫폼·메모리 해시)으로 대체합니다.
    // 이 값은 스크린샷/녹화 영상에서 유출 경로 추적에 사용됩니다.
    if (this.data.wm_seed && String(this.data.wm_seed).length > 0) {
      this._wmSeed = String(this.data.wm_seed);
    } else {
      // 클라이언트-사이드 지문 (가역적이지 않은 짧은 해시)
      var _fp = [
        screen.width, screen.height, screen.colorDepth,
        navigator.language || '',
        (new Date()).getTimezoneOffset(),
        navigator.platform  || '',
        navigator.hardwareConcurrency || 0,
        navigator.deviceMemory        || 0,
      ].join('|');
      // 간단한 djb2 해시 → base36
      var _h = 5381;
      for (var _ci = 0; _ci < _fp.length; _ci++) {
        _h = ((_h << 5) + _h) + _fp.charCodeAt(_ci);
        _h = _h & 0x7fffffff; // 32비트 양수 유지
      }
      this._wmSeed = 'T2VP-' + _h.toString(36).toUpperCase().slice(-8);
    }

    this._renderWatermark();

    var self = this;
    // 30초마다 타임스탬프 갱신 — 녹화 구간 특정 가능
    this._wmTimer = setInterval(function () { self._renderWatermark(); }, 30000);

    // 창 크기 변경 시 캔버스 재조정
    window.addEventListener('resize', function () { self._renderWatermark(); });
  };

  T2VideoPlayer.prototype._renderWatermark = function () {
    var canvas = this._wmCanvas;
    if (!canvas) return;

    var W = this.root.offsetWidth  || 640;
    var H = this.root.offsetHeight || 360;

    // 크기가 달라진 경우에만 재할당 (불필요한 메모리 할당 방지)
    if (canvas.width !== W)  canvas.width  = W;
    if (canvas.height !== H) canvas.height = H;

    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    // 현재 시각 포맷 (YYYY-MM-DD HH:MM:SS)
    var now = new Date();
    var ts  = now.getFullYear() + '-'
            + String(now.getMonth() + 1).padStart(2, '0') + '-'
            + String(now.getDate()).padStart(2, '0') + ' '
            + String(now.getHours()).padStart(2, '0') + ':'
            + String(now.getMinutes()).padStart(2, '0') + ':'
            + String(now.getSeconds()).padStart(2, '0');

    var text = this._wmSeed + '  ' + ts;

    // ── 레이어 A: 주 워터마크 (일반 시청 중 거의 보이지 않음) ─
    ctx.save();
    ctx.font         = '13px "Courier New", "Lucida Console", monospace';
    ctx.fillStyle    = 'rgba(255,255,255,0.14)';
    ctx.textBaseline = 'middle';

    var angle    = -Math.PI / 7.2;  // ≈ -25°
    var spacingX = 300;
    var spacingY = 90;
    var cols     = Math.ceil(W / spacingX) + 3;
    var rows     = Math.ceil(H / spacingY) + 3;

    ctx.translate(W * 0.5, H * 0.5);
    ctx.rotate(angle);

    var halfCols = Math.ceil(cols / 2);
    var halfRows = Math.ceil(rows / 2);

    for (var row = -halfRows; row <= halfRows; row++) {
      for (var col = -halfCols; col <= halfCols; col++) {
        ctx.fillText(text, col * spacingX - spacingX * 0.5, row * spacingY);
      }
    }
    ctx.restore();

    // ── 레이어 B: 보조 워터마크 (오프셋 + 극미세 투명도 — 화면 녹화 후 이미지 분석용) ─
    // 육안으로는 거의 불가능하지만 이미지 히스토그램/스테가노그래피 분석 시 검출 가능
    ctx.save();
    ctx.font         = '11px "Courier New", monospace';
    ctx.fillStyle    = 'rgba(255,255,255,0.04)';
    ctx.textBaseline = 'middle';

    var angle2    = Math.PI / 9;     // ≈ +20° (반대 방향)
    var spacingX2 = 260;
    var spacingY2 = 110;
    var cols2     = Math.ceil(W / spacingX2) + 3;
    var rows2     = Math.ceil(H / spacingY2) + 3;

    ctx.translate(W * 0.5, H * 0.5);
    ctx.rotate(angle2);

    var halfCols2 = Math.ceil(cols2 / 2);
    var halfRows2 = Math.ceil(rows2 / 2);

    for (var row2 = -halfRows2; row2 <= halfRows2; row2++) {
      for (var col2 = -halfCols2; col2 <= halfCols2; col2++) {
        ctx.fillText(text, col2 * spacingX2 + spacingX2 * 0.25, row2 * spacingY2 + spacingY2 * 0.5);
      }
    }
    ctx.restore();
  };

  // ── 볼륨 패널 ────────────────────────────────────────────────
  T2VideoPlayer.prototype.bindVolumePanel = function () {
    var self      = this;
    var panel     = this.ui.volumePanel;
    var muteBtn   = this.ui.mute;
    var volInput  = this.ui.volume;
    var wrap      = this.ui.volumeWrap;

    if (!panel || !muteBtn) return;

    function isPanelOpen() { return panel.classList.contains('is-open'); }

    function openPanel() { panel.classList.add('is-open'); }

    function closePanel() { panel.classList.remove('is-open'); }

    function scheduleClose() {
      window.clearTimeout(self._volHideTimer);
      self._volHideTimer = window.setTimeout(closePanel, VOL_HIDE_MS);
    }

    function cancelClose() { window.clearTimeout(self._volHideTimer); }

    // ── pointerdown: 포인터 타입 추적 + 모바일 long-press 시작 ──
    muteBtn.addEventListener('pointerdown', function (e) {
      self._lastPtrType = e.pointerType || 'mouse';

      if (e.pointerType === 'touch') {
        self._volLpFired = false;
        self._volLpTimer = window.setTimeout(function () {
          self._volLpFired = true;
          openPanel();
          scheduleClose();
        }, VOL_LP_MS); // 2000 ms
      }
    });

    muteBtn.addEventListener('pointerup',     function () { window.clearTimeout(self._volLpTimer); });
    muteBtn.addEventListener('pointercancel', function () {
      window.clearTimeout(self._volLpTimer);
      self._volLpFired = false;
    });

    // ── click 핸들러 ─────────────────────────────────────────────
    muteBtn.addEventListener('click', function () {
      // long-press로 패널을 이미 열었으면 클릭 이벤트는 무시
      if (self._volLpFired) { self._volLpFired = false; return; }

      if (self._lastPtrType === 'touch') {
        // 모바일: 패널이 열려 있으면 → 음소거 토글(+ 닫기 지연 재시작)
        //         패널이 닫혀 있으면 → 평소대로 음소거 토글
        if (isPanelOpen()) {
          self.toggleMute();
          scheduleClose();
        } else {
          self.toggleMute();
        }
      } else {
        // 데스크톱: 패널이 닫혀 있으면 → 패널 열기(음소거 X)
        //           패널이 열려 있으면 → 음소거 토글(+ 닫기 지연 재시작)
        if (isPanelOpen()) {
          self.toggleMute();
          scheduleClose();
        } else {
          openPanel();
          scheduleClose();
        }
      }
    });

    // ── 볼륨 슬라이더 ──────────────────────────────────────────
    if (volInput) {
      volInput.addEventListener('input', function () {
        self.video.volume = Number(volInput.value);
        self.video.muted  = self.video.volume === 0;
        if (self.video.volume > 0) self.lastVolume = self.video.volume;
      });
      // 드래그 중엔 닫기 타이머 정지, 놓으면 1.5초 후 자동 닫기
      volInput.addEventListener('pointerdown', cancelClose);
      volInput.addEventListener('pointerup',   scheduleClose);
      volInput.addEventListener('touchend',    scheduleClose);
    }

    // ── 영역 밖 클릭 시 패널 즉시 닫기 ────────────────────────
    document.addEventListener('pointerdown', function (e) {
      if (isPanelOpen() && wrap && !wrap.contains(e.target)) {
        cancelClose();
        closePanel();
      }
    });
  };

  // ── 커스텀 배속 메뉴 ─────────────────────────────────────────
  T2VideoPlayer.prototype.bindCustomSpeed = function () {
    var self     = this;
    var speedBtn = this.ui.speedBtn;
    var speedMenu = this.ui.speedMenu;

    if (!speedBtn || !speedMenu) return;

    // 버튼 클릭 → 메뉴 토글
    speedBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = !speedMenu.hidden;
      speedMenu.hidden = isOpen;
      speedBtn.setAttribute('aria-expanded', String(!isOpen));
    });

    // 옵션 선택
    speedMenu.addEventListener('click', function (e) {
      var opt = e.target.closest('[data-speed-option]');
      if (!opt) return;
      var rate = parseFloat(opt.getAttribute('data-speed-option'));
      if (Number.isFinite(rate) && rate > 0) {
        self.setSpeed(rate);
        speedMenu.hidden = true;
        speedBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // 메뉴 내부 클릭은 버블링 차단 (document 닫기 방지)
    speedMenu.addEventListener('click', function (e) { e.stopPropagation(); });

    // 영역 밖 클릭 시 메뉴 닫기
    document.addEventListener('click', function () {
      if (!speedMenu.hidden) {
        speedMenu.hidden = true;
        speedBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // Escape 키로 닫기
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !speedMenu.hidden) {
        speedMenu.hidden = true;
        speedBtn.setAttribute('aria-expanded', 'false');
        speedBtn.focus();
      }
    });
  };

  // ── 컴팩트 모드 (ResizeObserver + overflow 감지) ─────────────
  T2VideoPlayer.prototype.initCompactMode = function () {
    var self = this;

    if (typeof ResizeObserver === 'undefined') return;

    var rafPending = false;

    function check() {
      var controls = self.root.querySelector('.t2vp-controls');
      if (!controls) { self._renderWatermark(); rafPending = false; return; }

      // compact 클래스를 일시 제거해 전체화면 버튼을 controls 안으로 복귀시킨 뒤
      // scrollWidth > clientWidth 이면 공간 부족 → compact 유지
      self.root.classList.remove('is-compact');
      var overflows = controls.scrollWidth > controls.clientWidth + 2;
      if (overflows) self.root.classList.add('is-compact');

      self._renderWatermark();
      rafPending = false;
    }

    var ro = new ResizeObserver(function () {
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(check);
      }
    });

    ro.observe(this.root);
  };

  // ── 확장자 레이블 초기화 ─────────────────────────────────────
  T2VideoPlayer.prototype.initExtLabel = function () {
    var label = this.ui.extLabel;
    if (!label) return;
    var ext = (this.data && this.data.ext) ? String(this.data.ext) : '';
    if (!ext && this.sources.length > 0) {
      ext = String(this.sources[0].quality || this.sources[0].label || '').toUpperCase();
    }
    label.textContent = ext || '';
  };

  // ── 터치 제스처 ──────────────────────────────────────────────
  T2VideoPlayer.prototype.bindTouchGestures = function () {
    var self  = this;
    var video = this.video;

    // ──── Long Press → 2× 배속 ────────────────────────────────
    function startLongPress() {
      self._lpTimer = window.setTimeout(function () {
        self._lpActive     = true;
        self._lpSavedRate  = self.video.playbackRate;
        self.video.playbackRate = 2;
        self.showSpeedBadge();
        self.updateSpeedUI(2);
      }, LONGPRESS_MS);
    }

    function endLongPress() {
      window.clearTimeout(self._lpTimer);
      if (self._lpActive) {
        self._lpActive = false;
        self.video.playbackRate = self._lpSavedRate;
        self.hideSpeedBadge();
        self.updateSpeedUI(self._lpSavedRate);
      }
    }

    video.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        startLongPress();
      }
    });
    video.addEventListener('pointerup',     endLongPress);
    video.addEventListener('pointercancel', endLongPress);
    video.addEventListener('pointerleave',  endLongPress);

    // ──── Double Tap → ±10초 스킵 ─────────────────────────────
    video.addEventListener('touchend', function (e) {
      if (self._lpActive) { e.preventDefault(); return; }

      window.clearTimeout(self._lpTimer);

      var touch  = e.changedTouches[0];
      var rect   = video.getBoundingClientRect();
      var xRatio = (touch.clientX - rect.left) / rect.width;
      var zone   = xRatio < 0.35 ? 'left' : xRatio > 0.65 ? 'right' : 'center';
      var now    = Date.now();

      var isDoubleTap = (zone !== 'center') &&
                        (now - self._lastTapTime < DOUBLETAP_MS) &&
                        (zone === self._lastTapZone);

      if (isDoubleTap) {
        window.clearTimeout(self._tapTimeout);
        self._lastTapTime = 0;
        self._lastTapZone = '';

        if (zone === 'left') {
          self.seek(self.video.currentTime - SKIP_SECS);
          self.showSkipFeedback('left');
        } else {
          self.seek(self.video.currentTime + SKIP_SECS);
          self.showSkipFeedback('right');
        }
      } else {
        self._lastTapTime = now;
        self._lastTapZone = zone;

        window.clearTimeout(self._tapTimeout);

        if (zone === 'center') {
          self.togglePlay();
        } else {
          self._tapTimeout = window.setTimeout(function () {
            self.togglePlay();
          }, DOUBLETAP_MS + 30);
        }
      }
    });

    // 데스크톱 클릭
    video.addEventListener('click', function (e) {
      if (e.pointerType !== 'touch') {
        self.togglePlay();
      }
    });
  };

  // ── 스킵 피드백 ───────────────────────────────────────────────
  T2VideoPlayer.prototype.showSkipFeedback = function (side) {
    var el    = side === 'left' ? this.ui.skipLeft : this.ui.skipRight;
    var timer = side === 'left' ? '_skipTimerL' : '_skipTimerR';
    if (!el) return;

    el.hidden = false;
    el.classList.remove('is-active');
    void el.offsetWidth; // reflow
    el.classList.add('is-active');

    window.clearTimeout(this[timer]);
    this[timer] = window.setTimeout(function () {
      el.classList.remove('is-active');
      el.hidden = true;
    }, 750);
  };

  // ── 속도 뱃지 ─────────────────────────────────────────────────
  T2VideoPlayer.prototype.showSpeedBadge = function () {
    if (!this.ui.speedBadge) return;
    this.ui.speedBadge.hidden = false;
  };

  T2VideoPlayer.prototype.hideSpeedBadge = function () {
    if (!this.ui.speedBadge) return;
    this.ui.speedBadge.hidden = true;
  };

  // ── 배속 설정 (단일 진입점) ──────────────────────────────────
  T2VideoPlayer.prototype.setSpeed = function (rate) {
    if (!Number.isFinite(rate) || rate <= 0) return;
    this.video.playbackRate = rate;
    this._lpSavedRate = rate;
    this.updateSpeedUI(rate);
  };

  T2VideoPlayer.prototype.updateSpeedUI = function (rate) {
    // 버튼 텍스트 업데이트
    if (this.ui.speedBtn) {
      this.ui.speedBtn.textContent = rate + '×';
    }
    // 메뉴 옵션 active 상태 업데이트
    if (this.ui.speedOptions) {
      this.ui.speedOptions.forEach(function (opt) {
        var val = parseFloat(opt.getAttribute('data-speed-option'));
        var isActive = val === rate;
        opt.classList.toggle('is-active', isActive);
        opt.setAttribute('aria-selected', String(isActive));
      });
    }
  };

  // ── 키보드 속도 단계 조절 ────────────────────────────────────
  T2VideoPlayer.prototype.setSpeedStep = function (delta) {
    var STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    var cur   = this.video.playbackRate;
    var idx   = STEPS.indexOf(cur);
    var next;

    if (idx === -1) {
      next = delta > 0 ? Math.min(2, cur + 0.25) : Math.max(0.25, cur - 0.25);
    } else {
      var ni = Math.max(0, Math.min(STEPS.length - 1, idx + (delta > 0 ? 1 : -1)));
      next = STEPS[ni];
    }

    this.setSpeed(next);
    this.showToast('재생 속도: ' + next + '×');
  };

  // ── 소스 관련 ─────────────────────────────────────────────────
  T2VideoPlayer.prototype.sourceKey = function (src) {
    return [src.type || 'auto', src.quality || 'auto', src.url || ''].join('|');
  };

  T2VideoPlayer.prototype.loadSource = function (source, options) {
    if (!source || !source.url) {
      this.showToast('재생 가능한 영상 소스가 없습니다.');
      return;
    }

    var preserveTime = Boolean(options && options.preserveTime);
    var autoplay     = Boolean(options && options.autoplay);
    var prevTime     = preserveTime ? this.video.currentTime : 0;
    var isHls        = isHlsSource(source);

    if (isHls && !canPlayNativeHls(this.video)) {
      var fallback = this.sources.find(function (s) { return !isHlsSource(s); });
      if (fallback && fallback.url !== source.url) {
        this.showToast('현재 브라우저가 HLS를 직접 재생하지 못해 MP4 소스로 전환했습니다.');
        this.loadSource(fallback, { preserveTime: preserveTime, autoplay: autoplay });
        return;
      }
      this.showToast('이 브라우저는 네이티브 HLS를 지원하지 않습니다.');
      this.postEvent('error', { message: 'Native HLS is not supported.' });
      return;
    }

    this.activeSource = source;
    this.video.src    = source.url;
    this.video.load();
    this.syncQualitySelect();

    if (preserveTime && prevTime > 0) {
      this.video.addEventListener('loadedmetadata', function restoreTime() {
        this.removeEventListener('loadedmetadata', restoreTime);
        this.currentTime = Number.isFinite(this.duration)
          ? Math.min(prevTime, Math.max(this.duration - 0.25, 0))
          : prevTime;
      });
    }

    if (autoplay) this.play();

    this.postEvent('sourcechange', {
      label:   source.label,
      quality: source.quality,
      type:    source.type,
    });
  };

  // ── 재생 제어 ─────────────────────────────────────────────────
  T2VideoPlayer.prototype.play = function () {
    var self   = this;
    var result = this.video.play();
    if (result && typeof result.catch === 'function') {
      result.catch(function () {
        self.showToast('브라우저 정책 때문에 자동 재생이 차단되었습니다. 재생 버튼을 눌러 시작하세요.');
      });
    }
  };

  T2VideoPlayer.prototype.pause = function () { this.video.pause(); };

  T2VideoPlayer.prototype.togglePlay = function () {
    if (this.video.paused) this.play(); else this.pause();
  };

  T2VideoPlayer.prototype.seek = function (seconds) {
    if (!Number.isFinite(seconds)) return;
    this.video.currentTime = Number.isFinite(this.video.duration)
      ? Math.max(0, Math.min(seconds, this.video.duration))
      : Math.max(0, seconds);
  };

  T2VideoPlayer.prototype.seekBySlider = function () {
    var dur = this.video.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    this.seek(dur * (Number(this.ui.progress.value) / 1000));
  };

  T2VideoPlayer.prototype.toggleMute = function () {
    if (this.video.muted || this.video.volume === 0) {
      this.video.muted  = false;
      this.video.volume = this.lastVolume || 1;
    } else {
      this.lastVolume  = this.video.volume;
      this.video.muted = true;
    }
  };

  // ── UI 업데이트 ───────────────────────────────────────────────
  T2VideoPlayer.prototype.updateVolumeUI = function () {
    var vol = this.video.muted ? 0 : this.video.volume;
    if (this.ui.volume) {
      this.ui.volume.value = String(vol);
      this.ui.volume.style.setProperty('--vol', Math.round(vol * 100) + '%');
    }
    if (this.video.muted || this.video.volume === 0) {
      this.root.classList.add('is-muted');
    } else {
      this.root.classList.remove('is-muted');
    }
  };

  T2VideoPlayer.prototype.updateDuration = function () {
    this.ui.duration.textContent = formatTime(this.video.duration || this.data.duration || 0);
  };

  T2VideoPlayer.prototype.updateProgress = function () {
    var dur   = this.video.duration;
    var ratio = (Number.isFinite(dur) && dur > 0) ? this.video.currentTime / dur : 0;

    this.ui.currentTime.textContent   = formatTime(this.video.currentTime);
    this.ui.progress.value            = String(Math.round(ratio * 1000));
    this.ui.progressFill.style.width  = (ratio * 100).toFixed(3) + '%';
    if (this.ui.progressThumb) {
      this.ui.progressThumb.style.left = (ratio * 100).toFixed(3) + '%';
    }
  };

  T2VideoPlayer.prototype.updateBuffered = function () {
    var dur = this.video.duration;
    if (!Number.isFinite(dur) || dur <= 0 || this.video.buffered.length === 0) {
      this.ui.progressBuffer.style.width = '0%';
      return;
    }
    var end   = this.video.buffered.end(this.video.buffered.length - 1);
    var ratio = Math.max(0, Math.min(1, end / dur));
    this.ui.progressBuffer.style.width = (ratio * 100).toFixed(3) + '%';
  };

  // ── 화질 옵션 ─────────────────────────────────────────────────
  T2VideoPlayer.prototype.renderQualityOptions = function () {
    if (!this.ui.quality) return;
    var self = this;
    this.ui.quality.innerHTML = '';
    this.sources.forEach(function (src) {
      var opt = document.createElement('option');
      opt.value       = self.sourceKey(src);
      opt.textContent = src.label || src.quality || src.type || 'Auto';
      self.ui.quality.appendChild(opt);
    });
    if (this.sources.length <= 1) this.ui.quality.disabled = true;
  };

  T2VideoPlayer.prototype.syncQualitySelect = function () {
    if (!this.ui.quality || !this.activeSource) return;
    this.ui.quality.value = this.sourceKey(this.activeSource);
  };

  // ── 전체화면 / PIP ───────────────────────────────────────────
  T2VideoPlayer.prototype.toggleFullscreen = function () {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (this.root.requestFullscreen) {
      this.root.requestFullscreen();
    }
  };

  T2VideoPlayer.prototype.togglePictureInPicture = function () {
    var self = this;
    if (!document.pictureInPictureEnabled || this.video.disablePictureInPicture) {
      this.showToast('이 브라우저에서는 PIP 모드를 사용할 수 없습니다.');
      return;
    }
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture();
      return;
    }
    this.video.requestPictureInPicture().catch(function () {
      self.showToast('PIP 모드를 시작할 수 없습니다.');
    });
  };

  // ── 아이들 타이머 ─────────────────────────────────────────────
  T2VideoPlayer.prototype.resetIdleTimer = function () {
    var self = this;
    this.root.classList.remove('is-idle');
    window.clearTimeout(this.idleTimer);
    if (this.video.paused) return;
    this.idleTimer = window.setTimeout(function () {
      self.root.classList.add('is-idle');
    }, IDLE_DELAY_MS);
  };

  // ── 토스트 ────────────────────────────────────────────────────
  T2VideoPlayer.prototype.showToast = function (message) {
    var self = this;
    this.ui.toast.textContent = message;
    this.ui.toast.hidden      = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(function () {
      self.ui.toast.hidden = true;
    }, 5000);
  };

  // ── postMessage ───────────────────────────────────────────────
  T2VideoPlayer.prototype.postEvent = function (eventName, payload) {
    window.parent.postMessage({
      type: EVENT_TYPE, event: eventName, payload: payload || {}
    }, '*');
  };

  T2VideoPlayer.prototype.handleCommand = function (message) {
    if (!message || message.type !== COMMAND_TYPE) return;
    switch (message.command) {
      case 'play':      this.play(); break;
      case 'pause':     this.pause(); break;
      case 'seek':      this.seek(Number(message.value)); break;
      case 'mute':      this.video.muted = true; break;
      case 'unmute':    this.video.muted = false; break;
      case 'setVolume':
        this.video.volume = Math.max(0, Math.min(1, Number(message.value)));
        this.video.muted  = this.video.volume === 0;
        break;
      case 'setQuality':  this.setQuality(String(message.value)); break;
      case 'setPlaybackRate': {
        var rate = parseFloat(message.value);
        if (Number.isFinite(rate) && rate > 0) {
          this.setSpeed(rate);
        }
        break;
      }
      default: break;
    }
  };

  T2VideoPlayer.prototype.setQuality = function (quality) {
    var src = this.sources.find(function (s) {
      return String(s.quality) === quality || String(s.label) === quality;
    });
    if (src) this.loadSource(src, { preserveTime: true, autoplay: !this.video.paused });
  };

  // ── 도움말 모달 ────────────────────────────────────────────────
  T2VideoPlayer.prototype.toggleHelp = function (open) {
    var modal = this.ui.helpModal;
    if (!modal) return;
    modal.hidden = !open;
    if (open) {
      // 모달이 열리면 비디오를 일시정지하지 않고, 포커스만 이동
      var closeBtn = this.ui.helpClose;
      if (closeBtn) closeBtn.focus();
    } else {
      if (this.ui.helpBtn) this.ui.helpBtn.focus();
    }
  };

  // ── 초기화 ────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var root = document.querySelector('[data-t2-video-player]');
    if (root) window.t2VideoPlayer = new T2VideoPlayer(root);
  });
}());
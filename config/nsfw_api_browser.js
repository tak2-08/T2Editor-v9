/**
Path: T2Editor/config/nsfw_api_browser.js
 * T2Editor NSFW Browser API
 * - 기존 자체 UI 없음
 * - 기존 이미지 플러그인 UI에만 결과를 공급
 * - 엔진: nsfwjs + TensorFlow.js
 * - 기본 모델: MobileNetV2Mid (graph)
 * - 기본 런타임: 자체 호스팅 정적 자산
 * - 백엔드 우선순위: webgpu -> webgl -> wasm -> cpu
 */

const DEFAULTS = {
  model: 'MobileNetV2Mid',
  modelUrl: null,
  modelType: 'graph',
  topK: 5,
  backendPriority: ['webgpu', 'webgl', 'wasm', 'cpu'],
  useProdMode: true,
  wasmThreads: 0,
  assets: null,
  thresholds: {
    unsafeExplicit: 0.20,
    unsafeCombined: 0.70,
    suspectExplicit: 0.08,
    suspectCombined: 0.35,
    suspectSexy: 0.30
  }
};

const SCRIPT_CACHE = new Map();

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function getEditorBaseUrl() {
  // 1순위: 서버에서 명시적으로 주입한 전역 변수
  if (typeof window !== 'undefined' && window.T2EDITOR_URL) {
    return String(window.T2EDITOR_URL).replace(/\/+$/, '');
  }

  // 2순위: ES Module 환경 — import.meta.url로 자기 위치 기준 탐지
  // 이 파일 위치: T2Editor/config/nsfw_api_browser.js
  // 두 단계 상위(../..)가 T2Editor 루트
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return new URL('../..', import.meta.url).href.replace(/\/+$/, '');
    }
  } catch (_) { /* ignore */ }

  // 3순위: 비-모듈 스크립트 태그 환경 — document.currentScript.src 기준
  try {
    if (
      typeof document !== 'undefined' &&
      document.currentScript &&
      document.currentScript.src
    ) {
      return new URL('../..', document.currentScript.src).href.replace(/\/+$/, '');
    }
  } catch (_) { /* ignore */ }

  // 4순위: 최후 fallback — window.location 기준으로 상대 경로 유지
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    console.warn('[T2NSFW] T2EDITOR_URL이 설정되지 않았습니다. window.T2EDITOR_URL을 명시적으로 설정하세요.');
  }
  return '/t2editor';
}

function getDefaultAssets() {
  const base = `${getEditorBaseUrl()}/vendor`;
  return {
    tfjs: `${base}/tfjs/tf.min.js`,
    webgl: `${base}/tfjs-backend-webgl/tf-backend-webgl.min.js`,
    webgpu: `${base}/tfjs-backend-webgpu/tf-backend-webgpu.min.js`,
    wasm: `${base}/tfjs-backend-wasm/tf-backend-wasm.min.js`,
    wasmBase: `${base}/tfjs-backend-wasm/`,
    nsfwjs: `${base}/nsfwjs/nsfwjs.min.js`
  };
}

function resolveAssets(customAssets) {
  return {
    ...getDefaultAssets(),
    ...(customAssets || {})
  };
}

function isProbablyUrl(value) {
  return typeof value === 'string' && /(^https?:\/\/)|(^\/)|(^\.\/)|(^\.\.\/)|(^indexeddb:\/\/)/i.test(value);
}

function loadScriptOnce(src) {
  if (!src) {
    return Promise.reject(new Error('스크립트 경로가 비어 있습니다.'));
  }

  if (SCRIPT_CACHE.has(src)) {
    return SCRIPT_CACHE.get(src);
  }

  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-t2-nsfw-src="${src}"]`);
    if (existing && existing.dataset.loaded === 'true') {
      resolve();
      return;
    }

    const script = existing || document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.dataset.t2NsfwSrc = src;

    const cleanup = () => {
      script.onload = null;
      script.onerror = null;
    };

    script.onload = () => {
      script.dataset.loaded = 'true';
      cleanup();
      resolve();
    };

    script.onerror = () => {
      cleanup();
      reject(new Error(`스크립트 로드 실패: ${src}`));
    };

    if (!existing) {
      document.head.appendChild(script);
    }
  });

  SCRIPT_CACHE.set(src, promise);
  return promise;
}

function toPredictionMap(predictions) {
  const map = Object.create(null);
  for (const item of Array.isArray(predictions) ? predictions : []) {
    if (!item || typeof item.className !== 'string') continue;
    map[item.className.toLowerCase()] = clamp01(Number(item.probability || 0));
  }
  return map;
}

function buildAssessment(predictions, backend, options) {
  const sorted = [...(predictions || [])].sort((a, b) => (b?.probability || 0) - (a?.probability || 0));
  const topPrediction = sorted[0] || null;
  const scoreMap = toPredictionMap(sorted);

  const porn = scoreMap.porn || 0;
  const hentai = scoreMap.hentai || 0;
  const sexy = scoreMap.sexy || 0;
  const neutral = scoreMap.neutral || 0;
  const drawing = scoreMap.drawing || 0;

  const explicitScore = clamp01(porn + hentai);
  const nsfwScore = clamp01(explicitScore + sexy);
  const safeScore = clamp01(neutral + drawing);
  const thresholds = options.thresholds || DEFAULTS.thresholds;

  let label = 'safe';
  let prob = safeScore;

  if (explicitScore >= thresholds.unsafeExplicit || nsfwScore >= thresholds.unsafeCombined) {
    label = 'unsafe';
    prob = Math.max(explicitScore, nsfwScore, porn, hentai);
  } else if (
    explicitScore >= thresholds.suspectExplicit ||
    nsfwScore >= thresholds.suspectCombined ||
    sexy >= thresholds.suspectSexy
  ) {
    label = 'suspect';
    prob = Math.max(explicitScore, nsfwScore, sexy);
  }

  const topProb = clamp01(Number(topPrediction?.probability || 0));
  const confidence = topProb >= 0.85 ? 'high' : topProb >= 0.55 ? 'medium' : 'low';

  return {
    ok: true,
    label,
    prob,
    confidence,
    backend: backend || null,
    explicitScore,
    nsfwScore,
    sexyScore: sexy,
    safeScore,
    topPrediction,
    predictions: sorted,
    classes: {
      porn,
      hentai,
      sexy,
      neutral,
      drawing
    }
  };
}

class NSFWFilterAPI {
  constructor(options = {}) {
    this.options = {
      ...DEFAULTS,
      ...options,
      assets: resolveAssets(options.assets || (typeof window !== 'undefined' ? window.T2EDITOR_NSFW_RUNTIME_ASSETS : null)),
      thresholds: {
        ...DEFAULTS.thresholds,
        ...(options.thresholds || {})
      }
    };

    this._tf = null;
    this._nsfwjs = null;
    this._model = null;
    this._backend = null;
    this._loadPromise = null;
    this._onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  }

  _reportProgress(percent, message, stage) {
    if (typeof this._onProgress === 'function') {
      try {
        this._onProgress({ percent, message, stage });
      } catch (_) { /* ignore */ }
    }
  }

  async load() {
    if (this._model) return this;
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = (async () => {
      const assets = this.options.assets;

      this._reportProgress(5, 'TensorFlow.js 로딩 중', 'loading-tfjs');
      await loadScriptOnce(assets.tfjs);

      const tf = window.tf;
      if (!tf) {
        throw new Error('TensorFlow.js 전역 객체(tf)를 찾지 못했습니다.');
      }

      this._reportProgress(30, '추론 백엔드 설정 중', 'tfjs-loaded');

      if (this.options.useProdMode && typeof tf.enableProdMode === 'function') {
        try {
          tf.enableProdMode();
        } catch (error) {
          console.warn('[T2NSFW] tf.enableProdMode 실패:', error);
        }
      }

      await this._registerOptionalBackends(tf, assets);
      this._reportProgress(50, '백엔드 초기화 중', 'backends-registered');

      await tf.ready();
      this._reportProgress(60, 'NSFWJS 로딩 중', 'tf-ready');

      const selectedBackend = await this._selectBackend(tf);

      await loadScriptOnce(assets.nsfwjs);
      const nsfwjs = window.nsfwjs || window.NSFWJS;
      if (!nsfwjs || typeof nsfwjs.load !== 'function') {
        throw new Error('nsfwjs 전역 객체를 찾지 못했습니다.');
      }

      this._reportProgress(75, 'AI 모델 로딩 중', 'loading-model');

      const loadTarget = this.options.modelUrl || this.options.model || 'MobileNetV2Mid';
      const loadOptions = {};

      if (isProbablyUrl(loadTarget) && this.options.modelType) {
        loadOptions.type = this.options.modelType;
      }

      const model = await nsfwjs.load(loadTarget, loadOptions);

      this._reportProgress(100, '준비 완료', 'done');

      this._tf = tf;
      this._nsfwjs = nsfwjs;
      this._model = model;
      this._backend = selectedBackend || tf.getBackend();

      return this;
    })();

    return this._loadPromise;
  }

  async _registerOptionalBackends(tf, assets) {
    const priorities = Array.isArray(this.options.backendPriority) ? this.options.backendPriority : DEFAULTS.backendPriority;

    const requested = new Set(priorities);
    if (requested.has('webgl')) {
      try {
        await loadScriptOnce(assets.webgl);
      } catch (error) {
        console.warn('[T2NSFW] webgl backend 로드 실패:', error);
      }
    }

    if (requested.has('webgpu')) {
      const webgpuAvailable = typeof navigator !== 'undefined' && !!navigator.gpu;
      if (webgpuAvailable) {
        try {
          await loadScriptOnce(assets.webgpu);
        } catch (error) {
          console.warn('[T2NSFW] webgpu backend 로드 실패:', error);
        }
      } else {
        console.info('[T2NSFW] navigator.gpu 미지원으로 webgpu 백엔드를 건너뜁니다.');
      }
    }

    if (requested.has('wasm')) {
      try {
        await loadScriptOnce(assets.wasm);
        if (tf.wasm && typeof tf.wasm.setWasmPaths === 'function') {
          tf.wasm.setWasmPaths(assets.wasmBase);
        }
        if (this.options.wasmThreads > 0 && tf.wasm && typeof tf.wasm.setThreadsCount === 'function') {
          tf.wasm.setThreadsCount(this.options.wasmThreads);
        }
      } catch (error) {
        console.warn('[T2NSFW] wasm backend 로드 실패:', error);
      }
    }
  }

  async _selectBackend(tf) {
    const priorities = Array.isArray(this.options.backendPriority) ? this.options.backendPriority : DEFAULTS.backendPriority;

    for (const candidate of priorities) {
      if (candidate === 'webgpu' && (typeof navigator === 'undefined' || !navigator.gpu)) {
        continue;
      }

      try {
        const changed = await tf.setBackend(candidate);
        await tf.ready();
        if (changed || tf.getBackend() === candidate) {
          return tf.getBackend();
        }
      } catch (error) {
        console.warn(`[T2NSFW] backend 전환 실패: ${candidate}`, error);
      }
    }

    return tf.getBackend();
  }

  async classify(input, heatmap = false) {
    void heatmap;
    await this.load();

    const source = await this._normalizeInput(input);
    try {
      const predictions = await this._model.classify(source, this.options.topK);
      return buildAssessment(predictions, this._backend, this.options);
    } finally {
      this._cleanupSource(source, input);
    }
  }

  async classifyWithHeatmap(input) {
    return this.classify(input, true);
  }

  async _normalizeInput(input) {
    if (!input) {
      throw new Error('이미지 입력이 비어 있습니다.');
    }

    if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) {
      if (!input.complete) {
        await new Promise((resolve, reject) => {
          const onLoad = () => {
            input.removeEventListener('load', onLoad);
            input.removeEventListener('error', onError);
            resolve();
          };
          const onError = (event) => {
            input.removeEventListener('load', onLoad);
            input.removeEventListener('error', onError);
            reject(event);
          };
          input.addEventListener('load', onLoad, { once: true });
          input.addEventListener('error', onError, { once: true });
        });
      }
      return input;
    }

    if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) {
      return input;
    }

    if (typeof ImageBitmap !== 'undefined' && input instanceof ImageBitmap) {
      return input;
    }

    if (input instanceof Blob || input instanceof File) {
      return this._blobToImage(input);
    }

    if (typeof input === 'string') {
      return this._urlToImage(input);
    }

    throw new Error('지원하지 않는 이미지 입력 형식입니다.');
  }

  _cleanupSource(source, originalInput) {
    if (source && source !== originalInput && source.dataset && source.dataset.t2ObjectUrl) {
      URL.revokeObjectURL(source.dataset.t2ObjectUrl);
    }
  }

  _blobToImage(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);
      img.dataset.t2ObjectUrl = objectUrl;
      img.onload = () => resolve(img);
      img.onerror = (e) => {
        URL.revokeObjectURL(objectUrl);
        reject(e);
      };
      img.src = objectUrl;
    });
  }

  _urlToImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  getBackend() {
    return this._backend;
  }

  dispose() {
    try {
      if (this._model && typeof this._model.dispose === 'function') {
        this._model.dispose();
      }
    } catch (error) {
      console.warn('[T2NSFW] 모델 dispose 실패:', error);
    }
    this._model = null;
    this._loadPromise = null;
  }
}

export default NSFWFilterAPI;
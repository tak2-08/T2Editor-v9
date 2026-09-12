<?php
// Path: T2Editor/plugin/file/audio_player.php
//
// ── video_player.php 와 동일한 3단 보안 구조 ──────────────────────────────
// ① t2_config.php   : T2EDITOR_DATA_PATH, t2editor_is_allowed_url()
// ② upload_config.php: get_audio_extensions(), get_ext_mime_map()
// ③ 경로 탈출(path traversal) 검증 — realpath + expected_base 비교
// ─────────────────────────────────────────────────────────────────────────
require_once __DIR__ . '/../../config/t2_config.php';

$common_path = __DIR__ . '/../../../..';
if (is_file($common_path . '/common.php')) {
    include_once $common_path . '/common.php';
}

if (!function_exists('get_audio_extensions')) {
    require_once __DIR__ . '/../../config/upload_config.php';
}

// ── get_audio_extensions() 폴백 ──────────────────────────────────────────
// upload_config.php 에는 get_audio_extensions() 가 별도로 없다.
// get_js_config() 와 동일한 방식: 'other' 확장자 중 MIME 가 audio/* 인 것만 추출.
// upload_config.php 가 변경되어도 자동 반영된다.
if (!function_exists('get_audio_extensions')) {
    function get_audio_extensions(): array {
        if (!function_exists('get_ext_mime_map') || !function_exists('get_other_extensions')) {
            // 최후 하드코딩 폴백
            return ['mp3', 'm4a', 'wav', 'flac', 'aac', 'wma'];
        }
        $mime_map   = get_ext_mime_map();
        $other_exts = get_other_extensions();  // upload_config.php 의 'other' 카테고리
        $audio_exts = [];
        foreach ($other_exts as $ext) {
            foreach ($mime_map[$ext] ?? [] as $mime) {
                if (strncmp($mime, 'audio/', 6) === 0) {
                    $audio_exts[] = $ext;
                    break;
                }
            }
        }
        return $audio_exts ?: ['mp3', 'm4a', 'wav', 'flac', 'aac', 'wma'];
    }
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────
function t2ap_h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

function t2ap_error(string $message, int $status = 400): void
{
    http_response_code($status);
    echo '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
       . '<meta name="viewport" content="width=device-width,initial-scale=1">'
       . '<meta name="robots" content="noindex"><title>Audio player unavailable</title>'
       . '<style>*{margin:0;padding:0;box-sizing:border-box}'
       . 'body{background:#1c1c1f;display:flex;align-items:center;justify-content:center;'
       . 'min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui}'
       . 'p{color:rgba(255,255,255,.45);font-size:12px;padding:12px}</style>'
       . '</head><body><p>' . t2ap_h($message) . '</p></body></html>';
    exit;
}

// ── MIME 맵 구성 (오디오 전용) ────────────────────────────────────────────
function t2ap_mime_map(): array
{
    $_full = get_ext_mime_map();
    $_exts = get_audio_extensions(); // ['mp3','m4a','wav','flac','aac','wma', ...]
    $map   = [];
    foreach ($_exts as $_ext) {
        if (!empty($_full[$_ext])) {
            $map[$_ext] = $_full[$_ext][0];
        }
    }
    // 누락 폴백
    $fallbacks = ['mp3'=>'audio/mpeg','m4a'=>'audio/mp4','wav'=>'audio/wav',
                  'flac'=>'audio/flac','aac'=>'audio/aac','wma'=>'audio/x-ms-wma',
                  'ogg'=>'audio/ogg','opus'=>'audio/ogg'];
    foreach ($fallbacks as $ext => $mime) {
        if (!isset($map[$ext])) $map[$ext] = $mime;
    }
    return $map;
}

// ── 파라미터 수신 ─────────────────────────────────────────────────────────
$audio_path = isset($_GET['audio']) ? trim((string)$_GET['audio']) : '';
if ($audio_path === '') {
    t2ap_error('오디오 파일을 찾을 수 없습니다.', 400);
}

$file_name = isset($_GET['name']) ? trim((string)$_GET['name']) : '';
if ($file_name === '') {
    try {
        $file_name = rawurldecode(basename(parse_url($audio_path, PHP_URL_PATH) ?? ''));
    } catch (Throwable $e) {
        $file_name = 'audio';
    }
}
// 파일명 길이 제한
if (mb_strlen($file_name, 'UTF-8') > 200) {
    $file_name = mb_substr($file_name, 0, 200, 'UTF-8');
}

$mime_map    = t2ap_mime_map();
$allowed_ext = array_keys($mime_map);

$audio_url = '';
$mime_type = 'audio/mpeg';
$ext       = '';

// ── URL 유형 판별 (video_player.php 와 동일 패턴) ─────────────────────────
if (preg_match('#^(https?:)?//#i', $audio_path)) {

    // [SEC-SSRF] 허용 도메인 검증
    if (!t2editor_is_allowed_url($audio_path)) {
        t2ap_error('허용되지 않는 외부 URL입니다.', 403);
    }

    $url_path = parse_url($audio_path, PHP_URL_PATH) ?? '';
    $ext      = strtolower(pathinfo($url_path, PATHINFO_EXTENSION));

    if (!in_array($ext, $allowed_ext, true)) {
        t2ap_error('지원하지 않는 오디오 형식입니다.', 400);
    }

    $audio_url = $audio_path;
    $mime_type = $mime_map[$ext] ?? 'audio/mpeg';

} else {
    // [SEC-PATH-TRAVERSAL] realpath 검증
    $relative  = ltrim(str_replace('\\', '/', $audio_path), '/');
    $ext       = strtolower(pathinfo($relative, PATHINFO_EXTENSION));

    if (!in_array($ext, $allowed_ext, true)) {
        t2ap_error('지원하지 않는 오디오 형식입니다.', 400);
    }

    $expected_base  = rtrim(str_replace('\\', '/', realpath(T2EDITOR_DATA_PATH) ?: T2EDITOR_DATA_PATH), '/');
    $candidate      = T2EDITOR_DATA_PATH . '/' . $relative;
    $real_candidate = realpath($candidate);

    if ($real_candidate === false ||
        strpos(str_replace('\\', '/', $real_candidate), $expected_base . '/') !== 0) {
        t2ap_error('허용되지 않는 경로입니다.', 403);
    }

    $audio_url = T2EDITOR_DATA_URL . '/' . $relative;
    $mime_type = $mime_map[$ext] ?? 'audio/mpeg';
}

// ── payload JSON 구성 (video_player.php 동일 패턴) ────────────────────────
$payload = [
    'url'      => $audio_url,
    'mime'     => $mime_type,
    'ext'      => strtoupper($ext),
    'name'     => $file_name,
    'download' => $audio_url,
];

$payload_json = json_encode(
    $payload,
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES |
    JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
);
if ($payload_json === false) {
    t2ap_error('오디오 메타데이터를 생성할 수 없습니다.', 500);
}

$mtime   = @filemtime(__DIR__ . '/audio_player.js');
$asset_v = ($mtime !== false) ? (string)$mtime : '1';
?>
<!doctype html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex">
    <title><?php echo t2ap_h($file_name); ?></title>
    <style>
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

        html, body {
            width: 100%;
            /* 높이: JS가 카드 렌더 후 postMessage로 부모에 알린다. */
            background: transparent;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        }

        /* ── 카드 본체 ── */
        .t2ap-card {
            background: #1c1c1f;
            border-radius: 20px;
            border: 0.5px solid rgba(255,255,255,0.09);
            box-shadow: 0 8px 32px rgba(0,0,0,0.36), 0 1px 2px rgba(0,0,0,0.28);
            padding: 13px 15px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            user-select: none;
            -webkit-user-select: none;
        }

        /* ── 상단 행 ── */
        .t2ap-top {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
        }

        .t2ap-note {
            width: 14px;
            height: 14px;
            color: rgba(255,255,255,0.42);
            flex-shrink: 0;
            display: block;
        }

        .t2ap-name {
            flex: 1;
            min-width: 0;
            font-size: 13px;
            font-weight: 500;
            color: rgba(255,255,255,0.92);
            letter-spacing: -0.01em;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .t2ap-speed {
            flex-shrink: 0;
            background: rgba(255,255,255,0.11);
            color: rgba(255,255,255,0.72);
            border: 0.5px solid rgba(255,255,255,0.18);
            border-radius: 7px;
            padding: 3px 8px;
            font-size: 11px;
            font-weight: 600;
            line-height: 1;
            cursor: pointer;
            transition: background 0.15s, color 0.15s;
            font-family: inherit;
        }
        .t2ap-speed:hover {
            background: rgba(255,255,255,0.18);
            color: rgba(255,255,255,1);
        }

        .t2ap-dl {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            color: rgba(255,255,255,0.55);
            text-decoration: none;
            line-height: 1;
            transition: color 0.15s;
            border-radius: 4px;
        }
        .t2ap-dl svg { width: 17px; height: 17px; }
        .t2ap-dl:hover { color: rgba(255,255,255,0.92); }

        /* ── 하단 행 ── */
        .t2ap-bottom {
            display: flex;
            align-items: center;
            gap: 13px;
        }

        /* ── 재생 버튼 ── */
        .t2ap-play {
            flex-shrink: 0;
            width: 42px;
            height: 42px;
            border-radius: 50%;
            background: rgba(255,255,255,0.14);
            border: 0.5px solid rgba(255,255,255,0.22);
            color: rgba(255,255,255,1);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: background 0.15s, transform 0.1s;
            font-family: inherit;
            position: relative;
            overflow: hidden;
        }
        .t2ap-play .mi {
            font-size: 18px;
            line-height: 1;
            position: relative;
            z-index: 1;
        }
        .t2ap-play::after {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 50%;
            background: rgba(255,255,255,0);
            transition: background 0.15s;
        }
        .t2ap-play:hover::after { background: rgba(255,255,255,0.06); }
        .t2ap-play:hover { background: rgba(255,255,255,0.20); }

        /* ── 진행 영역 ── */
        .t2ap-progress-area {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 7px;
        }

        .t2ap-track-wrap {
            position: relative;
            padding: 6px 0;
            cursor: pointer;
        }

        .t2ap-track {
            height: 3px;
            background: rgba(255,255,255,0.13);
            border-radius: 99px;
            position: relative;
            overflow: visible;
        }

        .t2ap-fill {
            position: absolute;
            top: 0; left: 0;
            height: 100%;
            width: 0%;
            background: rgba(255,255,255,1);
            border-radius: 99px;
            transition: width 0.15s linear;
            pointer-events: none;
        }

        .t2ap-thumb {
            position: absolute;
            top: 50%; left: 0%;
            width: 11px; height: 11px;
            background: #ffffff;
            border-radius: 50%;
            transform: translate(-50%, -50%);
            box-shadow: 0 1px 4px rgba(0,0,0,0.5);
            opacity: 0;
            transition: opacity 0.15s;
            pointer-events: none;
        }
        .t2ap-track-wrap:hover .t2ap-thumb { opacity: 1; }

        .t2ap-time {
            display: flex;
            justify-content: space-between;
            font-size: 10.5px;
            font-weight: 500;
            letter-spacing: 0.01em;
            color: rgba(255,255,255,0.40);
            line-height: 1;
        }


    </style>
</head>
<body>
    <div class="t2ap-card" data-t2ap-player
         data-payload="<?php echo t2ap_h($payload_json); ?>">

        <!-- 상단 행 -->
        <div class="t2ap-top">
            <svg class="t2ap-note" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
            <span class="t2ap-name" data-name><?php echo t2ap_h($file_name); ?></span>
            <button class="t2ap-speed" type="button" data-speed aria-label="재생 속도">1×</button>
            <a class="t2ap-dl" href="<?php echo t2ap_h($audio_url); ?>"
               download="<?php echo t2ap_h($file_name); ?>"
               aria-label="다운로드">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 8h14v2H5v-2z"/>
                </svg>
            </a>
        </div>

        <!-- 하단 행 -->
        <div class="t2ap-bottom">
            <!-- 재생 버튼 -->
            <button class="t2ap-play" type="button" data-play aria-label="재생">
                <svg data-play-icon width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="margin-left:2px">
                    <path d="M8 5v14l11-7z"/>
                </svg>
            </button>

            <!-- 진행 영역 -->
            <div class="t2ap-progress-area">
                <div class="t2ap-track-wrap" data-track-wrap>
                    <div class="t2ap-track" data-track role="slider"
                         aria-label="재생 위치" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                        <div class="t2ap-fill" data-fill></div>
                        <div class="t2ap-thumb" data-thumb></div>
                    </div>
                </div>
                <div class="t2ap-time">
                    <span data-current>0:00</span>
                    <span data-total>0:00</span>
                </div>
            </div>
        </div>
    </div>

    <script src="<?php echo t2ap_h(T2EDITOR_URL . '/plugin/file/audio_player.js?v=' . $asset_v); ?>" defer></script>
</body>
</html>
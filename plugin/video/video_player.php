<?php
//Path: T2Editor/plugin/video/video_player.php

require_once __DIR__ . '/../../config/t2_config.php';

$common_path = __DIR__ . '/../../../..';
if (is_file($common_path . '/common.php')) {
    include_once $common_path . '/common.php';
}

if (!function_exists('get_video_extensions')) {
    require_once __DIR__ . '/../../config/upload_config.php';
}

function t2_video_player_h($value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

function t2_video_player_error(string $message, int $status = 400): void
{
    http_response_code($status);
    $safe_message = t2_video_player_h($message);
    echo '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Video player unavailable</title><link rel="stylesheet" href="' . t2_video_player_h(T2EDITOR_URL . '/plugin/video/video_player.css') . '"></head><body class="t2vp-embed-body"><main class="t2vp-error-frame" role="main"><div class="t2vp-error-card"><p class="t2vp-eyebrow">Player unavailable</p><h1>영상을 표시할 수 없습니다.</h1><p>' . $safe_message . '</p></div></main></body></html>';
    exit;
}

function t2_video_player_mime_map(): array
{
    $_full_mime_map = get_ext_mime_map();
    $_video_exts = get_video_extensions();
    $mime_types = [];

    foreach ($_video_exts as $_ext) {
        if (isset($_full_mime_map[$_ext]) && !empty($_full_mime_map[$_ext])) {
            $mime_types[$_ext] = $_full_mime_map[$_ext][0];
        }
    }

    $mime_types['m3u8'] = 'application/vnd.apple.mpegurl';
    return $mime_types;
}

function t2_video_player_source_type(string $ext): string
{
    if ($ext === 'm3u8') return 'hls';
    if ($ext === 'webm') return 'webm';
    if ($ext === 'ogg' || $ext === 'ogv') return 'ogg';
    return 'mp4';
}

function t2_video_player_quality_label(string $ext): string
{
    return $ext === 'm3u8' ? 'Auto HLS' : strtoupper($ext);
}

$video_path = isset($_GET['video']) ? trim((string)$_GET['video']) : '';
if ($video_path === '') {
    t2_video_player_error('비디오 파일을 찾을 수 없습니다.', 400);
}

$mime_types = t2_video_player_mime_map();
$allowed_exts = array_keys($mime_types);
$video_url = '';
$mime_type = 'video/mp4';
$ext = '';

if (preg_match('#^(https?:)?//#i', $video_path)) {
    if (!t2editor_is_allowed_url($video_path)) {
        t2_video_player_error('허용되지 않는 외부 URL입니다. 관리자에게 도메인 허용을 요청하세요.', 403);
    }
    $url_path = parse_url($video_path, PHP_URL_PATH) ?? '';
    $ext = strtolower(pathinfo($url_path, PATHINFO_EXTENSION));
    if (!in_array($ext, $allowed_exts, true)) {
        t2_video_player_error('지원하지 않는 비디오 형식입니다.', 400);
    }
    $video_url = $video_path;
    $mime_type = $mime_types[$ext] ?? 'video/mp4';
} else {
    $relative = ltrim(str_replace('\\', '/', $video_path), '/');
    $ext = strtolower(pathinfo($relative, PATHINFO_EXTENSION));
    if (!in_array($ext, $allowed_exts, true)) {
        t2_video_player_error('지원하지 않는 비디오 형식입니다.', 400);
    }
    $expected_base = rtrim(str_replace('\\', '/', realpath(T2EDITOR_DATA_PATH) ?: T2EDITOR_DATA_PATH), '/');
    $candidate = T2EDITOR_DATA_PATH . '/' . $relative;
    $real_candidate = realpath($candidate);
    if ($real_candidate === false || strpos(str_replace('\\', '/', $real_candidate), $expected_base . '/') !== 0) {
        t2_video_player_error('허용되지 않는 경로입니다.', 403);
    }
    $video_url = T2EDITOR_DATA_URL . '/' . $relative;
    $mime_type = $mime_types[$ext] ?? 'video/mp4';
}

$title = trim((string)($_GET['title'] ?? 'T2Editor video'));
if ($title === '') $title = 'T2Editor video';
if (mb_strlen($title, 'UTF-8') > 200) $title = mb_substr($title, 0, 200, 'UTF-8');

$poster = trim((string)($_GET['poster'] ?? ''));
if ($poster !== '' && !t2editor_is_allowed_url($poster)) $poster = '';

$source_type = t2_video_player_source_type($ext);
$payload = [
    'id'       => 't2-video-' . substr(hash('sha256', $video_url), 0, 16),
    'title'    => $title,
    'poster'   => $poster,
    'duration' => 0,
    'ext'      => strtoupper($ext),
    'sources'  => [[
        'label'   => t2_video_player_quality_label($ext),
        'quality' => $source_type === 'hls' ? 'auto' : strtoupper($ext),
        'url'     => $video_url,
        'type'    => $source_type,
        'mime'    => $mime_type,
        'default' => true,
    ]],
];

$payload_json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
if ($payload_json === false) {
    t2_video_player_error('비디오 메타데이터를 생성할 수 없습니다.', 500);
}

$asset_version = (string)@filemtime(__DIR__ . '/video_player.js');
if ($asset_version === '') $asset_version = '1';
?>
<!doctype html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex">
    <title><?php echo t2_video_player_h($title); ?></title>
    <link rel="stylesheet" href="<?php echo t2_video_player_h(T2EDITOR_URL . '/plugin/video/video_player.css?v=' . $asset_version); ?>">
</head>
<body class="t2vp-embed-body">
    <main class="t2vp-player" data-t2-video-player
          data-video="<?php echo t2_video_player_h($payload_json); ?>"
          aria-label="<?php echo t2_video_player_h($title); ?> 플레이어"
          tabindex="0">

        <video class="t2vp-video" data-video-el preload="metadata" playsinline
               poster="<?php echo t2_video_player_h($poster); ?>"></video>

        <!-- 큰 재생 버튼 (일시정지 상태) -->
        <button class="t2vp-big-play" type="button" data-big-play aria-label="재생">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7 4.5l13.5 7.5L7 19.5V4.5z" fill="currentColor"/>
            </svg>
        </button>

        <!-- 배속 뱃지 (long press 2× 활성 시) — glassmorphism -->
        <div class="t2vp-speed-badge" data-speed-badge hidden aria-hidden="true">2×</div>

        <!-- 더블탭 스킵 피드백 — 작은 뱃지 -->
        <div class="t2vp-skip-feedback t2vp-skip-left" data-skip-left hidden aria-hidden="true">
            <div class="t2vp-skip-ripple">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                    <path d="M13 4l-5 6 5 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M8 4l-5 6 5 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            <span class="t2vp-skip-seconds" data-skip-seconds>10초</span>
        </div>
        <div class="t2vp-skip-feedback t2vp-skip-right" data-skip-right hidden aria-hidden="true">
            <div class="t2vp-skip-ripple">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                    <path d="M7 4l5 6-5 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M12 4l5 6-5 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            <span class="t2vp-skip-seconds" data-skip-seconds>10초</span>
        </div>

        <!-- 토스트 -->
        <div class="t2vp-toast" data-toast hidden role="status" aria-live="polite"></div>

        <!-- 컨트롤 바 -->
        <section class="t2vp-chrome" data-chrome aria-label="재생 컨트롤">
            <!-- 프로그레스바 -->
            <div class="t2vp-progress" data-progress-wrap>
                <div class="t2vp-progress-track"></div>
                <div class="t2vp-progress-buffer" data-progress-buffer></div>
                <div class="t2vp-progress-fill" data-progress-fill></div>
                <div class="t2vp-progress-thumb" data-progress-thumb></div>
                <input class="t2vp-progress-input" data-progress
                       type="range" min="0" max="1000" value="0" step="1"
                       aria-label="재생 위치">
            </div>

            <!-- 버튼 열 -->
            <div class="t2vp-controls">

                <!-- 재생/일시정지 -->
                <button class="t2vp-control t2vp-control--play" type="button" data-play aria-label="재생 또는 일시정지">
                    <svg class="t2vp-icon-play" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <path d="M5 3.5L14.5 9 5 14.5V3.5z" fill="currentColor"/>
                    </svg>
                    <svg class="t2vp-icon-pause" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <rect x="3.5" y="2.5" width="3.5" height="13" rx="1.2" fill="currentColor"/>
                        <rect x="11" y="2.5" width="3.5" height="13" rx="1.2" fill="currentColor"/>
                    </svg>
                </button>

                <!-- 음소거 + 볼륨 패널 (래퍼) -->
                <div class="t2vp-volume-wrap" data-volume-wrap>
                    <button class="t2vp-control t2vp-control--mute" type="button" data-mute aria-label="음소거 토글">
                        <svg class="t2vp-icon-vol" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                            <path d="M2.5 6.5v5h3L9 14.5V3.5l-3.5 3h-3z" fill="currentColor"/>
                            <path d="M12 6.5a3.5 3.5 0 0 1 0 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>
                            <path d="M14 4.5a6 6 0 0 1 0 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>
                        </svg>
                        <svg class="t2vp-icon-mute" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                            <path d="M2.5 6.5v5h3L9 14.5V3.5l-3.5 3h-3z" fill="currentColor"/>
                            <path d="M12.5 7l3.5 4m0-4-3.5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                    </button>
                    <!-- 가로 볼륨 슬라이더 패널 -->
                    <div class="t2vp-volume-panel" data-volume-panel>
                        <input data-volume type="range" min="0" max="1" step="0.01" value="1" aria-label="볼륨">
                    </div>
                </div>

                <!-- 시간 표시 -->
                <div class="t2vp-time" aria-live="off">
                    <span data-current-time>0:00</span>
                    <span class="t2vp-time-divider">/</span>
                    <span data-duration>0:00</span>
                </div>

                <div class="t2vp-spacer"></div>

                <!-- PIP -->
                <button class="t2vp-control" type="button" data-pip aria-label="PIP 모드">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <rect x="1.5" y="3.5" width="15" height="11" rx="2" stroke="currentColor" stroke-width="1.4"/>
                        <rect x="8" y="8" width="7" height="4.5" rx="1.2" fill="currentColor"/>
                    </svg>
                </button>

                <!-- 확장자 레이블 (텍스트 전용, 인터랙션 없음) -->
                <span class="t2vp-ext-label" data-ext-label aria-hidden="true"></span>

                <!-- 배속 커스텀 드롭다운 -->
                <div class="t2vp-speed-wrap" data-speed-wrap>
                    <button class="t2vp-control t2vp-speed-btn" type="button"
                            data-speed-btn aria-label="재생 속도" aria-expanded="false"
                            aria-haspopup="listbox">1×</button>
                    <div class="t2vp-speed-menu" data-speed-menu hidden role="listbox" aria-label="재생 속도 선택">
                        <button class="t2vp-speed-option" type="button" role="option" data-speed-option="0.5">0.5×</button>
                        <button class="t2vp-speed-option" type="button" role="option" data-speed-option="0.75">0.75×</button>
                        <button class="t2vp-speed-option is-active" type="button" role="option" data-speed-option="1" aria-selected="true">1×</button>
                        <button class="t2vp-speed-option" type="button" role="option" data-speed-option="1.25">1.25×</button>
                        <button class="t2vp-speed-option" type="button" role="option" data-speed-option="1.5">1.5×</button>
                        <button class="t2vp-speed-option" type="button" role="option" data-speed-option="2">2×</button>
                    </div>
                </div>

                <!-- 도움말 -->
                <button class="t2vp-control t2vp-help-btn" type="button" data-help-btn aria-label="T2player 사용법">
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                        <circle cx="7.5" cy="7.5" r="6.25" stroke="currentColor" stroke-width="1.3"/>
                        <path d="M7.5 10.8v-.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                        <path d="M5.6 5.9a2 2 0 1 1 2.5 1.9c-.6.2-1 .75-1 1.35" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>

                <!-- 전체화면 -->
                <button class="t2vp-control t2vp-control--fs" type="button" data-fullscreen aria-label="전체 화면">
                    <svg class="t2vp-icon-fs-enter" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <path d="M2.5 6.5V2.5h4M11.5 2.5h4v4M15.5 11.5v4h-4M6.5 15.5h-4v-4" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <svg class="t2vp-icon-fs-exit" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <path d="M6.5 2.5v4h-4 M11.5 2.5v4h4 M11.5 15.5v-4h4 M6.5 15.5v-4h-4" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>

            </div><!-- /.t2vp-controls -->
        </section><!-- /.t2vp-chrome -->

        <!-- 도움말 모달 -->
        <div class="t2vp-help-overlay" data-help-modal hidden role="dialog" aria-modal="true" aria-label="T2player 사용법">
            <div class="t2vp-help-card" role="document">
                <div class="t2vp-help-header">
                    <span class="t2vp-help-logo">T2<em>player</em></span>
                    <button class="t2vp-help-close" type="button" data-help-close aria-label="닫기">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
                <div class="t2vp-help-body">
                    <section class="t2vp-help-section">
                        <h3 class="t2vp-help-sec-title">⌨ 키보드 단축키</h3>
                        <ul class="t2vp-help-list">
                            <li><kbd>Space</kbd> / <kbd>K</kbd><span>재생 / 일시정지</span></li>
                            <li><kbd>→</kbd><span>5초 앞으로</span></li>
                            <li><kbd>←</kbd><span>5초 뒤로</span></li>
                            <li><kbd>M</kbd><span>음소거 토글</span></li>
                            <li><kbd>F</kbd><span>전체화면 전환</span></li>
                            <li><kbd>&gt;</kbd><span>재생 속도 증가</span></li>
                            <li><kbd>&lt;</kbd><span>재생 속도 감소</span></li>
                        </ul>
                    </section>
                    <section class="t2vp-help-section">
                        <h3 class="t2vp-help-sec-title">👆 터치 제스처</h3>
                        <ul class="t2vp-help-list">
                            <li><span class="t2vp-help-key">화면 좌측 더블탭</span><span>10초 뒤로 이동</span></li>
                            <li><span class="t2vp-help-key">화면 우측 더블탭</span><span>10초 앞으로 이동</span></li>
                            <li><span class="t2vp-help-key">화면 꾹 누르기</span><span>2배속 재생</span></li>
                            <li><span class="t2vp-help-key">소리 아이콘 2초 누르기</span><span>볼륨 슬라이더 표시</span></li>
                            <li><span class="t2vp-help-key">슬라이더 노출 중 소리 탭</span><span>음소거 토글</span></li>
                        </ul>
                    </section>
                    <section class="t2vp-help-section">
                        <h3 class="t2vp-help-sec-title">🖱 마우스 조작</h3>
                        <ul class="t2vp-help-list">
                            <li><span class="t2vp-help-key">비디오 클릭</span><span>재생 / 일시정지</span></li>
                            <li><span class="t2vp-help-key">소리 아이콘 클릭</span><span>볼륨 슬라이더 표시</span></li>
                            <li><span class="t2vp-help-key">슬라이더 노출 중 소리 클릭</span><span>음소거 토글</span></li>
                            <li><span class="t2vp-help-key">프로그레스바 드래그</span><span>재생 위치 이동</span></li>
                        </ul>
                    </section>
                </div>
            </div>
        </div><!-- /.t2vp-help-overlay -->

    </main>

    <script src="<?php echo t2_video_player_h(T2EDITOR_URL . '/plugin/video/video_player.js?v=' . $asset_version); ?>" defer></script>
</body>
</html>
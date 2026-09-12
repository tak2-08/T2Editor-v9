<?php
//Path: T2Editor/editor.lib.php

include 'config/t2_config.php';

if (!defined('T2EDITOR_PATH')) define('T2EDITOR_PATH', __DIR__);
if (!defined('T2EDITOR_URL'))  define('T2EDITOR_URL', '/t2editor');

// ── [UPLOAD-CONFIG] 파일 스코프에서 로드 ─────────────────────────────────
// editor_html() 의 if ($js && $ver) 블록 안에서 로드하면
// $ver 미설정·$js=false 등의 조건으로 블록이 건너뛰어질 때
// get_video_extensions() 등 함수와 T2EDITOR_MAX_UPLOAD_SIZE 상수를
// JS 주입 시점에 사용할 수 없게 되는 문제가 발생한다.
// 파일 스코프에서 한 번만 로드해 항상 사용 가능하도록 보장한다.
if (!function_exists('get_video_extensions')) {
    $_t2_upload_cfg = T2EDITOR_PATH . '/config/upload_config.php';
    if (file_exists($_t2_upload_cfg)) {
        require_once $_t2_upload_cfg;
    }
    unset($_t2_upload_cfg);
}

// ======= 압축 설정 =======
if (!defined('T2_CSS_MIN')) define('T2_CSS_MIN', true); //true 권장
if (!defined('T2_JS_MIN'))  define('T2_JS_MIN', false); //사양이 낮은 서버의 경우 과부하가 올 수 있음

// ======= 마이그레이션 옵션 =======
// 'auto'   : 묻지 않고 즉시 T2Editor 형식으로 자동 변환
// 'prompt' : 타 에디터 콘텐츠 감지 시 변환 여부 팝업 표시
// false    : 감지/변환 비활성화 (기본값)
if (!defined('T2_MIGRATION_MODE')) define('T2_MIGRATION_MODE', false);

// ======= NSFW 필터 설정 =======
// == T2_NSFW_ENABLED: NSFW 필터 사용 여부 ==
// true: 사용
// false: 미사용 (기본값)
if (!defined('T2_NSFW_ENABLED')) define('T2_NSFW_ENABLED', false);

// == T2_NSFW_MODE: 필터 작동 방식 ==
// 'browser': 브라우저 추론
if (!defined('T2_NSFW_MODE')) define('T2_NSFW_MODE', 'browser');

// == T2_NSFW_ALLOW_SUSPICIOUS: 19금 의심 이미지 업로드 허용 여부 ==
// true  → 경고 팝업 표시 후 업로드 허용 (법적 책임 경고) (기본값)
// false → 해당 이미지 업로드 취소 처리
if (!defined('T2_NSFW_ALLOW_SUSPICIOUS')) define('T2_NSFW_ALLOW_SUSPICIOUS', true);

// == 브라우저 NSFW 런타임/모델 설정 ==
// 기본값은 자체 호스팅 경로를 사용합니다.
// vendor 폴더에 tfjs / backend / nsfwjs / model 파일을 배치하면 바로 동작합니다.
if (!defined('T2_NSFW_RUNTIME_ASSET_BASE')) define('T2_NSFW_RUNTIME_ASSET_BASE', T2EDITOR_URL . '/vendor');
if (!defined('T2_NSFW_BROWSER_MODEL')) define('T2_NSFW_BROWSER_MODEL', 'MobileNetV2Mid');
if (!defined('T2_NSFW_BROWSER_MODEL_TYPE')) define('T2_NSFW_BROWSER_MODEL_TYPE', 'graph');
if (!defined('T2_NSFW_BROWSER_MODEL_URL')) define('T2_NSFW_BROWSER_MODEL_URL', T2_NSFW_RUNTIME_ASSET_BASE . '/nsfwjs/models/mobilenet_v2_mid/model.json');
if (!defined('T2_NSFW_BROWSER_BACKEND_PRIORITY')) define('T2_NSFW_BROWSER_BACKEND_PRIORITY', 'webgpu,webgl,wasm,cpu');

// ======= 비디오 플레이어 설정 =======
// true  : 업로드/직접 링크 동영상을 T2Editor 전용 iframe 플레이어(video_player.php)로 표시
// false : 기존 native video 래퍼(video_view.php)로 표시
// YouTube 등 외부 임베드는 이 옵션과 무관하게 해당 서비스 iframe을 사용.
if (!defined('T2_VIDEO_PLAYER_ENABLED')) define('T2_VIDEO_PLAYER_ENABLED', true);

// ======= 플러그인 등록 =======
$T2EDITOR_PLUGINS = [
    'link',
    'image', 
    'video',
    'file',
    'table',
    'code',
    'export',
    'search',
    'draw',
    'collab',
    'ai',
    'ai_rearrange',
    'clipurl',
    'meme'
];

// ======= 플러그인 로딩 순서 설정 =======
$T2EDITOR_PLUGIN_PRIORITY = [
    'image' => 0,
    'video' => 1,
    'link' => 2,
    'ai' => 3,
    'file' => 4,
    'code' => 4,
    'search' => 4,
    'table' => 5,
    'draw' => 6,
    'collab' => 6,
    'ai_rearrange' => 7,
    'export' => 9,
    'clipurl' => 9
];

// === 라이센스 검증 함수 ===
function _t2e_hash($s) { return hash('sha256', $s); }
function _t2e_b64d($s) { return base64_decode($s); }
function _t2e_b64e($d) { return base64_encode($d); }

function _t2e_norm($s) {
    $s = preg_replace("/\r\n|\r|\n/", "\n", $s);
    $s = preg_replace("/[ \t]+/u", " ", $s);
    $s = preg_replace("/\n{2,}/u", "\n\n", $s);
    return trim($s);
}

function _t2e_extract_kor($content) {
    if (preg_match('/사용 권한:[\s\S]*?(?=제한사항:|배포 및 문의:|$)/u', $content, $m)) {
        return _t2e_norm($m[0]);
    }
    if (preg_match('/사용 권한:[\s\S]*?b\)[\s\S]*?(?=(\n){2}|배포:|Usage Rights:|$)/iu', $content, $m)) {
        return _t2e_norm($m[0]);
    }
    return '';
}

function _t2e_extract_eng($content) {
    if (preg_match('/Usage Rights:[\s\S]*?(?=Restrictions:|Distribution and Contact:|$)/u', $content, $m)) {
        return _t2e_norm($m[0]);
    }
    if (preg_match('/Usage Rights:[\s\S]*?b\)[\s\S]*?(?=(\n){2}|Distribution:|$)/u', $content, $m)) {
        return _t2e_norm($m[0]);
    }
    return '';
}

function _t2e_extract_fileline($content) {
    if (preg_match('/The_first\.license_License_ko\.txt\s*&\s*License_en\.txt/i', $content, $m)) {
        return trim($m[0]);
    }
    if (strpos($content, 'The_first.license_License_ko.txt') !== false) {
        return 'The_first.license_License_ko.txt & License_en.txt';
    }
    return '';
}

function _t2e_validate_readme($path) {
    if (!file_exists($path)) return array(false, '라이센스 파일이 존재하지 않습니다.');
    $content = file_get_contents($path);

    $kor_block = _t2e_extract_kor($content);
    $eng_block = _t2e_extract_eng($content);
    $file_line = _t2e_extract_fileline($content);

    if ($kor_block === '') return array(false, '라이센스 내용(KO) 없음');
    if ($eng_block === '') return array(false, '라이센스 내용(EN) 없음');
    if ($file_line === '') return array(false, '라이센스 참조파일 정보 없음');

    $kor_hash = hash('sha256', $kor_block);
    $eng_hash = hash('sha256', $eng_block);
    $file_hash = hash('sha256', $file_line);

    $KOR_PARTS = [
        'YWIxMjVmYmI=', 'ZTEzMDg5NGI=', 'ZGY4MWNlNWU=', 'NDA3ODRiYzc=',
        'M2IyZjI1ZDk=', 'MTYwMTBlYTY=', 'NjRjYTM4MWI=', 'MzZlNjNmZDc=',
    ];
    $ENG_PARTS = [
        'ZjQ3NTEwMTQ=', 'M2QyYjkxMmE=', 'NTc0YTA1NzQ=', 'Nzk0OGU4N2E=',
        'YmRlZDdhY2Y=', 'ODZhMzdlNmI=', 'NGQ0OTEzYzI=', 'MTNiODEwNjk=',
    ];
    $FILE_PARTS = [
        'Yzg0YmQxODA=', 'YmJmYTA4ZTc=', 'ZTUyYjIxNmE=', 'NGM3OTNhMmU=',
        'MDlkY2FiYTY=', 'MGU1NjAyZDU=', 'NzM4ZWZhNDc=', 'YWY1MTRiOTQ=',
    ];

    $rebuild = function($parts){
        $out = '';
        foreach($parts as $p){
            $d = base64_decode($p);
            $out .= strrev($d);
        }
        return $out;
    };

    $expected_kor = $rebuild($KOR_PARTS);
    $expected_eng = $rebuild($ENG_PARTS);
    $expected_file = $rebuild($FILE_PARTS);

    if (!hash_equals($expected_kor, $kor_hash)) return array(false, '라이센스 내용(KO) 불일치');
    if (!hash_equals($expected_eng, $eng_hash)) return array(false, '라이센스 내용(EN) 불일치');
    if (!hash_equals($expected_file, $file_hash)) return array(false, '라이센스 참조파일 정보 불일치');

    return array(true, '');
}

function _t2e_get_status() {
    $p = T2EDITOR_PATH . '/';
    $readme = $p . 'readme.txt';
    return _t2e_validate_readme($readme);
}

function get_readme_version() {
    $readme_path = T2EDITOR_PATH . '/readme.txt';
    if (file_exists($readme_path)) {
        $content = file_get_contents($readme_path);
        if (preg_match('/ver_([0-9.]+)/', $content, $matches)) {
            return $matches[1];
        }
    }
    return '';
}

// CSS url("...") 컨텍스트용 이스케이프 헬퍼
// [SEC-CSS-INJECTION] CSS url("...") 안에서 구조를 파괴할 수 있는 문자만 최소한으로 처리.
//
// ❌ 이전 방식 rawurlencode():
//    T2EDITOR_URL 이 https://cdn.example.com 처럼 full URL 이면
//    ':' → '%3A' 로 인코딩되어 URL 자체가 깨짐 (아이콘 폰트 미적용 원인)
//
// ✅ 변경: CSS double-quoted string 컨텍스트에서 실제로 위험한 문자만 이스케이프.
//    · "  → \"  (닫는 따옴표 → CSS 이스케이프 시퀀스)
//    · \  → \\ (CSS 이스케이프 시작 문자)
//    · \n, \r → 제거 (CSS string 안에서 개행은 파싱 오류)
//    경로 구분자, 콜론, 쿼리스트링 등 URL 구조 문자는 건드리지 않음.
function _t2e_css_url($url) {
    $url = str_replace('\\', '\\\\', $url);       // \ → \\ (반드시 먼저)
    $url = str_replace('"',  '\\"',  $url);        // " → \"
    $url = str_replace(["\n", "\r"], '', $url);    // 개행 제거
    return $url;
}

// CSS 로드 헬퍼
function _t2e_css_link($editor_url, $path, $ver) {
    // [SEC-XSS] URL 구성 요소를 HTML 속성 컨텍스트에 맞게 이스케이프
    $e_url  = htmlspecialchars($editor_url, ENT_QUOTES, 'UTF-8');
    $e_path = htmlspecialchars($path,       ENT_QUOTES, 'UTF-8');
    $e_ver  = htmlspecialchars($ver,        ENT_QUOTES, 'UTF-8');
    if (T2_CSS_MIN) {
        return '<link rel="stylesheet" href="' . $e_url . '/t2_css_min.php?f=' . $e_path . '&amp;v=' . $e_ver . '">';
    } else {
        return '<link rel="stylesheet" href="' . $e_url . '/' . $e_path . '?v=' . $e_ver . '">';
    }
}

// JS 로드 헬퍼
function _t2e_js_script($editor_url, $path, $ver) {
    // [SEC-XSS] URL 구성 요소를 HTML 속성 컨텍스트에 맞게 이스케이프
    $e_url  = htmlspecialchars($editor_url, ENT_QUOTES, 'UTF-8');
    $e_path = htmlspecialchars($path,       ENT_QUOTES, 'UTF-8');
    $e_ver  = htmlspecialchars($ver,        ENT_QUOTES, 'UTF-8');
    if (T2_JS_MIN) {
        return '<script src="' . $e_url . '/t2_js_min.php?f=' . $e_path . '&amp;v=' . $e_ver . '"></script>';
    } else {
        return '<script src="' . $e_url . '/' . $e_path . '?v=' . $e_ver . '"></script>';
    }
}

function editor_html($id, $content, $is_dhtml_editor=true) {
    global $g5, $config, $T2EDITOR_PLUGINS, $T2EDITOR_PLUGIN_PRIORITY;

    static $js = true;

    list($valid, $msg) = _t2e_get_status();
    if (!$valid) {
        return '<div class="alert alert-danger"><strong>Error:</strong> '.$msg.'</div>';
    }

    $editor_url = T2EDITOR_URL;
    $ver = get_readme_version();

    $html = "<span class=\"sound_only\" style=\"display:none\">웹에디터 시작</span>";

    if ($js && $ver) {
        // === Core CSS ===
        $html .= "\n" . _t2e_css_link($editor_url, 'css/core.css', $ver);
        $html .= "\n" . _t2e_css_link($editor_url, 'css/dark.css', $ver);

        $sorted_plugins = [];
        foreach ($T2EDITOR_PLUGINS as $plugin) {
            $priority = isset($T2EDITOR_PLUGIN_PRIORITY[$plugin]) ? $T2EDITOR_PLUGIN_PRIORITY[$plugin] : 999;
            if (!isset($sorted_plugins[$priority])) $sorted_plugins[$priority] = [];
            $sorted_plugins[$priority][] = $plugin;
        }
        ksort($sorted_plugins);

        $plugin_scripts = "";
        foreach ($sorted_plugins as $priority => $plugins) {
            foreach ($plugins as $plugin) {
                // Plugin CSS
                if (file_exists(T2EDITOR_PATH . "/plugin/{$plugin}/{$plugin}.css")) {
                    $html .= "\n" . _t2e_css_link($editor_url, 'plugin/' . $plugin . '/' . $plugin . '.css', $ver);
                }
                if (file_exists(T2EDITOR_PATH . "/plugin/{$plugin}/{$plugin}.js")) {
                    $plugin_scripts .= "\n" . _t2e_js_script($editor_url, 'plugin/' . $plugin . '/' . $plugin . '.js', $ver);
                }
            }
        }

        $html .= "\n" . _t2e_js_script($editor_url, 'js/utils.js', $ver);
        $html .= "\n" . _t2e_js_script($editor_url, 'js/core.js', $ver);
        $html .= $plugin_scripts; // 플러그인 JS 추가

        $readme_path = T2EDITOR_PATH . '/readme.txt';
        $readme_contents = file_exists($readme_path) ? file_get_contents($readme_path) : '';
        $license_token = _t2e_hash($readme_contents . $editor_url);

        // T2_MIGRATION_MODE PHP 상수 → JS 변수 변환
        // false는 JSON false, 문자열은 JSON 문자열로 직렬화
        // [SEC-XSS] JSON_HEX_TAG: </script> 탈출 방지
        $migration_mode_js = (T2_MIGRATION_MODE === false) ? 'false' : json_encode(T2_MIGRATION_MODE, JSON_HEX_TAG | JSON_HEX_AMP);

        $html .= "\n<script>";
        // [SEC-XSS] 아래 모든 json_encode에 JSON_HEX_TAG | JSON_HEX_AMP 플래그 적용.
        // T2EDITOR_URL 등 URL 상수는 관리자 설정에 따라 변경될 수 있으므로
        // </script> 삽입으로 인한 스크립트 탈출을 방지함.
        $html .= "window.T2EDITOR_LICENSE_TOKEN = " . json_encode($license_token, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_PLUGINS = " . json_encode($T2EDITOR_PLUGINS, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_PLUGIN_PRIORITY = " . json_encode($T2EDITOR_PLUGIN_PRIORITY, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_URL = " . json_encode($editor_url, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_MIGRATION_MODE = " . $migration_mode_js . ";";
        $html .= "window.T2EDITOR_VIDEO_PLAYER_ENABLED = " . (T2_VIDEO_PLAYER_ENABLED ? 'true' : 'false') . ";";
        // NSFW 필터 설정 — image.js 에서 참조
        $html .= "window.T2EDITOR_NSFW_ENABLED = " . (T2_NSFW_ENABLED ? 'true' : 'false') . ";";
        $html .= "window.T2EDITOR_NSFW_MODE = " . json_encode(T2_NSFW_MODE, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_ALLOW_SUSPICIOUS = " . (T2_NSFW_ALLOW_SUSPICIOUS ? 'true' : 'false') . ";";
        $nsfwAssetBase = T2_NSFW_RUNTIME_ASSET_BASE;
        $nsfwBackendPriority = array_values(array_filter(array_map('trim', explode(',', T2_NSFW_BROWSER_BACKEND_PRIORITY))));
        $nsfwRuntimeAssets = [
            'tfjs' => $nsfwAssetBase . '/tfjs/tf.min.js',
            'webgl' => $nsfwAssetBase . '/tfjs-backend-webgl/tf-backend-webgl.min.js',
            'webgpu' => $nsfwAssetBase . '/tfjs-backend-webgpu/tf-backend-webgpu.min.js',
            'wasm' => $nsfwAssetBase . '/tfjs-backend-wasm/tf-backend-wasm.min.js',
            'wasmBase' => $nsfwAssetBase . '/tfjs-backend-wasm/',
            'nsfwjs' => $nsfwAssetBase . '/nsfwjs/nsfwjs.min.js',
        ];

        $html .= "window.T2EDITOR_NSFW_SERVER_URL = " . json_encode($editor_url . '/config/nsfw_api_server.php', JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_URL = " . json_encode($editor_url . '/config/nsfw_api_browser.js', JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_MODEL = " . json_encode(T2_NSFW_BROWSER_MODEL, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_MODEL_TYPE = " . json_encode(T2_NSFW_BROWSER_MODEL_TYPE, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_MODEL_URL = " . json_encode(T2_NSFW_BROWSER_MODEL_URL, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_BACKEND_PRIORITY = " . json_encode($nsfwBackendPriority, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_RUNTIME_ASSETS = " . json_encode($nsfwRuntimeAssets, JSON_HEX_TAG | JSON_HEX_AMP) . ";";

        // ── [UPLOAD-CONFIG] 통합 업로드 설정 JS 주입 ────────────────────────
        // video.js · file.js 등 모든 플러그인이 window.T2EDITOR_UPLOAD_CONFIG
        // 하나만 참조하도록 통합한다.
        //
        // get_js_config() 는 upload_config.php 에 정의된 단일 소스이며,
        // get_upload_config.php fallback 엔드포인트도 같은 함수를 사용한다.
        // 따라서 window 주입 값과 fallback 응답이 항상 동일한 구조를 보장한다.
        //
        // 반환 구조 → JS 참조 키:
        //   maxSizeMB              — 최대 업로드 크기 (MB 정수)
        //   extensions.image/video/document/audio/other — 카테고리별 확장자 배열
        //   accept.image/video/file — <input accept> 속성값
        //   mimeMap                — 비디오 확장자 → 대표 MIME (video.js 전용)
        // ─────────────────────────────────────────────────────────────────────
        if (function_exists('get_js_config')) {
            $html .= "window.T2EDITOR_UPLOAD_CONFIG = "
                   . json_encode(get_js_config(), JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) . ";";
        }

        // ── [SEC-IFRAME-ALLOWLIST] ────────────────────────────────────────────
        // iframe 허용 도메인 목록을 t2_config.php 에서 통합 관리한다.
        // t2editor_get_allowed_iframe_domains() 가 built-in 스트리밍 도메인 +
        // T2EDITOR_ALLOWED_URL_DOMAINS 사용자 설정을 모두 포함한다.
        //
        // 현재 서버 도메인은 클라이언트에서 location.hostname 으로 자동 추가됨.
        //
        // ★ t2_config.php 에 아래 함수를 추가하면 이 파일에서 하드코딩 제거 완료:
        //
        //   function t2editor_get_allowed_iframe_domains() {
        //       $builtin = [
        //           'youtube.com','www.youtube.com','m.youtube.com','youtu.be',
        //           'youtube-nocookie.com','www.youtube-nocookie.com',
        //           'vimeo.com','www.vimeo.com','player.vimeo.com',
        //           'dailymotion.com','www.dailymotion.com','geo.dailymotion.com',
        //           'twitch.tv','www.twitch.tv','player.twitch.tv','clips.twitch.tv',
        //           'tiktok.com','www.tiktok.com',
        //           'tv.kakao.com','play.kakao.com','tv.naver.com',
        //           'streamable.com','embed.streamable.com',
        //           'wistia.com','fast.wistia.com','wistia.net','fast.wistia.net',
        //           'w.soundcloud.com','open.spotify.com',
        //           'player.bilibili.com',
        //           'rumble.com','www.rumble.com','www.loom.com',
        //           'embed.vidyard.com','play.vidyard.com',
        //           'gfycat.com','www.gfycat.com','coub.com','www.coub.com',
        //       ];
        //       $user = is_array(T2EDITOR_ALLOWED_URL_DOMAINS)
        //           ? array_values(array_filter(T2EDITOR_ALLOWED_URL_DOMAINS, 'is_string'))
        //           : [];
        //       return array_values(array_unique(array_merge($builtin, $user)));
        //   }
        //
        // ─────────────────────────────────────────────────────────────────────
        if (function_exists('t2editor_get_allowed_iframe_domains')) {
            // t2_config.php 에 함수가 정의된 경우 (권장 경로)
            $t2_allowed_iframe_domains = t2editor_get_allowed_iframe_domains();
        } else {
            // fallback: t2_config.php 가 아직 함수를 정의하지 않은 구버전 호환
            $t2_builtin_iframe_domains = [
                'youtube.com', 'www.youtube.com', 'm.youtube.com',
                'youtu.be',
                'youtube-nocookie.com', 'www.youtube-nocookie.com',
                'vimeo.com', 'www.vimeo.com', 'player.vimeo.com',
                'dailymotion.com', 'www.dailymotion.com', 'geo.dailymotion.com',
                'twitch.tv', 'www.twitch.tv', 'player.twitch.tv', 'clips.twitch.tv',
                'tiktok.com', 'www.tiktok.com',
                'tv.kakao.com', 'play.kakao.com',
                'tv.naver.com',
                'streamable.com', 'embed.streamable.com',
                'wistia.com', 'fast.wistia.com', 'wistia.net', 'fast.wistia.net',
                'w.soundcloud.com',
                'open.spotify.com',
                'player.bilibili.com',
                'rumble.com', 'www.rumble.com',
                'www.loom.com',
                'embed.vidyard.com', 'play.vidyard.com',
                'gfycat.com', 'www.gfycat.com',
                'coub.com', 'www.coub.com',
            ];
            $t2_user_extra_domains = is_array(T2EDITOR_ALLOWED_URL_DOMAINS)
                ? array_values(array_filter(T2EDITOR_ALLOWED_URL_DOMAINS, 'is_string'))
                : [];
            $t2_allowed_iframe_domains = array_values(array_unique(
                array_merge($t2_builtin_iframe_domains, $t2_user_extra_domains)
            ));
        }

        // 현재 서버 도메인은 클라이언트(location.hostname)가 자동 추가하므로
        // 여기서는 명시적으로 넣지 않아도 됨.
        $html .= "window.T2EDITOR_ALLOWED_IFRAME_DOMAINS = "
               . json_encode($t2_allowed_iframe_domains, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) . ";";

        $html .= "</script>";

        $js = false;
    }

    if ($is_dhtml_editor) {
        // ── [FIX-XSS/구조파괴] html_entity_decode 전에 <code> 내용 보호 ────────────
        // html_entity_decode()는 &lt; → < 등 전체 콘텐츠의 HTML 엔티티를 복원한다.
        // <code> 안에 &lt;/code&gt; 같은 엔티티가 있으면 복원 후 실제 HTML 태그가 되어
        // JS에서 tempDiv.innerHTML = contentToLoad 실행 시 HTML 파서가 이를 닫는 태그로
        // 해석 → <pre><code> 구조 파괴 + XSS 취약 + textarea 강제 확장 발생.
        //
        // 대책: decode 전에 <code> 내부의 & 를 &amp; 로 이중 인코딩.
        //   → html_entity_decode 후에도 엔티티 이스케이프가 유지됨.
        //
        // [^<]* 를 쓰는 이유: decode 전 상태에서 <code> 내부에는 &lt; 등 엔티티만
        //   있고 실제 < 문자는 존재하지 않으므로 [^<]* 로 안전하게 매칭 가능.
        if (strpos($content, '<code') !== false) {
            $content = preg_replace_callback(
                '/<code([^>]*)>([^<]*)<\/code>/si',
                function ($m) {
                    // & → &amp; : decode 후에도 엔티티 이스케이프 유지 (이중 인코딩)
                    return '<code' . $m[1] . '>' . str_replace('&', '&amp;', $m[2]) . '</code>';
                },
                $content
            );
        }
        $content = html_entity_decode($content, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        // [SEC-XSS] str_replace 기반 수동 이스케이프 제거 →
        // json_encode(JSON_HEX_TAG|JSON_HEX_AMP)로 교체.
        // 기존 방식은 \u2028/\u2029(JS 줄바꿈), 멀티바이트 경계,
        // </script> 대소문자 변형 등을 처리하지 못해 XSS 가능했음.
        // JSON_HEX_TAG : <, > → \u003C, \u003E (스크립트 태그 탈출 방지)
        // JSON_HEX_AMP : &  → \u0026             (HTML 엔티티 충돌 방지)
        $json_content = json_encode($content, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE);

        // [SEC-XSS] $id를 HTML 속성에 삽입 전 이스케이프
        $safe_id = htmlspecialchars($id, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        // ======= 그누보드5 환경 및 관리자 페이지 감지 =======
        // _GNUBOARD_ 상수: 그누보드5가 로드될 때 반드시 정의되는 식별 상수
        $is_gnuboard5 = defined('_GNUBOARD_');

        $is_gnuboard5_admin = false;
        if ($is_gnuboard5) {
            global $is_admin;

            // 그누보드5 관리자 경로: $g5['admin_url'] 기준, 없으면 기본값 /adm
            $admin_path = '/adm';
            if (!empty($g5['admin_url'])) {
                $parsed = parse_url($g5['admin_url'], PHP_URL_PATH);
                if ($parsed) $admin_path = rtrim($parsed, '/');
            }

            $request_uri = $_SERVER['REQUEST_URI'] ?? '';

            // is_admin 변수가 비어 있지 않고, 현재 URL이 관리자 경로 하위인 경우
            $is_gnuboard5_admin = !empty($is_admin)
                && (
                    strpos($request_uri, $admin_path . '/') === 0
                    || strpos($request_uri, $admin_path . '?') === 0
                    || $request_uri === $admin_path
                    || strpos($request_uri, '/adm/') !== false
                );
        }

        ob_start(); ?>
<script>
// [SEC-XSS] JSON_HEX_TAG: T2EDITOR_URL 의 <\/script> 조기 종료 차단
const t2editor_url = <?php echo json_encode(T2EDITOR_URL ?? "", JSON_HEX_TAG | JSON_HEX_AMP); ?>;
</script>
<?php
if (isset($_SERVER['HTTP_USER_AGENT']) && stripos($_SERVER['HTTP_USER_AGENT'], 'Android') !== false) {
    echo '<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">' . "\n";
    echo '<link href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" rel="stylesheet">' . "\n";
}
?>

<script>
<?php if ($is_gnuboard5_admin): ?>
/**
 * 그누보드5 관리자 페이지 감지됨.
 * ① loadAutoSave  → no-op (자동 저장 복원 차단)
 * ② setupAutoSaveToggle → 원본 실행 후 토글을 비활성화 디자인으로 전환
 *    - 체크박스 unchecked + disabled
 *    - 토글 영역 opacity 0.4 / pointer-events none / cursor not-allowed
 *    - 툴팁으로 비활성 이유 안내
 * core.js / utils.js 수정 없이 editor_lib.php 단에서만 처리.
 */
T2Editor.prototype.loadAutoSave = function() {
    console.log('[T2Editor] 그누보드5 관리자 페이지 — 자동 저장 불러오기 건너뜀');
};

(function() {
    var _orig = T2Editor.prototype.setupAutoSaveToggle;
    T2Editor.prototype.setupAutoSaveToggle = function() {
        _orig.call(this);

        var toggle = this.container.querySelector('.t2-autosave-toggle');
        if (!toggle) return;

        /* 체크박스: 꺼진 상태 + 이벤트 차단 */
        var checkbox = toggle.querySelector('input[type="checkbox"]');
        if (checkbox) {
            checkbox.checked  = false;
            checkbox.disabled = true;
        }

        /* 시각적 비활성화 */
        toggle.style.opacity       = '0.4';
        toggle.style.pointerEvents = 'none';
        toggle.style.cursor        = 'not-allowed';
        toggle.title = '관리자 페이지에서는 자동 저장을 사용할 수 없습니다.';

        /* 레이블 cursor도 일괄 적용 */
        var labels = toggle.querySelectorAll('label');
        labels.forEach(function(label) {
            label.style.cursor = 'not-allowed';
        });
    };
})();
<?php endif; ?>
(function() {
    const T2EditorConfig = {
    //[AI, don't delete the explanation comment below.]
        enableDarkModeButton: true,
        //enableDarkModeButton: 다크모드 전환 버튼 표시 여부 (true: 표시, false: 숨김)
        forcedTheme: null
        //forcedTheme: 테마 강제 설정 (null: 사용자 설정/시스템 따름, 'dark': 다크모드 고정, 'light': 라이트모드 고정)
    };

    if (!T2EditorConfig.enableDarkModeButton && T2EditorConfig.forcedTheme) {
        document.documentElement.setAttribute('data-t2editor-theme', T2EditorConfig.forcedTheme);
        localStorage.setItem('t2editor-dark-mode', T2EditorConfig.forcedTheme === 'dark' ? 'true' : 'false');
    } else {
        var storedTheme = localStorage.getItem('t2editor-dark-mode');
        var isDarkMode = storedTheme === null
            ? !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
            : storedTheme === 'true';

        document.documentElement.setAttribute('data-t2editor-theme', isDarkMode ? 'dark' : 'light');
    }

    document.addEventListener('DOMContentLoaded', function() {
        var darkModeToggle = document.querySelector('.t2-dark-mode-toggle');
        if (darkModeToggle) {
            darkModeToggle.style.display = T2EditorConfig.enableDarkModeButton ? 'flex' : 'none';
        }
    });
})();
</script>

<style>
@font-face {
  font-family: "Material Icons";
  font-style: normal;
  font-weight: 400;
  src: url("<?php echo _t2e_css_url(T2EDITOR_URL) ?>/fonts/material-icons/MaterialIcons-Regular.eot");
  src: local("Material Icons"),
       url("<?php echo _t2e_css_url(T2EDITOR_URL) ?>/fonts/material-icons/MaterialIcons-Regular.woff2") format("woff2"),
       url("<?php echo _t2e_css_url(T2EDITOR_URL) ?>/fonts/material-icons/MaterialIcons-Regular.woff") format("woff"),
       url("<?php echo _t2e_css_url(T2EDITOR_URL) ?>/fonts/material-icons/MaterialIcons-Regular.ttf") format("truetype");
  font-display: swap;
}
.material-icons {
  font-family: "Material Icons";
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  display: inline-block;
  line-height: 1;
  text-transform: none;
  letter-spacing: normal;
  word-wrap: normal;
  white-space: nowrap;
  direction: ltr;
  -webkit-font-feature-settings: "liga";
  font-feature-settings: "liga";
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  -moz-osx-font-smoothing: grayscale;
}

@font-face {
  font-family: "Material Icons Outlined";
  font-style: normal;
  font-weight: 400;
  src: url("<?php echo _t2e_css_url(T2EDITOR_URL) ?>/fonts/material-icons/MaterialIconsOutlined-Regular.woff2") format("woff2"),
       url("<?php echo _t2e_css_url(T2EDITOR_URL) ?>/fonts/material-icons/MaterialIconsOutlined-Regular.ttf") format("truetype");
  font-display: swap;
}

.material-icons-outlined {
  font-family: "Material Icons Outlined";
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-feature-settings: "liga";
  font-feature-settings: "liga";
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
</style>

<div class="t2-editor-container" id="<?php echo $safe_id ?>_container">
    <div class="t2-toolbar">
        <button class="t2-btn" data-command="undo" disabled aria-label="undo"><span class="material-icons">undo</span></button>
        <button class="t2-btn" data-command="redo" disabled aria-label="redo"><span class="material-icons">redo</span></button>
        <button class="t2-btn" data-command="bold" aria-label="format bold"><span class="material-icons">format_bold</span></button>
        <button class="t2-btn" data-command="italic" aria-label="format italic"><span class="material-icons">format_italic</span></button>
        <button class="t2-btn" data-command="underline" aria-label="format underline"><span class="material-icons">format_underlined</span></button>
        <button class="t2-btn" data-command="strikeThrough" aria-label="format strikethrough"><span class="material-icons">format_strikethrough</span></button>
        <button class="t2-btn" data-command="justifyContent" aria-label="format align left"><span class="material-icons">format_align_left</span></button>
        <button class="t2-btn" data-command="fontSize" aria-label="format font size"><span class="material-icons">format_size</span></button>
        <button class="t2-btn" data-command="foreColor" aria-label="format text color"><span class="material-icons">format_color_text</span></button>
        <button class="t2-btn" data-command="backColor" aria-label="format text background color"><span class="material-icons">format_color_fill</span></button>
        <button class="t2-btn" data-command="createLink" data-plugin="link" aria-label="create link"><span class="material-icons">link</span></button>
        <button class="t2-btn" data-command="insertImage" data-plugin="image" aria-label="insert image"><span class="material-icons">image</span></button>
        <button class="t2-btn" data-command="insertYouTube" data-plugin="video" style="color:#f04f48" aria-label="insert video block"><span class="material-icons">smart_display</span></button>
        <button class="t2-btn" data-command="insertTable" data-plugin="table" aria-label="insert table block"><span class="material-icons-outlined">table_chart</span></button>
        <button class="t2-btn" data-command="attachFile" data-plugin="file" aria-label="insert file block"><span class="material-icons">attach_file</span></button>
        <button class="t2-btn" data-command="insertCodeBlock" data-plugin="code" aria-label="insert code block"><span class="material-icons">code</span></button>
        <button class="t2-btn" data-command="search" data-plugin="search" aria-label="web&content search"><span class="material-icons">manage_search</span></button>
        <button class="t2-btn" data-command="insertAI" data-plugin="ai" style="color:#7c3aed" aria-label="content ai"><span class="material-icons">auto_awesome</span></button>
        <button class="t2-btn" data-command="rearrangeContent" data-plugin="ai_rearrange" style="color:#667eea" aria-label="content ai2"><span class="material-icons" style="animation: rainbow 2s infinite;">auto_fix_high</span></button>
        <button class="t2-btn" data-command="insertMeme" data-plugin="meme" aria-label="insert meme"><span class="material-icons">sentiment_very_satisfied</span></button>
        <button class="t2-btn" data-command="createClipUrl" data-plugin="clipurl" aria-label="clip url"><span class="material-icons">qr_code_2</span></button>
        <button class="t2-btn" data-command="collab" data-plugin="collab" aria-label="collab"><span class="material-icons">group</span></button>
        <button class="t2-btn" data-command="insertDrawing" data-plugin="draw" aria-label="draw"><span class="material-icons">brush</span></button>
        <button class="t2-btn" data-command="exportHTML" data-plugin="export" aria-label="content export"><span class="material-icons-outlined">ios_share</span></button>
    </div>
    <div class="t2-editor" contenteditable="true" id="<?php echo $safe_id ?>_editor"></div>
    <textarea name="<?php echo $safe_id ?>" id="<?php echo $safe_id ?>" style="display:none;"><?php
        // [SEC-XSS] $content를 textarea HTML 컨텍스트에 맞게 이스케이프.
        // </textarea> 등의 삽입으로 인한 HTML injection 방지.
        echo htmlspecialchars($content, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    ?></textarea>
    <div class="t2-editor-status">
        <div class="t2-status-left">
            <a href="//dsclub.kr/service/editor">
                <div class="t2-logo" aria-label="T2Editor logo"><span class="t2-logo-prefix">T2</span><span class="t2-logo-suffix">Editor</span></div>
            </a>
        </div>
        <div class="t2-dark-mode-toggle">
            <button type="button" class="t2-dark-mode-btn" onclick="toggleT2EditorTheme(event)" aria-label="dark mode toggle">
                <span class="material-icons t2-dark-mode-icon">dark_mode</span>
                <span class="material-icons t2-light-mode-icon">light_mode</span>
            </button>
        </div>
        <div class="t2-char-count">txt: <span>0</span></div>
    </div>
    <span style="color: #7a7a7a; position: absolute; right: 5px; margin:5px 0; font-size: 11px; font-weight: 500; display: flex; align-items: center;">
        <i class="material-icons-outlined" style="margin-right: 4px; font-size: 14px">info</i>
        <?php echo (strpos($v = get_readme_version(), '오류') !== false) ? $v : "T2Editor Ver $v"; ?>
    </span>
</div>

<?php echo _t2e_js_script($editor_url, 'js/toolbar.js', $ver); ?>

<script>
function toggleT2EditorTheme(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const currentTheme = document.documentElement.getAttribute('data-t2editor-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-t2editor-theme', newTheme);
    localStorage.setItem('t2editor-dark-mode', newTheme === 'dark');
}

(function() {
    // [SEC-XSS] $safe_id는 이미 htmlspecialchars 처리됨 (< → &lt; 로 변환).
    // script 컨텍스트에서 HTML 엔티티는 디코딩되지 않으므로 &lt;/script> 는 스크립트를 닫지 않음.
    // 추가로 JSON_HEX_TAG | JSON_HEX_AMP 를 적용하여 이중 방어.
    //
    // [BUG-FIX] 이중 인코딩 수정: $safe_id 대신 raw $id 를 json_encode 에 전달.
    // $safe_id = htmlspecialchars($id) 는 HTML 속성 컨텍스트 전용이며,
    // DOM 속성 id 값은 브라우저가 엔티티를 복원하므로 실제 id = $id 임.
    // json_encode($safe_id)를 쓰면 JS 코드는 "&lt;foo&gt;" 를 탐색하지만
    // 실제 DOM id 는 "<foo>" 이므로 getElementById 가 null 을 반환하는 버그 발생.
    // json_encode(JSON_HEX_TAG) 자체가 < > 를 \u003C \u003E 로 안전하게 처리함.
    const editorContainerId = <?php echo json_encode($id . '_container', JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    const editorTextareaId  = <?php echo json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    const editor = new T2Editor(document.getElementById(editorContainerId));
    window[<?php echo json_encode($id . '_editor', JSON_HEX_TAG | JSON_HEX_AMP); ?>] = editor;

    if (<?php echo $json_content; ?>) {
        try {
            // [SEC-XSS] json_encode(JSON_HEX_TAG|JSON_HEX_AMP) 사용으로
            // <\/script> 조기 종료, \u2028/\u2029 JS 줄바꿈 문자 등 완전 차단.
            var contentToLoad = <?php echo $json_content; ?>;
            var tempDiv = document.createElement('div');
            tempDiv.innerHTML = contentToLoad;

            // 테이블 및 미디어 블록 초기화
            tempDiv.querySelectorAll('.table-responsive').forEach(function(responsiveWrapper) {
                var table = responsiveWrapper.querySelector('table');
                if (table) {
                    if (!table.classList.contains('t2-table')) table.classList.add('t2-table');
                    var isLargeTable = table.classList.contains('t2-table-large') || (table.rows.length > 10 || (table.rows[0] && table.rows[0].cells.length > 10));
                    if (isLargeTable && !table.classList.contains('t2-table-large')) table.classList.add('t2-table-large');
                    var tableWrapper = document.createElement('div');
                    tableWrapper.className = 't2-table-wrapper';
                    tableWrapper.contentEditable = false;
                    responsiveWrapper.parentNode.insertBefore(tableWrapper, responsiveWrapper);
                    if (isLargeTable) {
                        var scrollWrapper = document.createElement('div');
                        scrollWrapper.className = 't2-table-scroll-wrapper';
                        tableWrapper.appendChild(scrollWrapper);
                        scrollWrapper.appendChild(table);
                    } else {
                        tableWrapper.appendChild(table);
                    }
                    responsiveWrapper.remove();
                }
            });

            // [FIX-PERSIST] .t2-drawing-block class 를 제거하지 않는다.
            // 구버전 migration 코드가 class 를 지우면 initializeDrawingBlocks() 전략 1 이
            // 항상 실패해 전략 2(data-t2-block) 폴백에만 의존하게 된다.
            // class 를 보존하고 data-t2-block / data-drawing-url 만 보완해 양쪽 탐지를 보장.
            tempDiv.querySelectorAll('.t2-drawing-block').forEach(function(drawingBlock) {
                if (!drawingBlock.classList.contains('t2-media-block')) {
                    drawingBlock.classList.add('t2-media-block');
                }
                drawingBlock.setAttribute('data-t2-block', 'drawing');
                var container = drawingBlock.querySelector('div:first-child');
                if (container) container.setAttribute('data-t2-block', 'drawing');
                var img = drawingBlock.querySelector('img');
                if (img && img.src) {
                    var placeholder1px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
                    if (img.src !== placeholder1px) {
                        if (!drawingBlock.getAttribute('data-drawing-url')) {
                            drawingBlock.setAttribute('data-drawing-url', img.src);
                        }
                        if (container && !container.getAttribute('data-drawing-url')) {
                            container.setAttribute('data-drawing-url', img.src);
                        }
                    }
                }
            });

            // ── 비디오 블록 선행 복구 ──────────────────────────────────────────
            // [FIX] CMS(Gnuboard5 등) 가 iframe·data-* 를 제거해도
            //       wrapper/container data-t2-block·data-video-* 또는
            //       .t2-video-source[href] fallback anchor 에서 URL 복구.
            // [FIX] :has() 미지원 브라우저 호환 — querySelectorAll 순회 방식 사용.
            (function restoreVideoBlocks(root) {
                var found = [];
                var seen  = new Set();

                function addDirectChild(el) {
                    if (!el || el === root) return;
                    var node = el;
                    while (node.parentElement && node.parentElement !== root) {
                        node = node.parentElement;
                    }
                    if (node.parentElement === root && !seen.has(node)) {
                        seen.add(node);
                        found.push(node);
                    }
                }

                // 전략 1: class / data-t2-block 기반 (class 살아있는 경우)
                root.querySelectorAll('.t2-video-block, [data-t2-block="video"]')
                    .forEach(function(el) { addDirectChild(el); });

                // 전략 2: video_view.php iframe (class 소실, src 생존)
                root.querySelectorAll('iframe[src*="video_view.php"]')
                    .forEach(function(el) { addDirectChild(el.closest('div') || el.parentElement); });

                // 전략 3: youtube.com iframe (class 소실, src 생존)
                root.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"]')
                    .forEach(function(el) { addDirectChild(el.closest('div') || el.parentElement); });

                // 전략 4: .t2-video-source[href] fallback anchor (iframe+class 모두 소실)
                root.querySelectorAll('.t2-video-source[href]')
                    .forEach(function(el) { addDirectChild(el.closest('div') || el.parentElement); });

                // 전략 5: mp4/webm 등 직접 링크 (fallback anchor href 에서 확장자 탐지)
                root.querySelectorAll('a[href]').forEach(function(a) {
                    var href = a.getAttribute('href') || '';
                    if (/\.(mp4|webm|ogg|mov|m4v|mkv|avi|wmv|flv)(\?|#|$)/i.test(href)) {
                        addDirectChild(a.closest('div') || a.parentElement);
                    }
                });

                found.forEach(function(block) {
                    // 이미 다른 블록 타입으로 처리된 경우 제외
                    if (block.classList.contains('t2-file-block') ||
                        block.classList.contains('t2-code-block') ||
                        block.classList.contains('t2-table-wrapper') ||
                        block.classList.contains('t2-drawing-block')) return;

                    // iframe 또는 .t2-video-source[href] 가 없으면 비디오 블록이 아님
                    var hasIframe  = !!block.querySelector('iframe');
                    var hasFallback = !!block.querySelector('.t2-video-source[href]');
                    var hasVideoLink = (function() {
                        var links = block.querySelectorAll('a[href]');
                        for (var i = 0; i < links.length; i++) {
                            if (/\.(mp4|webm|ogg|mov|m4v|mkv|avi|wmv|flv)(\?|#|$)/i.test(links[i].getAttribute('href') || '')) return true;
                        }
                        return false;
                    })();
                    if (!hasIframe && !hasFallback && !hasVideoLink) return;

                    // 필수 클래스·속성 복원
                    block.classList.add('t2-media-block', 't2-video-block');
                    block.setAttribute('data-t2-block', 'video');
                    block.setAttribute('contenteditable', 'false');
                    if (!block.style.position) block.style.position = 'relative';

                    // 이벤트 없는 죽은 컨트롤 선제 제거
                    var ctrl = block.querySelector('.t2-media-controls');
                    if (ctrl) ctrl.remove();
                    var moveCtrl = block.querySelector('.t2-move-controls');
                    if (moveCtrl) moveCtrl.remove();

                    // <p> 래핑 탈출
                    if (block.parentNode && block.parentNode.nodeName === 'P') {
                        var p = block.parentNode;
                        p.parentNode.insertBefore(block, p);
                        var pText = (p.textContent || '').replace(/\u200B/g, '').trim();
                        if (!pText && !p.querySelector('img, iframe, video')) p.remove();
                    }
                });

            })(tempDiv);

            // ── 파일 블록 선행 복구 ──────────────────────────────────────────────
            // 이미지 블록이 <img> 태그 자체로 복구되듯,
            // 파일 블록도 클래스 손실 시 내부 구조(data 속성, 내부 요소)로 식별한다.
            //
            // CMS(Gnuboard5 등)의 HTML 새니타이저가 class 속성을 제거하거나
            // contenteditable 속성을 strip하는 경우에도 아래 다중 탐색 전략으로
            // 블록을 식별·복원한 뒤 setContent()에 전달한다.
            (function restoreFileBlocks(root) {
                var found = [];
                var seen = new Set();

                function addDirectChild(el) {
                    if (!el || el === root) return;
                    var node = el;
                    while (node.parentElement && node.parentElement !== root) {
                        node = node.parentElement;
                    }
                    if (node.parentElement === root && !seen.has(node)) {
                        seen.add(node);
                        found.push(node);
                    }
                }

                // 전략 1·2: class / data 속성이 살아있는 경우
                root.querySelectorAll('.t2-file-block, [data-t2-block="file"]')
                    .forEach(function(el) { addDirectChild(el); });

                // 전략 3: 내부 .file-container (outer class 손실, inner class 생존)
                root.querySelectorAll('.file-container')
                    .forEach(function(el) {
                        addDirectChild(el.closest('div') || el);
                    });

                // 전략 4: 오디오 블록 내부 클래스
                root.querySelectorAll('.audio-file-container, .audio-player')
                    .forEach(function(el) {
                        addDirectChild(el.closest('div') || el);
                    });

                // 전략 5: <a download> (class 전체 손실 시 구조로 판별)
                root.querySelectorAll('a[download]').forEach(function(a) {
                    addDirectChild(a.closest('div, article, section') || a.parentElement);
                });

                // 전략 6: PDF 뷰어 링크
                root.querySelectorAll('a[href*="pdf_view.php"]').forEach(function(a) {
                    addDirectChild(a.closest('div, article, section') || a.parentElement);
                });

                found.forEach(function(block) {
                    // 이미지·비디오·코드·테이블 블록 제외
                    if (block.classList.contains('t2-video-block') ||
                        block.classList.contains('t2-code-block') ||
                        block.classList.contains('t2-table-wrapper')) return;
                    var hasFileContent = block.querySelector(
                        '.file-container, .audio-player, .audio-file-container, a[download], a[href*="pdf_view.php"], audio'
                    );
                    if (!hasFileContent) return;

                    // 필수 속성·클래스 복원
                    block.classList.add('t2-media-block', 't2-file-block');
                    block.setAttribute('data-t2-block', 'file');
                    block.setAttribute('contenteditable', 'false');
                    if (!block.style.position) block.style.position = 'relative';

                    // 이벤트 없는 죽은 컨트롤 선제 제거
                    var ctrl = block.querySelector('.t2-media-controls');
                    if (ctrl) ctrl.remove();

                    // <p> 래핑 탈출
                    if (block.parentNode && block.parentNode.nodeName === 'P') {
                        var p = block.parentNode;
                        p.parentNode.insertBefore(block, p);
                        if (!p.textContent.trim() &&
                            !p.querySelector('img, iframe, video')) p.remove();
                    }
                });
            })(tempDiv);

            // ── 코드블록 선행 복구 ──────────────────────────────────────────────────
            // [FIX-미탐지  문제1] class·data 소실 시 <pre><code> 구조로 보조 탐지 (전략 B)
            // [FIX-미복구  문제2] html_entity_decode + innerHTML 파싱으로 파손된
            //                     <pre><code> 구조를 pre.textContent 수집으로 재구성
            // [FIX-XSS       ] 잔류 HTML 마크업 textContent 치환 (& 먼저 처리)
            // [FIX-레이아웃  ] <pre> 에 overflowX:auto / maxWidth:100% 적용
            (function restoreCodeBlocks(root) {

                // ── 전략 A: class / data-block-id 기반 탐지 ──────────────────────
                var foundBlocks = new Set();

                function addEditorDirectChild(el) {
                    if (!el || el === root) return;
                    var node = el;
                    while (node.parentElement && node.parentElement !== root) {
                        node = node.parentElement;
                    }
                    if (node.parentElement === root) foundBlocks.add(node);
                }

                root.querySelectorAll('.t2-code-block, [data-block-id^="code_"]')
                    .forEach(addEditorDirectChild);

                // ── 전략 B: <pre><code> 구조 탐지 (class·data 전부 소실 시) ────────
                root.querySelectorAll('pre > code').forEach(function(codeEl) {
                    var node = codeEl;
                    while (node.parentElement && node.parentElement !== root) {
                        node = node.parentElement;
                    }
                    if (node.parentElement !== root) return;
                    if (node.classList.contains('t2-video-block') ||
                        node.classList.contains('t2-file-block') ||
                        node.classList.contains('t2-table-wrapper') ||
                        node.classList.contains('t2-drawing-block')) return;
                    if (!node.querySelector('img, iframe, video, audio, .file-container, a[download]')) {
                        foundBlocks.add(node);
                    }
                });

                foundBlocks.forEach(function(block) {

                    // ── 필수 클래스·속성 복원 ──────────────────────────────────
                    if (!block.classList.contains('t2-media-block')) block.classList.add('t2-media-block');
                    if (!block.classList.contains('t2-code-block'))  block.classList.add('t2-code-block');
                    block.setAttribute('contenteditable', 'false');
                    if (!block.style.position) block.style.position = 'relative';

                    // ── 이벤트 없는 죽은 컨트롤 선제 제거 ───────────────────
                    var ctrl = block.querySelector('.t2-media-controls');
                    if (ctrl) ctrl.remove();
                    var moveCtrl = block.querySelector('.t2-move-controls');
                    if (moveCtrl) moveCtrl.remove();

                    // ── <p> 래핑 탈출 ────────────────────────────────────────
                    if (block.parentNode && block.parentNode.nodeName === 'P') {
                        var p = block.parentNode;
                        p.parentNode.insertBefore(block, p);
                        var pText = p.textContent.replace(/\u200B/g, '').trim();
                        if (!pText && !p.querySelector('img, iframe, video')) p.remove();
                    }

                    // ── <pre> 구조 확인 및 복원 ──────────────────────────────
                    var preEl = block.querySelector('pre');
                    if (!preEl) {
                        var container = block.querySelector('div') || block;
                        preEl = document.createElement('pre');
                        preEl.setAttribute('contenteditable', 'false');
                        var orphanCode = container.querySelector('code');
                        if (orphanCode) {
                            preEl.appendChild(orphanCode);
                        } else {
                            var newCode = document.createElement('code');
                            newCode.textContent = container.textContent.trim();
                            preEl.appendChild(newCode);
                            container.textContent = '';
                        }
                        container.appendChild(preEl);
                    }

                    // [FIX-레이아웃] <pre> overflow — textarea 강제 확장 방지
                    preEl.setAttribute('contenteditable', 'false');
                    preEl.style.overflowX = 'auto';
                    preEl.style.maxWidth  = '100%';

                    // ── <code> 복원 및 파손 구조 재구성 ──────────────────────
                    var codeEl = preEl.querySelector('code');

                    if (!codeEl) {
                        var txt = preEl.textContent;
                        preEl.innerHTML = '';
                        codeEl = document.createElement('code');
                        codeEl.textContent = txt;
                        preEl.appendChild(codeEl);
                    } else {
                        // [FIX-미복구] 파손 구조 복구:
                        // html_entity_decode + innerHTML 파싱으로 </code> 등이
                        // 실제 닫는 태그로 해석되어 <code> 내용이 잘리고 <pre> 안에
                        // 텍스트 노드로 남는 경우 → pre.textContent 수집으로 복구.
                        var preText = preEl.textContent;
                        if (preEl.childNodes.length > 1 || codeEl.textContent !== preText) {
                            codeEl.textContent = preText;
                            Array.prototype.slice.call(preEl.childNodes).forEach(function(child) {
                                if (child !== codeEl) preEl.removeChild(child);
                            });
                        }

                        // [FIX-XSS] 잔류 HTML 마크업 sanitize
                        // & 를 먼저 처리해야 이중 인코딩 오류 없음
                        var rawText = codeEl.textContent;
                        var expectedHtml = rawText
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/"/g, '&quot;');
                        if (codeEl.innerHTML !== expectedHtml) {
                            codeEl.textContent = rawText;
                        }
                    }

                    // [FIX-이벤트] data-events-setup 제거 —
                    // initializeCodeBlocks()가 이벤트 재연결을 건너뛰던 근본 원인
                    codeEl.removeAttribute('data-events-setup');
                });

            })(tempDiv);

            editor.setContent(tempDiv.innerHTML);

            // [NOTE] editor.setContent() → _doSetContent() → processContentSet()이
            // plugin.onContentSet()을 이미 호출함.
            // 아래 setTimeout은 플러그인 로딩이 지연된 경우의 fallback이지만
            // initializeCodeBlocks()가 WeakSet 기반으로 멱등(idempotent)하게
            // 설계되어 있어 이중 호출이 발생해도 안전함.
            setTimeout(function() {
                for (let [name, plugin] of editor.plugins) {
                    if (plugin.onContentSet) plugin.onContentSet(tempDiv.innerHTML);
                }
            }, 100);
        } catch (e) {
            console.error('에디터 초기화 오류:', e);
        }
    }
})();
</script>
<?php
        $html .= ob_get_clean();
    } else {
        // [SEC-XSS] is_dhtml_editor=false 브랜치에서도 $id, $content 이스케이프 적용
        $safe_id_ne      = htmlspecialchars($id,      ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $safe_content_ne = htmlspecialchars($content, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $html .= "\n<textarea id=\"{$safe_id_ne}\" name=\"{$safe_id_ne}\" style=\"width:100%;height:300px\">{$safe_content_ne}</textarea>";
    }

    return $html;
}

function get_editor_js($id, $is_dhtml_editor=true) {
    if ($is_dhtml_editor) {
        // [SEC-XSS] T2EDITOR_URL을 JS 문자열로 안전하게 삽입:
        // json_encode(JSON_HEX_TAG)는 <, > → \u003C, \u003E로 인코딩하여
        // </script> 탈출 및 HTML 인젝션을 차단함.
        $js_editor_url = json_encode(T2EDITOR_URL, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE);
        // [SEC-XSS] JSON_HEX_TAG | JSON_HEX_AMP 추가:
        // 기본 json_encode()는 < > & 를 이스케이프하지 않으므로
        // $id 에 </script> 가 포함되면 스크립트 블록이 조기 종료되어 XSS 발생.
        // JSON_HEX_TAG: < → \u003C, > → \u003E 로 인코딩하여 탈출 차단.
        $js_id = json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP); // 따옴표 포함 JSON 문자열 반환
        return "
var _submitContent = function() {
    var editorContent = document.getElementById({$js_id} + '_editor').innerHTML;
    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = editorContent;

    // [FIX-G5-IFRAME] 직접 업로드 비디오 iframe을 9.1.1 계열과 같은 단순 iframe으로 저장한다.
    // 일부 CMS 필터는 same-origin iframe + sandbox 또는 상대 src 조합을 제거한다.
    // 저장 직전 video_view.php iframe은 sandbox를 제거하고 src를 절대 URL로 정규화한다.
    var t2IsVideoViewIframe = function(src) {
        src = String(src || '').toLowerCase();
        return src.indexOf('video_view.php') !== -1;
    };
    var t2ToAbsoluteUrl = function(src) {
        if (!src) return src;
        try { return new URL(src, window.location.href).href; } catch (e) { return src; }
    };

    tempDiv.querySelectorAll('.t2-move-controls').forEach(function(ctrl) { ctrl.remove(); });
    tempDiv.querySelectorAll('.t2-code-block code').forEach(function(codeElement) {
        // [SEC] textContent만 보존 — 저장 HTML에 마크업이 남지 않도록 강제 치환
        var codeContent = codeElement.textContent;
        codeElement.textContent = '';
        codeElement.appendChild(document.createTextNode(codeContent));
        // [FIX] data-events-setup을 저장 HTML에서 반드시 제거.
        // 이 속성이 DB에 남아 수정 재로드 시 이벤트 재연결을 막는 근본 원인이었음.
        codeElement.removeAttribute('data-events-setup');
        // contenteditable은 뷰 측에서 불필요 — 저장 시 제거
        codeElement.removeAttribute('contenteditable');
    });

    tempDiv.querySelectorAll('.t2-file-block, .t2-drawing-block').forEach(function(block) {
        const controls = block.querySelector('.t2-media-controls');
        if (controls) controls.remove();

        // [FIX-PERSIST] drawing block: video block 처럼 저장 직전 data-* / fallback anchor 재기록.
        // draw.js updateDrawingBlock() 이 이미 기록하지만 저장 시점에 한 번 더 보장.
        // CMS 새니타이저가 data-* 를 지워도 다음 수정 로드 시 복구 기준이 됨.
        if (block.classList.contains('t2-drawing-block')) {
            var container  = block.querySelector('div:first-child');
            var img        = block.querySelector('img');
            var placeholder1px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

            // URL: wrapper data-drawing-url → container data-drawing-url → img.src 순으로 채택
            var drawingUrl = block.getAttribute('data-drawing-url') ||
                             (container && container.getAttribute('data-drawing-url')) ||
                             (img && img.src !== placeholder1px ? img.src : '') || '';

            if (drawingUrl) {
                // wrapper / container 재기록
                block.setAttribute('data-t2-block',    'drawing');
                block.setAttribute('data-drawing-url', drawingUrl);
                if (container) {
                    container.setAttribute('data-t2-block',    'drawing');
                    container.setAttribute('data-drawing-url', drawingUrl);
                }

                // fallback anchor — 저장 HTML 에 남겨 두어 다음 수정 로드 시 복구 기준 사용
                if (container) {
                    var anchor = container.querySelector('.t2-drawing-source');
                    if (!anchor) {
                        anchor = document.createElement('a');
                        anchor.className = 't2-drawing-source';
                        anchor.setAttribute('aria-hidden', 'true');
                        anchor.setAttribute('tabindex', '-1');
                        anchor.style.cssText =
                            'position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;';
                        container.appendChild(anchor);
                    }
                    anchor.href = drawingUrl;
                }
            }
        }
    });

    tempDiv.querySelectorAll('.t2-video-block').forEach(function(block) {
        if (!block.classList.contains('t2-video-block')) block.classList.add('t2-video-block');
        var container = block.querySelector('div:first-child');

        // [FIX] :has() 제거 — 구형 브라우저 호환을 위해 직접 순회로 대체.
        // .t2-video-block 내부의 <video> 태그 처리
        var videoEl = container ? container.querySelector('video') : null;
        if (videoEl) {
            if (container.style.width) videoEl.style.width = container.style.width;
            if (container.style.height) videoEl.style.height = container.style.height;
            if (!videoEl.hasAttribute('controls')) videoEl.setAttribute('controls', 'controls');
            if (!videoEl.style.backgroundColor) videoEl.style.backgroundColor = '#000';
        }

        // [FIX] iframe 기반 비디오 블록: data-video-url / data-video-type 속성을
        // src에서 재구성하여 누락된 경우 보완 → CMS 새니타이저가 data-* 를 제거해도
        // 다음 수정 시 src 파싱 폴백이 동작하도록 src를 정규화된 상태로 유지
        var iframeEl = container ? container.querySelector('iframe') : null;
        if (iframeEl) {
            var rawSrc = iframeEl.getAttribute('src') || '';

            // [FIX-G5-IFRAME] T2 직접 업로드 비디오는 iframe 유지.
            // G5/CMS 필터 회피를 위해 sandbox 제거 + 절대 URL 저장.
            if (t2IsVideoViewIframe(rawSrc)) {
                iframeEl.removeAttribute('sandbox');
                iframeEl.setAttribute('src', t2ToAbsoluteUrl(rawSrc));
                rawSrc = iframeEl.getAttribute('src') || rawSrc;
            }

            // data-video-url 이 없으면 src 에서 복원 후 기록
            if (!iframeEl.dataset.videoUrl && !iframeEl.dataset.videoId) {
                var videoMatch = rawSrc.match(/[?&]video=([^&]+)/);
                if (videoMatch) {
                    try {
                        iframeEl.dataset.videoUrl = decodeURIComponent(videoMatch[1]);
                    } catch (e) {
                        iframeEl.dataset.videoUrl = videoMatch[1];
                    }
                }
            }
            // data-video-type 이 없으면 기본값 기록
            if (!iframeEl.dataset.videoType) {
                iframeEl.dataset.videoType = iframeEl.dataset.videoId ? 'youtube' : 'video';
            }

            // [FIX-PERSIST] 저장 전 wrapper/container data-* 에도 URL 재기록.
            // CMS가 iframe 을 제거해도 wrapper div 는 대부분 살아남아 다음 복구 기준이 됨.
            var vType = iframeEl.dataset.videoType;
            var vUrl  = iframeEl.dataset.videoUrl  || '';
            var vId   = iframeEl.dataset.videoId   || '';
            if (vType) {
                block.setAttribute('data-t2-block', 'video');
                block.setAttribute('data-video-type', vType);
                if (container) {
                    container.setAttribute('data-t2-block', 'video');
                    container.setAttribute('data-video-type', vType);
                }
                if (vType === 'youtube' && vId) {
                    block.setAttribute('data-video-id', vId);
                    if (container) container.setAttribute('data-video-id', vId);
                    block.removeAttribute('data-video-url');
                    if (container) container.removeAttribute('data-video-url');
                } else if (vUrl) {
                    block.setAttribute('data-video-url', vUrl);
                    if (container) container.setAttribute('data-video-url', vUrl);
                    block.removeAttribute('data-video-id');
                    if (container) container.removeAttribute('data-video-id');
                }

                // [FIX-PERSIST] fallback anchor 갱신 (없으면 재생성)
                // 저장 HTML 에 남겨 두어 다음 수정 로드 시 iframe 재생성 기준으로 사용한다.
                if (container) {
                    var anchor = container.querySelector('.t2-video-source');
                    if (!anchor) {
                        anchor = document.createElement('a');
                        anchor.className = 't2-video-source';
                        anchor.setAttribute('aria-hidden', 'true');
                        anchor.setAttribute('tabindex', '-1');
                        anchor.style.cssText =
                            'position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;';
                        container.appendChild(anchor);
                    }
                    if (vType === 'youtube' && vId) {
                        var safeId = vId.replace(/[^a-zA-Z0-9\-_]/g, '');
                        anchor.href = safeId ? 'https://www.youtube.com/watch?v=' + safeId : '';
                    } else {
                        anchor.href = vUrl || '';
                    }
                }
            }
        }

        // [FIX] 에디터 전용 UI 컨트롤 전부 제거 — .t2-media-controls 뿐 아니라
        // .t2-move-controls 도 DB 저장 대상에서 제외해야 재로드 시 구조 오염 방지
        var controls = block.querySelector('.t2-media-controls');
        if (controls) controls.remove();
        var moveControls = block.querySelector('.t2-move-controls');
        if (moveControls) moveControls.remove();
    });

    // [FIX] :has() 제거 — .t2-media-block 중 .t2-video-block 이 아닌 것만 처리.
    // 구형 브라우저 호환을 위해 :has() 대신 forEach + classList 체크 사용.
    tempDiv.querySelectorAll('.t2-media-block').forEach(function(block) {
        if (block.classList.contains('t2-video-block') ||
            block.classList.contains('t2-file-block') ||
            block.classList.contains('t2-drawing-block')) return;
        var container = block.querySelector('div:first-child');
        var mediaElement = container ? container.querySelector('iframe, img') : null;
        if (mediaElement) {
            if (container.style.width) mediaElement.style.width = container.style.width;
            if (container.style.height && mediaElement.tagName === 'IFRAME') mediaElement.style.height = container.style.height;
            var controls = block.querySelector('.t2-media-controls');
            if (controls) controls.remove();
        }
    });

    tempDiv.querySelectorAll('.t2-table-wrapper').forEach(function(wrapper) {
        const table = wrapper.querySelector('table');
        if (table) {
            const controls = wrapper.querySelector('.t2-table-controls, .t2-table-download-btn');
            if (controls) controls.remove();
            const isLargeTable = table.classList.contains('t2-table-large') || (table.rows.length > 10 || (table.rows[0] && table.rows[0].cells.length > 10));
            const hasScrollWrapper = wrapper.querySelector('.t2-table-scroll-wrapper');
            if (isLargeTable || hasScrollWrapper) {
                const scrollContainer = document.createElement('div');
                scrollContainer.className = 'table-responsive';
                scrollContainer.style.cssText = 'display:block; width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch;';
                wrapper.parentNode.insertBefore(scrollContainer, wrapper);
                if (hasScrollWrapper) {
                    hasScrollWrapper.parentNode.insertBefore(table, hasScrollWrapper);
                    hasScrollWrapper.remove();
                }
                scrollContainer.appendChild(table);
                wrapper.remove();
            } else {
                wrapper.parentNode.insertBefore(table, wrapper);
                wrapper.remove();
            }
        }
    });

    tempDiv.querySelectorAll('.t2-code-block').forEach(function(block) {
        const controls = block.querySelector('.t2-media-controls');
        if (controls) controls.remove();
    });

    // [SEC-XSS] T2EDITOR_URL을 json_encode 값으로 JS 문자열 안에 안전하게 삽입
    var contentStyle = '<link href=\"' + {$js_editor_url} + '/css/content.css\" rel=\"stylesheet\">';
    var finalContent = tempDiv.innerHTML;
    if (finalContent.indexOf('t2-media-block') !== -1 || finalContent.indexOf('t2-table') !== -1 || finalContent.indexOf('t2-code-block') !== -1 || finalContent.indexOf('t2-drawing-block') !== -1) {
        finalContent += contentStyle;
    }
    document.getElementById({$js_id}).value = finalContent;
};
_submitContent();\n";
    }
    // [SEC-XSS] getElementById 인수: JSON_HEX_TAG | JSON_HEX_AMP 로 </script> 탈출 차단
    $js_id = json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP);
    // [BUG-FIX] $js_id 는 "foo" 처럼 따옴표를 포함한 JSON 문자열이므로,
    // "var {$js_id}_editor" 는 var "foo"_editor 가 되어 유효하지 않은 식별자.
    // JS 변수명용으로 영숫자/언더스코어만 남긴 별도 식별자를 생성한다.
    //
    // [ChatGPT 일침/BUG-FIX] 'get_editor_js()의 $js_var는 반드시 접두어를 붙여
    // 숫자 시작 식별자도 안전하게 처리해야 함'
    // JS 식별자는 숫자로 시작할 수 없음(ES2015 §11.6).
    // $id = "1board_content" → $js_var = "1board_content" → var 1board_content_editor ← SyntaxError
    // 접두어 t2_ 를 무조건 붙여 숫자/특수문자 시작 ID를 모두 안전하게 처리.
    $js_var = 't2_' . preg_replace('/[^a-zA-Z0-9_]/', '_', $id);
    return "var {$js_var}_editor = document.getElementById({$js_id});\n";
}

function chk_editor_js($id, $is_dhtml_editor=true) {
    if ($is_dhtml_editor) {
        // [SEC-XSS] JSON_HEX_TAG | JSON_HEX_AMP: </script> 탈출 차단
        $js_id = json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP);
        return "
            var editorContent = document.getElementById({$js_id} + '_editor').innerHTML;
            function hasRealContent(html) {
                var tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                if (tempDiv.textContent.trim()) return true;
                if (tempDiv.querySelector('img, video, iframe, table, .t2-file-block, .file-container')) return true;
                return false;
            }
            if (!hasRealContent(editorContent)) {
                alert('내용을 입력해 주십시오.');
                document.getElementById({$js_id} + '_editor').focus();
                return false;
            }\n";
    }
    // [SEC-XSS] JSON_HEX_TAG | JSON_HEX_AMP: </script> 탈출 차단
    $js_id = json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP);
    return "if (!document.getElementById({$js_id}).value) { alert('내용을 입력해 주십시오.'); document.getElementById({$js_id}).focus(); return false; }\n";
}
?>
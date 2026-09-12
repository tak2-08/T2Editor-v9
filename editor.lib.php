<?php
//Path: T2Editor/editor.lib.php

include 'config/t2_config.php';

if (!defined('T2EDITOR_PATH')) define('T2EDITOR_PATH', __DIR__);
if (!defined('T2EDITOR_URL'))  define('T2EDITOR_URL', '/t2editor');

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
if (!defined('T2_NSFW_ENABLED')) define('T2_NSFW_ENABLED', true);

// == T2_NSFW_MODE: 필터 작동 방식 ==
// 'browser': 브라우저 추론
if (!defined('T2_NSFW_MODE')) define('T2_NSFW_MODE', 'browser');

// == T2_NSFW_ALLOW_SUSPICIOUS: 19금 의심 이미지 업로드 허용 여부 ==
// true  → 경고 팝업 표시 후 업로드 허용 (법적 책임 경고) (기본값)
// false → 해당 이미지 업로드 취소 처리
if (!defined('T2_NSFW_ALLOW_SUSPICIOUS')) define('T2_NSFW_ALLOW_SUSPICIOUS', false);

// == 브라우저 NSFW 런타임/모델 설정 ==
// 기본값은 자체 호스팅 경로를 사용합니다.
// vendor 폴더에 tfjs / backend / nsfwjs / model 파일을 배치하면 바로 동작합니다.
if (!defined('T2_NSFW_RUNTIME_ASSET_BASE')) define('T2_NSFW_RUNTIME_ASSET_BASE', T2EDITOR_URL . '/vendor');
if (!defined('T2_NSFW_BROWSER_MODEL')) define('T2_NSFW_BROWSER_MODEL', 'MobileNetV2Mid');
if (!defined('T2_NSFW_BROWSER_MODEL_TYPE')) define('T2_NSFW_BROWSER_MODEL_TYPE', 'graph');
if (!defined('T2_NSFW_BROWSER_MODEL_URL')) define('T2_NSFW_BROWSER_MODEL_URL', T2_NSFW_RUNTIME_ASSET_BASE . '/nsfwjs/models/mobilenet_v2_mid/model.json');
if (!defined('T2_NSFW_BROWSER_BACKEND_PRIORITY')) define('T2_NSFW_BROWSER_BACKEND_PRIORITY', 'webgpu,webgl,wasm,cpu');

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

// CSS 로드 헬퍼
function _t2e_css_link($editor_url, $path, $ver) {
    if (T2_CSS_MIN) {
        return '<link rel="stylesheet" href="' . $editor_url . '/t2_css_min.php?f=' . $path . '&v=' . $ver . '">';
    } else {
        return '<link rel="stylesheet" href="' . $editor_url . '/' . $path . '?v=' . $ver . '">';
    }
}

// JS 로드 헬퍼
function _t2e_js_script($editor_url, $path, $ver) {
    if (T2_JS_MIN) {
        return '<script src="' . $editor_url . '/t2_js_min.php?f=' . $path . '&v=' . $ver . '"></script>';
    } else {
        return '<script src="' . $editor_url . '/' . $path . '?v=' . $ver . '"></script>';
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
        $migration_mode_js = (T2_MIGRATION_MODE === false) ? 'false' : json_encode(T2_MIGRATION_MODE);

        $html .= "\n<script>";
        $html .= "window.T2EDITOR_LICENSE_TOKEN = " . json_encode($license_token) . ";";
        $html .= "window.T2EDITOR_PLUGINS = " . json_encode($T2EDITOR_PLUGINS) . ";";
        $html .= "window.T2EDITOR_PLUGIN_PRIORITY = " . json_encode($T2EDITOR_PLUGIN_PRIORITY) . ";";
        $html .= "window.T2EDITOR_URL = " . json_encode($editor_url) . ";";
        $html .= "window.T2EDITOR_MIGRATION_MODE = " . $migration_mode_js . ";";
        // NSFW 필터 설정 — image.js 에서 참조
        $html .= "window.T2EDITOR_NSFW_ENABLED = " . (T2_NSFW_ENABLED ? 'true' : 'false') . ";";
        $html .= "window.T2EDITOR_NSFW_MODE = " . json_encode(T2_NSFW_MODE) . ";";
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

        $html .= "window.T2EDITOR_NSFW_SERVER_URL = " . json_encode($editor_url . '/config/nsfw_api_server.php') . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_URL = " . json_encode($editor_url . '/config/nsfw_api_browser.js') . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_MODEL = " . json_encode(T2_NSFW_BROWSER_MODEL) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_MODEL_TYPE = " . json_encode(T2_NSFW_BROWSER_MODEL_TYPE) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_MODEL_URL = " . json_encode(T2_NSFW_BROWSER_MODEL_URL) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_BACKEND_PRIORITY = " . json_encode($nsfwBackendPriority) . ";";
        $html .= "window.T2EDITOR_NSFW_RUNTIME_ASSETS = " . json_encode($nsfwRuntimeAssets) . ";";
        $html .= "</script>";

        $js = false;
    }

    if ($is_dhtml_editor) {
        $content = html_entity_decode($content, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $escaped_content = str_replace(
            array("\\", "'", "\r", "\n"),
            array("\\\\", "\\'", "\\r", "\\n"),
            $content
        );

        ob_start(); ?>
<script>
const t2editor_url = <?php echo json_encode(T2EDITOR_URL ?? ""); ?>;
</script>
<?php
if (isset($_SERVER['HTTP_USER_AGENT']) && stripos($_SERVER['HTTP_USER_AGENT'], 'Android') !== false) {
    echo '<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">' . "\n";
    echo '<link href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" rel="stylesheet">' . "\n";
}
?>

<script>
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
  src: url("<?php echo T2EDITOR_URL ?>/fonts/material-icons/MaterialIcons-Regular.eot");
  src: local("Material Icons"),
       url("<?php echo T2EDITOR_URL ?>/fonts/material-icons/MaterialIcons-Regular.woff2") format("woff2"),
       url("<?php echo T2EDITOR_URL ?>/fonts/material-icons/MaterialIcons-Regular.woff") format("woff"),
       url("<?php echo T2EDITOR_URL ?>/fonts/material-icons/MaterialIcons-Regular.ttf") format("truetype");
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
  src: url("<?php echo T2EDITOR_URL ?>/fonts/material-icons/MaterialIconsOutlined-Regular.woff2") format("woff2"),
       url("<?php echo T2EDITOR_URL ?>/fonts/material-icons/MaterialIconsOutlined-Regular.ttf") format("truetype");
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

<div class="t2-editor-container" id="<?php echo $id ?>_container">
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
        <button class="t2-btn" data-command="createClipUrl" data-plugin="clipurl" aria-label="clip url"><span class="material-icons">qr_code_2</span></button>
        <button class="t2-btn" data-command="collab" data-plugin="collab" aria-label="collab"><span class="material-icons">group</span></button>
        <button class="t2-btn" data-command="insertDrawing" data-plugin="draw" aria-label="draw"><span class="material-icons">brush</span></button>
        <button class="t2-btn" data-command="exportHTML" data-plugin="export" aria-label="content export"><span class="material-icons-outlined">ios_share</span></button>
    </div>
    <div class="t2-editor" contenteditable="true" id="<?php echo $id ?>_editor"></div>
    <textarea name="<?php echo $id ?>" id="<?php echo $id ?>" style="display:none;"><?php echo $content ?></textarea>
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
    const editor = new T2Editor(document.getElementById('<?php echo $id ?>_container'));
    window.<?php echo $id ?>_editor = editor;

    if ('<?php echo $escaped_content ?>') {
        try {
            var contentToLoad = '<?php echo $escaped_content ?>';
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

            tempDiv.querySelectorAll('.t2-drawing-block').forEach(function(drawingBlock) {
                var img = drawingBlock.querySelector('img');
                if (img && img.src) {
                    drawingBlock.classList.remove('t2-drawing-block');
                    if (!drawingBlock.classList.contains('t2-media-block')) drawingBlock.classList.add('t2-media-block');
                }
            });

            editor.setContent(tempDiv.innerHTML);

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
        $html .= "\n<textarea id=\"{$id}\" name=\"{$id}\" style=\"width:100%;height:300px\">{$content}</textarea>";
    }

    return $html;
}

function get_editor_js($id, $is_dhtml_editor=true) {
    if ($is_dhtml_editor) {
        $t2editor_url = T2EDITOR_URL; // 변수 정의 추가
        return "
var _submitContent = function() {
    var editorContent = document.getElementById('{$id}_editor').innerHTML;
    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = editorContent;

    tempDiv.querySelectorAll('.t2-move-controls').forEach(function(ctrl) { ctrl.remove(); });
    tempDiv.querySelectorAll('.t2-code-block code').forEach(function(codeElement) {
        var codeContent = codeElement.textContent;
        codeElement.textContent = '';
        codeElement.appendChild(document.createTextNode(codeContent));
    });

    tempDiv.querySelectorAll('.t2-file-block, .t2-drawing-block').forEach(function(block) {
        const controls = block.querySelector('.t2-media-controls');
        if (controls) controls.remove();
    });

    tempDiv.querySelectorAll('.t2-video-block, .t2-media-block:has(video)').forEach(function(block) {
        if (!block.classList.contains('t2-video-block')) block.classList.add('t2-video-block');
        var container = block.querySelector('div:first-child');
        var videoElement = container ? container.querySelector('video') : null;
        if (videoElement) {
            if (container.style.width) videoElement.style.width = container.style.width;
            if (container.style.height) videoElement.style.height = container.style.height;
            if (!videoElement.hasAttribute('controls')) videoElement.setAttribute('controls', 'controls');
            if (!videoElement.style.backgroundColor) videoElement.style.backgroundColor = '#000';
        }
        var controls = block.querySelector('.t2-media-controls');
        if (controls) controls.remove();
    });

    tempDiv.querySelectorAll('.t2-media-block:not(.t2-video-block):not(.t2-file-block):not(.t2-drawing-block)').forEach(function(block) {
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

    var contentStyle = '<link href=\"{$t2editor_url}/css/content.css\" rel=\"stylesheet\">';
    var finalContent = tempDiv.innerHTML;
    if (finalContent.indexOf('t2-media-block') !== -1 || finalContent.indexOf('t2-table') !== -1 || finalContent.indexOf('t2-code-block') !== -1 || finalContent.indexOf('t2-drawing-block') !== -1) {
        finalContent += contentStyle;
    }
    document.getElementById('{$id}').value = finalContent;
};
_submitContent();\n";
    }
    return "var {$id}_editor = document.getElementById('{$id}');\n";
}

function chk_editor_js($id, $is_dhtml_editor=true) {
    if ($is_dhtml_editor) {
        return "
            var editorContent = document.getElementById('{$id}_editor').innerHTML;
            function hasRealContent(html) {
                var tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                if (tempDiv.textContent.trim()) return true;
                if (tempDiv.querySelector('img, video, iframe, table, .t2-file-block, .file-container')) return true;
                return false;
            }
            if (!hasRealContent(editorContent)) {
                alert('내용을 입력해 주십시오.');
                document.getElementById('{$id}_editor').focus();
                return false;
            }\n";
    }
    return "if (!{$id}_editor.value) { alert('내용을 입력해 주십시오.'); {$id}_editor.focus(); return false; }\n";
}
?>

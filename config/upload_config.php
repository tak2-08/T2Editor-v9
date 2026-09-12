<?php
//Path: T2Editor/config/upload_config.php

/**
 * T2Editor 업로드 설정 파일
 *
 * [구조 변경 요약]
 *   이전: validate_upload_file()이 확장자+크기만 검사.
 *         MIME·매직바이트 검증은 각 핸들러에 중복·분산.
 *         새 업로드 엔드포인트 추가 시 보호가 누락될 수 있었다.
 *
 *   현재: 공통 보안 함수 3종을 이 파일에 집약.
 *         · check_request_origin()    — Origin allowlist 검증
 *         · sanitize_original_name()  — 파일명 정제
 *         · verify_file_magic_bytes() — 포맷 시그니처 검증
 *
 *         validate_upload_file()에 $tmp_path 파라미터를 추가.
 *         $tmp_path 제공 시 → 확장자+크기+MIME+매직바이트 전체 검사.
 *         $tmp_path 없이 호출 시 → 기존 확장자+크기만 검사 (하위 호환).
 *
 *         어떤 업로드 핸들러도 $tmp_path 하나만 추가하면
 *         완전한 콘텐츠 검증을 자동으로 받는다.
 *
 * [MIME 맵 개선]
 *   mp4: video/quicktime 추가 (iOS/QuickTime 촬영 영상이 이 MIME 반환)
 *   mov: video/mp4 추가 (일부 mov 파일이 mp4 컨테이너로 인식됨)
 *   avi: video/avi, video/msvideo 추가 (환경별 finfo 차이)
 *   flv: video/flv 추가
 *
 * [매직바이트 개선]
 *   mp4/m4v: 첫 번째 박스 타입을 더 넓게 허용 (wide, free, mdat, moov 등)
 *            iOS 촬영 mp4, Apple QuickTime 인코딩 등 다양한 변형 지원.
 */

// ────────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────────

define('T2EDITOR_MAX_UPLOAD_SIZE', 50);

// WebP 변환 실패 처리
//   true (기본·권장): 변환 실패 시 거부. 비정상 포맷 저장 방지.
//   false: 구형 서버(imagewebp 미지원)에서 원본 폴백이 필요할 때만 사용.
define('T2EDITOR_STRICT_WEBP_CONVERSION', true);

// 이미지 픽셀 수 상한 (DoS 선제 차단)
//   50 MP ≈ RGBA 4채널 기준 약 200 MB. memory_limit 512 MB 내 안전 처리 가능.
define('T2EDITOR_MAX_IMAGE_PIXELS', 50_000_000);

// ────────────────────────────────────────────────────────────────
// 허용 확장자 목록
// ────────────────────────────────────────────────────────────────
// SVG·ICO 제외:
//   SVG — XML 내 <script>·이벤트 핸들러·외부 참조가 실행됨.
//          sanitizer 없이 저장하면 XSS 공격 벡터가 된다.
//   ICO — MIME 판정이 환경 의존적이고 GD 처리 오류·폴백 위험이 크다.
// ────────────────────────────────────────────────────────────────
$t2editor_allowed_extensions = [
    'document' => [
        'pdf','txt','doc','docx','xls','xlsx','ppt','pptx',
        'hwp','odt','ods','odp','rtf',
    ],
    'image' => [
        'jpg','jpeg','png','gif','webp','bmp',
    ],
    'video' => [
        'mp4','webm','ogg','mov','avi','mkv','wmv','flv','m4v',
    ],
    'other' => [
        'zip','rar','7z','tar','gz','bz2',
        'mp3','m4a','wav','flac','aac','wma',
        'json','xml','csv',
    ],
];

// ────────────────────────────────────────────────────────────────
// 확장자 ↔ 허용 MIME 타입 맵
// (이미지·문서·미디어·압축 전체 통합 — 핸들러별 중복 제거)
//
// [개선] 비디오 MIME 타입을 실제 서버 환경(finfo) 반환값에 맞게 확장:
//   · mp4  : video/quicktime 추가 (iOS/Apple 기기 촬영 mp4)
//   · mov  : video/mp4 추가 (일부 mov가 mp4 컨테이너로 판정)
//   · avi  : video/avi, video/msvideo 추가 (환경별 finfo 차이)
//   · flv  : video/flv 추가
// ────────────────────────────────────────────────────────────────
function get_ext_mime_map(): array {
    return [
        // ── 이미지 ─────────────────────────────────────────────────────────
        'jpg'  => ['image/jpeg'],
        'jpeg' => ['image/jpeg'],
        'png'  => ['image/png'],
        'gif'  => ['image/gif'],
        'webp' => ['image/webp'],
        'bmp'  => ['image/bmp','image/x-bmp','image/x-ms-bmp'],
        // ── 문서 ───────────────────────────────────────────────────────────
        'pdf'  => ['application/pdf'],
        'txt'  => ['text/plain'],
        'doc'  => ['application/msword'],
        'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        'xls'  => ['application/vnd.ms-excel'],
        'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        'ppt'  => ['application/vnd.ms-powerpoint'],
        'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
        'hwp'  => ['application/x-hwp','application/haansofthwp','application/octet-stream'],
        'odt'  => ['application/vnd.oasis.opendocument.text'],
        'ods'  => ['application/vnd.oasis.opendocument.spreadsheet'],
        'odp'  => ['application/vnd.oasis.opendocument.presentation'],
        'rtf'  => ['application/rtf','text/rtf'],
        // ── 비디오 ─────────────────────────────────────────────────────────
        // [개선] 실제 finfo 반환값과의 불일치로 인한 업로드 실패를 방지하기 위해
        //        각 포맷별 알려진 MIME 변형을 모두 포함한다.
        'mp4'  => ['video/mp4','video/quicktime','video/x-m4v'],
        //         ^ video/quicktime: iOS/Apple 기기 촬영 mp4가 이 MIME로 판정됨
        'webm' => ['video/webm'],
        'ogg'  => ['video/ogg','audio/ogg','application/ogg'],
        'mov'  => ['video/quicktime','video/mp4'],
        //         ^ video/mp4: 일부 mov 파일이 mp4 컨테이너로 인식됨
        'avi'  => ['video/x-msvideo','video/avi','video/msvideo'],
        //         ^ video/avi, video/msvideo: 환경별 finfo 응답 차이
        'mkv'  => ['video/x-matroska','video/webm'],
        'wmv'  => ['video/x-ms-wmv','video/x-ms-asf'],
        'flv'  => ['video/x-flv','video/flv'],
        //         ^ video/flv: 일부 시스템에서 이 MIME로 반환됨
        'm4v'  => ['video/mp4','video/x-m4v','video/quicktime'],
        // ── 압축 ───────────────────────────────────────────────────────────
        'zip'  => ['application/zip','application/x-zip-compressed'],
        'rar'  => ['application/x-rar-compressed','application/vnd.rar'],
        '7z'   => ['application/x-7z-compressed'],
        'tar'  => ['application/x-tar'],
        'gz'   => ['application/gzip','application/x-gzip'],
        'bz2'  => ['application/x-bzip2'],
        // ── 오디오 ─────────────────────────────────────────────────────────
        'mp3'  => ['audio/mpeg','audio/mp3'],
        'm4a'  => ['audio/mp4','audio/x-m4a'],
        'wav'  => ['audio/wav','audio/x-wav'],
        'flac' => ['audio/flac','audio/x-flac'],
        'aac'  => ['audio/aac'],
        'wma'  => ['audio/x-ms-wma'],
        // ── 텍스트 계열 ────────────────────────────────────────────────────
        'json' => ['application/json','text/plain'],
        'xml'  => ['application/xml','text/xml'],
        'csv'  => ['text/csv','text/plain','application/csv'],
    ];
}

// ────────────────────────────────────────────────────────────────
// [공통-ORIGIN] Origin allowlist 검증
//
// 설정 예시 (t2_config.php):
//   define('T2EDITOR_ALLOWED_ORIGINS', [
//       'https://www.example.com',
//       'https://editor.example.com',
//   ]);
// 미정의 시 동일 호스트 비교로 폴백.
//
// [FIX] 역방향 프록시(Nginx, Apache mod_proxy, CDN 등) 환경에서
// $_SERVER['HTTPS'] 가 설정되지 않는 경우가 있다.
// GET 요청(loadConfig)은 Origin 헤더를 보내지 않아 통과하지만,
// POST 요청(실제 업로드)은 Chrome 이 Origin 을 항상 포함하므로
// 프로토콜 불일치가 생기면 정상 요청이 403 으로 차단된다.
// X-Forwarded-Proto 를 우선 참조하도록 수정한다.
//
// [SEC-CSRF] POST 요청에 Origin 헤더가 없으면 거부한다.
// 브라우저는 cross-origin POST 요청에 Origin 을 항상 포함한다.
// Origin 이 비어있는 POST = curl / 서버 간 요청으로 간주하여 차단한다.
// GET 요청(설정 조회 등)은 Origin 없이도 허용한다.
// ────────────────────────────────────────────────────────────────
function check_request_origin(): bool {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    // [SEC-CSRF] POST/PUT/DELETE 등 데이터 변경 요청에서 Origin 이 비어있으면 거부
    if ($origin === '') {
        if ($method !== 'GET' && $method !== 'HEAD' && $method !== 'OPTIONS') {
            return false;
        }
        return true; // GET 등 읽기 요청은 Origin 없어도 허용
    }

    if (defined('T2EDITOR_ALLOWED_ORIGINS') && is_array(T2EDITOR_ALLOWED_ORIGINS) && count(T2EDITOR_ALLOWED_ORIGINS) > 0) {
        return in_array($origin, T2EDITOR_ALLOWED_ORIGINS, true);
    }

    // [FIX] 역방향 프록시가 X-Forwarded-Proto 를 설정한 경우 우선 참조
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO'])) {
        $proto = strtolower(trim(explode(',', $_SERVER['HTTP_X_FORWARDED_PROTO'])[0]));
    } elseif (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        $proto = 'https';
    } else {
        $proto = 'http';
    }

    return $origin === $proto . '://' . $_SERVER['HTTP_HOST'];
}

// ────────────────────────────────────────────────────────────────
// [공통-FILENAME] 원본 파일명 정제
// ────────────────────────────────────────────────────────────────
function sanitize_original_name(string $filename): string {
    $filename = str_replace("\0", '', $filename);
    $filename = str_replace(['/', '\\', '..'], '', $filename);
    $filename = preg_replace('/[\x00-\x1F\x7F]/', '', $filename);

    if (mb_strlen($filename, 'UTF-8') > 255) {
        $ext  = pathinfo($filename, PATHINFO_EXTENSION);
        $base = mb_substr(pathinfo($filename, PATHINFO_FILENAME), 0, 240, 'UTF-8');
        $filename = $ext !== '' ? $base . '.' . $ext : $base;
    }
    return $filename !== '' ? $filename : 'unnamed_file';
}

// ────────────────────────────────────────────────────────────────
// [공통-MAGIC] 파일 시그니처(매직 바이트) 검증
//
// 이미지(jpg·png·gif·webp·bmp)를 포함한 전체 허용 포맷을 처리.
// 환경 의존적 MIME 판정(octet-stream 오판 등)을 내용 기반으로 보완.
//
// [개선] mp4/m4v: 첫 번째 박스 타입을 더 넓게 허용.
//   MP4 컨테이너 규격(ISO 14496-12)에서 첫 번째 박스는 ftyp 가 권장되지만
//   wide, free, mdat, moov 로 시작하는 유효한 파일도 존재한다.
//   특히 iOS/QuickTime 인코딩 파일은 wide 박스로 시작하는 경우가 많다.
// ────────────────────────────────────────────────────────────────
function verify_file_magic_bytes(string $tmp_path, string $file_ext): bool {
    $handle = fopen($tmp_path, 'rb');
    if (!$handle) return false;
    $header = fread($handle, 16);
    fclose($handle);
    if ($header === false || strlen($header) < 2) return false;

    switch ($file_ext) {
        // ── 이미지 ─────────────────────────────────────────────────────────
        case 'jpg': case 'jpeg':
            return substr($header, 0, 3) === "\xFF\xD8\xFF";
        case 'png':
            return substr($header, 0, 8) === "\x89PNG\r\n\x1A\n";
        case 'gif':
            return substr($header, 0, 6) === 'GIF87a' || substr($header, 0, 6) === 'GIF89a';
        case 'webp':
            return substr($header, 0, 4) === 'RIFF' && strlen($header) >= 12 && substr($header, 8, 4) === 'WEBP';
        case 'bmp':
            return substr($header, 0, 2) === 'BM';
        // ── 문서 ───────────────────────────────────────────────────────────
        case 'pdf':
            return substr($header, 0, 4) === '%PDF';
        case 'zip': case 'docx': case 'xlsx': case 'pptx':
        case 'odt': case 'ods':  case 'odp':
            return substr($header, 0, 4) === "PK\x03\x04";
        case 'doc': case 'xls': case 'ppt': case 'hwp':
            return substr($header, 0, 8) === "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1";
        case 'rtf':
            return substr($header, 0, 5) === '{\\rtf';
        case 'txt': case 'csv':
            return strpos($header, "\x00") === false;
        case 'json': {
            $s = file_get_contents($tmp_path, false, null, 0, 4096);
            if ($s === false) return false;
            if (substr($s, 0, 3) === "\xEF\xBB\xBF") $s = substr($s, 3);
            $t = ltrim($s);
            return strlen($t) > 0 && ($t[0] === '{' || $t[0] === '[');
        }
        case 'xml': {
            $s = file_get_contents($tmp_path, false, null, 0, 256);
            if ($s === false) return false;
            if (substr($s, 0, 3) === "\xEF\xBB\xBF") $s = substr($s, 3);
            $t = ltrim($s);
            return strncmp($t, '<?xml', 5) === 0 || (strlen($t) > 0 && $t[0] === '<');
        }
        // ── 압축 ───────────────────────────────────────────────────────────
        case 'rar':
            return substr($header, 0, 7) === "Rar!\x1A\x07\x00" || substr($header, 0, 8) === "Rar!\x1A\x07\x01\x00";
        case '7z':
            return substr($header, 0, 6) === "7z\xBC\xAF\x27\x1C";
        case 'gz':
            return substr($header, 0, 2) === "\x1F\x8B";
        case 'bz2':
            return substr($header, 0, 2) === 'BZ';
        case 'tar': {
            $h2 = fopen($tmp_path, 'rb');
            if (!$h2) return false;
            fseek($h2, 257);
            $m = fread($h2, 5);
            fclose($h2);
            return $m !== false && substr($m, 0, 5) === 'ustar';
        }
        // ── 오디오 ─────────────────────────────────────────────────────────
        case 'mp3':
            return substr($header, 0, 3) === 'ID3' || (ord($header[0]) === 0xFF && (ord($header[1]) & 0xE0) === 0xE0);
        case 'm4a':
            return strlen($header) >= 8 && substr($header, 4, 4) === 'ftyp';
        case 'wav':
            return substr($header, 0, 4) === 'RIFF' && substr($header, 8, 4) === 'WAVE';
        case 'flac':
            return substr($header, 0, 4) === 'fLaC';
        case 'ogg':
            return substr($header, 0, 4) === 'OggS';
        case 'aac':
            return (ord($header[0]) === 0xFF && (ord($header[1]) & 0xF0) === 0xF0) || substr($header, 0, 3) === 'ID3';
        case 'wma':
            return substr($header, 0, 8) === "\x30\x26\xB2\x75\x8E\x66\xCF\x11";
        // ── 비디오 ─────────────────────────────────────────────────────────
        case 'mp4': case 'm4v':
            // [개선] MP4/M4V 매직바이트 검사 강화
            //
            // MP4 컨테이너(ISO 14496-12)의 첫 번째 박스 구조:
            //   [4바이트 크기][4바이트 타입][데이터...]
            //
            // 표준(권장): ftyp 로 시작.
            // 현실:       iOS, QuickTime, 일부 인코더는 아래 박스로 시작할 수 있다.
            //   · wide — Apple QuickTime 의 확장 크기 예약 박스
            //   · free — 빈 공간(패딩) 박스
            //   · mdat — 미디어 데이터가 앞에 오는 경우 (스트리밍 최적화)
            //   · moov — 메타데이터 박스가 앞에 오는 경우
            //   · pdin — Progressive Download Information
            //   · skip — 건너뛰기 박스
            //
            // 이를 모두 허용해 iOS 촬영 영상, Apple 인코딩 파일 등의
            // MIME 검사 통과 실패를 방지한다.
            if (strlen($header) < 8) return false;
            $box_type = substr($header, 4, 4);
            return in_array($box_type, ['ftyp','mdat','moov','wide','free','skip','pdin'], true);

        case 'webm': case 'mkv':
            return substr($header, 0, 4) === "\x1A\x45\xDF\xA3";
        case 'avi':
            return substr($header, 0, 4) === 'RIFF' && substr($header, 8, 4) === 'AVI ';
        case 'mov': {
            // MOV 는 QuickTime 포맷으로 MP4 와 유사한 박스 구조
            $box = strlen($header) >= 8 ? substr($header, 4, 4) : '';
            return in_array($box, ['ftyp','moov','mdat','wide','free','skip','pnot'], true);
        }
        case 'wmv':
            return substr($header, 0, 8) === "\x30\x26\xB2\x75\x8E\x66\xCF\x11";
        case 'flv':
            return substr($header, 0, 3) === 'FLV';
        default:
            // 알 수 없는 확장자는 통과 (확장자 검사에서 이미 필터링됨)
            return true;
    }
}

// ────────────────────────────────────────────────────────────────
// 확장자 헬퍼
// ────────────────────────────────────────────────────────────────

function get_allowed_extensions($category = null): array {
    global $t2editor_allowed_extensions;
    if ($category && isset($t2editor_allowed_extensions[$category])) {
        return $t2editor_allowed_extensions[$category];
    }
    $all = [];
    foreach ($t2editor_allowed_extensions as $exts) {
        $all = array_merge($all, $exts);
    }
    return $all;
}

function get_image_extensions():    array { return get_allowed_extensions('image'); }
function get_video_extensions():    array { return get_allowed_extensions('video'); }
function get_document_extensions(): array { return get_allowed_extensions('document'); }
function get_other_extensions():    array { return get_allowed_extensions('other'); }

function is_allowed_extension($filename, $categories = null): bool {
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    if ($categories === null) {
        $allowed = get_allowed_extensions();
    } elseif (is_string($categories)) {
        $allowed = get_allowed_extensions($categories);
    } elseif (is_array($categories)) {
        $allowed = [];
        foreach ($categories as $cat) {
            $allowed = array_merge($allowed, get_allowed_extensions($cat));
        }
    } else {
        return false;
    }
    return in_array($ext, $allowed, true);
}

function is_allowed_file_size(int $file_size): bool {
    return $file_size <= T2EDITOR_MAX_UPLOAD_SIZE * 1024 * 1024;
}

// ────────────────────────────────────────────────────────────────
// validate_upload_file() — 강화된 공통 보안 경계
//
// 파라미터:
//   $filename   — (정제된) 파일명
//   $file_size  — 파일 크기 (바이트)
//   $categories — 허용 카테고리 (null = 전체)
//   $tmp_path   — 임시 파일 경로 (null = 확장자+크기만 검사)
//
// $tmp_path 제공 시 실행되는 추가 검사:
//   3) MIME — finfo 기반. octet-stream 은 매직바이트로 위임.
//   4) 매직바이트 — verify_file_magic_bytes()
// ────────────────────────────────────────────────────────────────
function validate_upload_file(
    string  $filename,
    int     $file_size,
    $categories  = null,
    ?string $tmp_path = null
): array {

    // 1. 확장자
    if (!is_allowed_extension($filename, $categories)) {
        return ['success' => false, 'message' => '지원하지 않는 파일 형식입니다.'];
    }

    // 2. 크기
    if (!is_allowed_file_size($file_size)) {
        return ['success' => false, 'message' => '파일 크기가 너무 큽니다. (최대 ' . T2EDITOR_MAX_UPLOAD_SIZE . 'MB)'];
    }

    // tmp_path 없으면 여기서 종료 (하위 호환)
    if ($tmp_path === null || !is_file($tmp_path)) {
        return ['success' => true, 'message' => ''];
    }

    $file_ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    $mime_map = get_ext_mime_map();

    // 3. MIME 검증
    //    octet-stream → libmagic 미판정. MIME 거부 없이 매직바이트 검사로 위임.
    if (function_exists('finfo_open')) {
        $finfo     = finfo_open(FILEINFO_MIME_TYPE);
        $real_mime = finfo_file($finfo, $tmp_path);
        finfo_close($finfo);

        if (
            isset($mime_map[$file_ext]) &&
            $real_mime !== 'application/octet-stream' &&
            !in_array($real_mime, $mime_map[$file_ext], true)
        ) {
            return ['success' => false, 'message' => '파일 내용이 확장자와 일치하지 않습니다.'];
        }
    }

    // 4. 매직바이트
    if (!verify_file_magic_bytes($tmp_path, $file_ext)) {
        return ['success' => false, 'message' => '파일 형식이 올바르지 않습니다.'];
    }

    return ['success' => true, 'message' => ''];
}

// ────────────────────────────────────────────────────────────────
// 기타 헬퍼
// ────────────────────────────────────────────────────────────────

function detect_file_type(string $filename): string {
    global $t2editor_allowed_extensions;
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    foreach ($t2editor_allowed_extensions as $type => $exts) {
        if (in_array($ext, $exts, true)) return $type;
    }
    return 'unknown';
}

function generate_accept_string($categories = null): string {
    if ($categories === null)          $exts = get_allowed_extensions();
    elseif (is_string($categories))    $exts = get_allowed_extensions($categories);
    elseif (is_array($categories)) {
        $exts = [];
        foreach ($categories as $cat) $exts = array_merge($exts, get_allowed_extensions($cat));
    } else return '';

    return implode(',', array_map(fn($e) => '.' . $e, $exts));
}

// ────────────────────────────────────────────────────────────────
// get_js_config() — JS/클라이언트용 통합 설정 객체 생성
//
// editor_lib.php 의 window.T2EDITOR_UPLOAD_CONFIG 주입과
// get_upload_config.php fallback 엔드포인트 양쪽이 이 함수를 사용해
// 완전히 동일한 구조를 반환하도록 보장한다.
//
// 반환 구조:
//   maxSizeMB   — 최대 업로드 크기 (MB 정수)
//   extensions  — 카테고리별 허용 확장자 배열
//     .image / .video / .document / .audio / .other
//   accept      — <input accept> 속성값 (카테고리별)
//     .image / .video / .file  (file = document+video+other)
//   mimeMap     — 비디오 확장자 → 대표 MIME (video.js 전용)
// ────────────────────────────────────────────────────────────────
function get_js_config(): array {
    global $t2editor_allowed_extensions;

    $mime_map = get_ext_mime_map();

    // 오디오 확장자: other 카테고리에서 첫 번째 MIME 가 audio/* 인 것만 추출.
    // upload_config.php 변경 시 자동 반영 — 별도 목록 관리 불필요.
    $audio_exts = [];
    foreach ($t2editor_allowed_extensions['other'] as $ext) {
        foreach ($mime_map[$ext] ?? [] as $mime) {
            if (strncmp($mime, 'audio/', 6) === 0) {
                $audio_exts[] = $ext;
                break;
            }
        }
    }

    // 비디오 확장자별 대표 MIME 맵 (첫 번째 값 = 가장 표준적인 MIME)
    $video_mime_map = [];
    foreach ($t2editor_allowed_extensions['video'] as $ext) {
        if (!empty($mime_map[$ext])) {
            $video_mime_map[$ext] = $mime_map[$ext][0];
        }
    }

    return [
        'maxSizeMB'  => (int) T2EDITOR_MAX_UPLOAD_SIZE,
        'extensions' => [
            'image'    => $t2editor_allowed_extensions['image'],
            'video'    => $t2editor_allowed_extensions['video'],
            'document' => $t2editor_allowed_extensions['document'],
            'audio'    => $audio_exts,
            'other'    => $t2editor_allowed_extensions['other'],
        ],
        'accept' => [
            'image'    => generate_accept_string('image'),
            'video'    => generate_accept_string('video'),
            'file'     => generate_accept_string(['document', 'video', 'other']),
        ],
        'mimeMap' => $video_mime_map,
    ];
}
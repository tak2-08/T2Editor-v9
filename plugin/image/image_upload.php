<?php
// Path: T2Editor/plugin/image/image_upload.php

ob_start();

function send_json_response(array $data): void {
    ob_clean();
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// ── include 경로 분기 ─────────────────────────────────────────────────────
// upload_config.php 에 check_request_origin() 및
// 강화된 validate_upload_file($filename, $size, $cat, $tmp_path) 가 정의됨.
// ──────────────────────────────────────────────────────────────────────────
$common_path = __DIR__ . '/../../../../../common.php';
if (is_file($common_path)) {
    include_once $common_path;
}

include_once __DIR__ . '/../../config/upload_config.php';

@ini_set('memory_limit', '512M');
@ini_set('max_execution_time', 120);

if (defined('_GNUBOARD_')) {
    if (!defined('T2EDITOR_PATH'))            define('T2EDITOR_PATH',            G5_PLUGIN_PATH . '/editor/t2editor');
    if (!defined('T2EDITOR_URL'))             define('T2EDITOR_URL',             G5_PLUGIN_URL  . '/editor/t2editor');
    if (!defined('T2EDITOR_DATA_PATH'))       define('T2EDITOR_DATA_PATH',       G5_DATA_PATH   . '/editor');
    if (!defined('T2EDITOR_DATA_URL'))        define('T2EDITOR_DATA_URL',        G5_DATA_URL    . '/editor');
    if (!defined('T2EDITOR_DIR_PERMISSION'))  define('T2EDITOR_DIR_PERMISSION',  G5_DIR_PERMISSION);
    if (!defined('T2EDITOR_FILE_PERMISSION')) define('T2EDITOR_FILE_PERMISSION', G5_FILE_PERMISSION);
} else {
    require __DIR__ . '/../../config/t2_config.php';
}

// Origin 검증 — upload_config.php 의 check_request_origin() 사용
if (!check_request_origin()) {
    send_json_response(['success' => false, 'message' => '잘못된 접근입니다.']);
}

// uid 정제
// [FIX] 이전 코드는 숫자만 허용(preg_replace '/[^0-9]/')했기 때문에
// JS 에서 UUID·hex·alphanumeric uid 를 전송하면 스트립 후 빈 문자열 또는
// 20자 초과가 되어 "잘못된 접근입니다." 를 반환했다.
// 이제 안전한 alphanumeric + 하이픈·언더스코어 을 허용하고 최대 64자로 제한한다.
$raw_uid = isset($_POST['uid']) ? $_POST['uid'] : '';
$uid     = preg_replace('/[^a-zA-Z0-9_\-]/', '', $raw_uid);
if (!$uid || strlen($uid) > 64) {
    send_json_response(['success' => false, 'message' => '잘못된 접근입니다.']);
}

// 업로드 경로
$date_folder = date('ymd');
$upload_dir  = T2EDITOR_DATA_PATH . '/' . $date_folder;
$upload_url  = T2EDITOR_DATA_URL  . '/' . $date_folder;

if (!is_dir($upload_dir)) {
    if (!@mkdir($upload_dir, T2EDITOR_DIR_PERMISSION, true)) {
        send_json_response(['success' => false, 'message' => '업로드 디렉토리를 생성할 수 없습니다.']);
    }
    @chmod($upload_dir, T2EDITOR_DIR_PERMISSION);
}

if (!isset($_FILES['bf_file'])) {
    send_json_response(['success' => false, 'message' => '업로드할 파일이 없습니다.']);
}

// ── 픽셀 수·메모리 사전 검사 헬퍼 ───────────────────────────────────────
function check_image_resource_limit(int $width, int $height): bool {
    $max_pixels = defined('T2EDITOR_MAX_IMAGE_PIXELS') ? (int)T2EDITOR_MAX_IMAGE_PIXELS : 50_000_000;
    if ($width * $height > $max_pixels) return false;

    $mem_str = ini_get('memory_limit');
    if ($mem_str !== '-1') {
        $mem_val  = (int)$mem_str;
        $mem_unit = strtoupper(substr(trim($mem_str), -1));
        if ($mem_unit === 'G')      $mem_val *= 1024 * 1024 * 1024;
        elseif ($mem_unit === 'M')  $mem_val *= 1024 * 1024;
        elseif ($mem_unit === 'K')  $mem_val *= 1024;

        $estimated = (int)($width * $height * 4 * 1.5);
        if ((memory_get_usage(true) + $estimated) > $mem_val * 0.80) return false;
    }
    return true;
}

$files           = $_FILES['bf_file'];
$file_count      = is_array($files['name']) ? count($files['name']) : 1;
$webp_quality    = 85;
$uploaded_files  = [];
$failure_details = [];

// SVG·ICO 이중 차단 (upload_config.php allowlist 외 직접 요청 방어)
const BLOCKED_IMAGE_EXTENSIONS = ['svg', 'ico'];

for ($i = 0; $i < $file_count; $i++) {
    if (is_array($files['name'])) {
        $filename   = $files['name'][$i];
        $tmp_name   = $files['tmp_name'][$i];
        $file_size  = $files['size'][$i];
        $file_error = $files['error'][$i];
    } else {
        $filename   = $files['name'];
        $tmp_name   = $files['tmp_name'];
        $file_size  = $files['size'];
        $file_error = $files['error'];
    }

    $filename          = str_replace("\0", '', $filename);
    $safe_display_name = htmlspecialchars(basename($filename), ENT_QUOTES, 'UTF-8');

    if ($file_error !== UPLOAD_ERR_OK || empty($filename) || !is_uploaded_file($tmp_name)) {
        if (!empty($filename)) {
            $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'upload_error', 'message' => 'PHP 업로드 오류'];
        }
        continue;
    }

    $file_ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));

    // SVG·ICO 명시적 거부
    if (in_array($file_ext, BLOCKED_IMAGE_EXTENSIONS, true)) {
        $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'blocked_extension', 'message' => $file_ext . ' 파일은 허용되지 않습니다.'];
        continue;
    }

    // ── [1단계] 확장자+크기 사전 검사 (move 전 빠른 실패) ─────────────────
    // tmp_path 없이 호출 → 확장자+크기만 검사
    $pre_check = validate_upload_file($filename, $file_size, 'image');
    if (!$pre_check['success']) {
        $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'validation_failed', 'message' => $pre_check['message']];
        continue;
    }

    // 임시 파일로 이동
    $temp_random   = bin2hex(random_bytes(8));
    $temp_filepath = $upload_dir . '/tmp_' . $temp_random . '.' . $file_ext;

    if (!move_uploaded_file($tmp_name, $temp_filepath)) {
        $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'move_failed', 'message' => '파일 이동에 실패했습니다.'];
        continue;
    }

    // ── [2단계] 콘텐츠 검증 (move 후 MIME + 매직바이트) ──────────────────
    // tmp_path 전달 → validate_upload_file()이 MIME·매직바이트까지 검사
    // 이전에는 이 핸들러 내부에서 별도로 finfo·매직바이트를 수행했으나
    // 이제 공통 함수에 위임한다.
    $content_check = validate_upload_file($filename, $file_size, 'image', $temp_filepath);
    if (!$content_check['success']) {
        @unlink($temp_filepath);
        $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'content_check_failed', 'message' => $content_check['message']];
        continue;
    }

    // 실제 이미지 타입 확인
    $image_info = @getimagesize($temp_filepath);
    if (!$image_info) {
        @unlink($temp_filepath);
        $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'not_image', 'message' => '유효한 이미지 파일이 아닙니다.'];
        continue;
    }

    $img_width  = $image_info[0];
    $img_height = $image_info[1];
    $img_type   = $image_info[2];

    // 픽셀 수·메모리 사전 검사
    if (!check_image_resource_limit($img_width, $img_height)) {
        @unlink($temp_filepath);
        $max_mp = number_format(defined('T2EDITOR_MAX_IMAGE_PIXELS') ? T2EDITOR_MAX_IMAGE_PIXELS : 50_000_000);
        $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'image_too_large', 'message' => "이미지 해상도가 너무 큽니다. (최대 {$max_mp} 픽셀)"];
        continue;
    }

    // WebP 이미지는 변환 없이 이동
    if ($img_type === IMAGETYPE_WEBP) {
        $save_filename = bin2hex(random_bytes(16)) . '.webp';
        $save_filepath = $upload_dir . '/' . $save_filename;
        if (@rename($temp_filepath, $save_filepath)) {
            @chmod($save_filepath, T2EDITOR_FILE_PERMISSION);
            $uploaded_files[] = ['url' => $upload_url . '/' . $save_filename, 'width' => $img_width, 'height' => $img_height];
        } else {
            @unlink($temp_filepath);
            $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'rename_failed', 'message' => '파일 저장에 실패했습니다.'];
        }
        continue;
    }

    // GD 리소스 생성
    $save_filename = bin2hex(random_bytes(16)) . '.webp';
    $save_filepath = $upload_dir . '/' . $save_filename;
    $src_image     = null;

    switch ($img_type) {
        case IMAGETYPE_JPEG: $src_image = @imagecreatefromjpeg($temp_filepath); break;
        case IMAGETYPE_PNG:
            $src_image = @imagecreatefrompng($temp_filepath);
            if ($src_image) { imagepalettetotruecolor($src_image); imagealphablending($src_image, false); imagesavealpha($src_image, true); }
            break;
        case IMAGETYPE_GIF: $src_image = @imagecreatefromgif($temp_filepath); break;
        case IMAGETYPE_BMP: $src_image = @imagecreatefrombmp($temp_filepath); break;
        default:
            @unlink($temp_filepath);
            $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'unsupported_image_type', 'message' => '처리할 수 없는 이미지 형식입니다.'];
            continue 2;
    }

    $conversion_success = false;

    if ($src_image) {
        $max_dimension = 9000;
        if ($img_width > $max_dimension || $img_height > $max_dimension) {
            $ratio      = min($max_dimension / $img_width, $max_dimension / $img_height);
            $new_width  = (int)floor($img_width  * $ratio);
            $new_height = (int)floor($img_height * $ratio);

            $resized = imagecreatetruecolor($new_width, $new_height);
            if ($img_type === IMAGETYPE_PNG || $img_type === IMAGETYPE_GIF) {
                imagealphablending($resized, false);
                imagesavealpha($resized, true);
                imagefill($resized, 0, 0, imagecolorallocatealpha($resized, 255, 255, 255, 127));
            }
            imagecopyresampled($resized, $src_image, 0, 0, 0, 0, $new_width, $new_height, $img_width, $img_height);
            imagedestroy($src_image);
            $src_image = $resized;
            $img_width  = $new_width;
            $img_height = $new_height;
        }

        if (function_exists('imagewebp')) {
            $conversion_success = @imagewebp($src_image, $save_filepath, $webp_quality);
        }
        imagedestroy($src_image);
    }

    if ($conversion_success) {
        @chmod($save_filepath, T2EDITOR_FILE_PERMISSION);
        $uploaded_files[] = ['url' => $upload_url . '/' . $save_filename, 'width' => $img_width, 'height' => $img_height];
        @unlink($temp_filepath);
    } else {
        // T2EDITOR_STRICT_WEBP_CONVERSION (upload_config.php 에서 정의)
        $strict = !defined('T2EDITOR_STRICT_WEBP_CONVERSION') || T2EDITOR_STRICT_WEBP_CONVERSION;

        if ($strict) {
            @unlink($temp_filepath);
            $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'webp_conversion_failed', 'message' => 'WebP 변환에 실패했습니다.'];
        } else {
            $org_save  = bin2hex(random_bytes(16)) . '.' . $file_ext;
            $org_path  = $upload_dir . '/' . $org_save;
            if (@rename($temp_filepath, $org_path)) {
                @chmod($org_path, T2EDITOR_FILE_PERMISSION);
                $uploaded_files[] = ['url' => $upload_url . '/' . $org_save, 'width' => $img_width, 'height' => $img_height];
            } else {
                @unlink($temp_filepath);
                $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'fallback_save_failed', 'message' => '파일 저장에 실패했습니다.'];
            }
        }
    }
}

if (empty($uploaded_files)) {
    $first_msg = !empty($failure_details) ? $failure_details[0]['message'] : '이미지 처리 중 오류가 발생했습니다.';
    send_json_response(['success' => false, 'message' => $first_msg, 'failures' => $failure_details]);
}

send_json_response(['success' => true, 'files' => $uploaded_files, 'failures' => $failure_details]);
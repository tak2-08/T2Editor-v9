<?php
// Path: T2Editor/plugin/image/image_upload.php

include_once('../../../../../common.php');
include_once('../../config/upload_config.php');

// 메모리 부족으로 인한 업로드 실패 방지
@ini_set('memory_limit', '-1');
@ini_set('max_execution_time', 0);

// 그누보드5 환경 상수 정의 확인
if (defined('_GNUBOARD_')) {
    if (!defined('T2EDITOR_PATH')) define('T2EDITOR_PATH', G5_PLUGIN_PATH.'/editor/t2editor');
    if (!defined('T2EDITOR_URL')) define('T2EDITOR_URL', G5_PLUGIN_URL.'/editor/t2editor');
    if (!defined('T2EDITOR_DATA_PATH')) define('T2EDITOR_DATA_PATH', G5_DATA_PATH.'/editor');
    if (!defined('T2EDITOR_DATA_URL')) define('T2EDITOR_DATA_URL', G5_DATA_URL.'/editor');
    if (!defined('T2EDITOR_DIR_PERMISSION')) define('T2EDITOR_DIR_PERMISSION', G5_DIR_PERMISSION);
    if (!defined('T2EDITOR_FILE_PERMISSION')) define('T2EDITOR_FILE_PERMISSION', G5_FILE_PERMISSION);
} else {
    include_once('../../config/t2_config.php');
}

$uid = isset($_POST['uid']) ? preg_replace('/[^0-9]/', '', $_POST['uid']) : ''; // 숫자만 허용
if (!$uid) {
    die(json_encode(['success' => false, 'message' => '잘못된 접근입니다.']));
}

// 현재 날짜로 폴더명 생성
$date_folder = date('ymd');
$upload_dir = T2EDITOR_DATA_PATH . '/' . $date_folder;
$upload_url = T2EDITOR_DATA_URL . '/' . $date_folder;

// 폴더 생성 및 권한 설정
if (!is_dir($upload_dir)) {
    if (!@mkdir($upload_dir, T2EDITOR_DIR_PERMISSION, true)) {
        die(json_encode(['success' => false, 'message' => '업로드 디렉토리를 생성할 수 없습니다.']));
    }
    @chmod($upload_dir, T2EDITOR_DIR_PERMISSION);
}

$uploaded_files = [];

if (!isset($_FILES['bf_file'])) {
    die(json_encode(['success' => false, 'message' => '업로드할 파일이 없습니다.']));
}

$files = $_FILES['bf_file'];
$file_count = is_array($files['name']) ? count($files['name']) : 1;
$webp_quality = 85;

for ($i = 0; $i < $file_count; $i++) {
    // 단일/다중 업로드에 따른 변수 할당
    if (is_array($files['name'])) {
        $filename = $files['name'][$i];
        $tmp_name = $files['tmp_name'][$i];
        $file_size = $files['size'][$i];
        $file_error = $files['error'][$i];
    } else {
        $filename = $files['name'];
        $tmp_name = $files['tmp_name'];
        $file_size = $files['size'];
        $file_error = $files['error'];
    }

    if ($file_error !== UPLOAD_ERR_OK || empty($filename) || !is_uploaded_file($tmp_name)) {
        continue;
    }

    // 파일명 검증 및 확장자 추출
    $file_ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    
    // validate_upload_file 함수가 존재할 경우 체크
    if (function_exists('validate_upload_file')) {
        $validation_result = validate_upload_file($filename, $file_size, 'image');
        if (!$validation_result['success']) {
            continue;
        }
    }

    // 임시 파일 이동
    $temp_filename = 'temp_' . $uid . '_' . $i . '.' . $file_ext;
    $temp_filepath = $upload_dir . '/' . $temp_filename;
    
    if (!move_uploaded_file($tmp_name, $temp_filepath)) {
        continue;
    }

    // 이미지 정보 가져오기 (실제 이미지 타입 확인)
    $image_info = @getimagesize($temp_filepath);
    if (!$image_info) {
        @unlink($temp_filepath);
        continue;
    }

    $img_type = $image_info[2]; // IMAGETYPE_JPEG, IMAGETYPE_PNG 등
    
    // 이미 WebP 형식이면 변환 없이 이동
    if ($img_type === IMAGETYPE_WEBP) {
        $save_filename = $uid . '_' . $i . '.webp';
        $save_filepath = $upload_dir . '/' . $save_filename;
        
        if (@rename($temp_filepath, $save_filepath)) {
            @chmod($save_filepath, T2EDITOR_FILE_PERMISSION);
            $uploaded_files[] = [
                'url' => $upload_url . '/' . $save_filename,
                'width' => $image_info[0],
                'height' => $image_info[1]
            ];
        } else {
            @unlink($temp_filepath);
        }
        continue;
    }

    // WebP 변환 시도
    $save_filename = $uid . '_' . $i . '.webp';
    $save_filepath = $upload_dir . '/' . $save_filename;
    $src_image = null;

    // 확장자가 아닌 실제 이미지 타입으로 리소스 생성
    switch ($img_type) {
        case IMAGETYPE_JPEG:
            $src_image = @imagecreatefromjpeg($temp_filepath);
            break;
        case IMAGETYPE_PNG:
            $src_image = @imagecreatefrompng($temp_filepath);
            if ($src_image) {
                imagepalettetotruecolor($src_image);
                imagealphablending($src_image, false);
                imagesavealpha($src_image, true);
            }
            break;
        case IMAGETYPE_GIF:
            $src_image = @imagecreatefromgif($temp_filepath);
            break;
        case IMAGETYPE_BMP:
            $src_image = @imagecreatefrombmp($temp_filepath);
            break;
    }

    $conversion_success = false;

    if ($src_image) {
        // 이미지 리사이징 (최대 9000px 제한)
        $original_width = $image_info[0];
        $original_height = $image_info[1];
        $max_dimension = 9000;

        if ($original_width > $max_dimension || $original_height > $max_dimension) {
            $ratio = min($max_dimension / $original_width, $max_dimension / $original_height);
            $new_width = floor($original_width * $ratio);
            $new_height = floor($original_height * $ratio);

            $resized_image = imagecreatetruecolor($new_width, $new_height);

            // 투명도 유지 처리
            if ($img_type == IMAGETYPE_PNG || $img_type == IMAGETYPE_GIF) {
                imagealphablending($resized_image, false);
                imagesavealpha($resized_image, true);
                $transparent = imagecolorallocatealpha($resized_image, 255, 255, 255, 127);
                imagefill($resized_image, 0, 0, $transparent);
            }

            imagecopyresampled($resized_image, $src_image, 0, 0, 0, 0, $new_width, $new_height, $original_width, $original_height);
            imagedestroy($src_image);
            $src_image = $resized_image;
            
            // 정보 업데이트
            $image_info[0] = $new_width;
            $image_info[1] = $new_height;
        }

        // WebP 저장
        if (function_exists('imagewebp')) {
            $conversion_success = @imagewebp($src_image, $save_filepath, $webp_quality);
        }
        imagedestroy($src_image);
    }

    if ($conversion_success) {
        @chmod($save_filepath, T2EDITOR_FILE_PERMISSION);
        $uploaded_files[] = [
            'url' => $upload_url . '/' . $save_filename,
            'width' => $image_info[0],
            'height' => $image_info[1]
        ];
        @unlink($temp_filepath); // 임시 파일 삭제
    } else {
        // WebP 변환 실패 또는 지원하지 않는 형식이면 원본 유지
        $org_save_filename = $uid . '_' . $i . '.' . $file_ext;
        $org_save_filepath = $upload_dir . '/' . $org_save_filename;

        if (@rename($temp_filepath, $org_save_filepath)) {
            @chmod($org_save_filepath, T2EDITOR_FILE_PERMISSION);
            $uploaded_files[] = [
                'url' => $upload_url . '/' . $org_save_filename,
                'width' => $image_info[0],
                'height' => $image_info[1]
            ];
        } else {
            @unlink($temp_filepath);
        }
    }
}

if (empty($uploaded_files)) {
    // 모든 처리가 끝났는데 업로드된 파일이 없다면 오류로 간주
    die(json_encode(['success' => false, 'message' => '이미지 처리 중 오류가 발생했습니다. (파일 권한 또는 서버 설정을 확인해주세요.)']));
}

echo json_encode([
    'success' => true,
    'files' => $uploaded_files
]);
?>
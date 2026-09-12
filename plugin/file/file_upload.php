<?php
//Path: T2Editor/plugin/file/file_upload.php

include_once('../../../../../common.php');
include_once('../../config/upload_config.php');

// 그누보드5 환경에서 T2EDITOR 상수 직접 정의
if (defined('_GNUBOARD_')) {
    define('T2EDITOR_PATH', G5_PLUGIN_PATH.'/editor/t2editor');
    define('T2EDITOR_URL', G5_PLUGIN_URL.'/editor/t2editor');
    define('T2EDITOR_DATA_PATH', G5_DATA_PATH.'/editor');
    define('T2EDITOR_DATA_URL', G5_DATA_URL.'/editor');
    define('T2EDITOR_DIR_PERMISSION', G5_DIR_PERMISSION);
    define('T2EDITOR_FILE_PERMISSION', G5_FILE_PERMISSION);
} else {
    // 타 환경에서만 t2_config.php 포함
    require '../../config/t2_config.php';
}

$uid = isset($_POST['uid']) ? $_POST['uid'] : '';
if (!$uid) {
    die(json_encode(['success' => false, 'message' => '잘못된 접근입니다.']));
}

// 폴더명 생성: t2editor_YYYYMMDD 형식
$folder_name = 't2editor_' . date('Ymd');
$upload_dir = T2EDITOR_DATA_PATH.'/'.$folder_name;
$upload_url = T2EDITOR_DATA_URL.'/'.$folder_name;

// 디렉토리가 없으면 생성
if (!is_dir($upload_dir)) {
    @mkdir($upload_dir, T2EDITOR_DIR_PERMISSION, true);
    @chmod($upload_dir, T2EDITOR_DIR_PERMISSION);
}

$file = $_FILES['bf_file'];

if (!isset($file) || empty($file['name'])) {
    die(json_encode(['success' => false, 'message' => '파일이 없습니다.']));
}

$filename = $file['name'];

// 통합 설정을 사용한 파일 검증
// 이미지를 제외한 모든 카테고리 허용 (이미지는 이미지 플러그인에서 처리)
$allowed_categories = array('document', 'video', 'other');
$validation_result = validate_upload_file($filename, $file['size'], $allowed_categories);

if (!$validation_result['success']) {
    die(json_encode(['success' => false, 'message' => $validation_result['message']]));
}

$file_ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
$save_filename = $uid.'_'.time().'.'.$file_ext;
$save_filepath = $upload_dir.'/'.$save_filename;

if (move_uploaded_file($file['tmp_name'], $save_filepath)) {
    @chmod($save_filepath, T2EDITOR_FILE_PERMISSION);
    
    die(json_encode([
        'success' => true,
        'file' => [
            'url' => $upload_url.'/'.$save_filename,
            'original_name' => $filename,
            'size' => $file['size'],
            'type' => $file_ext
        ]
    ]));
} else {
    die(json_encode(['success' => false, 'message' => '파일 업로드에 실패했습니다.']));
}
?>
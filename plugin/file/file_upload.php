<?php
//Path: T2Editor/plugin/file/file_upload.php

// [FILEU-06] 출력 버퍼링 시작
ob_start();

function send_json_response(array $data): void {
    ob_clean();
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// ── include 경로 분기 ─────────────────────────────────────────────────────
// upload_config.php 에 check_request_origin(), sanitize_original_name(),
// verify_file_magic_bytes(), 강화된 validate_upload_file() 이 모두 정의됨.
// 이 파일에서 직접 정의하던 중복 함수들을 제거하고 공통 파일에서 가져온다.
// ──────────────────────────────────────────────────────────────────────────
$common_path = __DIR__ . '/../../../../../common.php';
if (is_file($common_path)) {
    include_once $common_path;
}

include_once __DIR__ . '/../../config/upload_config.php';

if (defined('_GNUBOARD_')) {
    if (!defined('T2EDITOR_PATH')) {
        define('T2EDITOR_PATH',              G5_PLUGIN_PATH . '/editor/t2editor');
        define('T2EDITOR_URL',               G5_PLUGIN_URL  . '/editor/t2editor');
        define('T2EDITOR_DATA_PATH',         G5_DATA_PATH   . '/editor');
        define('T2EDITOR_DATA_URL',          G5_DATA_URL    . '/editor');
        define('T2EDITOR_DIR_PERMISSION',    G5_DIR_PERMISSION);
        define('T2EDITOR_FILE_PERMISSION',   G5_FILE_PERMISSION);
    }
} else {
    require __DIR__ . '/../../config/t2_config.php';
}

// Origin 검증 — upload_config.php 의 check_request_origin() 사용
if (!check_request_origin()) {
    send_json_response(['success' => false, 'message' => '잘못된 접근입니다.']);
}

// ── uid 정제 ──────────────────────────────────────────────────────────────
// [FIX] 이전 코드는 uid 가 빈 문자열이거나 길이·문자 검증에 실패하면
//        업로드를 즉시 거부했다. 그러나 uid 는 서버 내부 어디에도 저장·사용되지
//        않는 단순 세션 식별 힌트에 불과하다.
//
//        일부 브라우저·환경에서 FormData 전달 타이밍 차이로 uid 가 비어있거나
//        예상치 못한 값으로 수신될 수 있으므로, 검증 실패 시 업로드를 차단하는
//        대신 서버에서 타임스탬프로 대체한다.
//
//        허용 문자: 영문 대소문자, 숫자, 하이픈(-), 밑줄(_)
//        최대 길이: 64자 (초과 시 잘라냄)
//        빈 문자열·전부 제거된 경우: time() 으로 대체
// ──────────────────────────────────────────────────────────────────────────
$raw_uid = isset($_POST['uid']) ? $_POST['uid'] : '';
$uid     = preg_replace('/[^a-zA-Z0-9_\-]/', '', $raw_uid);
if (!$uid) {
    // uid 가 없거나 허용 문자가 하나도 없는 경우 → 서버 타임스탬프로 대체
    $uid = (string)time();
} elseif (strlen($uid) > 64) {
    // 과도하게 긴 uid → 앞 64자로 잘라서 사용 (업로드 차단 안함)
    $uid = substr($uid, 0, 64);
}

// 업로드 경로
$folder_name = 't2editor_' . date('Ymd');
$upload_dir  = T2EDITOR_DATA_PATH . '/' . $folder_name;
$upload_url  = T2EDITOR_DATA_URL  . '/' . $folder_name;

if (!is_dir($upload_dir)) {
    @mkdir($upload_dir, T2EDITOR_DIR_PERMISSION, true);
    @chmod($upload_dir, T2EDITOR_DIR_PERMISSION);
}

if (!isset($_FILES['bf_file']) || empty($_FILES['bf_file']['name'])) {
    send_json_response(['success' => false, 'message' => '파일이 없습니다.']);
}

// PHP 업로드 에러 코드
$upload_error_messages = [
    UPLOAD_ERR_INI_SIZE   => '파일이 서버 허용 크기를 초과합니다.',
    UPLOAD_ERR_FORM_SIZE  => '파일이 폼 허용 크기를 초과합니다.',
    UPLOAD_ERR_PARTIAL    => '파일이 일부만 업로드되었습니다.',
    UPLOAD_ERR_NO_FILE    => '파일이 없습니다.',
    UPLOAD_ERR_NO_TMP_DIR => '임시 디렉터리를 찾을 수 없습니다.',
    UPLOAD_ERR_CANT_WRITE => '파일 저장에 실패했습니다.',
    UPLOAD_ERR_EXTENSION  => '확장 프로그램이 업로드를 중단했습니다.',
];
$upload_err_code = $_FILES['bf_file']['error'];
if ($upload_err_code !== UPLOAD_ERR_OK) {
    $err_msg = $upload_error_messages[$upload_err_code] ?? '파일 업로드 중 오류가 발생했습니다.';
    send_json_response(['success' => false, 'message' => $err_msg]);
}

$file     = $_FILES['bf_file'];
$tmp_path = $file['tmp_name'];

// 파일명 정제 — upload_config.php 의 sanitize_original_name() 사용
$filename = sanitize_original_name($file['name']);
$file_ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));

// ── 통합 검증 ────────────────────────────────────────────────────────────
// validate_upload_file()에 $tmp_path 를 전달해 4단계 전체를 실행한다.
//   1) 확장자 — allowlist 대조
//   2) 크기   — T2EDITOR_MAX_UPLOAD_SIZE 이내
//   3) MIME   — finfo 기반 (octet-stream 은 매직바이트로 위임)
//   4) 매직바이트 — verify_file_magic_bytes()
//
// [개선] upload_config.php 의 MIME 맵에 비디오 포맷별 실제 반환값(video/quicktime 등)이
//        추가되어 iOS 촬영 mp4 등 다양한 비디오 파일이 정상 업로드된다.
// ──────────────────────────────────────────────────────────────────────────
$allowed_categories = ['document', 'video', 'other'];
$validation_result  = validate_upload_file($filename, $file['size'], $allowed_categories, $tmp_path);

if (!$validation_result['success']) {
    send_json_response(['success' => false, 'message' => $validation_result['message']]);
}

// 예측 불가능한 저장 파일명
$save_filename = bin2hex(random_bytes(16)) . '.' . $file_ext;
$save_filepath = $upload_dir . '/' . $save_filename;

if (move_uploaded_file($tmp_path, $save_filepath)) {
    @chmod($save_filepath, T2EDITOR_FILE_PERMISSION);
    send_json_response([
        'success' => true,
        'file'    => [
            'url'           => $upload_url . '/' . $save_filename,
            'original_name' => $filename,
            'size'          => $file['size'],
            'type'          => $file_ext,
        ],
    ]);
} else {
    send_json_response(['success' => false, 'message' => '파일 업로드에 실패했습니다.']);
}
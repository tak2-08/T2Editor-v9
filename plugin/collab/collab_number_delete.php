<?php
// Path: T2Editor/plugin/collab/collab_number_delete.php

if (session_id()) {
    session_write_close();
}

set_time_limit(0);

if (ob_get_level()) {
    ob_end_clean();
}

// [PATCH-1] HTTP 메서드 강제: POST만 허용
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success'=>false,'error'=>'method_not_allowed']);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');

// [PATCH-2] CORS 와일드카드 제거 — sendBeacon/fetch keepalive는 same-origin 요청이므로 불필요
// 외부 도메인에서의 방 삭제 요청을 원천 차단
// (필요 시 아래 주석을 해제하여 특정 도메인만 허용)
// $allowed_origin = 'https://your-domain.com';
// if (isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] === $allowed_origin) {
//     header('Access-Control-Allow-Origin: ' . $allowed_origin);
// }

ignore_user_abort(true);

if (!defined('T2EDITOR_PATH')) {
    $possible = __DIR__ . '/../../config/t2_config.php';
    if (file_exists($possible)) {
        include_once $possible;
    }
}
if (!defined('T2EDITOR_PATH')) {
    define('T2EDITOR_PATH', realpath(__DIR__ . '/../..'));
}

// [PATCH-3] 요청 바디 크기 제한 (4KB — 삭제 요청은 소량)
$raw = file_get_contents('php://input', false, null, 0, 4096 + 1);
if ($raw === false || strlen($raw) > 4096) {
    http_response_code(413);
    echo json_encode(['success'=>false,'error'=>'payload_too_large']);
    exit;
}
$input = json_decode($raw, true);
if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['success'=>false,'error'=>'invalid_json']);
    exit;
}

// 협업 환경 검증 수행
$verification = include __DIR__ . '/collab_verification.php';
if (!$verification['success']) {
    echo json_encode(['success' => false, 'error' => 'collab_environment_failed', 'detail' => $verification['error']]);
    exit;
}

function quickResponse($success, $error = '') {
    echo json_encode(['success' => $success, 'error' => $error]);
    if (ob_get_level()) ob_flush();
    flush();
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }
}

function code_to_paths($code) {
    $collab_dir = rtrim(T2EDITOR_PATH, '/\\') . '/collab';
    $code = preg_replace('/[^a-zA-Z0-9_-]/', '', $code);
    $base = $collab_dir . '/collab' . $code;
    return [
        'meta'         => $base . '_meta.json',
        'content'      => $base . '_content.json',
        'users'        => $base . '_users.json',
        'ops'          => $base . '_ops.json',
        'client_ops'   => $base . '_client_ops.json',
        'meta_lock'    => $base . '_meta.json.lock',
        'content_lock' => $base . '_content.json.lock',
        'users_lock'   => $base . '_users.json.lock',
        'ops_lock'     => $base . '_ops.json.lock',
        'client_ops_lock' => $base . '_client_ops.json.lock'
    ];
}

$code       = $input['code'] ?? '';
$host_token = $input['host_token'] ?? '';

if ($code === '' || $host_token === '') {
    quickResponse(false, 'invalid_params');
    exit;
}

$paths = code_to_paths($code);

if (!file_exists($paths['meta'])) {
    quickResponse(false, 'no_room');
    exit;
}

$json = @file_get_contents($paths['meta']);
if ($json === false) {
    quickResponse(false, 'read_failed');
    exit;
}

$data = json_decode($json, true);

// [PATCH-4] hash_equals()로 타이밍 공격 방지 (단순 !== 비교 대신)
if (!is_array($data) || !isset($data['host_token']) || !hash_equals($data['host_token'], $host_token)) {
    quickResponse(false, 'unauthorized');
    exit;
}

$maxRetries  = 3;
$retryDelay  = 100000; // 0.1초
$all_deleted = true;

$file_types = ['meta','content','users','ops','client_ops','meta_lock','content_lock','users_lock','ops_lock','client_ops_lock'];

foreach ($file_types as $type) {
    if (!isset($paths[$type])) continue;
    $file_path = $paths[$type];

    if (!file_exists($file_path)) continue;

    $deleted = false;
    for ($i = 0; $i < $maxRetries; $i++) {
        if (@unlink($file_path)) {
            $deleted = true;
            break;
        }
        if ($i < $maxRetries - 1) usleep($retryDelay);
    }

    if (!$deleted && file_exists($file_path)) {
        error_log("Failed to delete file: $file_path");
        $all_deleted = false;
    }
}

if ($all_deleted) {
    quickResponse(true);
} else {
    quickResponse(false, 'delete_failed');
}

exit;
?>
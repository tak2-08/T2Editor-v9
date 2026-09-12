<?php
// Path: T2Editor/plugin/collab/collab_number_delete.php

if (session_id()) {
    session_write_close();
}

set_time_limit(0);

if (ob_get_level()) {
    ob_end_clean();
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

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

// 협업 환경 검증 수행
$verification = include __DIR__ . '/collab_verification.php';
if (!$verification['success']) {
    echo json_encode(['success' => false, 'error' => 'collab_environment_failed', 'detail' => $verification['error']]);
    exit;
}

function quickResponse($success, $error = '') {
    echo json_encode(['success' => $success, 'error' => $error]);
    
    if (ob_get_level()) {
        ob_flush();
    }
    flush();
    
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }
}

function code_to_paths($code) {
    $collab_dir = rtrim(T2EDITOR_PATH, '/\\') . '/collab';
    $code = preg_replace('/[^a-zA-Z0-9_-]/','',$code);
    
    return [
        'meta' => $collab_dir . '/collab' . $code . '_meta.json',
        'content' => $collab_dir . '/collab' . $code . '_content.json',
        'users' => $collab_dir . '/collab' . $code . '_users.json',
        'ops' => $collab_dir . '/collab' . $code . '_ops.json',
        'meta_lock' => $collab_dir . '/collab' . $code . '_meta.json.lock',
        'content_lock' => $collab_dir . '/collab' . $code . '_content.json.lock',
        'users_lock' => $collab_dir . '/collab' . $code . '_users.json.lock',
        'ops_lock' => $collab_dir . '/collab' . $code . '_ops.json.lock'
    ];
}

$input = json_decode(file_get_contents('php://input'), true);
$code = $input['code'] ?? '';
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
if (!is_array($data) || !isset($data['host_token']) || $data['host_token'] !== $host_token) {
    quickResponse(false, 'unauthorized');
    exit;
}

$maxRetries = 3;
$retryDelay = 100000; // 0.1초
$all_deleted = true;

$file_types = ['meta', 'content', 'users', 'ops', 'meta_lock', 'content_lock', 'users_lock', 'ops_lock'];

foreach ($file_types as $type) {
    $file_path = $paths[$type];
    
    if (!file_exists($file_path)) {
        continue;
    }
    
    $deleted = false;
    for ($i = 0; $i < $maxRetries; $i++) {
        if (@unlink($file_path)) {
            $deleted = true;
            break;
        }
        
        if ($i < $maxRetries - 1) {
            usleep($retryDelay);
        }
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
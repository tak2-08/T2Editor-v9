<?php
// Path: T2Editor/plugin/collab/collab_number.php

if (!defined('T2EDITOR_PATH')) {
    $possible = __DIR__ . '/../../config/t2_config.php';
    if (file_exists($possible)) include_once $possible;
}
if (!defined('T2EDITOR_PATH')) {
    define('T2EDITOR_PATH', realpath(__DIR__ . '/../..'));
}

header('Content-Type: application/json; charset=utf-8');

// 협업 환경 검증 수행
$verification = include __DIR__ . '/collab_verification.php';
if (!$verification['success']) {
    http_response_code(500);
    echo json_encode(['success'=>false,'error'=>'collab_environment_failed', 'detail'=>$verification['error']]);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$action = $input['action'] ?? 'create';

$collab_dir = T2EDITOR_PATH . '/collab';

function now_ts() { return date('c'); }
function now_micro() { return microtime(true); }

function code_to_path($code, $type = 'meta') {
    global $collab_dir;
    $code = preg_replace('/[^a-zA-Z0-9_-]/', '', $code);
    return $collab_dir . '/collab' . $code . '_' . $type . '.json';
}

function safe_write_json($file, $data, $max_retries = 5) {
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json === false) {
        error_log("[Collab] JSON encoding failed for file: $file - " . json_last_error_msg());
        return false;
    }
    
    $retry = 0;
    while ($retry < $max_retries) {
        $tmp = $file . '.tmp.' . uniqid(mt_rand(), true);
        
        $oldmask = umask(0);
        $bytes = @file_put_contents($tmp, $json, LOCK_EX);
        umask($oldmask);
        
        if ($bytes === false) {
            error_log("[Collab] Failed to write temp file: $tmp (attempt $retry)");
            $retry++;
            usleep(50000);
            continue;
        }
        
        $oldmask = umask(0);
        @chmod($tmp, 0666);
        umask($oldmask);
        
        if (!@rename($tmp, $file)) {
            error_log("[Collab] Failed to rename $tmp to $file (attempt $retry)");
            @unlink($tmp);
            $retry++;
            usleep(50000);
            continue;
        }
        
        $oldmask = umask(0);
        @chmod($file, 0666);
        umask($oldmask);
        
        return true;
    }
    
    return false;
}

function safe_read_json($file, $default = null, $max_retries = 3) {
    $retry = 0;
    while ($retry < $max_retries) {
        if (!file_exists($file)) {
            return $default;
        }
        
        $json = @file_get_contents($file);
        if ($json === false) {
            $retry++;
            usleep(20000);
            continue;
        }
        
        $data = json_decode($json, true);
        if (!is_array($data)) {
            $retry++;
            usleep(20000);
            continue;
        }
        
        return $data;
    }
    
    return $default;
}

function atomic_update_file($file, callable $update_func, $default = []) {
    $lock_file = $file . '.lock';
    $fp = @fopen($lock_file, 'c+');
    
    if (!$fp) {
        error_log("[Collab] Failed to create lock file: $lock_file");
        return false;
    }
    
    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        error_log("[Collab] Failed to acquire lock: $lock_file");
        return false;
    }
    
    try {
        $data = safe_read_json($file, $default);
        $updated_data = $update_func($data);
        
        if ($updated_data === false) {
            flock($fp, LOCK_UN);
            fclose($fp);
            return false;
        }
        
        $result = safe_write_json($file, $updated_data);
        
        flock($fp, LOCK_UN);
        fclose($fp);
        @unlink($lock_file);
        
        return $result ? $updated_data : false;
    } catch (Exception $e) {
        error_log("[Collab] Error in atomic_update_file: " . $e->getMessage());
        flock($fp, LOCK_UN);
        fclose($fp);
        @unlink($lock_file);
        return false;
    }
}

function generate_room_code() {
    global $collab_dir;
    $tries = 0;
    do {
        try { 
            $code = str_pad(random_int(100000, 999999), 6, '0', STR_PAD_LEFT) . substr(bin2hex(random_bytes(2)), 0, 2); 
        } catch (Exception $e) { 
            $code = str_pad(mt_rand(100000,999999), 6, '0', STR_PAD_LEFT) . substr(md5(uniqid(mt_rand(), true)), 0, 2); 
        }
        
        $meta_path = code_to_path($code, 'meta');
        $tries++; 
        if ($tries > 20) break;
    } while (file_exists($meta_path));
    return $code;
}

function room_exists($code) {
    $meta_path = code_to_path($code, 'meta');
    return file_exists($meta_path);
}

function load_room_data($code) {
    $meta = safe_read_json(code_to_path($code, 'meta'));
    $content = safe_read_json(code_to_path($code, 'content'), ['content'=>'','version'=>0, 'domState'=>[], 'last_update_time'=>0]);
    $users = safe_read_json(code_to_path($code, 'users'), ['users'=>[]]);
    $client_ops = safe_read_json(code_to_path($code, 'client_ops'), ['client_ops'=>[]]);
    
    if (!$meta) return null;
    
    return [
        'code' => $code,
        'host_token' => $meta['host_token'] ?? '',
        'created_at' => $meta['created_at'] ?? '',
        'updated_at' => $meta['updated_at'] ?? '',
        'content' => $content['content'] ?? '',
        'domState' => $content['domState'] ?? [],
        'version' => $content['version'] ?? 0,
        'last_update_time' => $content['last_update_time'] ?? 0,
        'users' => $users['users'] ?? [],
        'client_ops' => $client_ops['client_ops'] ?? []
    ];
}

// 실제 변경 감지 함수
function has_real_change($prev_content, $curr_content, $prev_dom_state, $curr_dom_state) {
    if ($prev_content === null || $curr_content === null) return true;
    
    // HTML 정규화
    $prev_norm = preg_replace('/<p>\s*<\/p>/', '<p><br></p>', $prev_content);
    $prev_norm = preg_replace('/\s+/', ' ', $prev_norm);
    $prev_norm = trim($prev_norm);
    
    $curr_norm = preg_replace('/<p>\s*<\/p>/', '<p><br></p>', $curr_content);
    $curr_norm = preg_replace('/\s+/', ' ', $curr_norm);
    $curr_norm = trim($curr_norm);
    
    if ($prev_norm !== $curr_norm) return true;
    
    // DOM 상태 비교
    $prev_dom_json = json_encode($prev_dom_state ?? []);
    $curr_dom_json = json_encode($curr_dom_state ?? []);
    
    return $prev_dom_json !== $curr_dom_json;
}

switch ($action) {

    case 'create':
        $code = generate_room_code();
        
        try {
            $host_token = bin2hex(random_bytes(16));
        } catch (Exception $e) {
            $host_token = md5(uniqid(mt_rand(), true));
        }
        
        $meta_data = [
            'code' => $code,
            'host_token' => $host_token,
            'created_at' => now_ts(),
            'updated_at' => now_ts()
        ];
        
        $content_data = [
            'content' => '',
            'domState' => [],
            'version' => 0,
            'last_update_time' => now_micro()
        ];
        
        $users_data = [
            'users' => []
        ];
        
        $client_ops_data = [
            'client_ops' => []
        ];
        
        $meta_path = code_to_path($code, 'meta');
        $content_path = code_to_path($code, 'content');
        $users_path = code_to_path($code, 'users');
        $client_ops_path = code_to_path($code, 'client_ops');
        
        if (!safe_write_json($meta_path, $meta_data)) {
            error_log("[Collab] Failed to create meta file: $meta_path");
            http_response_code(500); 
            echo json_encode(['success'=>false,'error'=>'meta_creation_failed']); 
            exit;
        }
        
        if (!safe_write_json($content_path, $content_data)) {
            @unlink($meta_path);
            error_log("[Collab] Failed to create content file: $content_path");
            http_response_code(500); 
            echo json_encode(['success'=>false,'error'=>'content_creation_failed']); 
            exit;
        }
        
        if (!safe_write_json($users_path, $users_data)) {
            @unlink($meta_path);
            @unlink($content_path);
            error_log("[Collab] Failed to create users file: $users_path");
            http_response_code(500); 
            echo json_encode(['success'=>false,'error'=>'users_creation_failed']); 
            exit;
        }
        
        if (!safe_write_json($client_ops_path, $client_ops_data)) {
            @unlink($meta_path);
            @unlink($content_path);
            @unlink($users_path);
            error_log("[Collab] Failed to create client_ops file: $client_ops_path");
            http_response_code(500); 
            echo json_encode(['success'=>false,'error'=>'client_ops_creation_failed']); 
            exit;
        }
        
        error_log("[Collab] Room created: $code");
        echo json_encode(['success'=>true,'code'=>$code,'host_token'=>$host_token]); 
        exit;

    case 'exists':
        $code = $input['code'] ?? '';
        if ($code === '') { 
            echo json_encode(['success'=>false]); 
            exit; 
        }
        echo json_encode(['success'=>room_exists($code)]); 
        exit;

    case 'get':
        $code = $input['code'] ?? '';
        $client_id = trim($input['client_id'] ?? '');
        $since_version = isset($input['since_version']) ? intval($input['since_version']) : null;
        
        if ($code === '') { 
            echo json_encode(['success'=>false,'error'=>'no_code']); 
            exit; 
        }
        
        if (!room_exists($code)) { 
            echo json_encode(['success'=>false,'error'=>'no_room']); 
            exit; 
        }
        
        $data = load_room_data($code);
        if ($data === null) { 
            echo json_encode(['success'=>false,'error'=>'load_failed']); 
            exit; 
        }

        if ($since_version !== null && $data['version'] <= $since_version) {
            // 버전 변경 없음
            echo json_encode([
                'success'=>true,
                'has_updates'=>false,
                'data'=>[
                    'version'=>$data['version'],
                    'users'=>$data['users']
                ]
            ]);
            exit;
        }
        
        echo json_encode([
            'success'=>true,
            'has_updates'=>true,
            'data'=>[
                'version'=>$data['version'],
                'content'=>$data['content'],
                'domState'=>$data['domState'],
                'users'=>$data['users']
            ]
        ]);
        exit;

    case 'join':
        $code = $input['code'] ?? '';
        $client_id = trim($input['client_id'] ?? '');
        $nickname = trim($input['nickname'] ?? '익명');
        
        if ($code === '' || $client_id === '') {
            echo json_encode(['success'=>false,'error'=>'invalid_params']);
            exit;
        }
        
        if (!room_exists($code)) {
            echo json_encode(['success'=>false,'error'=>'no_room']);
            exit;
        }
        
        $users_path = code_to_path($code, 'users');
        
        $result = atomic_update_file($users_path, function($data) use ($client_id, $nickname, $code) {
            if (!isset($data['users'])) $data['users'] = [];
            
            $meta = safe_read_json(code_to_path($code, 'meta'));
            $is_host = count($data['users']) === 0;
            $host_token = $is_host ? ($meta['host_token'] ?? '') : null;
            
            $existing = false;
            foreach ($data['users'] as &$u) {
                if (($u['client_id'] ?? '') === $client_id) {
                    $u['nickname'] = $nickname;
                    $u['joined_at'] = now_ts();
                    $existing = true;
                    break;
                }
            }
            
            if (!$existing) {
                $data['users'][] = [
                    'client_id'=>$client_id,
                    'nickname'=>$nickname,
                    'joined_at'=>now_ts(),
                    'isHost'=>$is_host
                ];
            }
            
            $data['is_host'] = $is_host;
            $data['host_token'] = $host_token;
            
            return $data;
        }, ['users'=>[]]);
        
        if ($result === false) {
            echo json_encode(['success'=>false,'error'=>'join_failed']);
            exit;
        }
        
        // 클라이언트 operation 추적 초기화
        $client_ops_path = code_to_path($code, 'client_ops');
        atomic_update_file($client_ops_path, function($data) use ($client_id) {
            if (!isset($data['client_ops'])) $data['client_ops'] = [];
            
            $found = false;
            foreach ($data['client_ops'] as &$op) {
                if ($op['client_id'] === $client_id) {
                    $op['last_timestamp'] = now_micro();
                    $found = true;
                    break;
                }
            }
            
            if (!$found) {
                $data['client_ops'][] = [
                    'client_id' => $client_id,
                    'last_timestamp' => now_micro()
                ];
            }
            
            return $data;
        }, ['client_ops'=>[]]);
        
        $meta_path = code_to_path($code, 'meta');
        atomic_update_file($meta_path, function($data) {
            $data['updated_at'] = now_ts();
            return $data;
        });
        
        $room_data = load_room_data($code);
        
        error_log("[Collab] Client joined: $client_id to room: $code");
        
        echo json_encode([
            'success'=>true,
            'is_host'=>$result['is_host'] ?? false,
            'host_token'=>$result['host_token'] ?? null,
            'data'=>[
                'version'=>$room_data['version'],
                'content'=>$room_data['content'],
                'domState'=>$room_data['domState'],
                'users'=>$room_data['users']
            ]
        ]);
        exit;

    case 'leave':
        $code = $input['code'] ?? '';
        $client_id = trim($input['client_id'] ?? '');
        
        if ($code === '' || $client_id === '') {
            echo json_encode(['success'=>false,'error'=>'invalid_params']);
            exit;
        }
        
        if (!room_exists($code)) {
            echo json_encode(['success'=>false,'error'=>'no_room']);
            exit;
        }
        
        $users_path = code_to_path($code, 'users');
        
        $result = atomic_update_file($users_path, function($data) use ($client_id) {
            if (!isset($data['users'])) $data['users'] = [];
            
            $newUsers = [];
            foreach ($data['users'] as $u) {
                if (($u['client_id'] ?? '') === $client_id) continue;
                $newUsers[] = $u;
            }
            $data['users'] = $newUsers;
            
            return $data;
        }, ['users'=>[]]);
        
        if ($result === false) {
            echo json_encode(['success'=>false,'error'=>'leave_failed']);
            exit;
        }
        
        // 클라이언트 operation 추적 제거
        $client_ops_path = code_to_path($code, 'client_ops');
        atomic_update_file($client_ops_path, function($data) use ($client_id) {
            if (!isset($data['client_ops'])) $data['client_ops'] = [];
            
            $newOps = [];
            foreach ($data['client_ops'] as $op) {
                if ($op['client_id'] !== $client_id) {
                    $newOps[] = $op;
                }
            }
            $data['client_ops'] = $newOps;
            
            return $data;
        }, ['client_ops'=>[]]);
        
        $meta_path = code_to_path($code, 'meta');
        atomic_update_file($meta_path, function($data) {
            $data['updated_at'] = now_ts();
            return $data;
        });
        
        error_log("[Collab] Client left: $client_id from room: $code");
        
        echo json_encode(['success'=>true]);
        exit;

    case 'stop':
        $code = $input['code'] ?? '';
        $host_token = $input['host_token'] ?? '';
        
        if ($code === '' || $host_token === '') {
            echo json_encode(['success'=>false,'error'=>'invalid_params']);
            exit;
        }
        
        if (!room_exists($code)) {
            echo json_encode(['success'=>false,'error'=>'no_room']);
            exit;
        }
        
        $meta = safe_read_json(code_to_path($code, 'meta'));
        if (!$meta || !isset($meta['host_token']) || $meta['host_token'] !== $host_token) {
            echo json_encode(['success'=>false,'error'=>'unauthorized']);
            exit;
        }
        
        $meta_path = code_to_path($code, 'meta');
        $content_path = code_to_path($code, 'content');
        $users_path = code_to_path($code, 'users');
        $client_ops_path = code_to_path($code, 'client_ops');
        
        @unlink($meta_path);
        @unlink($content_path);
        @unlink($users_path);
        @unlink($client_ops_path);
        
        @unlink($meta_path . '.lock');
        @unlink($content_path . '.lock');
        @unlink($users_path . '.lock');
        @unlink($client_ops_path . '.lock');
        
        error_log("[Collab] Room stopped: $code");
        
        echo json_encode(['success'=>true]);
        exit;

    case 'update':
        $code = $input['code'] ?? '';
        $client_id = trim($input['client_id'] ?? '');
        $version = isset($input['version']) ? intval($input['version']) : 0;
        $operation = $input['operation'] ?? null;
        
        if ($code === '' || $client_id === '' || !is_array($operation)) {
            echo json_encode(['success'=>false,'error'=>'invalid_params']);
            exit;
        }
        
        if (!room_exists($code)) {
            echo json_encode(['success'=>false,'error'=>'no_room']);
            exit;
        }
        
        $users = safe_read_json(code_to_path($code, 'users'), ['users'=>[]]);
        $meta = safe_read_json(code_to_path($code, 'meta'));
        
        $allowed = false;
        if (isset($input['host_token']) && isset($meta['host_token']) && $input['host_token'] === $meta['host_token']) {
            $allowed = true;
        }
        foreach ($users['users'] as $u) {
            if (isset($u['client_id']) && $u['client_id'] === $client_id) {
                $allowed = true;
                break;
            }
        }
        
        if (!$allowed) {
            echo json_encode(['success'=>false,'error'=>'not_allowed']);
            exit;
        }
        
        $content_path = code_to_path($code, 'content');
        $client_ops_path = code_to_path($code, 'client_ops');
        
        $operation_timestamp = isset($operation['timestamp']) ? strtotime($operation['timestamp']) : now_micro();
        
        // 클라이언트별 operation 추적 업데이트
        $client_ops_result = atomic_update_file($client_ops_path, function($data) use ($client_id, $operation_timestamp) {
            if (!isset($data['client_ops'])) $data['client_ops'] = [];
            
            $found = false;
            foreach ($data['client_ops'] as &$op) {
                if ($op['client_id'] === $client_id) {
                    $op['last_timestamp'] = $operation_timestamp;
                    $found = true;
                    break;
                }
            }
            
            if (!$found) {
                $data['client_ops'][] = [
                    'client_id' => $client_id,
                    'last_timestamp' => $operation_timestamp
                ];
            }
            
            return $data;
        }, ['client_ops'=>[]]);
        
        $result = atomic_update_file($content_path, function($data) use ($version, $operation, $client_id, $operation_timestamp) {
            $current_version = isset($data['version']) ? intval($data['version']) : 0;
            $current_content = $data['content'] ?? '';
            $current_dom_state = $data['domState'] ?? [];
            $last_update_time = $data['last_update_time'] ?? 0;
            
            // 버전 충돌 감지
            if ($version < $current_version) {
                // 타임스탬프 비교로 실제 변경 여부 판단
                $time_diff = $operation_timestamp - $last_update_time;
                
                // 실제 변경이 있는지 확인
                $new_content = $operation['content'] ?? '';
                $new_dom_state = $operation['domState'] ?? [];
                
                $has_change = has_real_change($current_content, $new_content, $current_dom_state, $new_dom_state);
                
                if (!$has_change) {
                    // 변경 없음, 버전만 동기화
                    error_log("[Collab] No real change detected from client: $client_id");
                    return [
                        'no_change' => true,
                        'current_version' => $current_version
                    ];
                }
                
                // 실제 충돌 - 타임스탬프 비교
                if ($operation_timestamp > $last_update_time) {
                    // 이 operation이 더 최신
                    error_log("[Collab] Accepting newer operation from client: $client_id (timestamp: $operation_timestamp > $last_update_time)");
                } else {
                    // 서버의 것이 더 최신
                    error_log("[Collab] Conflict: server version is newer (timestamp: $last_update_time > $operation_timestamp)");
                    return [
                        'conflict' => true,
                        'current_version' => $current_version,
                        'current_content' => $current_content,
                        'current_dom_state' => $current_dom_state
                    ];
                }
            }
            
            // operation 적용
            if ($operation['type'] === 'full') {
                $newContent = $operation['content'] ?? '';
                $newDOMState = $operation['domState'] ?? [];
                
                // 실제 변경이 있는지 확인
                if (has_real_change($current_content, $newContent, $current_dom_state, $newDOMState)) {
                    $data['content'] = $newContent;
                    $data['domState'] = $newDOMState;
                    $data['version'] = $current_version + 1;
                    $data['last_update_time'] = $operation_timestamp;
                    
                    error_log("[Collab] Content updated by client: $client_id, new version: " . $data['version']);
                } else {
                    error_log("[Collab] No real change from client: $client_id");
                    return [
                        'no_change' => true,
                        'current_version' => $current_version
                    ];
                }
            }
            
            return $data;
        }, ['content'=>'','domState'=>[],'version'=>0,'last_update_time'=>0]);
        
        if ($result === false) {
            echo json_encode(['success'=>false,'error'=>'update_failed']);
            exit;
        }
        
        if (isset($result['no_change']) && $result['no_change']) {
            echo json_encode([
                'success'=>true,
                'no_change'=>true,
                'new_version'=>$result['current_version']
            ]);
            exit;
        }
        
        if (isset($result['conflict']) && $result['conflict']) {
            error_log("[Collab] Sending conflict response to client: $client_id");
            echo json_encode([
                'success'=>false,
                'conflict'=>true,
                'current_version'=>$result['current_version'],
                'current_content'=>$result['current_content'],
                'current_dom_state'=>$result['current_dom_state']
            ]);
            exit;
        }
        
        $meta_path = code_to_path($code, 'meta');
        atomic_update_file($meta_path, function($data) {
            $data['updated_at'] = now_ts();
            return $data;
        });
        
        echo json_encode([
            'success'=>true,
            'new_version'=>$result['version'] ?? 0
        ]);
        exit;

    case 'kick':
        $code = $input['code'] ?? '';
        $target_client_id = trim($input['target_client_id'] ?? '');
        $host_token = $input['host_token'] ?? '';
        
        if ($code === '' || $target_client_id === '' || $host_token === '') {
            echo json_encode(['success'=>false,'error'=>'invalid_params']);
            exit;
        }
        
        if (!room_exists($code)) {
            echo json_encode(['success'=>false,'error'=>'no_room']);
            exit;
        }
        
        $meta = safe_read_json(code_to_path($code, 'meta'));
        if (!$meta || !isset($meta['host_token']) || $meta['host_token'] !== $host_token) {
            echo json_encode(['success'=>false,'error'=>'unauthorized']);
            exit;
        }
        
        $users_path = code_to_path($code, 'users');
        
        $result = atomic_update_file($users_path, function($data) use ($target_client_id) {
            if (!isset($data['users'])) $data['users'] = [];
            
            $newUsers = [];
            foreach ($data['users'] as $u) {
                if (($u['client_id'] ?? '') === $target_client_id) continue;
                $newUsers[] = $u;
            }
            $data['users'] = $newUsers;
            
            return $data;
        }, ['users'=>[]]);
        
        if ($result === false) {
            echo json_encode(['success'=>false,'error'=>'kick_failed']);
            exit;
        }
        
        // 클라이언트 operation 추적 제거
        $client_ops_path = code_to_path($code, 'client_ops');
        atomic_update_file($client_ops_path, function($data) use ($target_client_id) {
            if (!isset($data['client_ops'])) $data['client_ops'] = [];
            
            $newOps = [];
            foreach ($data['client_ops'] as $op) {
                if ($op['client_id'] !== $target_client_id) {
                    $newOps[] = $op;
                }
            }
            $data['client_ops'] = $newOps;
            
            return $data;
        }, ['client_ops'=>[]]);
        
        $meta_path = code_to_path($code, 'meta');
        atomic_update_file($meta_path, function($data) {
            $data['updated_at'] = now_ts();
            return $data;
        });
        
        error_log("[Collab] Client kicked: $target_client_id from room: $code");
        
        echo json_encode(['success'=>true]);
        exit;

    default:
        echo json_encode(['success'=>false,'error'=>'invalid_action']);
        exit;
}

@chmod(__FILE__, 0644);
?>
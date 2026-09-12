<?php
// Path: T2Editor/plugin/collab/collab_number.php

// [PATCH-1] HTTP 메서드 강제: POST만 허용
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success'=>false,'error'=>'method_not_allowed']);
    exit;
}

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

// [PATCH-2] 요청 바디 크기 제한 (2MB)
$MAX_INPUT_SIZE = 2 * 1024 * 1024;
$raw = file_get_contents('php://input', false, null, 0, $MAX_INPUT_SIZE + 1);
if ($raw === false || strlen($raw) > $MAX_INPUT_SIZE) {
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

$action = $input['action'] ?? 'create';

// [PATCH-3] 허용 action 화이트리스트
$ALLOWED_ACTIONS = ['create','exists','get','join','leave','stop','update','kick'];
if (!in_array($action, $ALLOWED_ACTIONS, true)) {
    echo json_encode(['success'=>false,'error'=>'invalid_action']);
    exit;
}

$collab_dir = T2EDITOR_PATH . '/collab';

// [PATCH-4] 보안 상수
define('COLLAB_MAX_CONTENT_BYTES', 1 * 1024 * 1024); // 콘텐츠 최대 1MB
define('COLLAB_MAX_USERS',         50);               // 방당 최대 50명
define('COLLAB_MAX_NICKNAME_LEN',  50);               // 닉네임 최대 50자
define('COLLAB_MAX_CLIENT_ID_LEN', 64);               // client_id 최대 64자

function now_ts()    { return date('c'); }
function now_micro() { return microtime(true); }

function code_to_path($code, $type = 'meta') {
    global $collab_dir;
    $code = preg_replace('/[^a-zA-Z0-9_-]/', '', $code);
    return $collab_dir . '/collab' . $code . '_' . $type . '.json';
}

// [PATCH-5] client_id 형식 검증
function validate_client_id($client_id) {
    if (!is_string($client_id)) return false;
    $len = strlen($client_id);
    if ($len === 0 || $len > COLLAB_MAX_CLIENT_ID_LEN) return false;
    return (bool)preg_match('/^[a-zA-Z0-9\-]{8,64}$/', $client_id);
}

// [PATCH-6] 닉네임 살균 및 정규화
function sanitize_nickname($nickname) {
    if (!is_string($nickname)) return '익명';
    $nickname = trim($nickname);
    $nickname = mb_substr($nickname, 0, COLLAB_MAX_NICKNAME_LEN, 'UTF-8');
    if ($nickname === '') return '익명';
    return $nickname;
}

// [PATCH-7] HTML 콘텐츠 XSS 살균
// ※ 프로덕션 환경에서는 HTMLPurifier 라이브러리 사용을 강력히 권장합니다.
//   정규식 기반 살균은 우회 가능성이 있으며 최후 방어선이 아닙니다.
function sanitize_html_content($html) {
    if (!is_string($html)) return '';
    if (strlen($html) > COLLAB_MAX_CONTENT_BYTES) return '';

    // <script> 태그 완전 제거
    $html = preg_replace('/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/is', '', $html);

    // <style> 태그 완전 제거
    $html = preg_replace('/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/is', '', $html);

    // [PATCH-7a] SVG·MathML 내 스크립팅 벡터 제거
    $html = preg_replace('/<svg\b[^>]*>.*?<\/svg>/is', '', $html);
    $html = preg_replace('/<math\b[^>]*>.*?<\/math>/is', '', $html);

    // 위험 태그 블록 및 자체 닫힘 제거
    $dangerous = 'object|embed|form|base|link|meta|applet|frame|frameset|iframe|noscript|template|slot|portal';
    $html = preg_replace('/<(' . $dangerous . ')(\s[^>]*)?>.*?<\/\1>/is', '', $html);
    $html = preg_replace('/<(' . $dangerous . ')(\s[^>]*)?\/?\s*>/is', '', $html);

    // on* 이벤트 핸들러 속성 제거 (onerror, onclick, onload 등)
    $html = preg_replace('/\s+on[a-z]+\s*=\s*(?:"[^"]*"|\'[^\']*\'|[^\s>]*)/i', '', $html);

    // javascript:/vbscript:/data: URI 제거
    $uri_attrs = 'href|src|action|formaction|xlink:href|ping|poster';
    $html = preg_replace(
        '/(\s+(?:' . $uri_attrs . ')\s*=\s*)(["\'])\s*(?:javascript|vbscript|data)\s*:[^"\']*\2/i',
        '$1$2#$2',
        $html
    );

    // [PATCH-7b] style 속성의 CSS expression() 제거 (IE 레거시 공격 벡터)
    $html = preg_replace('/(\s+style\s*=\s*["\'][^"\']*?)expression\s*\([^)]*\)/i', '$1', $html);

    return $html;
}

// [PATCH-8] 타이밍 공격 방지: 모든 토큰 비교에 hash_equals() 사용
function tokens_equal($a, $b) {
    if (!is_string($a) || !is_string($b)) return false;
    return hash_equals($a, $b);
}

function safe_write_json($file, $data, $max_retries = 5) {
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json === false) {
        error_log("[Collab] JSON encoding failed for file: $file - " . json_last_error_msg());
        return false;
    }

    $retry = 0;
    while ($retry < $max_retries) {
        // [PATCH-9a] 임시 파일명에 암호학적 난수 사용 (예측 불가능한 이름)
        try {
            $rand_suffix = bin2hex(random_bytes(8));
        } catch (Exception $e) {
            $rand_suffix = hash('sha256', uniqid(mt_rand(), true) . microtime(true));
        }
        $tmp = $file . '.tmp.' . $rand_suffix;

        // [PATCH-9b] 파일 권한 0666 → 0640
        //   0640: 소유자 rw, 그룹 r, 기타 접근 불가
        //   웹서버 프로세스(소유자 또는 동일 그룹)는 읽기/쓰기 가능,
        //   같은 서버의 다른 OS 사용자는 접근 불가 → host_token 유출 방지
        $oldmask = umask(0137); // umask 0137 적용 시 결과 퍼미션 = 0640
        $bytes = @file_put_contents($tmp, $json, LOCK_EX);
        umask($oldmask);

        if ($bytes === false) {
            $retry++; usleep(50000); continue;
        }

        @chmod($tmp, 0640);

        if (!@rename($tmp, $file)) {
            @unlink($tmp); $retry++; usleep(50000); continue;
        }

        @chmod($file, 0640);
        return true;
    }
    return false;
}

function safe_read_json($file, $default = null, $max_retries = 3) {
    $retry = 0;
    while ($retry < $max_retries) {
        if (!file_exists($file)) return $default;
        $json = @file_get_contents($file);
        if ($json === false) { $retry++; usleep(20000); continue; }
        $data = json_decode($json, true);
        if (!is_array($data)) { $retry++; usleep(20000); continue; }
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
            flock($fp, LOCK_UN); fclose($fp);
            return false;
        }
        $result = safe_write_json($file, $updated_data);
        flock($fp, LOCK_UN); fclose($fp); @unlink($lock_file);
        return $result ? $updated_data : false;
    } catch (Exception $e) {
        error_log("[Collab] Error in atomic_update_file: " . $e->getMessage());
        flock($fp, LOCK_UN); fclose($fp); @unlink($lock_file);
        return false;
    }
}

function generate_room_code() {
    global $collab_dir;
    $tries = 0;
    do {
        try {
            $code = str_pad(random_int(100000, 999999), 6, '0', STR_PAD_LEFT)
                  . substr(bin2hex(random_bytes(2)), 0, 2);
        } catch (Exception $e) {
            $code = str_pad(mt_rand(100000,999999), 6, '0', STR_PAD_LEFT)
                  . substr(md5(uniqid(mt_rand(), true)), 0, 2);
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

// [PATCH-10] load_room_data에서 host_token 제외
//   host_token은 인가 검사가 필요한 특정 action에서 직접 safe_read_json으로 읽도록 분리.
//   이 함수가 반환하는 배열을 그대로 응답에 포함해도 토큰이 노출되지 않는다.
function load_room_data($code) {
    $meta       = safe_read_json(code_to_path($code, 'meta'));
    $content    = safe_read_json(code_to_path($code, 'content'),    ['content'=>'','version'=>0,'domState'=>[],'last_update_time'=>0]);
    $users      = safe_read_json(code_to_path($code, 'users'),      ['users'=>[]]);
    $client_ops = safe_read_json(code_to_path($code, 'client_ops'), ['client_ops'=>[]]);
    if (!$meta) return null;
    return [
        'code'            => $code,
        // host_token은 의도적으로 포함하지 않음
        'created_at'      => $meta['created_at'] ?? '',
        'updated_at'      => $meta['updated_at'] ?? '',
        'content'         => $content['content'] ?? '',
        'domState'        => $content['domState'] ?? [],
        'version'         => $content['version'] ?? 0,
        'last_update_time'=> $content['last_update_time'] ?? 0,
        'users'           => $users['users'] ?? [],
        'client_ops'      => $client_ops['client_ops'] ?? []
    ];
}

function has_real_change($prev_content, $curr_content, $prev_dom_state, $curr_dom_state) {
    if ($prev_content === null || $curr_content === null) return true;
    $prev_norm = trim(preg_replace('/\s+/', ' ', preg_replace('/<p>\s*<\/p>/', '<p><br></p>', $prev_content)));
    $curr_norm = trim(preg_replace('/\s+/', ' ', preg_replace('/<p>\s*<\/p>/', '<p><br></p>', $curr_content)));
    if ($prev_norm !== $curr_norm) return true;
    return json_encode($prev_dom_state ?? []) !== json_encode($curr_dom_state ?? []);
}

// [PATCH-11] IP 기반 단순 레이트 리미터 (exists·get 등 인증 없는 엔드포인트 보호)
function check_rate_limit($bucket, $max_per_minute = 30) {
    global $collab_dir;
    $rate_dir = $collab_dir . '/.rate';
    if (!is_dir($rate_dir)) {
        @mkdir($rate_dir, 0700, true);
    }
    $ip_raw   = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $ip_hash  = substr(hash('sha256', $ip_raw), 0, 20);
    $rate_file = $rate_dir . '/' . $bucket . '_' . $ip_hash . '.json';

    $fp = @fopen($rate_file . '.lock', 'c+');
    if (!$fp) return true; // 잠금 실패 시 통과(방어적 허용)

    flock($fp, LOCK_EX);
    $data = @file_exists($rate_file) ? json_decode(@file_get_contents($rate_file), true) : [];
    if (!is_array($data)) $data = [];

    $now = time();
    if (!isset($data['w']) || ($now - $data['w']) >= 60) {
        $data = ['w' => $now, 'c' => 1];
    } else {
        $data['c'] = ($data['c'] ?? 0) + 1;
    }

    @file_put_contents($rate_file, json_encode($data), LOCK_EX);
    @chmod($rate_file, 0600);
    flock($fp, LOCK_UN);
    fclose($fp);
    @unlink($rate_file . '.lock');

    return ($data['c'] <= $max_per_minute);
}


/* ========================================================
   ACTION HANDLERS
   ======================================================== */

switch ($action) {

    // ----------------------------------------------------------
    case 'create':
        try {
            // [PATCH-12] 토큰 엔트로피 강화: 32바이트 = 64 hex chars
            $host_token = bin2hex(random_bytes(32));
        } catch (Exception $e) {
            $host_token = hash('sha256', uniqid(mt_rand(), true) . microtime(true));
        }

        $code = generate_room_code();

        $meta_path       = code_to_path($code, 'meta');
        $content_path    = code_to_path($code, 'content');
        $users_path      = code_to_path($code, 'users');
        $client_ops_path = code_to_path($code, 'client_ops');

        if (!safe_write_json($meta_path, ['code'=>$code,'host_token'=>$host_token,'created_at'=>now_ts(),'updated_at'=>now_ts()])) {
            http_response_code(500);
            echo json_encode(['success'=>false,'error'=>'meta_creation_failed']); exit;
        }
        if (!safe_write_json($content_path, ['content'=>'','domState'=>[],'version'=>0,'last_update_time'=>now_micro()])) {
            @unlink($meta_path);
            http_response_code(500);
            echo json_encode(['success'=>false,'error'=>'content_creation_failed']); exit;
        }
        if (!safe_write_json($users_path, ['users'=>[]])) {
            @unlink($meta_path); @unlink($content_path);
            http_response_code(500);
            echo json_encode(['success'=>false,'error'=>'users_creation_failed']); exit;
        }
        if (!safe_write_json($client_ops_path, ['client_ops'=>[]])) {
            @unlink($meta_path); @unlink($content_path); @unlink($users_path);
            http_response_code(500);
            echo json_encode(['success'=>false,'error'=>'client_ops_creation_failed']); exit;
        }

        error_log("[Collab] Room created: $code");
        echo json_encode(['success'=>true,'code'=>$code,'host_token'=>$host_token]);
        exit;

    // ----------------------------------------------------------
    case 'exists':
        $code = $input['code'] ?? '';
        if ($code === '') { echo json_encode(['success'=>false]); exit; }

        // [PATCH-13] exists는 인증 없이 열려 있으므로 레이트 리밋으로 열거 공격 방어
        //   IP당 분당 30회 초과 시 429 반환
        if (!check_rate_limit('exists', 30)) {
            http_response_code(429);
            echo json_encode(['success'=>false,'error'=>'rate_limited']);
            exit;
        }

        echo json_encode(['success'=>room_exists($code)]);
        exit;

    // ----------------------------------------------------------
    case 'get':
        $code          = $input['code'] ?? '';
        $client_id     = trim($input['client_id'] ?? '');
        $host_token_in = $input['host_token'] ?? '';
        $since_version = isset($input['since_version']) ? intval($input['since_version']) : null;

        if ($code === '') { echo json_encode(['success'=>false,'error'=>'no_code']); exit; }
        if (!room_exists($code)) { echo json_encode(['success'=>false,'error'=>'no_room']); exit; }

        // [PATCH-14] get 요청 인가 검사
        //   방 코드만 알면 콘텐츠를 무단으로 읽을 수 있던 문제를 수정.
        //   host_token 일치 또는 users 목록에 등록된 client_id 소지자만 허용.
        $meta_for_get  = safe_read_json(code_to_path($code, 'meta'));
        $users_for_get = safe_read_json(code_to_path($code, 'users'), ['users'=>[]]);
        $get_authorized = false;

        if ($host_token_in !== '' && $meta_for_get && isset($meta_for_get['host_token'])
            && tokens_equal($meta_for_get['host_token'], $host_token_in)) {
            $get_authorized = true;
        }
        if (!$get_authorized && validate_client_id($client_id)) {
            foreach (($users_for_get['users'] ?? []) as $u) {
                if (isset($u['client_id']) && $u['client_id'] === $client_id) {
                    $get_authorized = true;
                    break;
                }
            }
        }
        if (!$get_authorized) {
            http_response_code(403);
            echo json_encode(['success'=>false,'error'=>'unauthorized']); exit;
        }

        $data = load_room_data($code);
        if ($data === null) { echo json_encode(['success'=>false,'error'=>'load_failed']); exit; }

        if ($since_version !== null && $data['version'] <= $since_version) {
            echo json_encode(['success'=>true,'has_updates'=>false,'data'=>['version'=>$data['version'],'users'=>$data['users']]]);
            exit;
        }

        echo json_encode(['success'=>true,'has_updates'=>true,'data'=>[
            'version' => $data['version'],
            'content' => $data['content'],
            'domState'=> $data['domState'],
            'users'   => $data['users']
        ]]);
        exit;

    // ----------------------------------------------------------
    case 'join':
        $code      = $input['code'] ?? '';
        $client_id = trim($input['client_id'] ?? '');

        // [PATCH-15] client_id / 닉네임 검증
        if ($code === '' || !validate_client_id($client_id)) {
            echo json_encode(['success'=>false,'error'=>'invalid_params']); exit;
        }
        $nickname = sanitize_nickname($input['nickname'] ?? '익명');

        if (!room_exists($code)) {
            echo json_encode(['success'=>false,'error'=>'no_room']); exit;
        }

        // [PATCH-16] 호스트 판별을 "첫 번째 join"이 아닌 "host_token 일치" 기준으로 변경.
        //   기존 방식의 문제: 방 코드를 알게 된 공격자가 창작자보다 먼저 join하면
        //   host_token을 탈취하고 방 전체 제어권(강퇴·방 삭제)을 획득할 수 있었음.
        //   수정 후: create 응답으로 받은 host_token을 함께 전송해야만 방장으로 인정.
        $provided_host_token = $input['host_token'] ?? '';
        $meta_for_join = safe_read_json(code_to_path($code, 'meta'));
        $is_host = (
            $provided_host_token !== ''
            && $meta_for_join !== null
            && isset($meta_for_join['host_token'])
            && tokens_equal($meta_for_join['host_token'], $provided_host_token)
        );

        $users_path = code_to_path($code, 'users');

        $result = atomic_update_file($users_path, function($data) use ($client_id, $nickname, $is_host, $provided_host_token) {
            if (!isset($data['users'])) $data['users'] = [];

            // [PATCH-17] 이미 참여 중인지 확인 후 최대 인원 체크
            $is_existing = false;
            foreach ($data['users'] as $u) {
                if (($u['client_id'] ?? '') === $client_id) { $is_existing = true; break; }
            }
            if (!$is_existing && count($data['users']) >= COLLAB_MAX_USERS) {
                error_log("[Collab] Room full, rejecting client");
                return false;
            }

            $existing = false;
            foreach ($data['users'] as &$u) {
                if (($u['client_id'] ?? '') === $client_id) {
                    $u['nickname']  = $nickname;
                    $u['joined_at'] = now_ts();
                    if ($is_host) $u['isHost'] = true;
                    $existing = true;
                    break;
                }
            }
            unset($u);

            if (!$existing) {
                $data['users'][] = ['client_id'=>$client_id,'nickname'=>$nickname,'joined_at'=>now_ts(),'isHost'=>$is_host];
            }

            $data['is_host']    = $is_host;
            $data['host_token'] = $is_host ? $provided_host_token : null;
            return $data;
        }, ['users'=>[]]);

        if ($result === false) {
            echo json_encode(['success'=>false,'error'=>'join_failed']); exit;
        }

        $client_ops_path = code_to_path($code, 'client_ops');
        atomic_update_file($client_ops_path, function($data) use ($client_id) {
            if (!isset($data['client_ops'])) $data['client_ops'] = [];
            $found = false;
            foreach ($data['client_ops'] as &$op) {
                if ($op['client_id'] === $client_id) { $op['last_timestamp'] = now_micro(); $found = true; break; }
            }
            unset($op);
            if (!$found) $data['client_ops'][] = ['client_id'=>$client_id,'last_timestamp'=>now_micro()];
            return $data;
        }, ['client_ops'=>[]]);

        atomic_update_file(code_to_path($code, 'meta'), function($data) {
            $data['updated_at'] = now_ts(); return $data;
        });

        $room_data = load_room_data($code);
        error_log("[Collab] Client joined room: $code");

        echo json_encode([
            'success'    => true,
            'is_host'    => $result['is_host'] ?? false,
            'host_token' => $result['host_token'] ?? null,
            'data'       => [
                'version' => $room_data['version'],
                'content' => $room_data['content'],
                'domState'=> $room_data['domState'],
                'users'   => $room_data['users']
            ]
        ]);
        exit;

    // ----------------------------------------------------------
    case 'leave':
        $code      = $input['code'] ?? '';
        $client_id = trim($input['client_id'] ?? '');

        // [PATCH-18] client_id 검증
        if ($code === '' || !validate_client_id($client_id)) {
            echo json_encode(['success'=>false,'error'=>'invalid_params']); exit;
        }
        if (!room_exists($code)) {
            echo json_encode(['success'=>false,'error'=>'no_room']); exit;
        }

        $result = atomic_update_file(code_to_path($code, 'users'), function($data) use ($client_id) {
            if (!isset($data['users'])) $data['users'] = [];
            $data['users'] = array_values(array_filter($data['users'], fn($u)=>($u['client_id']??'')!==$client_id));
            return $data;
        }, ['users'=>[]]);

        if ($result === false) {
            echo json_encode(['success'=>false,'error'=>'leave_failed']); exit;
        }

        atomic_update_file(code_to_path($code, 'client_ops'), function($data) use ($client_id) {
            if (!isset($data['client_ops'])) $data['client_ops'] = [];
            $data['client_ops'] = array_values(array_filter($data['client_ops'], fn($op)=>$op['client_id']!==$client_id));
            return $data;
        }, ['client_ops'=>[]]);

        atomic_update_file(code_to_path($code, 'meta'), function($data) {
            $data['updated_at'] = now_ts(); return $data;
        });

        error_log("[Collab] Client left room: $code");
        echo json_encode(['success'=>true]);
        exit;

    // ----------------------------------------------------------
    case 'stop':
        $code       = $input['code'] ?? '';
        $host_token = $input['host_token'] ?? '';

        if ($code === '' || $host_token === '') {
            echo json_encode(['success'=>false,'error'=>'invalid_params']); exit;
        }
        if (!room_exists($code)) {
            echo json_encode(['success'=>false,'error'=>'no_room']); exit;
        }

        $meta = safe_read_json(code_to_path($code, 'meta'));
        // [PATCH-19] hash_equals로 타이밍 공격 방지
        if (!$meta || !isset($meta['host_token']) || !tokens_equal($meta['host_token'], $host_token)) {
            echo json_encode(['success'=>false,'error'=>'unauthorized']); exit;
        }

        // [PATCH-20] stop 시 모든 파일 유형(data + lock) 삭제 — 기존에는 일부 누락
        foreach (['meta','content','users','client_ops'] as $t) {
            $p = code_to_path($code, $t);
            @unlink($p);
            @unlink($p . '.lock');
        }

        error_log("[Collab] Room stopped: $code");
        echo json_encode(['success'=>true]);
        exit;

    // ----------------------------------------------------------
    case 'update':
        $code      = $input['code'] ?? '';
        $client_id = trim($input['client_id'] ?? '');
        $version   = isset($input['version']) ? intval($input['version']) : 0;
        $operation = $input['operation'] ?? null;

        // [PATCH-21] client_id + operation 기본 검증
        if ($code === '' || !validate_client_id($client_id) || !is_array($operation)) {
            echo json_encode(['success'=>false,'error'=>'invalid_params']); exit;
        }

        // [PATCH-22] operation type 화이트리스트
        if (!in_array($operation['type'] ?? '', ['full'], true)) {
            echo json_encode(['success'=>false,'error'=>'invalid_operation_type']); exit;
        }

        // [PATCH-23] 콘텐츠 크기 제한 + XSS 살균
        if (isset($operation['content'])) {
            if (!is_string($operation['content'])) {
                echo json_encode(['success'=>false,'error'=>'invalid_content']); exit;
            }
            if (strlen($operation['content']) > COLLAB_MAX_CONTENT_BYTES) {
                echo json_encode(['success'=>false,'error'=>'content_too_large']); exit;
            }
            $operation['content'] = sanitize_html_content($operation['content']);
        }

        if (!room_exists($code)) {
            echo json_encode(['success'=>false,'error'=>'no_room']); exit;
        }

        $users = safe_read_json(code_to_path($code, 'users'), ['users'=>[]]);
        $meta  = safe_read_json(code_to_path($code, 'meta'));

        // [PATCH-24] hash_equals로 호스트 토큰 검증
        $allowed = false;
        if (isset($input['host_token']) && isset($meta['host_token']) && tokens_equal($meta['host_token'], $input['host_token'])) {
            $allowed = true;
        }
        if (!$allowed) {
            foreach ($users['users'] as $u) {
                if (isset($u['client_id']) && $u['client_id'] === $client_id) { $allowed = true; break; }
            }
        }
        if (!$allowed) {
            echo json_encode(['success'=>false,'error'=>'not_allowed']); exit;
        }

        $content_path    = code_to_path($code, 'content');
        $client_ops_path = code_to_path($code, 'client_ops');
        $operation_timestamp = isset($operation['timestamp']) ? strtotime($operation['timestamp']) : now_micro();

        atomic_update_file($client_ops_path, function($data) use ($client_id, $operation_timestamp) {
            if (!isset($data['client_ops'])) $data['client_ops'] = [];
            $found = false;
            foreach ($data['client_ops'] as &$op) {
                if ($op['client_id'] === $client_id) { $op['last_timestamp'] = $operation_timestamp; $found = true; break; }
            }
            unset($op);
            if (!$found) $data['client_ops'][] = ['client_id'=>$client_id,'last_timestamp'=>$operation_timestamp];
            return $data;
        }, ['client_ops'=>[]]);

        $result = atomic_update_file($content_path, function($data) use ($version, $operation, $client_id, $operation_timestamp) {
            $current_version   = intval($data['version'] ?? 0);
            $current_content   = $data['content'] ?? '';
            $current_dom_state = $data['domState'] ?? [];
            $last_update_time  = $data['last_update_time'] ?? 0;

            if ($version < $current_version) {
                $new_content   = $operation['content'] ?? '';
                $new_dom_state = $operation['domState'] ?? [];
                $has_change    = has_real_change($current_content, $new_content, $current_dom_state, $new_dom_state);

                if (!$has_change) {
                    return ['no_change'=>true,'current_version'=>$current_version];
                }
                if ($operation_timestamp <= $last_update_time) {
                    return ['conflict'=>true,'current_version'=>$current_version,'current_content'=>$current_content,'current_dom_state'=>$current_dom_state];
                }
            }

            if ($operation['type'] === 'full') {
                $newContent  = $operation['content'] ?? '';
                $newDOMState = $operation['domState'] ?? [];
                if (has_real_change($current_content, $newContent, $current_dom_state, $newDOMState)) {
                    $data['content']          = $newContent;
                    $data['domState']         = $newDOMState;
                    $data['version']          = $current_version + 1;
                    $data['last_update_time'] = $operation_timestamp;
                } else {
                    return ['no_change'=>true,'current_version'=>$current_version];
                }
            }
            return $data;
        }, ['content'=>'','domState'=>[],'version'=>0,'last_update_time'=>0]);

        if ($result === false) {
            echo json_encode(['success'=>false,'error'=>'update_failed']); exit;
        }
        if (!empty($result['no_change'])) {
            echo json_encode(['success'=>true,'no_change'=>true,'new_version'=>$result['current_version']]); exit;
        }
        if (!empty($result['conflict'])) {
            echo json_encode(['success'=>false,'conflict'=>true,'current_version'=>$result['current_version'],'current_content'=>$result['current_content'],'current_dom_state'=>$result['current_dom_state']]); exit;
        }

        atomic_update_file(code_to_path($code, 'meta'), function($data) {
            $data['updated_at'] = now_ts(); return $data;
        });

        echo json_encode(['success'=>true,'new_version'=>$result['version'] ?? 0]);
        exit;

    // ----------------------------------------------------------
    case 'kick':
        $code             = $input['code'] ?? '';
        $target_client_id = trim($input['target_client_id'] ?? '');
        $host_token       = $input['host_token'] ?? '';

        // [PATCH-25] target_client_id 형식 검증
        if ($code === '' || !validate_client_id($target_client_id) || $host_token === '') {
            echo json_encode(['success'=>false,'error'=>'invalid_params']); exit;
        }
        if (!room_exists($code)) {
            echo json_encode(['success'=>false,'error'=>'no_room']); exit;
        }

        $meta = safe_read_json(code_to_path($code, 'meta'));
        // [PATCH-26] hash_equals로 타이밍 공격 방지
        if (!$meta || !isset($meta['host_token']) || !tokens_equal($meta['host_token'], $host_token)) {
            echo json_encode(['success'=>false,'error'=>'unauthorized']); exit;
        }

        $result = atomic_update_file(code_to_path($code, 'users'), function($data) use ($target_client_id) {
            if (!isset($data['users'])) $data['users'] = [];
            $data['users'] = array_values(array_filter($data['users'], fn($u)=>($u['client_id']??'')!==$target_client_id));
            return $data;
        }, ['users'=>[]]);

        if ($result === false) {
            echo json_encode(['success'=>false,'error'=>'kick_failed']); exit;
        }

        atomic_update_file(code_to_path($code, 'client_ops'), function($data) use ($target_client_id) {
            if (!isset($data['client_ops'])) $data['client_ops'] = [];
            $data['client_ops'] = array_values(array_filter($data['client_ops'], fn($op)=>$op['client_id']!==$target_client_id));
            return $data;
        }, ['client_ops'=>[]]);

        atomic_update_file(code_to_path($code, 'meta'), function($data) {
            $data['updated_at'] = now_ts(); return $data;
        });

        error_log("[Collab] Client kicked from room: $code");
        echo json_encode(['success'=>true]);
        exit;

    // ----------------------------------------------------------
    default:
        echo json_encode(['success'=>false,'error'=>'invalid_action']);
        exit;
}

// [PATCH-27] @chmod(__FILE__, 0644) 제거
//   PHP 소스 파일의 권한을 런타임에 변경하는 것은 위험하며 불필요합니다.
//   - 웹서버가 자기 자신의 소스 파일에 쓰기 권한을 가져야 한다는 잘못된 전제
//   - 소스 파일 권한은 배포/설치 시 한 번만 올바르게 설정해야 합니다 (644 권장)
?>
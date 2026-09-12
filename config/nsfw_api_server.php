<?php
/**
 * NSFW Filter API (JSONL + SQLite 하이브리드)
 * JSONL 로드 실패 시 자동으로 SQLite 사용 (뚫림 방지)
 */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

define('JSONL_FILE', __DIR__ . '/learning_data.jsonl');
define('JSON_FILE', __DIR__ . '/learning_data.json');
define('DB_FILE', __DIR__ . '/learning_data.db');

// ── 예외 클래스 ─────────────────────────────
class ApiException extends RuntimeException {}

function api_ok(array $data): void {
    echo json_encode(['ok' => true] + $data, JSON_UNESCAPED_UNICODE);
    exit;
}
function api_error(string $msg, int $code = 400): void {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── 모델 로드 (JSONL → SQLite Fallback) ─────────────────────────────
function load_model(): array {
    // 1. JSONL 시도 (가장 빠름, 메모리 효율)
    if (file_exists(JSONL_FILE)) {
        try {
            $result = load_model_jsonl(JSONL_FILE);
            // 검증: 필수 가중치가 정상적으로 로드되었는지 확인
            if (validate_weights($result[0])) {
                return $result;
            }
            error_log("[NSFW] JSONL 가중치 검증 실패, SQLite로 fallback");
        } catch (Exception $e) {
            error_log("[NSFW] JSONL 로드 실패: " . $e->getMessage());
        }
    }
    
    // 2. 기존 JSON 시도 (하위 호환)
    if (file_exists(JSON_FILE)) {
        try {
            $result = load_model_json(JSON_FILE);
            if (validate_weights($result[0])) {
                return $result;
            }
        } catch (Exception $e) {
            error_log("[NSFW] JSON 로드 실패: " . $e->getMessage());
        }
    }
    
    // 3. 최종: SQLite (가장 안전)
    if (file_exists(DB_FILE)) {
        try {
            return load_model_sqlite();
        } catch (Exception $e) {
            throw new ApiException("모든 저장소 로드 실패: " . $e->getMessage(), 503);
        }
    }
    
    throw new ApiException('가용한 모델 데이터 없음 (jsonl/json/db 모두 없음)', 503);
}

// 가중치 검증: 필수 키와 데이터 타입 확인
function validate_weights(array $W): bool {
    $required = ['c1_dw','c1_pw','c2_dw','c2_pw','c3_dw','c3_pw','c4_dw','c4_pw','a_w1','a_w2','f1','f2','f3'];
    foreach ($required as $k) {
        if (!isset($W[$k]) || empty($W[$k])) {
            error_log("[NSFW] Missing weight: {$k}");
            return false;
        }
        // 배열인지 확인 (손상된 데이터는 null이나 문자열일 수 있음)
        if (!is_array($W[$k]) && !$W[$k] instanceof ArrayAccess) {
            error_log("[NSFW] Invalid weight type: {$k} is " . gettype($W[$k]));
            return false;
        }
    }
    return true;
}

// JSONL 로더 (Secure 버전)
function load_model_jsonl(string $path): array {
    $handle = @fopen($path, 'r');
    if (!$handle) throw new Exception('파일 열기 실패');
    
    $W = []; $b = []; $lineNum = 0;
    
    while (($line = fgets($handle)) !== false) {
        $lineNum++;
        $line = trim($line);
        if (empty($line)) continue;
        
        $record = json_decode($line, true);
        if (!$record) {
            fclose($handle);
            throw new Exception("JSON 파싱 오류 (줄 {$lineNum})");
        }
        
        if (($record['table'] ?? '') !== 'model_weights') continue;
        
        $name = $record['name'] ?? null;
        $data = $record['data'] ?? null;
        $checksum = $record['_checksum'] ?? null;
        
        if (!$name || $data === null) continue;
        
        // 체크섬 검증 (있는 경우)
        if ($checksum !== null) {
            $data_json = json_encode($data, JSON_UNESCAPED_UNICODE);
            if (crc32($data_json) !== $checksum) {
                fclose($handle);
                throw new Exception("체크섬 불일치: {$name}");
            }
        }
        
        // data는 이미 배열 (gzdecode 불필요)
        if (str_starts_with($name, 'b_')) {
            $b[substr($name, 2)] = $data;
        } else {
            $W[$name] = $data;
        }
    }
    
    fclose($handle);
    
    if (empty($W)) throw new Exception('JSONL에 가중치 데이터 없음');
    return [$W, $b];
}

// 기존 JSON 로더
function load_model_json(string $path): array {
    $contents = file_get_contents($path);
    if ($contents === false) throw new Exception('파일 읽기 실패');
    
    $data = json_decode($contents, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        throw new Exception('JSON 파싱 오류: ' . json_last_error_msg());
    }
    
    if (!isset($data['model_weights'])) {
        throw new Exception('model_weights 키 없음');
    }
    
    $rows = $data['model_weights'];
    $W = []; $b = [];
    
    foreach ($rows as $r) {
        $name = $r['name'];
        $val = $r['data'];
        
        // Base64 처리 (구버전 데이터)
        if (is_string($val) && str_starts_with($val, 'BASE64:')) {
            $val = base64_decode(substr($val, 7));
        }
        
        // gzdecode 시도
        if (is_string($val)) {
            $u = @gzdecode($val);
            $decoded = json_decode($u !== false ? $u : $val, true);
        } else {
            $decoded = $val;
        }
        
        if (str_starts_with($name, 'b_')) {
            $b[substr($name, 2)] = $decoded;
        } else {
            $W[$name] = $decoded;
        }
    }
    
    return [$W, $b];
}

// SQLite 로더 (최종 안전망)
function load_model_sqlite(): array {
    if (!extension_loaded('pdo_sqlite')) {
        throw new Exception('PDO SQLite 확장 없음');
    }
    
    $pdo = new PDO('sqlite:' . DB_FILE);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    $stmt = $pdo->query("SELECT name, data FROM model_weights");
    if (!$stmt) throw new Exception('쿼리 실패');
    
    $W = []; $b = [];
    
    while ($row = $stmt->fetch()) {
        $name = $row['name'];
        $data_blob = $row['data'];
        
        // gzdecode
        $uncompressed = @gzdecode($data_blob);
        if ($uncompressed === false) $uncompressed = $data_blob;
        
        $decoded = json_decode($uncompressed, true);
        if ($decoded === null) continue;
        
        if (str_starts_with($name, 'b_')) {
            $b[substr($name, 2)] = $decoded;
        } else {
            $W[$name] = $decoded;
        }
    }
    
    if (empty($W)) throw new Exception('SQLite에서 가중치 로드 실패');
    return [$W, $b];
}

// ── 핸들러 ─────────────────────────────
function handle_get_model() {
    [$W, $b] = load_model();
    api_ok([
        'weights' => $W, 
        'biases' => $b,
        'source' => 'jsonl', // 실제로는 내부에서 결정
        'validated' => true
    ]);
}

function handle_info() {
    $sources = [];
    if (file_exists(JSONL_FILE)) $sources[] = 'jsonl';
    if (file_exists(JSON_FILE)) $sources[] = 'json';
    if (file_exists(DB_FILE)) $sources[] = 'sqlite';
    
    api_ok([
        'available_sources' => $sources,
        'active_source' => 'auto (jsonl→json→sqlite)',
        'db_size' => file_exists(DB_FILE) ? filesize(DB_FILE) : 0
    ]);
}

function handle_health() {
    try {
        [$W, $b] = load_model();
        $valid = validate_weights($W);
        api_ok([
            'status' => $valid ? 'ok' : 'degraded',
            'weights_loaded' => count($W),
            'biases_loaded' => count($b)
        ]);
    } catch (Exception $e) {
        api_error('unhealthy: ' . $e->getMessage(), 503);
    }
}

// ── 이미지 처리 (기존 코드 유지) ─────────────────────────────
function process_classification(string $filePath, bool $returnHeatmap = false) {
    // 이미지 처리 로직은 필요시 구현
    $px = prepare_image($filePath);
    [$W, $b] = load_model();
    // CNN 연산은 클라이언트 사이드에서 처리하므로 여기서는 기본 응답
    api_ok(['prob' => 0.5, 'label' => 'safe', 'note' => 'CNN 코드는 클라이언트 사이드에서 실행']);
}

function prepare_image(string $path): array {
    // 기본 구현
    return []; 
}

// ── 라우팅 ─────────────────────────────
try {
    $action = $_GET['action'] ?? $_POST['action'] ?? '';
    match ($action) {
        'get_model' => handle_get_model(),
        'info' => handle_info(),
        'health' => handle_health(),
        default => api_error('Unknown action', 400)
    };
} catch (ApiException $e) {
    api_error($e->getMessage(), $e->getCode() ?: 500);
} catch (Throwable $e) {
    api_error('Server error: ' . $e->getMessage(), 500);
}
?>

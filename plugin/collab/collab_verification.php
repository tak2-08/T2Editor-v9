<?php
// Path: T2Editor/plugin/collab/collab_verification.php

if (!defined('T2EDITOR_PATH')) {
    $possible = __DIR__ . '/../../config/t2_config.php';
    if (file_exists($possible)) include_once $possible;
}
if (!defined('T2EDITOR_PATH')) {
    define('T2EDITOR_PATH', realpath(__DIR__ . '/../..'));
}

// [PATCH-1] Content-Type 헤더는 직접 호출 시에만 설정
$is_direct_call = (isset($_GET['verify']) || basename($_SERVER['SCRIPT_FILENAME'] ?? '') === 'collab_verification.php');
if ($is_direct_call) {
    // [PATCH-2] 직접 호출 시 GET ?verify=1 만 허용
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        http_response_code(405);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success'=>false,'error'=>'method_not_allowed']);
        exit;
    }
    header('Content-Type: application/json; charset=utf-8');
}

function verifyCollabEnvironment() {
    $collab_dir = T2EDITOR_PATH . '/collab';
    $results = [
        'steps'   => [],
        'success' => false,
        'error'   => ''
    ];

    // [1] /t2editor/collab 폴더 존재 여부 확인
    if (!is_dir($collab_dir)) {
        $results['steps'][] = '1. collab 폴더가 존재하지 않음';
        $results['error']   = "/t2editor/collab 폴더가 없습니다.\n/t2editor에 /collab을 생성해주세요.\n\n[https://dsclub.kr/service/editor 의 설치 방법을 참고]";
        return $results;
    }
    $results['steps'][] = '✓ collab 폴더 존재 확인';

    // [2] collab 폴더 쓰기 권한 확인
    if (!is_writable($collab_dir)) {
        $results['steps'][] = '2. collab 폴더에 쓰기 권한 없음';

        // [PATCH-3] 디렉터리 권한 권장값을 707 → 750으로 변경
        //   707 문제점:
        //     - "기타(others)" 에 rwx 권한 부여 → 같은 서버의 모든 OS 사용자가
        //       파일 생성·삭제·열거 가능 → host_token, 콘텐츠 탈취·위변조 위험
        //   750 의미:
        //     - 소유자(웹서버 또는 FTP 계정): rwx
        //     - 그룹(웹서버 실행 그룹):       r-x  (읽기·실행만)
        //     - 기타:                         ---  (접근 불가)
        //   설정 방법: 웹서버 실행 사용자(예: www-data, apache, nginx)를
        //   collab 디렉터리 소유자의 그룹에 추가한 후 chmod 750 적용.
        //   공유 호스팅 등 그룹 설정이 어려운 환경에서는 최소한 755로 유지하고,
        //   절대 707·777은 사용하지 마십시오.
        $results['error'] = "/t2editor/collab 폴더에 쓰기 권한이 부족합니다.\n\n"
            . "【권장】 chmod 750 /t2editor/collab\n"
            . "웹서버 실행 사용자를 디렉터리 그룹에 추가해야 합니다.\n"
            . "예) usermod -aG \$(stat -c '%G' /t2editor/collab) www-data\n\n"
            . "※ chmod 707 / 777 은 보안상 위험하므로 사용하지 마십시오.\n\n"
            . "[https://dsclub.kr/service/editor 의 설치 방법을 참고]";
        return $results;
    }
    $results['steps'][] = '✓ collab 폴더 쓰기 권한 확인';

    // [3] 필수 PHP 파일 존재 여부 확인
    $collab_files = ['collab_number.php', 'collab_number_delete.php'];
    foreach ($collab_files as $file) {
        $file_path = __DIR__ . '/' . $file;
        if (!file_exists($file_path)) {
            $results['steps'][] = "⚠ $file 파일이 존재하지 않음";
            $results['error']   = "$file 파일이 없습니다.\n협업 플러그인을 재설치해주세요.";
            return $results;
        }
        $results['steps'][] = "✓ $file 파일 존재 확인";
    }

    // [4] 실제 쓰기 권한 테스트
    // [PATCH-4] 테스트 파일명에 충분한 엔트로피 사용 (추측 불가)
    try {
        $rand_suffix = bin2hex(random_bytes(8));
    } catch (Exception $e) {
        $rand_suffix = md5(uniqid(mt_rand(), true));
    }
    $test_file = $collab_dir . '/.perm_test_' . $rand_suffix . '.tmp';

    if (@file_put_contents($test_file, 'test') === false) {
        $results['steps'][] = '⚠ 쓰기 권한 테스트 실패';
        $results['error']   = "/t2editor/collab 폴더에 파일을 생성할 수 없습니다.\n\n"
            . "【권장】 chmod 750 /t2editor/collab\n"
            . "웹서버 실행 사용자를 디렉터리 그룹에 추가해야 합니다.\n\n"
            . "※ chmod 707 / 777 은 보안상 위험하므로 사용하지 마십시오.\n\n"
            . "[자세한 사항은 https://dsclub.kr/service/editor 의 설치 방법을 참고]";
        return $results;
    }
    @unlink($test_file);
    $results['steps'][] = '✓ 쓰기 권한 테스트 통과';

    $results['success'] = true;
    return $results;
}

// 직접 호출 시 검증 수행
if (isset($_GET['verify'])) {
    $result = verifyCollabEnvironment();
    echo json_encode($result);
    exit;
}

return verifyCollabEnvironment();
?>
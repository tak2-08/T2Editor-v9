<?php
// Path: T2Editor/plugin/collab/collab_verification.php

if (!defined('T2EDITOR_PATH')) {
    $possible = __DIR__ . '/../../config/t2_config.php';
    if (file_exists($possible)) include_once $possible;
}
if (!defined('T2EDITOR_PATH')) {
    define('T2EDITOR_PATH', realpath(__DIR__ . '/../..'));
}

header('Content-Type: application/json; charset=utf-8');

function verifyCollabEnvironment() {
    $collab_dir = T2EDITOR_PATH . '/collab';
    $results = [
        'steps' => [],
        'success' => false,
        'error' => ''
    ];

    // [1] /t2editor/collab 폴더 존재 여부 확인
    if (!is_dir($collab_dir)) {
        $results['steps'][] = '1. collab 폴더가 존재하지 않음';
        $results['error'] = "/t2editor/collab 폴더가 없습니다.\n/t2editor에 /collab을 생성해주세요.\n\n[https://dsclub.kr/service/editor 의 설치 방법을 참고]";
        return $results;
    } else {
        $results['steps'][] = '✓ collab 폴더 존재 확인';
    }

    // [2] collab 폴더 쓰기 권한 확인
    if (!is_writable($collab_dir)) {
        $results['steps'][] = '2. collab 폴더에 쓰기 권한 없음';
        $results['error'] = "/t2editor/collab 폴더에 쓰기 권한이 부족합니다.\n/t2editor/collab 에 707 권한을 부여해주세요.\n\n[https://dsclub.kr/service/editor 의 설치 방법을 참고]";
        return $results;
    } else {
        $results['steps'][] = '✓ collab 폴더 쓰기 권한 확인';
    }

    // [3] collab_number.php, collab_number_delete.php 파일 존재 여부 확인
    $collab_files = [
        'collab_number.php',
        'collab_number_delete.php'
    ];
    
    foreach ($collab_files as $file) {
        $file_path = __DIR__ . '/' . $file;
        
        if (!file_exists($file_path)) {
            $results['steps'][] = "⚠ $file 파일이 존재하지 않음";
            $results['error'] = "$file 파일이 없습니다.\n협업 플러그인을 재설치해주세요.";
            return $results;
        } else {
            $results['steps'][] = "✓ $file 파일 존재 확인";
        }
    }

    // 테스트 파일 생성으로 실제 쓰기 권한 확인
    $test_file = $collab_dir . '/test_permission_' . uniqid() . '.txt';
    $test_content = 'test';
    
    if (@file_put_contents($test_file, $test_content) === false) {
        $results['steps'][] = '⚠ 쓰기 권한 테스트 실패';
        $results['error'] = "/t2editor/collab 폴더에 파일을 생성할 수 없습니다.\n/t2editor/collab 에 707 권한을 부여해주세요.\n\n[자세한 사항은 https://dsclub.kr/service/editor 의 설치 방법을 참고]";
        return $results;
    }
    
    // 테스트 파일 삭제
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
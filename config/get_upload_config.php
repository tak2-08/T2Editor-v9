<?php
//Path: T2Editor/config/get_upload_config.php

header('Content-Type: application/json; charset=utf-8');

// ────────────────────────────────────────────────────────────────
// [BUG FIX] check_request_origin() 중복 선언 제거
//
// 이전 코드: 이 파일에 check_request_origin()를 인라인으로 정의한 뒤
//   include_once 'upload_config.php'를 호출했다.
//   upload_config.php에도 동일한 함수가 정의되어 있으므로
//   같은 PHP 프로세스에서 두 파일이 모두 로드되면
//   "Cannot redeclare check_request_origin()" Fatal Error가 발생했다.
//
// 수정: upload_config.php를 먼저 포함해 함수를 확보하고,
//   이 파일의 인라인 정의를 완전히 제거한다.
//   Origin 검증 로직(allowlist, 폴백)은 upload_config.php의 구현을 따른다.
// ────────────────────────────────────────────────────────────────

// 업로드 설정 파일 포함 (check_request_origin() 포함)
include_once 'upload_config.php';

if (!check_request_origin()) {
    http_response_code(403);
    echo json_encode(['error' => '접근 거부']);
    exit;
}

// JavaScript에서 사용할 설정 데이터 반환
$config = get_js_config();

// JSON 응답
echo json_encode($config);
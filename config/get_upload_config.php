<?php
//Path: T2Editor/config/get_upload_config.php

// CORS 허용
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Access-Control-Allow-Headers: Content-Type');

// 업로드 설정 파일 포함
include_once 'upload_config.php';

// JavaScript에서 사용할 설정 데이터 반환
$config = get_js_config();

// JSON 응답
echo json_encode($config);
?>
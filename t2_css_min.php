<?php
//Path: T2Editor/t2_css_min.php

include_once 'editor.lib.php';

// 보안을 위해 상위 디렉토리 접근 방지
function is_safe_path($path) {
    if (strpos($path, '..') !== false) return false;
    if (strpos($path, './') !== false) return false;
    // 허용된 확장자 및 디렉토리 체크
    if (substr($path, -4) !== '.css') return false;
    return true;
}

$file = isset($_GET['f']) ? $_GET['f'] : '';
$version = get_readme_version();

// 입력값 검증
if (!$file || !is_safe_path($file)) {
    header('HTTP/1.1 400 Bad Request');
    exit('Invalid file request');
}

$filepath = __DIR__ . '/' . $file;

// 파일 존재 여부 확인
if (!file_exists($filepath)) {
    header('HTTP/1.1 404 Not Found');
    exit('File not found');
}

// CSS 헤더 설정
header('Content-Type: text/css; charset=UTF-8');
header('X-Content-Type-Options: nosniff');

// 브라우저 캐싱 설정
$expires = 60 * 60 * 24 * 30;
header("Pragma: public");
header("Cache-Control: max-age=" . $expires);
header('Expires: ' . gmdate('D, d M Y H:i:s', time() + $expires) . ' GMT');

// 파일 수정 시간 기반 ETag 처리
$last_modified = filemtime($filepath);
$etag = md5($file . $last_modified . $version);
header("Last-Modified: " . gmdate("D, d M Y H:i:s", $last_modified) . " GMT");
header("Etag: $etag");

if (isset($_SERVER['HTTP_IF_NONE_MATCH']) && trim($_SERVER['HTTP_IF_NONE_MATCH']) == $etag) {
    header("HTTP/1.1 304 Not Modified");
    exit;
}

$buffer = file_get_contents($filepath);

// URL 경로 보정
$dir = dirname($file);
if ($dir !== '.' && $dir !== '') {
    // url('...') 패턴을 찾아 경로 앞에 디렉토리를 붙임 (data:, http:, /, 절대경로 제외)
    $buffer = preg_replace_callback('/url\s*\(([\'"]?)(?!data:|http:|https:|\/|#)(.*?)\1\)/i', function($m) use ($dir) {
        return "url({$m[1]}{$dir}/{$m[2]}{$m[1]})";
    }, $buffer);
}

// 주석 제거
$buffer = preg_replace('!/\*[^*]*\*+([^/][^*]*\*+)*//!', '', $buffer);

// 줄바꿈, 탭, 불필요한 공백 제거
$buffer = str_replace(array("\r\n", "\r", "\n", "\t"), '', $buffer);

// 여러 개의 공백을 하나로
$buffer = preg_replace('/ {2,}/', ' ', $buffer);

// 문법 기호( : ; { } , ) 앞뒤의 공백 제거
$buffer = preg_replace('/\s*([:;{},])\s*/', '$1', $buffer);

// 마지막 세미콜론 제거
$buffer = str_replace(';}', '}', $buffer);

echo $buffer;
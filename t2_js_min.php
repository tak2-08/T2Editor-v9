<?php
//Path: T2Editor/t2_js_min.php

include_once 'editor.lib.php';
if (!defined('T2EDITOR_PATH')) define('T2EDITOR_PATH', __DIR__);

$file = isset($_GET['f']) ? $_GET['f'] : '';
$version = get_readme_version();

$real_base = realpath(T2EDITOR_PATH);
$target_file = realpath(T2EDITOR_PATH . '/' . $file);

if (!$target_file || strpos($target_file, $real_base) !== 0 || pathinfo($target_file, PATHINFO_EXTENSION) !== 'js') {
    header("HTTP/1.0 404 Not Found");
    exit('File not found or access denied.');
}

$last_modified = filemtime($target_file);
$etag = md5($target_file . $last_modified . $version);

header("Content-Type: application/javascript; charset=UTF-8");
header("Cache-Control: public, max-age=2628000");
header("ETag: \"$etag\"");
header("Last-Modified: " . gmdate("D, d M Y H:i:s", $last_modified) . " GMT");

if (isset($_SERVER['HTTP_IF_NONE_MATCH']) && trim($_SERVER['HTTP_IF_NONE_MATCH'], '"') == $etag) {
    header("HTTP/1.1 304 Not Modified");
    exit;
}

$content = file_get_contents($target_file);

// 멀티라인 주석 제거 (/* ... */)
$content = preg_replace('!/\*.*?\*/!s', '', $content);

// 싱글라인 주석 제거 (// ...) - 단, URL(http://) 등은 제외하기 위해 정교하게 처리
$content = preg_replace_callback('/(?<!:)\/\/(.*)$/m', function($matches) {
    return '';
}, $content);

// 연속된 공백 및 탭을 하나로 축소
$content = preg_replace('/[ \t]+/', ' ', $content);

// 불필요한 줄바꿈 정리 (빈 줄 제거)
$content = preg_replace('/\n\s*\n/', "\n", $content);

// 앞뒤 공백 제거
$content = trim($content);

echo "// T2Editor Minified JS (Safe Mode) - v{$version}\n";
echo $content;
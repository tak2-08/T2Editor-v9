<?php
//Path: T2Editor/config/t2_config.php

/**
 * T2Editor Configuration File
 * T2에디터 설정 파일
 */

// 그누보드5 체크
if (defined('_GNUBOARD_')) {
    // GNUBOARD5 SYSTEM
    if (!defined('T2EDITOR_PATH')) {
        define('T2EDITOR_PATH', G5_PLUGIN_PATH.'/editor/t2editor');
        define('T2EDITOR_URL', G5_PLUGIN_URL.'/editor/t2editor');
        define('T2EDITOR_DATA_PATH', G5_DATA_PATH.'/editor');
        define('T2EDITOR_DATA_URL', G5_DATA_URL.'/editor');
        define('T2EDITOR_DIR_PERMISSION', G5_DIR_PERMISSION);
        define('T2EDITOR_FILE_PERMISSION', G5_FILE_PERMISSION);
    }
} else {
    // BASIC SYSTEM (타 환경)
    if (!defined('T2EDITOR_PATH')) {
        // config 폴더의 상위 폴더(T2Editor 루트)를 기준으로 설정
        $base_dir = dirname(__DIR__);
        $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? "https://" : "http://";
        $host = $_SERVER['HTTP_HOST'];
        
        // 웹 경로 계산
        $document_root = rtrim($_SERVER['DOCUMENT_ROOT'], '/\\');
        $relative_path = str_replace($document_root, '', $base_dir);
        $relative_path = str_replace('\\', '/', $relative_path);
        
        define('T2EDITOR_PATH', $base_dir);
        define('T2EDITOR_URL', $protocol . $host . $relative_path);
        define('T2EDITOR_DATA_PATH', T2EDITOR_PATH.'/data');
        define('T2EDITOR_DATA_URL', T2EDITOR_URL.'/data');
        define('T2EDITOR_DIR_PERMISSION', 0755);
        define('T2EDITOR_FILE_PERMISSION', 0644);
    }
}

// 데이터 디렉토리 생성
if (!is_dir(T2EDITOR_DATA_PATH)) {
    @mkdir(T2EDITOR_DATA_PATH, T2EDITOR_DIR_PERMISSION, true);
    @chmod(T2EDITOR_DATA_PATH, T2EDITOR_DIR_PERMISSION);
}
?>
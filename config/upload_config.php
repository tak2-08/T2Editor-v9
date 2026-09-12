<?php
//Path: T2Editor/config/upload_config.php

/**
 * T2Editor 업로드 설정 파일
 * 모든 업로드 관련 설정을 통합 관리
 */

// 업로드 최대 허용 용량 (MB 단위)
define('T2EDITOR_MAX_UPLOAD_SIZE', 50);

// 허용 확장자 목록 (카테고리별)
$t2editor_allowed_extensions = array(
    // 문서 파일
    'document' => array(
        'pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 
        'hwp', 'odt', 'ods', 'odp', 'rtf'
    ),
    
    // 이미지 파일
    'image' => array(
        'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'
    ),
    
    // 동영상 파일
    'video' => array(
        'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'm4v'
    ),
    
    // 기타 파일
    'other' => array(
        // 압축 파일
        'zip', 'rar', '7z', 'tar', 'gz', 'bz2',
        // 오디오 파일
        'mp3', 'm4a', 'wav', 'flac', 'aac', 'wma',
        // 기타
        'json', 'xml', 'csv'
    )
);

/**
 * 특정 카테고리의 허용 확장자 목록 반환
 * @param string $category 카테고리명 (document, image, video, other)
 * @return array 확장자 배열
 */
function get_allowed_extensions($category = null) {
    global $t2editor_allowed_extensions;
    
    if ($category && isset($t2editor_allowed_extensions[$category])) {
        return $t2editor_allowed_extensions[$category];
    }
    
    // 전체 확장자 목록 반환
    $all_extensions = array();
    foreach ($t2editor_allowed_extensions as $cat => $extensions) {
        $all_extensions = array_merge($all_extensions, $extensions);
    }
    return $all_extensions;
}

/**
 * 이미지 확장자만 반환
 * @return array 이미지 확장자 배열
 */
function get_image_extensions() {
    return get_allowed_extensions('image');
}

/**
 * 비디오 확장자만 반환
 * @return array 비디오 확장자 배열
 */
function get_video_extensions() {
    return get_allowed_extensions('video');
}

/**
 * 문서 확장자만 반환
 * @return array 문서 확장자 배열
 */
function get_document_extensions() {
    return get_allowed_extensions('document');
}

/**
 * 기타 확장자만 반환
 * @return array 기타 확장자 배열
 */
function get_other_extensions() {
    return get_allowed_extensions('other');
}

/**
 * 파일 확장자가 허용되는지 확인
 * @param string $filename 파일명
 * @param string|array $categories 허용할 카테고리 (문자열 또는 배열)
 * @return bool 허용 여부
 */
function is_allowed_extension($filename, $categories = null) {
    $file_ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    
    if ($categories === null) {
        // 모든 카테고리 허용
        $allowed = get_allowed_extensions();
    } elseif (is_string($categories)) {
        // 단일 카테고리
        $allowed = get_allowed_extensions($categories);
    } elseif (is_array($categories)) {
        // 다중 카테고리
        $allowed = array();
        foreach ($categories as $category) {
            $allowed = array_merge($allowed, get_allowed_extensions($category));
        }
    } else {
        return false;
    }
    
    return in_array($file_ext, $allowed);
}

/**
 * 파일 크기가 허용 범위인지 확인
 * @param int $file_size 파일 크기 (바이트)
 * @return bool 허용 여부
 */
function is_allowed_file_size($file_size) {
    $max_size = T2EDITOR_MAX_UPLOAD_SIZE * 1024 * 1024; // MB를 바이트로 변환
    return $file_size <= $max_size;
}

/**
 * 파일이 업로드 가능한지 종합 검사
 * @param string $filename 파일명
 * @param int $file_size 파일 크기 (바이트)
 * @param string|array $categories 허용할 카테고리
 * @return array 결과 배열 ['success' => bool, 'message' => string]
 */
function validate_upload_file($filename, $file_size, $categories = null) {
    // 확장자 검사
    if (!is_allowed_extension($filename, $categories)) {
        return array(
            'success' => false, 
            'message' => '지원하지 않는 파일 형식입니다.'
        );
    }
    
    // 파일 크기 검사
    if (!is_allowed_file_size($file_size)) {
        return array(
            'success' => false, 
            'message' => '파일 크기가 너무 큽니다. (최대 ' . T2EDITOR_MAX_UPLOAD_SIZE . 'MB)'
        );
    }
    
    return array('success' => true, 'message' => '');
}

/**
 * 파일 타입 감지
 * @param string $filename 파일명
 * @return string 파일 타입 (document, image, video, other)
 */
function detect_file_type($filename) {
    global $t2editor_allowed_extensions;
    
    $file_ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    
    foreach ($t2editor_allowed_extensions as $type => $extensions) {
        if (in_array($file_ext, $extensions)) {
            return $type;
        }
    }
    
    return 'unknown';
}

/**
 * Accept 속성용 MIME 타입 문자열 생성
 * @param string|array $categories 카테고리
 * @return string accept 속성값
 */
function generate_accept_string($categories = null) {
    if ($categories === null) {
        $extensions = get_allowed_extensions();
    } elseif (is_string($categories)) {
        $extensions = get_allowed_extensions($categories);
    } elseif (is_array($categories)) {
        $extensions = array();
        foreach ($categories as $category) {
            $extensions = array_merge($extensions, get_allowed_extensions($category));
        }
    } else {
        return '';
    }
    
    $accept_parts = array();
    foreach ($extensions as $ext) {
        $accept_parts[] = '.' . $ext;
    }
    
    return implode(',', $accept_parts);
}

/**
 * JavaScript에서 사용할 설정 데이터 반환
 * @return array JavaScript용 설정 배열
 */
function get_js_config() {
    global $t2editor_allowed_extensions;
    
    return array(
        'maxUploadSize' => T2EDITOR_MAX_UPLOAD_SIZE,
        'allowedExtensions' => $t2editor_allowed_extensions,
        'acceptStrings' => array(
            'all' => generate_accept_string(),
            'image' => generate_accept_string('image'),
            'video' => generate_accept_string('video'),
            'document' => generate_accept_string('document'),
            'other' => generate_accept_string('other')
        )
    );
}
?>
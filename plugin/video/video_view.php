<?php
//Path: T2Editor/plugin/video/video_view.php

// 상대 경로 설정
$base_path = '../../../..';
include_once($base_path.'/common.php');

// 비디오 파일 경로 받기
$video_path = isset($_GET['video']) ? $_GET['video'] : '';

if (!$video_path) {
    die('비디오 파일을 찾을 수 없습니다.');
}

// 보안 검증
$video_url = $video_path;
if (strpos($video_url, 'http') !== 0) {
    // 상대 경로인 경우 절대 경로로 변환
    $video_url = G5_URL . '/' . ltrim($video_path, '/');
}

// 파일 확장자 확인
$ext = strtolower(pathinfo($video_url, PATHINFO_EXTENSION));
$allowed_types = ['mp4', 'webm', 'ogg'];

if (!in_array($ext, $allowed_types)) {
    die('지원하지 않는 비디오 형식입니다.');
}

// MIME 타입 설정
$mime_types = [
    'mp4' => 'video/mp4',
    'webm' => 'video/webm',
    'ogg' => 'video/ogg'
];

$mime_type = $mime_types[$ext] ?? 'video/mp4';
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Video Player</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            background: #000;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            overflow: hidden;
        }
        video {
            width: 100%;
            height: 100vh;
            object-fit: contain;
        }
    </style>
</head>
<body>
    <video controls autoplay>
        <source src="<?php echo htmlspecialchars($video_url); ?>" type="<?php echo $mime_type; ?>">
        브라우저가 비디오를 지원하지 않습니다.
    </video>
</body>
</html>
# T2Editor v9 배포본 매니페스트

**상태: EOL (지원 종료) — 이 계열의 모든 판본**
판본 7건 · 출처 시점 2026-09-27 · 배포 API `https://dsclub.kr/api/t2editor/version/index.php?action=list`

릴리즈 노트에 실리는 배포 설명 전문을 옮긴 기록이다.

---

## 1. v9.0.0

- **상태: EOL**
- 배포일: 2026-04-07
- 저장소 표제: T2Editor 9.0.0
- 브랜치: `releases/v9.0.0` · 태그: `v9.0.0`
- ZIP: `9.0.0.zip` (1882367 bytes)
- sha256: `06604ece24a70ce1388fd5bbba036f03a7fddf8c59ba688c2f41e6a2d20c8050`
- 배포 시점 유효 라이선스: **2.0.0**
- 라이선스 원본 위치: 배포본 안 `readme.txt`
- readme.txt: 포함 (sha256 `21416ea45a56cc77f0ea52ac4fc7bc3821e044efb7a36ab3e991a30d7c3e2cf5`)
- 배포 API 원본: <https://dsclub.kr/api/t2editor/version/index.php?action=download&version=9.0.0&file=0>

### 배포 설명

```text
1. T2Editor SafeAI추가- 자체 개발 nsfw필터로 유저가 악의적인 19금 이미지를 게시할 때 필터링 가능 (editor.lib.php에서 원하는 옵션으로 수정, 서버에서의 실행&브라우저에서의 실행 전부 지원)- 아직까지는 정확도가 매우 높은편은 아닌 베타버전으로, 문서와 19금 웹툰, 여성의 가슴 이미지 정도를 구분하며 필터링 가능
2. T2Meme 플러그인 추가
```

---

## 2. v9.1.0

- **상태: EOL**
- 배포일: 2026-04-19
- 저장소 표제: T2Editor 9.1.0
- 브랜치: `releases/v9.1.0` · 태그: `v9.1.0`
- ZIP: `9.1.0.zip` (6013571 bytes)
- sha256: `5e061355645101cbbb5c7b13d7376cea6c2a1f1c81a8a8a2dcfd96453831c12f`
- 배포 시점 유효 라이선스: **2.0.0**
- 라이선스 원본 위치: 배포본 안 `readme.txt`
- readme.txt: 포함 (sha256 `e8ffb71e518b33fed8b48b39c2443cb29738ec4f71930ec49dce316ea5ee5964`)
- 배포 API 원본: <https://dsclub.kr/api/t2editor/version/index.php?action=download&version=9.1.0&file=0>

### 배포 설명

```text
1. T2Editor SafeAI업그레이드 및 패치- NSFWJS의 v2-mid모델을 사용하여 (기대)정확도 향상(93%)- 경고 및 차단 관련 모달 디자인 개선&T2Editor SafeAI관련 안내 추가- 서버버전 nsfw모드 지원중단
```

---

## 3. v9.1.1

- **상태: EOL**
- 배포일: 2026-04-20
- 저장소 표제: T2Editor 9.1.1
- 브랜치: `releases/v9.1.1` · 태그: `v9.1.1`
- ZIP: `9.1.1.zip` (6014551 bytes)
- sha256: `e4b3dbbe81954a2bdf797e461e66e3dbd6aba801f7e1b0579d761b5669c91c22`
- 배포 시점 유효 라이선스: **2.0.0**
- 라이선스 원본 위치: 배포본 안 `readme.txt`
- readme.txt: 포함 (sha256 `f66424e718d13819e12ba8f1220d133814efa95525d9c982d18756e8bba216ed`)
- 배포 API 원본: <https://dsclub.kr/api/t2editor/version/index.php?action=download&version=9.1.1&file=0>

### 배포 설명

```text
그누보드5 환경에서 자동 저장 기능이 활성화된 상태로 관리자 페이지 게시판 관리를 사용할 경우, 이전에 저장된 에디터 내용이 의도치 않게 복원되어 게시판 설정 폼이 오염되거나 잘못된 스타일이 적용되는 문제가 있었습니다.이번 패치는 editor_lib.php 단독 수정으로, 그누보드5 관리자 페이지(/adm/) 진입 시 자동으로 다음 두 가지를 처리합니다.
자동 저장된 내용을 에디터에 복원하지 않음 자동 저장 토글을 비활성화 상태로 표시하여 현재 기능이 제한됨을 시각적으로 안내일반 사용자 페이지에서의 자동 저장 동작은 기존과 동일합니다.
```

---

## 4. v9.1.2

- **상태: EOL**
- 배포일: 2026-04-23
- 저장소 표제: T2Editor 9.1.2
- 브랜치: `releases/v9.1.2` · 태그: `v9.1.2`
- ZIP: `9.1.2.zip` (6063723 bytes)
- sha256: `1dff68a52fa93174d510d8b16b68798851a1ecc7ed77c3bb17f74156ffe02540`
- 배포 시점 유효 라이선스: **2.0.0**
- 라이선스 원본 위치: 배포본 안 `readme.txt`
- readme.txt: 포함 (sha256 `0e45656c4c9bf928838e0affd054994baedba2b20632b7a43d78cda63c92bc34`)
- 배포 API 원본: <https://dsclub.kr/api/t2editor/version/index.php?action=download&version=9.1.2&file=0>

### 배포 설명

```text
xss 취약점 패치 등 대규모 보안 패치를 진행하였습니다.본 버전은 T2Editor 
9. 
1. 2-alpha
1. 
0. 5와 동일합니다.*상세 업데이트 및 패치 감사 보고서: https://dsclub.kr/service/editor/document/?action=view&slug=t2editor-
9. 
1. 1-대비-
9. 
1. 2-alpha
1. 
0. 5-chatgpt-비교감사-보고서&branch=main업데이트 및 패치 요약:T2Editor 
9. 
1. 2-alpha
1. 
0. 5는 
9. 
1. 1 대비 보안 경계를 전반적으로 강화한 업데이트입니다.
업로드 검증이 확장자 중심에서 Origin·파일명·매직바이트·MIME·카테고리 검증 중심으로 개선되었습니다.
저장 콘텐츠 출력, 붙여넣기, 자동저장 복원, PDF 뷰어 처리도 더 안전하게 정리되었습니다.
협업 기능은 get 인가, host token 기반 권한 귀속, 0640 파일 권한, 750 운영 권고로 하드닝되었습니다.
결과적으로 파일·이미지·비디오·협업 사용 흐름이 
9. 
1. 1보다 더 안전하고 안정적으로 동작합니다.
```

---

## 5. v9.1.3

- **상태: EOL**
- 배포일: 2026-04-27
- 저장소 표제: T2Editor 9.1.3
- 브랜치: `releases/v9.1.3` · 태그: `v9.1.3`
- ZIP: `9.1.3.zip` (6115852 bytes)
- sha256: `be02214d430a05b2097c8c7bc4395f5ad733b6ba06cc4802c4d478f4c0f1359c`
- 배포 시점 유효 라이선스: **2.0.0**
- 라이선스 원본 위치: 배포본 안 `readme.txt`
- readme.txt: 포함 (sha256 `99a1f2d790d5a83ff916bf4b091e7231a9fa3f6f7cea369a627709274542f6e5`)
- 배포 API 원본: <https://dsclub.kr/api/t2editor/version/index.php?action=download&version=9.1.3&file=0>

### 배포 설명

```text
*세부 업데이트 및 패치 감사 보고서: https://dsclub.kr/service/editor/document/?action=view&slug=t2editor-
9. 
1. 2-
9. 
1. 3-alpha
1. 
1. 0-chatgpt업데이트-감사서요약:
1. 
9. 
1. 3-alpha
1. 
1. 0에서는 비디오·드로잉·이미지 등 미디어 블록의 저장 후 복구 안정성을 강화했습니다.
2. YouTube/비디오 URL 인식 범위를 넓히고, 저장 필터 환경에서도 재편집 시 블록이 깨질 가능성을 줄였습니다.
3. AI 재정렬, ClipURL, Meme 기능의 UI와 모바일 대응을 개선해 콘텐츠 삽입·검토 흐름을 더 명확하게 정리했습니다.
4. URL 정제, 플러그인 HTML 처리, iframe 허용 도메인 설정 등 보안 경계와 export 정리 로직을 보강했습니다.
```

---

## 6. v9.2.0

- **상태: EOL**
- 배포일: 2026-04-30
- 저장소 표제: T2Editor 9.2.0
- 브랜치: `releases/v9.2.0` · 태그: `v9.2.0`
- ZIP: `9.2.0.zip` (6146767 bytes)
- sha256: `a5e8b614bb4976db24319cb47afd1d86382ae0db834435e7e218f8b299c5a5d2`
- 배포 시점 유효 라이선스: **2.0.0**
- 라이선스 원본 위치: 배포본 안 `readme.txt`
- readme.txt: 포함 (sha256 `bdea9afea52a8c17fd5fa416211c97a338675902011b7fd10adb2d57f5c60e36`)
- 배포 API 원본: <https://dsclub.kr/api/t2editor/version/index.php?action=download&version=9.2.0&file=0>

### 배포 설명

```text
1. 일부 플러그인들 오작동 패치
2. 일부 필수 플러그인들 보안 패치 완료
3. 일부 플러그인들의 스타일 작동 미흡 패치
4. T2Editor 자체 내장 비디오 플레이어 추가 - 업로드 동영상 비디오 플레이어로 재생 여부 editor.lib.php에서 선택 가능
5. 이미지 플러그인 - 이미지 확대(전체)보기 기능 및 이미지 정보 보기 기능 추가, 이미지 드래그 시 모바일 다운로드 방지 처리 적용
```

---

## 7. v9.3.0

- **상태: EOL**
- 배포일: 2026-05-29
- 저장소 표제: T2Editor 9.3.0
- 브랜치: `releases/v9.3.0` · 태그: `v9.3.0`
- ZIP: `9.3.0.zip` (2497803 bytes)
- sha256: `2a648683ec067e996032aa40da9f1775bbd0eaaa2a95d513a27f30646e051b9f`
- 배포 시점 유효 라이선스: **2.0.0**
- 라이선스 원본 위치: 배포본 안 `readme.txt`
- readme.txt: 포함 (sha256 `790fd3c2b8d4b1f11b363342412f22e36ed88eced517fa03a8aeca7530bcae11`)
- 배포 API 원본: <https://dsclub.kr/api/t2editor/version/index.php?action=download&version=9.3.0&file=0>

### 배포 설명

```text
기능 추가사항:
1. 이미지 플러그인 - 사진 간편 편집 기능 추가​ ​ ​ ​ ​​패치 사항:
1. ios/safari 엔터키 및 공백 추가 버그 해결​개선:
1. 에디터 툴바 버튼 비율 및 사이즈 조정​
2. 에디터 로고 비율 및 사이즈 조정
3. 비디오 플레이어 사용법 시각화​​ ​ ​ ​
```

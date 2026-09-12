# T2Editor v9 — 배포본 아카이브

T2Editor **v9 계열 배포본 7개**(9.0.0 ~ 9.3.0).

> ## ⚠️ EOL — 지원 종료
>
> **T2Editor v9 계열은 지원이 끝났다(End of Life).** 이 저장소는 최종 상태의 보존용이다.
>
> - 이 계열에 대한 **기능 추가 · 버그 수정 · 보안 패치를 하지 않는다.**
> - 이 계열은 더 이상 배포되지 않는다. 여기 있는 것은 마지막 배포 상태 그대로다.
> - 신규 설치·마이그레이션은 [v10](https://github.com/tak2-08/T2Editor-v10)(현행 공개 판본) 또는 [v11](https://github.com/tak2-08/T2Editor-v11)(개발 중) 쪽을 본다.
> - 채택을 검토한다면 v1~v9 보다 [v10](https://github.com/tak2-08/T2Editor-v10) 을 본다. v1~v9 는 오래된 CMS·브라우저·PHP 환경만을 전제로 한다.

| 모양 | 위치 | 설명 |
|---|---|---|
| 브랜치 | `releases/v<판본>` | 그 판본 배포본을 **펼친 소스**. 브랜치 루트가 곧 서버에 올리는 `t2editor/` 폴더 |
| 태그 | `v<판본>` | 위 브랜치와 같은 커밋. `git checkout v9.3.0` 로 그 시점 트리가 나온다 |
| 릴리즈 | [Releases](https://github.com/tak2-08/T2Editor-v9/releases) | 원본 **ZIP 에셋**(sha256 대조값 첨부)이 올라간다 |

- ZIP 합계 33.1 MB · 판본 7개 · 상태 **EOL**
- 계열 전체 지원 상태: [v1](https://github.com/tak2-08/T2Editor-v1) · [v2](https://github.com/tak2-08/T2Editor-v2) · [v3](https://github.com/tak2-08/T2Editor-v3) · [v4](https://github.com/tak2-08/T2Editor-v4) · [v5](https://github.com/tak2-08/T2Editor-v5) · [v6](https://github.com/tak2-08/T2Editor-v6) · [v7](https://github.com/tak2-08/T2Editor-v7) · [v8](https://github.com/tak2-08/T2Editor-v8) · [v9](https://github.com/tak2-08/T2Editor-v9)(현재) · [v10](https://github.com/tak2-08/T2Editor-v10)
- v11 은 이 아카이브 범위가 아니다. [tak2-08/T2Editor-v11](https://github.com/tak2-08/T2Editor-v11) 참조.

> **가져오는 법** — 배포본이 필요하면 릴리즈 에셋 ZIP 이 가장 정확하다(원본 그대로, sha256 대조 가능).
> 소스를 들여다보려면 `git clone --branch releases/v<판본> --depth 1` 또는 `git checkout v<판본>`.

---

## 지원 상태

| 계열 | 상태 | 최종 판본 | 최종 배포일 | 아카이브 |
|---|---|---|---|---|
| v1 | EOL | `1.6.3` | 2025-05-01 | [T2Editor-v1](https://github.com/tak2-08/T2Editor-v1) |
| v2 | EOL | `2.0.0` | 2025-06-03 | [T2Editor-v2](https://github.com/tak2-08/T2Editor-v2) |
| v3 | EOL | `3.0.9` | 2025-10-06 | [T2Editor-v3](https://github.com/tak2-08/T2Editor-v3) |
| v4 | EOL | `4.0.2` | 2025-10-08 | [T2Editor-v4](https://github.com/tak2-08/T2Editor-v4) |
| v5 | EOL | `5.10.0` | 2025-12-08 | [T2Editor-v5](https://github.com/tak2-08/T2Editor-v5) |
| v6 | EOL | `6.0.0` | 2025-12-09 | [T2Editor-v6](https://github.com/tak2-08/T2Editor-v6) |
| v7 | EOL | `7.0.2` | 2025-12-19 | [T2Editor-v7](https://github.com/tak2-08/T2Editor-v7) |
| v8 | EOL | `8.2.0` | 2026-03-26 | [T2Editor-v8](https://github.com/tak2-08/T2Editor-v8) |
| v9 | **EOL** | `9.3.0` | 2026-05-29 | **T2Editor-v9** |
| v10 | 현행 공개 판본 | `10.5.1` | 2026-07-27 | [T2Editor-v10](https://github.com/tak2-08/T2Editor-v10) |
| v11 | 개발 중 | — | — | 별도 저장소([tak2-08/T2Editor-v11](https://github.com/tak2-08/T2Editor-v11)) |

**EOL(End of Life) 판정** — v9 계열은 최종 배포(9.3.0) 이후 새 배포가 없고 결함 수정도 하지 않는다. 이 저장소는 그 마지막 상태의 보존용이며, `9.3.0` 이후 배포는 없다.

---

## 저작권 안내 (Copyright Notice)

**T2Editor 의 저작권은 Tak2 (dsclub.kr) 에 있다.**

아래는 T2Editor 배포본 `readme.txt` 의 **전문 원문 그대로**다. 원본 파일은 저장소 루트 [`readme.txt`](readme.txt) 다.

> sha256 `d46dc52442a19ef201c0e77baed96a7eaf39ed758d2797a53b5bb8d0c0e5716a`

```text
Path: T2Editor/readme.txt
ver_11.0.0
date_2026.09.08
Copyright (c) 2025 Tak2 (dsclub.kr)
The_first.license_License_ko.txt & License_en.txt
email_dsclub2023@gmail.com

-___-

T2Editor License_Ko
Version: 3.0.0
Initial development period: 2025.01.23 - 2025.02.11
Copyright (c) 2025 Tak2 (dsclub.kr)

[한국어 버전]

저작권 및 소유권:
T2Editor의 저작권은 Tak2(dsclub.kr)에게 있습니다.
이메일: dsclub2023@gmail.com

사용 권한:
1. dsclub.kr에서 배포하는 T2Editor 코어 파일 및 기본 제공 플러그인:
   - 사용, 복사, 수정, 재배포 가능
   - 모든 배포물(수정본 포함)은 무료로 제공해야 함
   - 상업적 판매 금지

2. 외부 자체 개발 플러그인 및 관련 서비스:
   - T2Editor와 연동되는 독자 개발 플러그인의 유료 판매 허용
   - 자체 개발 플러그인 기반 유료 서비스(구독형 등) 제공 허용
   - 단, dsclub.kr 기본 제공 소프트웨어는 무료로 유지되어야 함
   - 플러그인은 T2Editor 본체의 핵심 기능을 무단으로 변경·우회·비활성화할 수 없음
   - 배포 시 "T2Editor 호환 플러그인"임을 명시해야 하며, DSc 또는 Tak2의 공식 제품으로 오인될 수 있는 표현은 사용할 수 없음
   - 유료 판매로 발생하는 수익, 환불, 분쟁, 세금 등 일체의 책임은 해당 개발자 본인에게 있음
   - DSc는 플러그인의 품질·보안성·지속 운영을 보증하지 않으며, 부적절하다고 판단되는 플러그인의 유통을 제한할 수 있음
   - T2 서비스의 코드, API, 호환 구조는 사전 공지 없이도 변경될 수 있으며, 이로 인해 서드파티 플러그인의 호환성이 깨지거나 정상 작동하지 않게 되는 경우 DSc 및 Tak2는 이에 대한 책임을 지지 않음

3. 파생 에디터 개발:
   - T2Editor를 기반으로 한 새로운 브랜드의 에디터 개발 허용
   - 단, 파생된 에디터 또한 본 약관, DSc의 정책, T2Editor 라이선스를 우선적으로 따라야 하며, 이에 반하는 별도 약관이나 정책을 적용할 수 없음

책임의 한계:
T2 서비스는 무상으로 제공되는 도구입니다. T2 서비스의 이용 과정에서 발생하는 데이터 손실, 콘텐츠 분쟁, 제3자와의 법적 분쟁, 기타 직·간접적 손해에 대하여 DSc(dsclub.kr) 및 Tak2는 어떠한 책임도 지지 않습니다. T2 서비스는 "있는 그대로(AS-IS)" 제공되며, 특정 목적에 대한 적합성, 안정성, 무결성을 명시적·묵시적으로 보증하지 않습니다.

약관의 개정:
DSc는 운영상 필요에 따라 본 약관을 개정할 수 있습니다. 약관이 개정되는 경우 적용 전 dsclub.kr 공지사항을 통해 사전에 고지하며, 개정된 약관은 공지된 시점 이후 배포되는 신규 버전 또는 공지에서 명시한 시점부터 적용됩니다. 신규 버전을 다운로드하거나 계속 이용하시는 경우 개정된 약관에 동의한 것으로 간주됩니다.

서비스 변경, 중단 및 유료화:
DSc는 운영상·정책상 사정에 따라 사전 공지를 통해 T2 서비스의 내용을 변경하거나, 서비스의 일부 또는 전부를 중단할 수 있습니다. 또한 T2 서비스는 현재 무상으로 제공되고 있으나, DSc는 사전 공지를 통해 일부 기능 또는 전체를 유료로 전환할 수 있으며, 적용 시점·대상 범위·요금 정책 등은 별도 공지를 통해 안내됩니다. 무상 제공 기간 동안의 이용이 향후 무상 이용을 보장하는 것은 아닙니다.

코드 및 호환 구조 변경에 대한 고지:
T2 서비스(T2Editor 및 연계 서비스 포함)의 소스코드, 내부 구조, API, 호환 방식 등은 DSc(dsclub.kr) 및 Tak2의 운영상 사정에 따라 사전 공지 없이 언제든지 변경될 수 있습니다. 이는 서비스 개선, 보안 조치, 정책 변경 등 다양한 사유로 발생할 수 있는 통상적인 운영 활동이며, 코드 및 구조 변경으로 인해 발생하는 모든 호환성 문제, 기능 오작동, 손해에 대하여 DSc 및 Tak2는 어떠한 책임도 지지 않습니다.

약관의 우선순위 및 서비스 종료 시 적용 기준:
T2Editor를 비롯한 dsclub 산하의 모든 T2 서비스는 dsclub.kr 공지사항 게시판에 게시된 약관 및 그 개정 내용을 우선적으로 따릅니다. DSc(dsclub.kr) 커뮤니티에 장애가 발생하거나 접속이 불가능한 경우, 또는 DSc가 영구적으로 서비스를 종료하는 경우, 이미 배포된 소프트웨어 제품은 해당 배포본을 다운로드한 시점에 유효했던 약관 및 라이선스를 따릅니다. dsclub.kr 공지사항 등을 통해 최신 약관 및 라이선스 확인이 불가능한 경우에는, 해당 소프트웨어 배포본에 포함된 라이선스 파일(readme.txt 등)을 최후의 기준으로 삼아 적용합니다.

제한사항:
- 저작권 고지 제거 또는 수정 금지
- dsclub.kr 기본 배포 파일의 상업적 판매 금지
- readme.txt 변경·삭제 또는 누락 후 재배포 금지

배포 및 문의:
최신 버전: https://dsclub.kr/service/editor
사용 안내: https://dsclub.kr/service/editor

이 라이선스는 2026년 6월 29일부터 유효합니다.

-___-

T2Editor License_En
Version: 3.0.0
Initial development period: 2025.01.23 - 2025.02.11
Copyright (c) 2025 Tak2 (dsclub.kr)

[English Version]

Copyright and Ownership:
T2Editor is copyrighted by Tak2 (dsclub.kr)
Email: dsclub2023@gmail.com

Usage Rights:
1. T2Editor core files and bundled plugins distributed by dsclub.kr:
   - Free to use, copy, modify, and redistribute
   - All distributions (including modified versions) must be provided free of charge
   - Commercial sale prohibited

2. Third-party developed plugins and related services:
   - Commercial sale of independently developed plugins that integrate with T2Editor is permitted
   - Paid services (e.g., subscription-based) based on third-party plugins are permitted
   - Core software distributed by dsclub.kr must remain free
   - Plugins may not modify, bypass, or disable core functions of T2Editor without authorization
   - Plugins must be clearly labeled as "T2Editor-compatible plugins" and must not use language that could be mistaken for an official DSc or Tak2 product
   - All responsibility for revenue, refunds, disputes, and taxes arising from paid plugin sales rests solely with the developer
   - DSc does not guarantee the quality, security, or continued operability of any plugin, and may restrict the distribution of plugins it deems inappropriate
   - The code, API, and compatibility structure of T2 Services may change at any time without prior notice, and DSc and Tak2 bear no responsibility for any resulting plugin incompatibility or malfunction

3. Development of derivative editors:
   - Development of a new, separately branded editor based on T2Editor is permitted
   - However, any such derivative editor must first and foremost comply with these Terms, DSc's policies, and the T2Editor license, and may not apply separate terms or policies that conflict with them

Limitation of Liability:
T2 Services are provided free of charge. DSc (dsclub.kr) and Tak2 bear no liability for any data loss, content disputes, disputes with third parties, or other direct or indirect damages arising from the use of T2 Services. T2 Services are provided "AS-IS," without any express or implied warranty of fitness for a particular purpose, stability, or integrity.

Amendment of Terms:
DSc may amend these Terms as operationally necessary. Any amendment will be announced in advance via a notice on dsclub.kr prior to taking effect. Amended Terms apply to new versions released after the notice, or from the date specified in the notice. Continued use or downloading of a new version constitutes acceptance of the amended Terms.

Service Changes, Suspension, and Monetization:
DSc may, for operational or policy reasons and with advance notice, change the content of T2 Services or suspend part or all of them. Although T2 Services are currently provided free of charge, DSc may, with advance notice, convert some or all features to a paid model; the timing, scope, and pricing of any such change will be announced separately. Use during a free period does not guarantee continued free use in the future.

Notice Regarding Changes to Code and Compatibility Structure:
The source code, internal structure, APIs, and compatibility methods of T2 Services (including T2Editor and linked services) may be changed at any time without prior notice, at the operational discretion of DSc (dsclub.kr) and Tak2. Such changes may occur for reasons including service improvement, security measures, or policy changes, and are considered ordinary operational activity. DSc and Tak2 bear no responsibility for any compatibility issues, malfunctions, or damages resulting from such changes.

Order of Precedence and Terms Applicable Upon Service Termination:
All T2 Services under dsclub, including T2Editor, are governed primarily by the Terms posted on the dsclub.kr notice board and any amendments thereto. In the event that the DSc (dsclub.kr) community experiences an outage, becomes inaccessible, or permanently ceases operation, already-distributed software products shall be governed by the Terms and license in effect at the time that particular distribution was downloaded. If the latest Terms and license cannot be verified through the dsclub.kr notice board, the license file included within the software distribution itself (e.g., readme.txt) shall serve as the final, last-resort governing reference.

Restrictions:
- Removal or modification of copyright notices is prohibited
- Commercial sale of core files distributed by dsclub.kr is prohibited
- Redistribution without readme.txt, or with a modified or deleted readme.txt, is prohibited

Distribution and Contact:
Latest version: https://dsclub.kr/service/editor
How to use: https://dsclub.kr/service/editor

This license is valid from June 29, 2026.
[번역 디렉터리 책임 분리]
- locales/<locale>.json: T2Editor 순수 코어 번역만 담당
- plugin/<plugin>/locales/<locale>.json: 해당 플러그인 번역만 담당
- extend/locales/<locale>.json: /extend 번들 확장 번역만 담당
- 플러그인 번역이 없거나 JSON 오류가 있어도 플러그인 등록/실행은 계속됨
- 플러그인은 자신의 폴더명과 같은 번역 네임스페이스만 주입 가능
자세한 내용: locales/README.txt, plugin/readme-locales.txt

# T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
```

판본별 라이선스 원문 위치:

| 위치 | 내용 |
|---|---|
| 저장소 루트 `readme.txt` | 최신 배포본(T2Editor v11)의 라이선스 원문. 라이선스 3.0.0 |
| `README.md` 위 절 | 같은 원문 전문 |
| 각 릴리즈 노트 「저작권 안내」 | 판본별 유효 라이선스 |
| `licenses/` | 판본대가 실제로 유효했던 라이선스 원문 |
| `releases/v<판본>` 트리의 `readme.txt` | 그 판본 배포본에 들어 있던 원본 |

### 이 시리즈 판본에 적용되는 라이선스

`readme.txt` 의 「약관의 우선순위 및 서비스 종료 시 적용 기준」 조항에 따라, 이미 배포된 소프트웨어 제품은 **그 배포본을 배포한 시점에 유효했던 라이선스**를 따른다. 그래서 이 시리즈의 판본은 서로 다른 라이선스 판본에 속한다. 판본표의 라이선스 값이 그 판본의 실제 조건이다.

| 판본 | 배포일 | 배포 시점 유효 라이선스 | 판본 안 원문 위치 |
|---|---|---|---|
| `v9.0.0` | 2026-04-07 | **2.0.0** | `readme.txt` |
| `v9.1.0` | 2026-04-19 | **2.0.0** | `readme.txt` |
| `v9.1.1` | 2026-04-20 | **2.0.0** | `readme.txt` |
| `v9.1.2` | 2026-04-23 | **2.0.0** | `readme.txt` |
| `v9.1.3` | 2026-04-27 | **2.0.0** | `readme.txt` |
| `v9.2.0` | 2026-04-30 | **2.0.0** | `readme.txt` |
| `v9.3.0` | 2026-05-29 | **2.0.0** | `readme.txt` |

판본대가 유효했던 라이선스 원문:

- [`licenses/readme-license-2.0.0.txt`](licenses/readme-license-2.0.0.txt)
- [`licenses/License_ko-v1.0.txt`](licenses/License_ko-v1.0.txt)
- [`licenses/License_en-v1.0.txt`](licenses/License_en-v1.0.txt)

공통 제한: **상업적 판매 금지 · 저작권 고지 제거·수정 금지 · readme.txt 변경·삭제·누락 후 재배포 금지 · 모든 배포는 무료.**

---

## 판본표 (오래된 순)

`sha256` 는 배포 API 가 함께 제공한 무결성값이다. 에셋을 받고 이 값과 대조하면 된다. **이 시리즈의 모든 판본은 EOL 이다.**

| # | 판본 | 배포일 | 라이선스 | ZIP | 크기 | sha256 (앞 16자) |
|---:|---|---|---|---|---:|---|
| 1 | [`v9.0.0`](releases/tag/v9.0.0) | 2026-04-07 | 2.0.0 | `9.0.0.zip` | 1.80 MB | `06604ece24a70ce1` |
| 2 | [`v9.1.0`](releases/tag/v9.1.0) | 2026-04-19 | 2.0.0 | `9.1.0.zip` | 5.73 MB | `5e061355645101cb` |
| 3 | [`v9.1.1`](releases/tag/v9.1.1) | 2026-04-20 | 2.0.0 | `9.1.1.zip` | 5.74 MB | `e4b3dbbe81954a2b` |
| 4 | [`v9.1.2`](releases/tag/v9.1.2) | 2026-04-23 | 2.0.0 | `9.1.2.zip` | 5.78 MB | `1dff68a52fa93174` |
| 5 | [`v9.1.3`](releases/tag/v9.1.3) | 2026-04-27 | 2.0.0 | `9.1.3.zip` | 5.83 MB | `be02214d430a05b2` |
| 6 | [`v9.2.0`](releases/tag/v9.2.0) | 2026-04-30 | 2.0.0 | `9.2.0.zip` | 5.86 MB | `a5e8b614bb4976db` |
| 7 | [`v9.3.0`](releases/tag/v9.3.0) | 2026-05-29 | 2.0.0 | `9.3.0.zip` | 2.38 MB | `2a648683ec067e99` |

전수 목록(릴리즈 노트 전문 포함)은 [`MANIFEST.md`](MANIFEST.md) · 기계 판독용은 [`manifest.json`](manifest.json).

---

## 출처와 무결성

| 항목 | 값 |
|---|---|
| 배포 페이지 | https://dsclub.kr/service/editor |
| 배포 API | `https://dsclub.kr/api/t2editor/version/index.php?action=list` |
| 판본 수 | 7 |
| 수집 시점 | 2026-09-27 |
| sha256 | 배포 API 가 판본별로 제공한다. 이 저장소의 값과 **전 판본 일치**한다. |
| ZIP | 원본 그대로. 압축 해제·수정 없음. |
| 브랜치 루트 | ZIP 안 최상위 `t2editor/` 접두사를 제거한 것. 서버에 올릴 때 이 루트를 `t2editor/` 로 이름 붙이면 된다. |
| 제외 대상 | `__MACOSX/`(ZIP 메타데이터), 디렉터리 엔트리 |
| 파일 모드 | ZIP 이 준 실행 비트를 따르고 그 외는 644/755 |

### 배포본 표기 불일치 (원본에 있는 것. 고치지 않고 기록한다)

아래는 배포본과 배포 API 사이의 어긋남이다. 아카이브의 원칙은 원본 보존이므로 어느 것도 수정하지 않는다.

- `readme.txt` 의 `date_` 값이 배포 시점과 다름: `9.0.0`(readme `2026.04.06` vs API `2026-04-07`), `9.3.0`(readme `2026.05.28` vs API `2026-05-29`)
- 판본 표의 배포일은 **배포 API 의 `release_date`** 다(실제 배포일). `readme.txt` 머리말의 `date_` 는 판본마다 갱신되지 않은 값이 여럿이라 그 값은 쓰지 않는다.
- `readme.txt` 머리말과 배포일이 일치하는 판본: `9.1.0`, `9.1.1`, `9.1.2`, `9.1.3`, `9.2.0`.

---

## 자주 쓰는 명령

```bash
# 특정 판본 소스만 받기
git clone --depth 1 --branch releases/v9.3.0 https://github.com/tak2-08/T2Editor-v9.git t2editor-9.3.0

# 태그로 특정 시점 트리
git fetch --depth 1 origin tag v9.3.0

# 에셋 무결성 확인
sha256sum 9.3.0.zip   # 위 표 / manifest.json 의 값과 대조
```

## 문의

T2Editor 관련: dsclub2023@gmail.com · 최신 배포: https://dsclub.kr/service/editor


# SUPER-GENERAL-VOD 채팅 추출기 1.0.2v (Chrome Extension)

치지직이나 숲의 다시보기 VOD의 채팅 로그를
엑셀파일(재생시간, 닉네임, id, 메시지)로 추출하는 크롬 확장 프로그램입니다.

## 사용법
1. VOD 주소 입력
   (예: `https://chzzk.naver.com/video/1234567`, `https://vod.sooplive.co.kr/player/987654321`,
   다중 작업 예시: `https://chzzk.naver.com/video/1111111https://vod.sooplive.co.kr/player/222222222https://vod.sooplive.co.kr/player/333333333`)
2. 시작/종료 시각(선택): `hh:mm:ss` (숲은 워낙 속도가 빨라서 기능을 지원하지 않습니다)
3. [추출하기 (CSV)] 버튼 클릭
4. 진행률 바를 확인하고, 완료 시 자동 다운로드
5. 팝업을 닫아도 작업은 백그라운드에서 계속 진행됩니다

## 주요 기능
- CSV 추출: 재생시간, 닉네임, 메시지 3COLUMN 으로 구성
- 원본 JSON(관리자용): API 응답 포맷(content.videoChats) 유지, 모든 페이지 합본
- 시간 구간 추출: 시작/종료 시각(hh:mm:ss) 지정 가능

## 권한 설명
- downloads: 사용자가 요청한 CSV/JSON 파일 저장
- storage: VOD URL/시간 구간 로컬 저장(자동 복원)
- host_permissions: `https://api.chzzk.naver.com/*` VOD 메타/채팅 API 호출

## 개인정보 및 데이터 처리
- 개인 식별 정보 수집/전송 및 쿠키 저장 없음
- 입력한 VOD URL/시간 구간만 브라우저 로컬 저장소(chrome.storage)에 보관
- 네트워크 호출은 `api.chzzk.naver.com`의 VOD 메타/채팅 API에 한정

## EEA Trader Disclosure
- 배포 형태: 무료

## 프로젝트 구조
.  
├─ manifest.json  
├─ background.js # 수집/가공/저장(서비스 워커)  
├─ popup.html # 팝업 UI  
├─ popup.css # 팝업 스타일(막대형 진행률 포함)  
├─ popup.js # 팝업 로직(메시징, 진행률 갱신, 입력값 저장/복원)  
└─ icons/ # 아이콘(16/32/48/128px)  

## 배포
1. (Chrome Web Store)
2. git clone ㄱㄱ
3. 소스 ZIP 

## 사용 예시 (영상)
- 팝업 화면(입력/버튼)
- 진행률 바 동작
- 완료 후 CSV/JSON 다운로드 알림
- CSV를 스프레드시트에서 연 화면

## 대용량 처리
- 서비스 워커에서 Blob URL 대신 data: URL로 저장
- 파일 크기 임계치(기본 20MB) 초과 시 자동 분할 저장
  - CSV: `_p001.csv`, `_p002.csv` …
  - JSON: `_p001.json`, `_p002.json` …

## 변경 이력
- 1.0.2
  - 치지직과 SOOP 모두 지원가능하도록 탑제되었습니다
  - 다수의 링크를 한꺼번에 입력이 가능해졌습니다

## 개발 메모
- CSV 컬럼
- 치지직 : "재생시간,닉네임,메시지"
- SOOP : "재생시간,닉네임,id,메시지"

## 라이선스
이 프로젝트는 MIT 라이선스를 따릅니다.

# SUPER-GENERAL-VOD 채팅 추출기 1.0.2v (Chrome Extension)

치지직이나 숲의 다시보기 VOD의 채팅 로그를
엑셀파일(재생시간, 닉네임, id, 메시지)로 추출하는 크롬 확장 프로그램입니다.


## 배포
크롬 웹 스토어에서 배포중
https://chromewebstore.google.com/detail/nifbkfnomjbfgjmjdeblbmbadcgegiga?utm_source=item-share-cb


## 사용법
1. VOD 주소 입력
   (예: `https://chzzk.naver.com/video/1234567`,
`https://vod.sooplive.co.kr/player/987654321`,

   다중 작업 예시: `https://chzzk.naver.com/video/1111111https://vod.sooplive.co.kr/player/222222222https://vod.sooplive.co.kr/player/333333333`)

3. 시작/종료 시각(선택): `hh:mm:ss` (숲은 워낙 속도가 빨라서 기능을 지원하지 않습니다)
4. [추출하기 (CSV)] 버튼 클릭
5. 진행률 바를 확인하고, 완료 시 자동 다운로드
6. 팝업을 닫아도 작업은 백그라운드에서 계속 진행됩니다


## 권한 설명
- downloads: 사용자가 요청한 CSV/JSON 파일 저장
- storage: VOD URL/시간 구간 로컬 저장(자동 복원)
- host_permissions: `https://api.chzzk.naver.com/*` VOD 메타/채팅 API 호출

## 개인정보 및 데이터 처리
- 개인 식별 정보 수집/전송 및 쿠키 저장 없음
- 입력한 VOD URL/시간 구간만 브라우저 로컬 저장소(chrome.storage)에 보관
- 네트워크 호출은 `api.chzzk.naver.com`의 VOD 메타/채팅 API에 한정



## 변경 이력
- 1.0.2
  - 치지직과 SOOP 모두 지원가능하도록 탑제되었습니다 + 치지직도 유저의 id를 포함하도록 변경하였습니다
  - 다수의 링크를 한꺼번에 입력이 가능해졌습니다


## 라이선스
이 프로젝트는 MIT 라이선스를 따릅니다.

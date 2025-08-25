const PROGRESS_KEY = "soop_progress";
let job; // 실행중 작업상태 보관
let run = false;
let pct = 0; //진행률 백분율

// vod 채팅 전체 스크래핑 함수
async function soopchatcatch_full(urlcode, res) {
  
  // vod api res 가공
  let res_ = JSON.parse(JSON.stringify(JSON.parse(JSON.stringify(res)).data)); // data 접근
  let res__ = JSON.parse(JSON.stringify(res_.files)); // data.files 접근
  let rowkeys = getfiles(res__, "chat"); // ["http~rowkey1_c", "http~rowkey2_c", ...] (full url 불러오기)
  let rowkey_durations = getfiles(res__, "duration"); // [18000000, 8482784, ...] (ms 단위)
  let duration = res_.total_file_duration; // vod 전체 길이 (ms 단위)
  let vod_data = { // 저장시 필요한 자료
    nick: res_.writer_nick,
    id: res_.bj_id,
    vod_url_code: urlcode,
    date: res_.write_tm.split(" ~ ")[1].substring(0, 10)
  };

  // rowkeys 기반으로 반복문 실행 (5시간 혹은 카테고리로 나누어진 php-xml 주소)
  let stack_chat = []; // result
  for (const [i, rowkey] of rowkeys.entries()) {
    stack_chat = stack_chat.concat(await getchatfromisokey(rowkey, rowkey_durations, duration, i));
  }
  await setProgress(100, "-저장중-");
  await saveCSV_dataURLSmart(reformatChatData(stack_chat), vod_data);
  run = false;
  await setProgress(100, "");
}

// rowkey 하나에서 xml 데이터 추출
async function getchatfromisokey(
  rowkey, // 현재 읽을 rowkey
  rowkey_durations, //rowkey_duration array자료
  d, // vod 총 길이 (ms)
  r  // 읽고있는 rowkey의 index값
  ) {
  let rowkey_duration = rowkey_durations[r];
  let stack = [];
  let stack_ = [];
  let startTime = 0;
  let s = 0;
  let lastxml = null;
  let h5 = 0;
  let h1 = 0;
  if (r > 0){
    for (const j of (rowkey_durations.slice(0, r))){
      s += ~~(j / 1000);
    }
  }
  run = true;

  while(true) {
    if (startTime > 18000 || startTime == ((rowkey_duration / 3600) * 3600 + 3600) || h5 > 1) {
      await setProgress((startTime - 3600), `카테고리 점프`, d, r, s);
      break;
    }
    if (h1 > 1) { // h1 청크가 비었으면 1시간 점프 (404에러로 검증)
      await setProgress(startTime, `1시간 점프`, d, r, s);
      startTime += 3600;
      h1 = 0;
    }
    try {
      let res;
      try {
        res = await fetch(`${rowkey}&startTime=${startTime}`, { cache: "no-store" });
      } catch (e) {
        await setProgress(startTime, `자료 찾는 중.. ${e?.message || e}`, d, r, s);
        await sleep(600);
        continue;
      }
      if (!res.ok){
        if (res.status == 500) {
          h5++;
        }
        if (res.status == 404) {
          h1++;
        }
        await sleep(600);
        continue;
      }
      const xmlText = await res.text();
      const rows = xmltojson(xmlText);
      if (lastxml && lastxml === xmlText){
        await setProgress(startTime, `1시간 점프`, d, r, s);
        startTime = Math.floor(startTime / 3600) * 3600 + 3600; // 1시간 점프
        stack = stack.concat(rows);
        continue;
      }
      if (rows.length === 0){
        await setProgress(startTime, `0 점프`, d, r, s);
        startTime = Math.floor(startTime / 3600) * 3600 + 3600; // 1시간 점프
        continue;
      }
      stack = stack.concat(rows);
      startTime = rows[rows.length - 1]?.재생시간 ?? startTime;
      lastxml = xmlText;
      await setProgress(startTime, `startTime 갱신: ${startTime}`, d, r, s);
      continue;
    } catch (e) {
      await setProgress(startTime, `오류(01): ${e?.message || e}`, d, r, s);
      await sleep(600);
      continue;
    }
  }
  for (const r of stack) {
    const k = `${r.재생시간}|${r.닉네임}|${r.id}|${r.메시지}`;
      if (!stack_.includes(k)){
      stack_.push(r);
    }
  }
  //rowkey로 점프된 만큼 시간 수정
  if(r > 0){
     for (const item of stack_) {
      const t = item.재생시간;
      item.재생시간 = t + s;
    }
  }
  return stack_;
}

// vod api 받아오기
async function getvodperse(urlcode) {
  run = true;
  await setProgress(0, "-getvodapi-")
  await fetch('https://api.m.sooplive.co.kr/station/video/a/view', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      body: `nTitleNo=${encodeURIComponent(urlcode)}&nApiLevel=11&nPlaylistIdx=0`
    })
    .then(response => {
      return response.json();
    })
    .then(data => {
      soopchatcatch_full(urlcode, data);
    })
    .catch(error => {
      console.log(error);
      console.error('에러 발생:', error);
    });
}


// popup 버튼과 연동
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req?.type === "START_CSV") {
    const soop_vod_url = req?.soop_vod_url?.trim();
    if (!soop_vod_url) {
      sendResponse({ ok: false, message: "URL이 비어있습니다" });
      return;
    }
    
    if (run) {
      sendResponse({ ok: false, message: "이미 작업이 실행 중입니다" });
      return;
    }

    getvodperse(extractVideoId(soop_vod_url)).then(() => {}).catch((e) => console.error(e));
    sendResponse({ ok: true });
    return;
  }
  
  // 초기화 요청 처리 추가
  if (req?.type === "RESET_APP") {
    location.reload();
  }
});

function convertTimeFormat(data) { // time 값을 "시간:분:초" 형식으로 변환하는 함수 
    const hours = Math.floor(data / 3600);
    const minutes = Math.floor((data % 3600) / 60);
    const seconds = data % 60;
    const formattedHours = String(hours).padStart(2, '0');
    const formattedMinutes = String(minutes).padStart(2, '0');
    const formattedSeconds = String(seconds).padStart(2, '0');
  
  return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}

function stripCDATA(s) {
  if (typeof s !== 'string') return s;
  const m = s.match(/^<!\[CDATA\[(.*)\]\]>$/s);
  return m ? m[1] : s;
}

function stripn(id) {
  if (typeof id !== 'string') return id;
  return id.replace(/\(\s*\d+\s*\)$/, '');
}

function reformatChatData(data) {
  for (const item of data) {
    item.재생시간 = convertTimeFormat(item.재생시간);
    item.닉네임 = stripCDATA(item.닉네임);
    item.메시지 = stripCDATA(item.메시지);
    item.id = stripn(item.id);
  }
  return data;
}

// vod api data -> array화
function getfiles(aaa, address) {
  let bbb = [];
  let ccc = [];
  aaa = JSON.parse((JSON.stringify(aaa)));
  for (let aaa1 = 0; aaa1 < aaa.length; aaa1++){
    bbb.push(aaa[aaa1]); // bbb => [aaa[0], aaa[1], ...] 그런데 type => [object Object]임
  }
  for (let bbb1 = 0; bbb1 < bbb.length; bbb1++){
    ccc.push(JSON.parse((JSON.stringify(bbb[bbb1])))[address]); // ccc => ["rowkey1", "rowkey2", ...]
  }
  return ccc
}

// 진행률 저장
async function setProgress(a, text="-await-", b=null, rowkey_n=-1, s=0) {
  let pct = 0;
  if (s > 0) {
    pct = Math.max(0, Math.min(100, ~~(((a + s) / b) * 100000)));
  } else {
    pct = Math.max(0, Math.min(100, ~~(a / b * 100000)));
  }
  console.log(pct, a , text, b, s);
  try {
    chrome.runtime.sendMessage(
      { type: 'PROGRESS', payload: { pct, text } },
      () => { void chrome.runtime.lastError; } // 리스너 없으면 무시
    );
  } catch (_) { /* 무시 */ }
}

// url 입력값에서 vod ID 숫자만 추출
function extractVideoId(url) {
  let result = '';
  for (let i = 0; i < url.length; i++) {
    const char = url.charAt(i);
    // 각 문자가 숫자인지 확인
    if (char >= '0' && char <= '9') {
      result += char;
    }
  }
  return result;
}

// sleep 함수 재지정
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// XML 파싱 함수
function xmltojson(xmlText) {
  // service worker 환경 호환을 위해 간단 파서(정규식) 사용
  const chats = [];
  const blocks = xmlText.match(/<chat>[\s\S]*?<\/chat>/g) || [];
  for (const blk of blocks) {
    const pick = (tag) => {
      const m = blk.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? m[1] : "";
    };
    const t = ~~(pick("t")) || 0;
    const u = pick("u");
    const n = pick("n");
    const m = (pick("m") || "").replace(/\r\n/g, "\n");
    chats.push({ 재생시간: t, 닉네임: n, id: u, 메시지: m });
    // 시간, id, 닉네임, 메시지 array 반환
  }
  return chats;
}

// ===== 저장(서비스 워커: data: URL + 자동 분할) =====
const MAX_DATAURL_BYTES = 20 * 1024 * 1024; // 20MB 임계치
const JSON_CHATS_PER_PART = 50000;          // JSON 파트당 채팅 수(가이드)

function utf8Size(str) { return new TextEncoder().encode(str).length; }
function esc(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }

async function saveCSV_dataURLSmart(rows, fileInfo) {
  const header = '재생시간,닉네임,id,메시지\n';
  const bom = '\ufeff';

  // 단일 파일 시도
  let whole = bom + header;
  for (const r of rows) whole += [esc(r.재생시간), esc(r.닉네임), esc(r.id), esc(r.메시지)].join(',') + '\n';
  if (utf8Size(whole) <= MAX_DATAURL_BYTES) {
    const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(whole);
    const filename = `[${fileInfo.date}]_${fileInfo.nick}_${fileInfo.id}_${fileInfo.vod_url_code}.csv`;
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
    return;
  }

  // 분할 저장
  let part = 1;
  let chunk = bom + header;
  let chunkBytes = utf8Size(chunk);

  const commit = async () => {
    const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(chunk);
    const filename = `[${fileInfo.date}]_${fileInfo.nick}_${fileInfo.id}_${fileInfo.vod_url_code}_d_p${String(part).padStart(3, '0')}.csv`;
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
    part += 1;
    chunk = bom + header;
    chunkBytes = utf8Size(chunk);
  };

  for (const r of rows) {
    const line = [esc(r.재생시간), esc(r.닉네임), esc(r.id), esc(r.메시지)].join(',') + '\n';
    const lineBytes = utf8Size(line);
    if (chunkBytes + lineBytes > MAX_DATAURL_BYTES) await commit();
    chunk += line;
    chunkBytes += lineBytes;
  }
  if (chunkBytes > utf8Size(bom + header)) await commit();
}

function buildJsonPayloadString(template, chatsSlice) {
  const payload = template ? JSON.parse(JSON.stringify(template)) : { content: {} };
  if (!payload.content || typeof payload.content !== 'object') payload.content = {};
  payload.content.videoChats = chatsSlice;
  return JSON.stringify(payload, null, 2);
}

async function saveJSON_dataURLSmart(rawChats, fileInfo, rawTemplate) { // json 저장용
  // 단일 파일 시도
  let jsonStr = buildJsonPayloadString(rawTemplate, rawChats);
  if (utf8Size(jsonStr) <= MAX_DATAURL_BYTES) {
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonStr);
    const filename = `raw_[${fileInfo.date}]_${fileInfo.nick}_${fileInfo.id}_${fileInfo.vod_url_code}.json`;
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
    return;
  }

  // 분할 저장
  let part = 1;
  for (let i = 0; i < rawChats.length; i += JSON_CHATS_PER_PART) {
    const slice = rawChats.slice(i, i + JSON_CHATS_PER_PART);
    let partStr = buildJsonPayloadString(rawTemplate, slice);

    // 파트가 너무 크면 보수적으로 더 쪼갬
    while (utf8Size(partStr) > MAX_DATAURL_BYTES && slice.length > 1) {
      const half = Math.max(1, Math.floor(slice.length / 2));
      slice.length = half;
      partStr = buildJsonPayloadString(rawTemplate, slice);
    }

    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(partStr);
    const filename = `raw_[${fileInfo.date}]_${fileInfo.nick}_${fileInfo.id}_${fileInfo.vod_url_code}_p${String(part).padStart(3, '0')}.json`;
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
    part += 1;
  }
}
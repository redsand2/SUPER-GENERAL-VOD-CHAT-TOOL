const PROGRESS_KEY = "super_vod_chat_tool";
const withJitter = (ms) => Math.max(50, Math.round(ms * (0.85 + Math.random() * 0.3)));
const fl = /(?:sooplive\.co\.kr\/player\/(?<soop>\d+)|chzzk\.naver\.com\/video\/(?<chzzk>\d+))/g;
let job = {
  run: false,
  mode: "hold", // 'soop' | 'chzzk'
  startMs: 0,
  endMs: Infinity,
  urlcode: "",
  got: 0,
  count: 0,
  startedAt: Date.now(),
  aborter: null,
  rawChats: [],
  durationMs: 0,
  fileInfo: null,
  pct: 0,
  metadata: null
}; // 실행중 작업상태 보관
let pct = 0; //진행률 백분율
let debug = false;

async function chainworker(urls) {
  for(const url_iso of urls) {
    for (const {site, id} of url_iso) {
      if (site == 'chzzk' || id.length == 7) {
        job.mode = 'chzzk';
        await chzzkchatcatch_full(id);
      } else {
        if (site == 'soop' || id.length == 9) {
          job.mode = 'soop';
          await getvodperse(id);
        }
      }
    }
  }
  console.log('chain is done', job);
}

async function chzzkchatcatch_full(urlcode) {
  job.urlcode = urlcode;
  job.pct = 0;
  job.got = 0;
  job.count = 0;
  job.startedAt = Date.now();
  job.aborter = new AbortController();
  job.rawChats = [];
  job.metadata;
  
  
  job.metadata = await fetchWithRetry(`https://api.chzzk.naver.com/service/v2/videos/${job.urlcode}`, job.aborter.signal);
  const content = job.metadata?.content ?? {};
  const channelName = content?.channel?.channelName ?? content?.channelName ?? '채널미상';
  const candidates = [content?.openDate, content?.publishDate, content?.publishedAt, content?.createdAt, content?.createdDate, content?.openAt];
  const rawDate = candidates.find(v => typeof v === 'string' && v.length > 0) ?? null;
  const openDate = toYMD(rawDate) ?? '날짜미상';
  //const ChannelId = content?.channel?.channelId ?? "";
  job.durationMs = content?.duration * 1000 ?? null;
  job.fileInfo = { nick: channelName, date: openDate, id: '', vod_url_code: job.urlcode};

  const csvRows = [];
  let rawTemplate = null;
  const BASE_PAGE_DELAY = 150;
  const MAX_EMPTY_RETRY = 3;
  const MAX_STALL_RETRY = 3;
  const STALL_JUMP_MS = 1;

  const resTimes = [];
  const updateDelay = (base) => {
    const n = resTimes.length; if (n === 0) return base;
    const avg = resTimes.reduce((a,b)=>a+b,0)/n;
    if (avg < 200) return 120; if (avg < 400) return 150; if (avg < 600) return 200; return 300;
  };

  const hasEnd = Number.isFinite(job.endMs);
  let ti = Math.max(0, job.startMs | 0);
  let emptyRetry = 0;
  let lastProgressTime = job.startMs - 1;
  let stallRetry = 0;
  let page = 0;
  let pageDelay = BASE_PAGE_DELAY;

  await setProgress(-1, '치지직 작업 중');
/*
  const sendProgress = () => {
    chrome.runtime.sendMessage({ type: 'PROGRESS', payload: { percent: job.pct, got: job.got, count: job.count } }).catch(()=>{});
    chrome.storage.session.set({ jobSnapshot: { run: job.run, percent: job.pct, got: job.got, count: job.count } });
  }; */
  try {
    while (job.run) {
      const apiUrl = `https://api.chzzk.naver.com/service/v1/videos/${urlcode}/chats?playerMessageTime=${ti}`;
      const t0 = performance.now();
      const data = await fetchWithRetry(apiUrl, { signal: job.aborter.signal });
      const t1 = performance.now();
      const resTime = t1 - t0;
      resTimes.push(resTime); if (resTimes.length > 5) resTimes.shift();

      const chats = data?.content?.videoChats || [];

      // JSON 템플릿(첫 페이지 상단 구조 보존)
      if (!debug && !rawTemplate) {
        try {
          const contentMeta = {};
          if (data?.content && typeof data.content === 'object') {
            for (const k of Object.keys(data.content)) if (k !== 'videoChats') contentMeta[k] = data.content[k];
          }
          rawTemplate = {
            ...Object.fromEntries(Object.entries(data || {}).filter(([k]) => k !== 'content')),
            content: contentMeta
          };
        } catch { rawTemplate = { content: {} }; }
      }

      if (chats.length === 0) {
        emptyRetry++;
        if (emptyRetry >= MAX_EMPTY_RETRY) break;
        await sleep(withJitter(Math.max(pageDelay, 500)));
        continue;
      }
      emptyRetry = 0;

      let pageMaxTime = -1;
      for (const chat of chats) {
        const pm = chat.playerMessageTime ?? 0;
        pageMaxTime = Math.max(pageMaxTime, pm);
        if (pm < job.startMs || (hasEnd && pm > job.endMs)) continue;
        // JSON 모드: 원본 합치기
        if (debug) {
          job.rawChats.push(chat);
        } else {
          // 닉네임
          let nickname = '알 수 없는 사용자';
          try {
            if (chat.profile) {
              const profileObj = JSON.parse(chat.profile);
              nickname = profileObj?.nickname || nickname;
            }
          } catch {}
          if (chat.userIdHash === 'SYSTEM_MESSAGE') nickname = '[SYSTEM]';

          // 본문
          let message = chat.content || '';
          if (chat.messageStatusType === 'CBOTBLIND') message = '클린봇이 부적절한 표현을 감지했습니다';

          // 채팅 필터
          const { prefix, nicknameOverride } = chzzkchatfixer(chat);
          if (nicknameOverride) nickname = nicknameOverride;
          const combinedMessage = prefix ? `${prefix} ${message}` : message;
          csvRows.push({ 재생시간: convertTimeFormat(pm, 1), 닉네임: nickname, id: chat.userIdHash, 메시지: combinedMessage });
        }
      }
      // 진행률
      const progressedMs = Math.max(0, Math.min(job.durationMs, job.endMs) - job.startMs);
      job.pct = Math.max(0, Math.min(100, Math.floor((ti / progressedMs) * 100)));

      job.got = chats.length;
      job.count = (debug ? job.rawChats.length : csvRows.length);
      await setProgress(-1, '치지직 작업 중');

      const last = chats[chats.length - 1];
      const lastTime = last?.playerMessageTime;
      if (typeof lastTime !== 'number') break;

      if (lastTime === lastProgressTime) {
        stallRetry++;
        if (stallRetry >= MAX_STALL_RETRY) { ti = lastTime + STALL_JUMP_MS; stallRetry = 0; }
        else ti = lastTime + 1;
      } else {
        ti = lastTime + 1;
        lastProgressTime = lastTime;
        stallRetry = 0;
      }

      if (hasEnd && lastProgressTime >= job.endMs) break;

      pageDelay = updateDelay(BASE_PAGE_DELAY);
      page++;
      await sleep(withJitter(pageDelay));
    }

    // 저장
    await setProgress(100, "저장중")
    if (debug) await saveJSON_dataURLSmart(job.rawChats, job.fileInfo, rawTemplate);
    else await saveCSV_dataURLSmart(csvRows, job.fileInfo);
    await setProgress(0, "완료")

    chrome.runtime.sendMessage({
      type: 'COMPLETE',
      payload: {
        mode,
        count: (debug ? job.rawChats.length : csvRows.length),
        fileInfo: job.fileInfo
      }
    }).catch(()=>{});

  } catch (err) {
    if (err?.name === 'AbortError') {
      chrome.runtime.sendMessage({ type: 'ABORTED' }).catch(()=>{});
    } else {
      chrome.runtime.sendMessage({ type: 'ERROR', payload: String(err?.message || err) }).catch(()=>{});
    }
  } finally {
    job.run = false;
    job.mode = null;
    job.aborter = null;
    chrome.storage.session.set({ jobSnapshot: { run: false, percent: job.pct, got: job.got, count: job.count } });
  }
}

// retry fetch 함수
async function fetchWithRetry(url, { retries = 5, baseDelay = 400, factor = 1.8, signal } = {}) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const res = await fetchJsonWithTimeout(url, { timeout: 15000, signal });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          let delay = baseDelay * Math.pow(factor, attempt);
          const ra = res.headers.get('Retry-After');
          if (res.status === 429 && ra && !Number.isNaN(Number(ra))) delay = Number(ra) * 1000;
          await sleep(withJitter(delay));
          attempt++;
          continue;
        }
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = baseDelay * Math.pow(factor, attempt);
      await sleep(withJitter(delay));
      attempt++;
    }
  }
}

async function fetchJsonWithTimeout(url, { timeout = 15000, signal } = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: signal || ctrl.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// soop vod 채팅 전체 스크래핑 함수
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

// soop vod api 받아오기
async function getvodperse(urlcode) {
  await setProgress(0, "-getvodapi-")
  await fetch('https://api.m.sooplive.co.kr/station/video/a/view', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      body: `nTitleNo=${urlcode}&nApiLevel=11&nPlaylistIdx=0`
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

// popup 버튼과 수신
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req?.type === "START") {
    const inputurl = req?.url?.trim();
    if (!inputurl) {
      sendResponse({ ok: false, message: "URL이 비어있습니다" });
      return;
    }
    if (job.run) {
      sendResponse({ ok: false, message: "이미 작업이 실행 중입니다" });
      return;
    }
    job.run = true;
    job.startMs = req?.timeStart ?? 0;
    job.endMs = Number.isFinite(req?.timeEnd) ? req?.timeEnd : Infinity;
    chainworker(WhereareyoufromUrl(inputurl)).then(() => {}).catch((e) => console.error(e));
    sendResponse({ ok: true });
    return;
  }
  
  // 초기화 요청 처리 추가
  if (req?.type === "RESET_APP") {
    location.reload();
  }
});

function convertTimeFormat(data, ms=0) { // time 값을 "시간:분:초" 형식으로 변환하는 함수
  if (ms == 1) {
    data = Math.floor(data / 1000);
  }
  const hours = Math.floor(data / 3600);
  const minutes = Math.floor((data % 3600) / 60);
  const seconds = data % 60;
  const formattedHours = String(hours).padStart(2, '0');
  const formattedMinutes = String(minutes).padStart(2, '0');
  const formattedSeconds = String(seconds).padStart(2, '0');
  
  return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}

function stripCDATA(s) { // soop에서 xml에 붙는 <CDATA> 태그 삭제
  if (typeof s !== 'string') return s;
  const m = s.match(/^<!\[CDATA\[(.*)\]\]>$/s);
  return m ? m[1] : s;
}

function stripn(id) { // soop에서 id뒤에 붙는(2),(3)... 삭제
  if (typeof id !== 'string') return id;
  return id.replace(/\(\s*\d+\s*\)$/, '');
}

function reformatChatData(data) { //soop 전용 데이터 가공
  for (const item of data) {
    item.재생시간 = convertTimeFormat(item.재생시간);
    item.닉네임 = stripCDATA(item.닉네임);
    item.메시지 = stripCDATA(item.메시지);
    item.id = stripn(item.id);
  }
  return data;
}

// soopvod api data -> array화
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
  return ccc;
}

// 진행률 저장 
async function setProgress(a, text="-await-", b=0, rowkey_n=-1, s=0) {
  let pct = 0;
  if(a == -1) { // chzzk일 경우 바로 pct 설정
    pct = job.pct;
  } else {
    if (s > 0) {
      pct = Math.max(0, Math.min(100, ~~(((a + s) / b) * 100000)));
    } else {
      pct = Math.max(0, Math.min(100, ~~(a / b * 100000)));
    } 
  }

  console.log(pct, text);
  try {
    chrome.runtime.sendMessage(
      { type: 'PROGRESS', payload: { pct, text } },
      () => { void chrome.runtime.lastError; } // 리스너 없으면 무시
    );
  } catch (_) { /* 무시 */ }
}

// url 입력값 분석 하여 array화
function WhereareyoufromUrl(url) {
  const multi = url.split('+');
  let url_a = [];
  for (let sin of multi) {
  let url_ = [...sin.matchAll(fl)].map(m => ({site: m.groups.soop
    ? 'soop'
    : m.groups.chzzk
    ? 'chzzk'
    : null,
  id: (m.groups.soop ?? m.groups.chzzk ?? null)}));
  url_a.push(url_)
  }
  return url_a; // [{site: code: }, ...]
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

// sooplive 전용 XML 파싱 함수
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

// 치지직 접두어 빌드(미션/영상/구독/구독권 선물) =====
function chzzkchatfixer(chat) {
  const tags = [];
  let nicknameOverride = null;
  let extrasObj = null;
  try { if (chat.extras) extrasObj = JSON.parse(chat.extras); } catch {}

  const mt = chat?.messageTypeCode;
  const amount = extrasObj?.payAmount;
  let payType = extrasObj?.payType || '치즈';
  if (payType === 'CURRENCY') payType = '치즈';

  const donationTypeRaw = (extrasObj?.donationType ?? extrasObj?.DonationType ?? '')
    .toString().trim().toUpperCase();

  if (mt === 10) {
    const isMission = donationTypeRaw === 'MISSION' || donationTypeRaw === 'MISSION_PARTICIPATION';
    if (isMission) {
      const missionType = (extrasObj?.missionDonationType ?? extrasObj?.MissionDonationType ?? '')
        .toString().trim().toUpperCase();
      const missionTag = missionType === 'PARTICIPATION' ? '미션 후원-쌓기' : '미션 후원-개설';
      if (amount != null) tags.push(`[${missionTag} ${amount}${payType}]`);
      else tags.push(`[${missionTag}]`);
    } else if (donationTypeRaw === 'VIDEO') {
      if (amount != null) tags.push(`[영상 후원 ${amount}${payType}]`);
      else tags.push(`[영상 후원]`);
    } else {
      if (amount != null) tags.push(`[후원 ${amount}${payType}]`);
      else tags.push(`[후원]`);
    }
  }

  if (mt === 11) {
    let months =
      extrasObj?.month ?? extrasObj?.subscribeMonth ?? extrasObj?.subscriptionMonth ??
      extrasObj?.periodMonth ?? extrasObj?.months;
    if (!months) {
      try {
        const profile = chat.profile ? JSON.parse(chat.profile) : null;
        months = profile?.streamingProperty?.subscription?.accumulativeMonth;
      } catch {}
    }
    tags.push(months ? `[${months}개월 구독]` : `[구독]`);
  }

  if (mt === 12) {
    const qty = Number(extrasObj?.quantity ?? 0);
    const receiver =
      extrasObj?.receiverNickname ??
      extrasObj?.receiverUserNickname ??
      extrasObj?.receiverNick ??
      extrasObj?.receiverName ??
      null;
    if (qty >= 2) tags.push(`[구독권 선물 x${qty}]`);
    else if (receiver) tags.push(`[구독권 선물] ${receiver}`);
    else tags.push(`[구독권 선물]`);
  }

  if (extrasObj?.isAnonymous === true || chat.userIdHash === 'anonymous') {
    nicknameOverride = '익명의 후원자';
  }

  return { prefix: tags.join(' '), nicknameOverride };
}

// ===== 저장(서비스 워커: data: URL + 자동 분할) =====
const MAX_DATAURL_BYTES = 20 * 1024 * 1024; // 20MB 임계치
const JSON_CHATS_PER_PART = 50000;          // JSON 파트당 채팅 수(가이드)

function utf8Size(str) { return new TextEncoder().encode(str).length; }
function esc(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }

async function saveCSV_dataURLSmart(rows, fileInfo) {
  const header = '재생시간,닉네임,id,메시지\n';
  const bom = '\ufeff';
  let filename_ = "";
  if (fileInfo.id == ""){
    filename_ = `[${fileInfo.date}]_${fileInfo.nick}_${fileInfo.vod_url_code}`;
  } else {
    filename_ = `[${fileInfo.date}]_${fileInfo.nick}_${fileInfo.id}_${fileInfo.vod_url_code}`;
  }

  // 단일 파일 시도
  let whole = bom + header;
  for (const r of rows) whole += [esc(r.재생시간), esc(r.닉네임), esc(r.id), esc(r.메시지)].join(',') + '\n';
  if (utf8Size(whole) <= MAX_DATAURL_BYTES) {
    const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(whole);
    const filename = `${filename_}.csv`;
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
    return;
  }

  // 분할 저장
  let part = 1;
  let chunk = bom + header;
  let chunkBytes = utf8Size(chunk);

  const commit = async () => {
    const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(chunk);
    const filename = `${filename_}_d_p${String(part).padStart(3, '0')}.csv`;
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

/**
 * TODO: 치지직 전용 filename_ 정의해야함.
 * @param {} rawChats 
 * @param {[nick,id,vod_url_code,date]} fileInfo 
 * @param {} rawTemplate 
 * @returns 
 */
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

function toYMD(val) {
  try {
    if (!val) return null;
    const d = new Date(val);
    if (!isNaN(d)) {
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    const s = String(val);
    const head = s.includes('T') ? s.split('T')[0] : s;
    return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null;
  } catch { return null; }
}
const PROGRESS_KEY = 'soop_progress'; // { pct, text }
const els = {
  url: document.getElementById('soopUrl'),
  start: document.getElementById('startBtn'),
  fill: document.getElementById('progressFill'),
  pct: document.getElementById('progressPct'),
  status: document.getElementById('status')
};

let running = false;
let lastProg = { pct: 0, text: '', ts: 0 };
let watchdog = null;

// 진행률 UI 갱신 헬퍼
function setProgressUI(pct = 0, text = '') {
  const v = Number.isFinite(+pct) ? Math.max(0, Math.min(100, Math.trunc(+pct))) : 0;
  const fillEl = document.getElementById('progressFill'); // 너비 채우는 div
  const pctEl  = document.getElementById('progressPct');  // 숫자 라벨
  const statusEl = document.getElementById('status');     // 상태 문구

  if (fillEl) fillEl.style.width = `${v}%`;
  if (pctEl)  pctEl.textContent = String(v);
  if (statusEl) statusEl.textContent = String(text || '');
}

// 배경 → 팝업 실시간 푸시 수신
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'PROGRESS') return;
  const { pct = 0, text = '' } = msg.payload || {};
  setProgressUI(pct, text);
});

// UI
function setStatus(text, color) {
  if (!els.status) return;
  els.status.textContent = text || '';
  els.status.style.color = color || '#a0a0a0';
}
function setProgress(pct, text) {
  const v = Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.trunc(pct))) : 0;
  if (els.fill) els.fill.style.width = `${v}%`;
  if (els.pct) els.pct.textContent = String(v);
  if (typeof text === 'string') setStatus(text);
}

// 완료 처리(버튼 복원)
function markDone(reason = '완료되었습니다.') {
  running = false;
  if (els.start) els.start.disabled = false;
  setStatus(reason, '#7cd67c');
}

// 진행률 스냅샷 1회 반영
async function refreshProgressOnce() {
  try {
    const obj = await chrome.storage.session.get(PROGRESS_KEY);
    const prog = obj?.[PROGRESS_KEY];
    if (prog && typeof prog.pct === 'number') {
      setProgress(prog.pct, prog.text || '');
      lastProg = { pct: prog.pct, text: prog.text || '', ts: Date.now() };
    }
  } catch {}
}

// 진행률 변경 구독
function subscribeProgress() {
  try {
    chrome.storage.session.onChanged.addListener((changes, area) => {
      if (area !== 'session') return;
      const ch = changes[PROGRESS_KEY];
      if (!ch) return;
      const v = ch.newValue || { pct: 0, text: '' };
      setProgress(v.pct || 0, v.text || '');
      lastProg = { pct: v.pct || 0, text: v.text || '', ts: Date.now() };

      // 완료 신호로 판단하는 조건들을 넓게 처리
      // 1) pct가 100 도달
      // 2) pct가 0 이고 text가 빈 값(배경이 초기화한 경우)
      if (running && (v.pct >= 100 || (v.pct === 0 && (!v.text || v.text === '')))) {
        markDone('다음 작업을 시작할 수 있어요.');
      }
    });
  } catch {}
}

// 워치독: 진행률 갱신이 오래 멈추면 버튼 복원(배경 초기화 미동작 대비)
function startWatchdog(ms = 1000, idleMs = 10000) {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (!running) return;
    const since = Date.now() - (lastProg.ts || 0);
    // 진행률이 8초 이상 갱신되지 않았고, 현재 100%이거나(일반적 완주) 아예 미갱신이면 버튼 복원
    if (since > idleMs && (lastProg.pct >= 100 || lastProg.ts === 0)) {
    }
  }, ms);
}
function stopWatchdog() {
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
}

// URL 입력 저장/복원(편의)
async function loadPrefs() {
  try {
    const { lastUrl } = await chrome.storage.local.get('lastUrl');
    if (lastUrl && els.url) els.url.value = lastUrl;
  } catch {}
}
async function savePrefs() {
  try {
    const val = els.url?.value || '';
    await chrome.storage.local.set({ lastUrl: val });
  } catch {}
}

// background로 시작 요청
function sendStartCsv(urlOrId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'START_CSV', soop_vod_url: urlOrId }, // background.js가 기대하는 형식 유지
      (resp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve({ ok: false, message: err.message || String(err) });
          return;
        }
        resolve(resp || { ok: true });
      }
    );
  });
}

// 시작 버튼
els.start?.addEventListener('click', async () => {
  const input = (els.url?.value || '').trim();
  if (!input) {
    setStatus('URL 또는 숫자 ID를 입력해 주세요.', '#ff8a8a');
    return;
  }
  await savePrefs();

  if (running) {
    setStatus('이미 실행 중입니다.', '#ffcf70');
    return;
  }

  try {
    els.start.disabled = true;
    running = true;
    lastProg = { pct: 0, text: '', ts: 0 };
    setStatus('시작 요청 전송…');

    const resp = await sendStartCsv(input);
    if (!resp?.ok) {
      setStatus(`시작 실패: ${resp?.message || '알 수 없는 오류'}`, '#ff8a8a');
      running = false;
      els.start.disabled = false;
      return;
    }

    setStatus('백그라운드 실행 중…');
    await refreshProgressOnce(); // 초기 스냅샷 즉시 반영
    startWatchdog();             // 완료 신호 누락 대비

  } catch (e) {
    setStatus(`오류: ${e?.message || e}`, '#ff8a8a');
    running = false;
    els.start.disabled = false;
  }
});

// 초깃값 반영
(async function init() {
  subscribeProgress();
  await loadPrefs();
  await refreshProgressOnce();
  startWatchdog();
})();

// 로드취소 이벤트 수정본
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    stopWatchdog();
  }
});